(function () {
  const steps = ["intro", "availability", "time", "activity", "place", "note", "review", "sent"];
  const dotSteps = ["availability", "time", "activity", "place", "note"];
  const state = { free: null, time: null, activity: null, place: null };
  const stepEls = {};
  const hourEl = document.getElementById("exactHour");
  const minuteEl = document.getElementById("exactMinute");
  const periodButtons = [...document.querySelectorAll("[data-period]")];
  let exactPeriod = null;

  steps.forEach((step) => { stepEls[step] = document.querySelector(`[data-step="${step}"]`); });
  for (let hour = 1; hour <= 12; hour += 1) {
    const option = document.createElement("option");
    option.value = String(hour);
    option.textContent = String(hour).padStart(2, "0");
    hourEl.append(option);
  }
  for (let minute = 0; minute < 60; minute += 1) {
    const option = document.createElement("option");
    option.value = String(minute).padStart(2, "0");
    option.textContent = option.value;
    minuteEl.append(option);
  }

  function setGreeting() {
    document.getElementById("greeting-name").textContent = CONFIG.greeting || `Hey ${CONFIG.herName || "you"}`;
    document.getElementById("availability-heading").textContent =
      `Are you free ${CONFIG.dateLabel || "this Saturday"}?`;
    document.getElementById("plan-date").textContent = `${CONFIG.dateLabel || "Saturday"} · 2:30 p.m. · Bern`;
  }

  function currentStepName() {
    return steps.find((step) => stepEls[step].classList.contains("is-active"));
  }

  function showStep(name) {
    const previousName = currentStepName();
    const forward = steps.indexOf(name) >= steps.indexOf(previousName);
    steps.forEach((step) => {
      const element = stepEls[step];
      element.classList.toggle("is-active", step === name);
      element.classList.toggle("enter-forward", step === name && forward);
      element.classList.toggle("enter-backward", step === name && !forward);
    });
    updateProgress(name);
    if (name === "review") renderSummary();
    if (name === "sent") renderSentDetails();

    const heading = stepEls[name].querySelector("h1, h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }

    if (name !== previousName && window.innerHeight < 760) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById("question-card").scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center"
      });
    }
  }

  function updateProgress(name) {
    const idx = dotSteps.indexOf(name);
    const progress = document.getElementById("progress");
    const fill = document.getElementById("progress-fill");
    progress.classList.toggle("is-hidden", idx === -1);
    progress.setAttribute("aria-valuenow", String(idx < 0 ? 0 : idx + 1));
    if (idx >= 0) {
      document.getElementById("progress-count").innerHTML =
        `${String(idx + 1).padStart(2, "0")} <i>/ 05</i>`;
      fill.style.width = `${((idx + 1) / dotSteps.length) * 100}%`;
    }
  }

  function startCountdown() {
    const parts = String(CONFIG.dateISO || "").split("-").map(Number);
    const countdown = document.getElementById("countdown");
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 1)) {
      countdown.hidden = true;
      return;
    }

    const [year, month, day] = parts;
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
      countdown.hidden = true;
      return;
    }

    const target = dateInTimeZone(year, month, day, 14, 30, "Europe/Zurich");
    const endOfDate = dateInTimeZone(year, month, day + 1, 0, 0, "Europe/Zurich");
    document.getElementById("countdown-date").textContent = CONFIG.dateLabel || "Saturday";
    const valueEls = {
      days: document.getElementById("countdown-days"),
      hours: document.getElementById("countdown-hours"),
      minutes: document.getElementById("countdown-minutes"),
      seconds: document.getElementById("countdown-seconds")
    };
    const values = document.getElementById("countdown-values");
    const message = document.getElementById("countdown-message");
    let timer;

    function update() {
      const remaining = target.getTime() - Date.now();
      if (remaining <= 0) {
        values.hidden = true;
        message.hidden = false;
        message.textContent = Date.now() < endOfDate.getTime()
          ? "It's here — have the loveliest day together."
          : "Hope your Saturday was wonderful.";
        if (timer) window.clearInterval(timer);
        return;
      }

      const totalSeconds = Math.floor(remaining / 1000);
      valueEls.days.textContent = String(Math.floor(totalSeconds / 86400)).padStart(2, "0");
      valueEls.hours.textContent = String(Math.floor((totalSeconds % 86400) / 3600)).padStart(2, "0");
      valueEls.minutes.textContent = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
      valueEls.seconds.textContent = String(totalSeconds % 60).padStart(2, "0");
    }

    update();
    timer = window.setInterval(update, 1000);
  }

  function dateInTimeZone(year, month, day, hour, minute, timeZone) {
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    let timestamp = desired;
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
      const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      timestamp += desired - represented;
    }
    return new Date(timestamp);
  }

  function goNext() {
    const next = steps[steps.indexOf(currentStepName()) + 1];
    if (next) showStep(next);
  }

  function goBack() {
    const previous = steps[steps.indexOf(currentStepName()) - 1];
    if (previous) showStep(previous);
  }

  function clearExactTime() {
    hourEl.value = "";
    minuteEl.value = "";
    exactPeriod = null;
    periodButtons.forEach((button) => {
      button.classList.remove("selected");
      button.setAttribute("aria-pressed", "false");
    });
  }

  function exactTimeValue() {
    if (!hourEl.value || !minuteEl.value || !exactPeriod) return "";
    let hour = Number(hourEl.value) % 12;
    if (exactPeriod === "PM") hour += 12;
    return `${String(hour).padStart(2, "0")}:${minuteEl.value}`;
  }

  document.querySelectorAll(".choices").forEach((group) => {
    const field = group.dataset.field;
    group.addEventListener("click", (event) => {
      const button = event.target.closest(".choice");
      if (!button) return;

      group.querySelectorAll(".choice").forEach((choice) => {
        choice.classList.toggle("selected", choice === button);
        choice.setAttribute("aria-pressed", String(choice === button));
      });
      state[field] = button.dataset.value;

      const step = button.closest(".step");
      if (field === "time") clearExactTime();
      step.querySelectorAll(".reveal").forEach((reveal) => {
        const show = reveal.dataset.revealFor === button.dataset.value;
        reveal.classList.toggle("is-visible", show);
        const input = reveal.querySelector("input");
        if (show) input?.focus();
        else if (input) input.value = "";
      });

      validateStep(step);

      if (field === "activity") {
        const message = document.getElementById("activity-message");
        message.textContent = button.dataset.message || "A custom plan. The plot thickens.";
        message.classList.add("is-revealed");
      }
      if (field === "place") updatePlaceMapPreview(button);
    });
  });

  periodButtons.forEach((button) => {
    button.addEventListener("click", () => {
      exactPeriod = button.dataset.period;
      state.time = null;
      document.querySelectorAll('.choices[data-field="time"] .choice').forEach((choice) => {
        choice.classList.remove("selected");
        choice.setAttribute("aria-pressed", "false");
      });
      periodButtons.forEach((periodButton) => {
        const selected = periodButton === button;
        periodButton.classList.toggle("selected", selected);
        periodButton.setAttribute("aria-pressed", String(selected));
      });
      validateStep(button.closest(".step"));
    });
  });

  [hourEl, minuteEl].forEach((select) => {
    select.addEventListener("change", () => {
      state.time = null;
      document.querySelectorAll('.choices[data-field="time"] .choice').forEach((choice) => {
        choice.classList.remove("selected");
        choice.setAttribute("aria-pressed", "false");
      });
      validateStep(select.closest(".step"));
    });
  });

  document.querySelectorAll('input[type="text"], textarea').forEach((element) => {
    element.addEventListener("input", () => validateStep(element.closest(".step")));
  });

  function validateStep(step) {
    const nextButton = step.querySelector('[data-action="next"]');
    if (!nextButton) return;

    const name = step.dataset.step;
    let valid = true;
    if (name === "availability") {
      valid = state.free === "yes" || (state.free === "other" && value("altTime"));
    } else if (name === "time") {
      valid = !!state.time || !!exactTimeValue();
    } else if (name === "activity") {
      valid = (state.activity && state.activity !== "other") || (state.activity === "other" && value("customActivity"));
    } else if (name === "place") {
      valid = (state.place && state.place !== "other") || (state.place === "other" && value("customPlace"));
    }

    nextButton.disabled = !valid;
  }

  function value(id) {
    return document.getElementById(id).value.trim();
  }

  function formatTime(time) {
    const [hourValue, minuteValue] = time.split(":").map(Number);
    const period = hourValue >= 12 ? "PM" : "AM";
    const hour = ((hourValue + 11) % 12) + 1;
    return `${hour}:${String(minuteValue).padStart(2, "0")} ${period}`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function pickedTime() {
    const exact = exactTimeValue();
    return exact ? formatTime(exact) : state.time;
  }

  function pickedActivity() {
    return state.activity === "other" ? value("customActivity") : state.activity;
  }

  function pickedPlace() {
    return state.place === "other" ? value("customPlace") : state.place;
  }

  function getMapTarget() {
    if (state.place === "other" && value("customPlace")) {
      return { query: value("customPlace"), label: "Open in Maps", sentLabel: "Open our spot in Maps" };
    }
    const selectedPlace = document.querySelector('.choices[data-field="place"] .choice.selected');
    if (selectedPlace?.dataset.mapQuery) {
      return { query: selectedPlace.dataset.mapQuery, label: "See this spot in Maps", sentLabel: "Open our spot in Maps" };
    }
    return null;
  }

  function mapUrl(target) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target.query)}`;
  }

  function updatePlaceMapPreview(button) {
    const link = document.getElementById("place-map-link");
    if (button.dataset.mapQuery) {
      link.href = mapUrl({ query: button.dataset.mapQuery });
      link.hidden = false;
    } else {
      link.hidden = true;
    }
  }

  function updateMapLinks() {
    const target = getMapTarget();
    const summaryWrap = document.getElementById("summary-map-wrap");
    const summaryLink = document.getElementById("summary-map-link");
    const sentLink = document.getElementById("sent-map-link");
    if (!target) {
      summaryWrap.hidden = true;
      sentLink.hidden = true;
      return;
    }

    const url = mapUrl(target);
    summaryWrap.hidden = false;
    summaryLink.href = url;
    summaryLink.querySelector("span").textContent = target.label;
    sentLink.hidden = false;
    sentLink.href = url;
    sentLink.querySelector("span").textContent = target.sentLabel;
  }

  function renderSentDetails() {
    const name = CONFIG.herName || "you";
    const note = CONFIG.closingNote || "Can't wait to spend Saturday with you, {name}.";
    document.getElementById("closing-note").textContent = note.replace(/\{name\}/g, name);
    const date = state.free === "yes" ? (CONFIG.dateLabel || "Saturday") : (value("altTime") || "Alternate date to arrange");
    const time = pickedTime() || "2:30 PM";
    document.getElementById("sent-lede").textContent = `${CONFIG.dateLabel || "Saturday"} · 2:30 p.m. · Bern`;
    const rows = [
      ["Date", date],
      ["Time", `${time} · Bern time`],
      ["Plan", pickedActivity() || "Walk around Bern, go shopping, and get chicken nuggets at McDonald's"],
      ["Meeting spot", pickedPlace() || "Bern Old Town"]
    ];
    document.getElementById("sent-summary").innerHTML = rows
      .map(([key, result]) => `<div class="row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(result)}</dd></div>`)
      .join("");
    updateMapLinks();
  }

  function renderSummary() {
    const rows = [
      ["Saturday", state.free === "yes" ? "Yes, I'm free" : `Another day — ${value("altTime") || "no alternative given"}`],
      ["Time", pickedTime() || "—"],
      ["Doing", pickedActivity() || "—"],
      ["Where", pickedPlace() || "—"]
    ];
    const note = value("note");
    if (note) rows.push(["Note", note]);

    document.getElementById("summary").innerHTML = rows
      .map(([key, result]) => `<div class="row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(result)}</dd></div>`)
      .join("");
    updateMapLinks();
  }

  function buildMessage() {
    const herName = CONFIG.herName || "She";
    const lines = [
      state.free === "yes"
        ? `${CONFIG.dateLabel || "Saturday"}: ${herName} is free!`
        : `${CONFIG.dateLabel || "Saturday"}: not free. Alternative: ${value("altTime") || "none given"}`,
      `Time: ${pickedTime() || "no preference"}`,
      `Doing: ${pickedActivity() || "no preference"}`,
      `Where: ${pickedPlace() || "no preference"}`
    ];
    const note = value("note");
    if (note) lines.push(`Note: ${note}`);
    return lines.join("\n");
  }

  async function send() {
    const sendButton = document.querySelector('[data-action="send"]');
    const error = document.getElementById("sendError");
    error.hidden = true;
    sendButton.disabled = true;
    sendButton.innerHTML = 'Sending <span class="loading-dots" aria-hidden="true">…</span>';

    try {
      if (!CONFIG.ntfyTopic) throw new Error("missing-topic");
      const response = await fetch("https://ntfy.sh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: CONFIG.ntfyTopic,
          title: `${CONFIG.herName || "Saturday plans"} answered your Saturday question`,
          message: buildMessage(),
          priority: 4
        })
      });
      if (!response.ok) throw new Error("bad-response");
      showStep("sent");
    } catch (error) {
      document.getElementById("sendError").hidden = false;
      sendButton.disabled = false;
      sendButton.innerHTML = 'Send <svg class="icon"><use href="#icon-send"></use></svg>';
    }
  }

  document.addEventListener("click", (event) => {
    const flower = event.target.closest("#flower-note");
    if (flower) {
      const message = document.getElementById("flower-message");
      const expanded = flower.getAttribute("aria-expanded") === "true";
      flower.setAttribute("aria-expanded", String(!expanded));
      message.hidden = expanded;
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "next") goNext();
    else if (button.dataset.action === "back") goBack();
    else if (button.dataset.action === "send") send();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || ["TEXTAREA", "SELECT", "BUTTON"].includes(event.target.tagName)) return;
    const step = stepEls[currentStepName()];
    const nextButton = step.querySelector('[data-action="next"]:not(:disabled)');
    if (nextButton) nextButton.click();
  });

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.getElementById("background-video").pause();
  }

  setGreeting();
  startCountdown();
  showStep("intro");
})();
