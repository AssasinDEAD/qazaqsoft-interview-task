// app.js
// Ключ для сохранения состояния в localStorage
const STORAGE_KEY = "quiz_state_v1";

/* 
   - shuffle: случайная перестановка массива (Fisher–Yates)
    */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/* 
   - Question хранит текст, варианты и индекс правильного варианта
   - optionsMapped: каждый элемент { text, originalIndex, isCorrect }
   - shuffleOptions: перемешивает варианты (сохраняет флаг isCorrect)
    */
class Question {
  constructor({ id, text, options, correctIndex }) {
    this.id = id;
    this.text = text;
    this.optionsMapped = options.map((opt, idx) => ({
      text: opt,
      originalIndex: idx,
      isCorrect: idx === correctIndex,
    }));
  }
  shuffleOptions() {
    shuffle(this.optionsMapped);
  }
}

/* 
   - Хранит состояние теста, управление таймером, рендер и сохранение
   - Основные поля: questions, currentIndex, answers, analytics, timerSec
    */
class QuizEngine {
  constructor() {
    this.data = null;               
    this.questions = [];            
    this.currentIndex = 0;          
    this.answers = [];              
    this.analytics = [];           
    this.timerSec = 0;              
    this._timerInterval = null;     
    this.questionStartTs = 0;       
    this.elements = this._cacheElements();
    this._bindUI();
  }

  /* 
     Поиск и сохранение DOM-элементов
      */
  _cacheElements() {
    return {
      title: document.getElementById("quiz-title"),
      progress: document.getElementById("progress"),
      timer: document.getElementById("timer"),
      questionText: document.getElementById("question-text"),
      optionsForm: document.getElementById("options-form"),
      btnNext: document.getElementById("btn-next"),
      btnPrev: document.getElementById("btn-prev"),
      btnFinish: document.getElementById("btn-finish"),
      resultSection: document.getElementById("result-section"),
      questionSection: document.getElementById("question-section"),
      mainActions: document.querySelector(".actions"),
      btnReview: document.getElementById("btn-review"),
      btnRestart: document.getElementById("btn-restart"),
    };
  }

  /* 
     - кнопки: Далее, Назад, Завершить, Пройти заново, Посмотреть ответы
     - keyboard navigation внутри блока опций
      */
  _bindUI() {
    this.elements.btnNext.addEventListener("click", () => this.next());
    this.elements.btnPrev.addEventListener("click", () => this.prev());
    this.elements.btnFinish.addEventListener("click", () => this.finish());
    this.elements.btnRestart.addEventListener("click", () => this.restart());
    this.elements.btnReview.addEventListener("click", () => this.showReview());
    this.elements.optionsForm.addEventListener("keydown", (e) => this._onOptionsKeydown(e));
  }

  /* 
     - try/catch для обработки ошибок загрузки
     - после загрузки подготавливаем вопросы и пытаемся восстановить состояние
      */
  async loadFromFile(url = "data/questions.json") {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      this.data = await res.json();
    } catch (err) {
      console.error("Не удалось загрузить вопросы:", err);
      this.elements.title.textContent = "Ошибка загрузки теста";
      return;
    }
    this._prepareQuestions();
    const saved = this._loadState();
    if (saved) this._restoreState(saved);
    else this._initNew();
    this.renderCurrent();
    this._startTimerLoop();
  }

  /* 
     - маппим raw -> Question
     - опционально перемешиваем вопросы и варианты
     - устанавливаем таймер и порог прохождения
      */
  _prepareQuestions() {
    const rawQuestions = (this.data && this.data.questions) || [];
    this.questions = rawQuestions.map((q) => new Question(q));
    if (this.data.shuffleQuestions !== false) shuffle(this.questions);
    this.questions.forEach((q) => q.shuffleOptions());
    this.timerSec = Number(this.data.timeLimitSec) || 0;
    this.passThreshold = Number(this.data.passThreshold) || 0.7;
    this.elements.title.textContent = this.data.title || "Тест";
  }

  /* 
     - сбрасываем индексы, ответы и аналитику
     - сохраняем состояние
      */
  _initNew() {
    this.currentIndex = 0;
    this.answers = new Array(this.questions.length).fill(null);
    this.analytics = new Array(this.questions.length).fill(null);
    this._saveState();
  }

  /* 
     - state содержит: currentIndex, answers, analytics, timerSec и порядок опций
     - try/catch на запись, безопасное чтение с проверкой JSON
      */
  _saveState() {
    try {
      const state = {
        savedAt: Date.now(),
        currentIndex: this.currentIndex,
        answers: this.answers,
        analytics: this.analytics,
        timerSec: this.timerSec,
        questionsOrder: this.questions.map((q) => q.optionsMapped.map((o) => o.originalIndex)),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("Не удалось сохранить состояние:", err);
    }
  }

  _loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /* 
     - корректирует порядок опций по сохранённому состоянию
     - восстанавливает индекс текущего вопроса, ответы и таймер
      */
  _restoreState(state) {
    if (state.questionsOrder && state.questionsOrder.length === this.questions.length) {
      this.questions.forEach((q, qi) => {
        const order = state.questionsOrder[qi];
        if (Array.isArray(order)) {
          const mapByOrig = new Map(q.optionsMapped.map((o) => [o.originalIndex, o]));
          q.optionsMapped = order.map((orig) => mapByOrig.get(orig));
        }
      });
    }
    this.currentIndex = Math.min(Math.max(0, state.currentIndex || 0), this.questions.length - 1);
    this.answers = Array.isArray(state.answers) ? state.answers.slice(0, this.questions.length) : new Array(this.questions.length).fill(null);
    this.analytics = Array.isArray(state.analytics) ? state.analytics.slice(0, this.questions.length) : new Array(this.questions.length).fill(null);
    this.timerSec = Number(state.timerSec) || this.timerSec || 0;
  }

  /* 
     - генерирует label + input для каждого варианта
     - восстанавливает выбранный вариант и добавляет класс selected для визуала
     - сохраняет время показа вопроса (для аналитики)
      */
  renderCurrent() {
    const q = this.questions[this.currentIndex];
    if (!q) return;
    this.questionStartTs = Date.now();
    this.elements.questionText.textContent = q.text;

    const form = this.elements.optionsForm;
    form.innerHTML = "";
    form.setAttribute("role", "radiogroup");
    form.setAttribute("aria-labelledby", "question-text");

    q.optionsMapped.forEach((opt, optIndex) => {
      const label = document.createElement("label");
      label.className = "option";
      label.tabIndex = 0;
      label.dataset.optIndex = optIndex;

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "option";
      input.value = optIndex;
      input.id = `q${this.currentIndex}_opt${optIndex}`;
      input.setAttribute("aria-label", opt.text);

      const checkedIndex = this.answers[this.currentIndex];
      if (checkedIndex === optIndex) {
        input.checked = true;
        label.classList.add("selected");
        this.elements.btnNext.disabled = false;
        this.elements.btnFinish.disabled = false;
      }

      // при изменении помечаем выбранный label, сохраняем ответ и включаем кнопки навигации
      input.addEventListener("change", () => {
        Array.from(form.querySelectorAll(".option")).forEach((el) => el.classList.remove("selected"));
        label.classList.add("selected");
        this.elements.btnNext.disabled = false;
        this.elements.btnFinish.disabled = false;
        this._saveSelectedOption(optIndex);
      });

      label.appendChild(input);
      label.appendChild(document.createTextNode(" " + opt.text));
      form.appendChild(label);
    });

    this.elements.btnPrev.disabled = this.currentIndex === 0;
    const isLast = this.currentIndex === this.questions.length - 1;
    this.elements.btnFinish.classList.toggle("hidden", !isLast);
    this.elements.btnNext.classList.toggle("hidden", isLast);

    if (this.answers[this.currentIndex] == null) {
      this.elements.btnNext.disabled = true;
      this.elements.btnFinish.disabled = true;
    }

    this._updateProgress();
  }

  /* 
     - сохраняет выбранный индекс (в optionsMapped)
     - считает время, отмечает correct и диспатчит _saveState
      */
  _saveSelectedOption(optIndex) {
    const q = this.questions[this.currentIndex];
    const isCorrect = !!q.optionsMapped[optIndex]?.isCorrect;
    this.answers[this.currentIndex] = optIndex;
    const timeSpent = Math.round((Date.now() - this.questionStartTs) / 1000);
    this.analytics[this.currentIndex] = { id: q.id, timeSpentSec: timeSpent, correct: isCorrect };
    this._saveState();
  }

  /* 
     - перед переходом сохраняем текущий выбор (если есть)
     - обновляем DOM и сохраняем состояние
      */
  next() {
    const selected = this.elements.optionsForm.querySelector("input[type=radio]:checked");
    if (selected) this._saveSelectedOption(Number(selected.value));
    if (this.currentIndex < this.questions.length - 1) {
      this.currentIndex++;
      this.renderCurrent();
      this._saveState();
    }
  }

  prev() {
    const selected = this.elements.optionsForm.querySelector("input[type=radio]:checked");
    if (selected) this._saveSelectedOption(Number(selected.value));
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.renderCurrent();
      this._saveState();
    }
  }

  /* 
     - считает количество правильных ответов, процент и статус
     - выводит краткую аналитику (время/правильно/неправильно)
     - очищает сохранение (чтобы новый запуск был чистым)
      */
  finish() {
    const selected = this.elements.optionsForm.querySelector("input[type=radio]:checked");
    if (selected) this._saveSelectedOption(Number(selected.value));

    let correctCount = 0;
    for (let i = 0; i < this.questions.length; i++) {
      const ans = this.answers[i];
      const isCorrect = ans != null && this.questions[i].optionsMapped[ans]?.isCorrect;
      if (isCorrect) correctCount++;
      if (!this.analytics[i]) this.analytics[i] = { id: this.questions[i].id, timeSpentSec: 0, correct: !!isCorrect };
    }

    const total = this.questions.length;
    const percent = Math.round((correctCount / total) * 100);
    const passed = correctCount / total >= this.passThreshold;

    const rs = this.elements.resultSection;
    rs.innerHTML = "";
    const h2 = document.createElement("h2"); h2.textContent = "Результат";
    const p = document.createElement("p"); p.id = "result-summary";
    p.textContent = `Правильных ответов: ${correctCount}/${total} (${percent}%) — ${passed ? "✅ Сдано" : "❌ Не сдано"}`;
    rs.appendChild(h2); rs.appendChild(p);

    const analyticsTitle = document.createElement("h3"); analyticsTitle.textContent = "Аналитика";
    rs.appendChild(analyticsTitle);
    this.analytics.forEach((a, i) => {
      const q = this.questions[i];
      const pp = document.createElement("p");
      pp.textContent = `Вопрос ${i + 1}: ${q.text} — ${a && a.correct ? "правильно" : "неправильно"}, время: ${a ? a.timeSpentSec : 0} сек.`;
      rs.appendChild(pp);
    });

    const actionsWrap = document.createElement("div"); actionsWrap.className = "actions";
    const btnReview = document.createElement("button"); btnReview.className = "btn"; btnReview.textContent = "Посмотреть ответы";
    btnReview.addEventListener("click", () => this.showReview());
    const btnRestart = document.createElement("button"); btnRestart.className = "btn btn-primary"; btnRestart.textContent = "Пройти заново";
    btnRestart.addEventListener("click", () => this.restart());
    actionsWrap.appendChild(btnReview); actionsWrap.appendChild(btnRestart);
    rs.appendChild(actionsWrap);

    rs.classList.remove("hidden");
    this.elements.questionSection.classList.add("hidden");
    this.elements.mainActions.classList.add("hidden");
    this._stopTimerLoop();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  /* 
     - не заменяет текст вариантов
     - не использует inline-стили для подсветки
     - добавляет классы: correct, selected, selected-incorrect и data-атрибут meta
     - CSS должен обрабатывать визуализацию по этим классам
      */
  showReview() {
    const rs = this.elements.resultSection;
    rs.innerHTML = "<h2>Ваши ответы</h2>";

    this.questions.forEach((q, i) => {
      const card = document.createElement("div");
      card.className = "card review-card";

      const qTitle = document.createElement("p");
      qTitle.innerHTML = `<b>${i + 1}. ${q.text}</b>`;
      card.appendChild(qTitle);

      q.optionsMapped.forEach((opt, oi) => {
        const p = document.createElement("p");
        p.className = "review-option";
        p.textContent = opt.text; // сохраняем исходный текст

        const userSelected = this.answers[i] === oi;
        if (opt.isCorrect) p.classList.add("correct");
        if (userSelected && !opt.isCorrect) p.classList.add("selected-incorrect");
        if (userSelected) p.classList.add("selected");

        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = [
          opt.isCorrect ? "Правильно" : "",
          userSelected ? "Ваш выбор" : ""
        ].filter(Boolean).join(" · ");
        if (meta.textContent) p.appendChild(meta);

        card.appendChild(p);
      });

      rs.appendChild(card);
    });

    const btnBack = document.createElement("button");
    btnBack.className = "btn";
    btnBack.textContent = "Вернуться к результату";
    btnBack.addEventListener("click", () => this.finish());
    rs.appendChild(btnBack);

    rs.classList.remove("hidden");
    this.elements.questionSection.classList.add("hidden");
    this.elements.mainActions.classList.add("hidden");
  }

  /* 
     - заново подготавливает вопросы и сбрасывает прогресс
      */
  restart() {
    this._prepareQuestions();
    this._initNew();
    this.elements.resultSection.classList.add("hidden");
    this.elements.questionSection.classList.remove("hidden");
    this.elements.mainActions.classList.remove("hidden");
    this.renderCurrent();
    this._startTimerLoop();
  }

  /* 
     - улучшает доступность
      */
  _onOptionsKeydown(e) {
    const radios = Array.from(this.elements.optionsForm.querySelectorAll("input[type=radio]"));
    if (!radios.length) return;
    const current = radios.findIndex((r) => r === document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault(); radios[(current + 1) % radios.length].focus();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault(); radios[(current - 1 + radios.length) % radios.length].focus();
    } else if (e.key === "Enter") {
      const selected = this.elements.optionsForm.querySelector("input[type=radio]:checked");
      if (selected) {
        this.elements.btnNext.disabled = false;
        this.elements.btnFinish.disabled = false;
        this.elements.btnNext.focus();
      }
    }
  }

  /* 
     Обновление прогресса (текст "Вопрос X/N")
      */
  _updateProgress() {
    this.elements.progress.textContent = `Вопрос ${this.currentIndex + 1}/${this.questions.length}`;
  }

  /* 
     - запускает интервал, обновляет DOM каждую секунду
     - при 0 автоматом вызывает finish()
     - сохраняет оставшееся время каждую секунду
      */
  _startTimerLoop() {
    this._stopTimerLoop();
    const timerEl = this.elements.timer;
    const tick = () => {
      const min = String(Math.floor(this.timerSec / 60)).padStart(2, "0");
      const sec = String(this.timerSec % 60).padStart(2, "0");
      timerEl.textContent = `${min}:${sec}`;
      if (this.timerSec <= 0) { this.finish(); return; }
      this.timerSec--;
      this._saveState();
    };
    tick();
    this._timerInterval = setInterval(tick, 1000);
  }

  _stopTimerLoop() {
    if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
  }
}

/* 
   - try/catch защищает от ошибок инициализации
    */
window.addEventListener("DOMContentLoaded", () => {
  try {
    const engine = new QuizEngine();
    engine.loadFromFile("data/questions.json");
  } catch (err) {
    console.error("Ошибка инициализации теста:", err);
  }
});
