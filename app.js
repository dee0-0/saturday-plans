(function () {
  const TIME_ZONE = "Europe/Zurich";
  const steps = ["loading", "intro", "ask", "date", "time", "activity", "place", "note", "review", "planned", "coupons", "game", "journal", "next", "outfits", "snacks", "movies", "ideas", "question"];
  const extraSteps = ["planned", "coupons", "game", "journal", "outfits", "snacks", "movies", "ideas", "question"];
  const questionSteps = ["date", "time", "activity", "place", "note"];
  const state = { date: "", time: "", activity: null, place: null, "next-activity": null };
  // The "Something else" text field that belongs to each choice group.
  const customInputs = { activity: "customActivity", place: "customPlace", "next-activity": "nextCustomActivity" };
  // Heading and send button on the review step for each way into the questions.
  const reviewCopy = {
    invite: { heading: "Here’s the plan you’re setting", button: "Set this date", saving: "Setting the plan…" },
    reschedule: { heading: "Review your changes", button: "Save changes", saving: "Saving changes…" },
    next: { heading: "Our next date", button: "Plan our next date", saving: "Planning our next date…" }
  };
  const stepEls = Object.fromEntries(steps.map((name) => [name, document.querySelector(`[data-step="${name}"]`)]));
  const dateInput = document.getElementById("planDate");
  const timeInput = document.getElementById("planTime");
  const timePickerHint = document.getElementById("time-picker-hint");
  const serviceNote = document.getElementById("service-note");
  const apiRoot = String(CONFIG.planApiUrl || "").replace(/\/+$/, "").replace(/\/plan$/, "");
  // Opening the link with ?preview uses a separate sandbox store, so everything
  // can be tried out without touching her real letter.
  const previewMode = new URLSearchParams(window.location.search).has("preview");
  const apiUrl = (path) => previewMode ? `${apiRoot}${path}${path.includes("?") ? "&" : "?"}store=preview` : `${apiRoot}${path}`;
  const dayparts = {
    morning: { label: "Morning", time: "09:00" },
    afternoon: { label: "Afternoon", time: "14:00" },
    evening: { label: "Evening", time: "18:00" },
    night: { label: "Night", time: "21:00" }
  };
  let datePicker = null;
  let timePicker = null;
  let selectedDaypart = "";
  let activePlan = null;
  let isRescheduling = false;
  // True while the questions are planning a new date after the current one happened.
  let planningNext = false;
  // The idea pulled from the ideas jar for the next date: { id, activity } or null.
  let jarIdea = null;
  // Where "Back" on the next-date page leads: the journal, or the jar when "Plan it" opened it.
  let nextBackStep = "journal";
  let countdownTimer = null;

  function iconMarkup(name) {
    const icon = document.querySelector(`svg.lucide-${name}`);
    return icon ? icon.cloneNode(true).outerHTML : "";
  }

  function refreshIcons() {
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  function currentStepName() {
    return steps.find((name) => stepEls[name].classList.contains("is-active"));
  }

  // `forward` overrides the slide direction for jumps that skip around the step list
  // (the next-date page sits at the end of `steps` but leads into the first question).
  function showStep(name, { forward: direction } = {}) {
    const previous = currentStepName();
    const forward = typeof direction === "boolean" ? direction : steps.indexOf(name) >= steps.indexOf(previous);
    document.body.classList.toggle("is-envelope-landing", name === "intro");
    steps.forEach((step) => {
      const element = stepEls[step];
      element.classList.toggle("is-active", step === name);
      element.classList.toggle("enter-forward", step === name && forward);
      element.classList.toggle("enter-backward", step === name && !forward);
    });
    updateProgress(name);
    if (["date", "time", "activity", "place", "next"].includes(name)) validateStep(stepEls[name]);
    if (name === "review") renderSummary();
    if (name === "planned") renderPlan();
    window.LetterFX?.enterStep(stepEls[name], name, previous);
    document.dispatchEvent(new CustomEvent("date:step", { detail: { name, previous } }));

    const heading = stepEls[name].querySelector("h1, h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    if (name !== previous && window.innerHeight < 760) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById("question-card").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    }
  }

  function updateProgress(name) {
    const index = questionSteps.indexOf(name);
    const progress = document.getElementById("progress");
    progress.classList.toggle("is-hidden", index < 0);
    progress.setAttribute("aria-valuenow", String(index < 0 ? 0 : index + 1));
    if (index >= 0) {
      document.getElementById("progress-count").innerHTML = `${String(index + 1).padStart(2, "0")} <i>/ 05</i>`;
      document.getElementById("progress-fill").style.width = `${((index + 1) / questionSteps.length) * 100}%`;
    }
  }

  function datePartsInBern(date = new Date()) {
    return Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date).map(({ type, value }) => [type, value]));
  }

  function bernTodayISO() {
    const parts = datePartsInBern();
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function dateInTimeZone(year, month, day, hour, minute, timeZone = TIME_ZONE) {
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

  function validCalendarDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return false;
    const [year, month, day] = iso.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  }

  function dateTimeIsFuture(date, time) {
    if (!validCalendarDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "")) return false;
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const target = dateInTimeZone(year, month, day, hour, minute);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(target).map(({ type, value }) => [type, value]));
    if (Number(parts.year) !== year || Number(parts.month) !== month || Number(parts.day) !== day || Number(parts.hour) !== hour || Number(parts.minute) !== minute) return false;
    return target.getTime() > Date.now();
  }

  function formatDate(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric"
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  }

  function formatTime(time) {
    const [hour, minute] = time.split(":").map(Number);
    const period = hour >= 12 ? "p.m." : "a.m.";
    return `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")} ${period}`;
  }

  function setGreeting() {
    document.getElementById("greeting-name").textContent = CONFIG.greeting || `Hey ${CONFIG.herName || "you"}`;
    dateInput.min = bernTodayISO();
  }

  function connectPickerLabel(instance, input, label) {
    if (!instance?.altInput) return;
    input.classList.forEach((className) => instance.altInput.classList.add(className));
    instance.altInput.classList.add("picker-display-input");
    instance.altInput.style.paddingLeft = "54px";
    instance.altInput.id = `${input.id}-display`;
    instance.altInput.setAttribute("aria-label", label.textContent.trim());
    label.htmlFor = instance.altInput.id;
  }

  function initializePickers() {
    if (typeof window.flatpickr !== "function") return;

    const dateLabel = document.querySelector('label[for="planDate"]');
    datePicker = window.flatpickr(dateInput, {
      altInput: true,
      altInputClass: "date-input",
      altFormat: "l, F j, Y",
      dateFormat: "Y-m-d",
      minDate: dateInput.min,
      disableMobile: true,
      allowInput: false,
      locale: { firstDayOfWeek: 1 },
      onReady(_dates, _dateString, instance) { connectPickerLabel(instance, dateInput, dateLabel); },
      onChange() { validateStep(stepEls.date); }
    });

    const timeLabel = document.querySelector('label[for="planTime"]');
    timePicker = window.flatpickr(timeInput, {
      altInput: true,
      altInputClass: "time-input",
      altFormat: "H:i",
      dateFormat: "H:i",
      enableTime: true,
      noCalendar: true,
      time_24hr: true,
      minuteIncrement: 5,
      disableMobile: true,
      clickOpens: true,
      allowInput: false,
      onReady(_dates, _timeString, instance) { connectPickerLabel(instance, timeInput, timeLabel); },
      onChange(_dates, timeString) {
        updateSelectedDaypart(timeString);
        validateStep(stepEls.time);
      }
    });
  }

  function daypartForTime(time) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "")) return "";
    const [hour, minute] = time.split(":").map(Number);
    const totalMinutes = hour * 60 + minute;
    if (totalMinutes < 6 * 60) return "night";
    if (totalMinutes < 12 * 60) return "morning";
    if (totalMinutes < 17 * 60) return "afternoon";
    if (totalMinutes < 21 * 60) return "evening";
    return "night";
  }

  function updateSelectedDaypart(time) {
    selectedDaypart = daypartForTime(time);
    document.querySelectorAll(".time-period").forEach((button) => {
      const selected = button.dataset.period === selectedDaypart;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function chooseDaypart(period, { preserveTime = false, open = false } = {}) {
    const suggestion = dayparts[period];
    if (!suggestion) return;
    timePickerHint.textContent = `${suggestion.label} suggestion: ${formatTime(suggestion.time)}. You can choose any exact time.`;
    if (!preserveTime) {
      if (timePicker) timePicker.setDate(suggestion.time, true, "H:i");
      else {
        timeInput.value = suggestion.time;
        timeInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    updateSelectedDaypart(timeInput.value || suggestion.time);
    if (open) {
      if (timePicker) timePicker.open();
      else {
        timeInput.focus();
        try { timeInput.showPicker?.(); } catch { /* Focus the native time field if its picker cannot open. */ }
      }
    }
    validateStep(stepEls.time);
  }

  function value(id) {
    return document.getElementById(id).value.trim();
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function getActivity() {
    return state.activity === "other" ? value("customActivity") : state.activity;
  }

  function getPlace() {
    return state.place === "other" ? value("customPlace") : state.place;
  }

  function mapUrl(place) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${place}, Bern, Switzerland`)}&travelmode=walking`;
  }

  function canShowDirections(place) {
    return Boolean(place && !["you pick", "my place", "your place", "somewhere new"].includes(place.trim().toLowerCase()));
  }

  function escapeIcsText(text) {
    return String(text || "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function icsUtc(date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  function foldIcsLine(line) {
    const encoder = new TextEncoder();
    const folded = [];
    let current = "";
    let bytes = 0;
    for (const character of line) {
      const size = encoder.encode(character).length;
      if (bytes + size > 75 && current) {
        folded.push(current);
        current = ` ${character}`;
        bytes = 1 + size;
      } else {
        current += character;
        bytes += size;
      }
    }
    folded.push(current);
    return folded.join("\r\n");
  }

  function downloadCalendar(plan) {
    const [year, month, day] = plan.date.split("-").map(Number);
    const [hour, minute] = plan.time.split(":").map(Number);
    const start = dateInTimeZone(year, month, day, hour, minute);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const map = canShowDirections(plan.place) ? mapUrl(plan.place) : "";
    const description = [
      `Activity: ${plan.activity}`,
      `Place: ${plan.place}, Bern, Switzerland`,
      plan.note ? `Note: ${plan.note}` : "",
      map ? `Walking directions: ${map}` : ""
    ].filter(Boolean).join("\n");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Saturday Plans//Date Invitation//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${plan.id || `${plan.date}-${plan.time}@saturday-plans`}`,
      `DTSTAMP:${icsUtc(new Date())}`,
      `DTSTART:${icsUtc(start)}`,
      `DTEND:${icsUtc(end)}`,
      `SUMMARY:${escapeIcsText(`A date with ${CONFIG.herName || "you"}`)}`,
      `LOCATION:${escapeIcsText(`${plan.place}, Bern, Switzerland`)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      map ? `URL:${map}` : "",
      "END:VEVENT",
      "END:VCALENDAR"
    ].filter(Boolean);
    const blob = new Blob([lines.map(foldIcsLine).join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `date-plan-${plan.date}.ics`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function buildPlan() {
    return {
      date: dateInput.value,
      time: timeInput.value,
      timezone: TIME_ZONE,
      activity: getActivity(),
      place: getPlace(),
      note: value("note")
    };
  }

  function validateStep(step) {
    const next = step.querySelector('[data-action="next"]');
    if (!next) return;
    const name = step.dataset.step;
    let valid = true;
    if (name === "date") valid = validCalendarDate(dateInput.value) && dateInput.value >= bernTodayISO();
    if (name === "time") valid = dateTimeIsFuture(dateInput.value, timeInput.value);
    if (name === "activity") valid = (state.activity && state.activity !== "other") || (state.activity === "other" && value("customActivity"));
    if (name === "place") valid = (state.place && state.place !== "other") || (state.place === "other" && value("customPlace"));
    if (name === "next") valid = Boolean(nextActivityChoice());
    next.disabled = !valid;
  }

  function setChoice(field, valueToSet, customValue = "") {
    const group = document.querySelector(`.choices[data-field="${field}"]`);
    const choices = [...group.querySelectorAll(".choice")];
    const match = choices.find((choice) => choice.dataset.value === valueToSet);
    const chosen = match || choices.find((choice) => choice.dataset.value === "other");
    choices.forEach((choice) => {
      const selected = choice === chosen;
      choice.classList.toggle("selected", selected);
      choice.setAttribute("aria-pressed", String(selected));
    });
    state[field] = chosen?.dataset.value || null;
    if (customInputs[field]) document.getElementById(customInputs[field]).value = match ? "" : customValue;
    // Each step has its own "Something else" field, so look it up inside this group's step.
    const reveal = group.closest(".step").querySelector('[data-reveal-for="other"]');
    if (reveal) reveal.classList.toggle("is-visible", state[field] === "other");
  }

  // Unselects every card in a group (setChoice always lands on a card).
  function clearChoice(field) {
    const group = document.querySelector(`.choices[data-field="${field}"]`);
    group.querySelectorAll(".choice").forEach((choice) => {
      choice.classList.remove("selected");
      choice.setAttribute("aria-pressed", "false");
    });
    state[field] = null;
    if (customInputs[field]) document.getElementById(customInputs[field]).value = "";
    group.closest(".step").querySelector('[data-reveal-for="other"]')?.classList.remove("is-visible");
  }

  function showChoiceMessage(field, message) {
    const element = document.getElementById(`${field}-message`);
    if (!element) return;
    element.textContent = message || "A custom plan. The plot thickens.";
    element.classList.add("is-revealed");
  }

  function resetChoiceMessage(field) {
    const element = document.getElementById(`${field}-message`);
    if (!element) return;
    element.textContent = "Pick a card to reveal the official commentary.";
    element.classList.remove("is-revealed");
  }

  // The idea picked on the next-date page: a card's value, the typed idea, or "".
  function nextActivityChoice() {
    const choice = state["next-activity"];
    if (!choice) return "";
    return choice === "other" ? value("nextCustomActivity") : choice;
  }

  document.querySelectorAll(".choices[data-field]").forEach((group) => {
    group.addEventListener("click", (event) => {
      const button = event.target.closest(".choice");
      if (!button) return;
      const field = group.dataset.field;
      setChoice(field, button.dataset.value);
      showChoiceMessage(field, button.dataset.message);
      if (field === "place") updatePlaceMap();
      validateStep(button.closest(".step"));
    });
  });

  document.querySelectorAll(".time-period").forEach((button) => {
    button.addEventListener("click", () => chooseDaypart(button.dataset.period, { open: true }));
  });

  [dateInput, timeInput, ...document.querySelectorAll('input[type="text"], textarea')].forEach((input) => {
    input.addEventListener("input", () => {
      const step = input.closest(".step");
      if (step) validateStep(step);
      if (input === timeInput) updateSelectedDaypart(input.value);
      if (input.id === "customPlace") updatePlaceMap();
    });
    input.addEventListener("change", () => {
      const step = input.closest(".step");
      if (step) validateStep(step);
      if (input === timeInput) updateSelectedDaypart(input.value);
      if (input.id === "customPlace") updatePlaceMap();
    });
  });

  function goNext() {
    if (currentStepName() === "next") {
      beginNextPlan();
      return;
    }
    const next = steps[steps.indexOf(currentStepName()) + 1];
    if (next) showStep(next);
  }

  function goBack() {
    if (isRescheduling && currentStepName() === "date") {
      isRescheduling = false;
      showStep("planned");
      return;
    }
    if (planningNext && currentStepName() === "date") {
      showStep("next", { forward: false });
      return;
    }
    if (currentStepName() === "next") {
      planningNext = false;
      jarIdea = null;
      showStep(nextBackStep, { forward: false });
      return;
    }
    if (!isRescheduling && currentStepName() === "ask") {
      const envelope = document.querySelector(".envelope-open");
      envelope.disabled = false;
      envelope.classList.remove("is-opening");
      document.getElementById("envelope-caption").textContent = "Tap to open";
    }
    const previous = steps[steps.indexOf(currentStepName()) - 1];
    if (previous) showStep(previous);
  }

  function renderSummary() {
    const plan = buildPlan();
    const rows = [
      ["Date", formatDate(plan.date)],
      ["Time", `${formatTime(plan.time)} · Bern time`],
      ["Doing", plan.activity],
      ["Where", plan.place]
    ];
    if (plan.note) rows.push(["Note", plan.note]);
    document.getElementById("summary").innerHTML = rows
      .map(([key, result]) => `<div class="row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(result)}</dd></div>`)
      .join("");
    const link = document.getElementById("summary-map-link");
    link.href = mapUrl(plan.place);
    document.getElementById("summary-map-wrap").hidden = !canShowDirections(plan.place);
  }

  function renderPlan() {
    if (!activePlan) return;
    const isCancelled = activePlan.status === "cancelled";
    document.getElementById("plan-status").textContent = isCancelled ? "DATE CANCELLED" : "DATE CONFIRMED";
    document.getElementById("planned-heading").textContent = isCancelled ? "The plan is cancelled" : "The plan is set!";
    document.getElementById("planned-date-time").textContent = `${formatDate(activePlan.date)} · ${formatTime(activePlan.time)} · Bern`;
    document.getElementById("cancelled-message").hidden = !isCancelled;
    document.querySelector('[data-action="cancel"]').hidden = isCancelled;
    document.querySelector('[data-action="cancel"]').disabled = isCancelled;
    document.getElementById("reschedule-label").textContent = isCancelled ? "Reschedule this plan" : "Reschedule";
    const rows = [
      ["Activity", activePlan.activity],
      ["Meet at", activePlan.place]
    ];
    if (activePlan.note) rows.push(["Extra note", activePlan.note]);
    document.getElementById("planned-summary").innerHTML = rows
      .map(([key, result]) => `<div class="row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(result)}</dd></div>`)
      .join("");
    const mapLink = document.getElementById("planned-map-link");
    mapLink.href = mapUrl(activePlan.place);
    mapLink.hidden = isCancelled || !canShowDirections(activePlan.place);
    document.getElementById("calendar-link").hidden = isCancelled;
    renderLateStatus(activePlan, isCancelled);
    const note = CONFIG.closingNote || "";
    document.getElementById("closing-note").textContent = note.replace(/\{name\}/g, CONFIG.herName || "you");
    document.getElementById("planError").hidden = true;
    updatePlanCountdown(isCancelled ? null : activePlan);
    document.dispatchEvent(new CustomEvent("date:plan", { detail: { plan: activePlan } }));
  }

  function renderLateStatus(plan, isCancelled) {
    const tools = document.getElementById("late-tools");
    const status = document.getElementById("late-status");
    const hasUpdate = Boolean(plan.lateAt);
    tools.hidden = isCancelled;
    status.hidden = !hasUpdate;
    document.getElementById("late-options").hidden = true;
    document.getElementById("late-toggle").querySelector("span").textContent = hasUpdate ? "Update late status" : "I'm running late";
    const arrivedButton = document.getElementById("late-arrived");
    arrivedButton.hidden = !hasUpdate;
    arrivedButton.disabled = false;
    document.querySelectorAll(".late-option").forEach((button) => { button.disabled = false; });
    document.getElementById("late-error").hidden = true;
    if (!hasUpdate) return;
    const updatedAt = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).format(new Date(plan.lateAt));
    const estimate = plan.lateByMinutes ? `about ${plan.lateByMinutes} minutes late` : "running late";
    status.textContent = `Running ${estimate} · updated ${updatedAt} Bern time.`;
  }

  function updatePlanCountdown(plan) {
    const container = document.getElementById("planned-countdown");
    if (countdownTimer) window.clearInterval(countdownTimer);
    countdownTimer = null;
    if (!plan) {
      container.hidden = true;
      return;
    }
    const [year, month, day] = plan.date.split("-").map(Number);
    const [hour, minute] = plan.time.split(":").map(Number);
    const target = dateInTimeZone(year, month, day, hour, minute);
    if (target.getTime() <= Date.now()) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    document.getElementById("planned-countdown-date").textContent = formatDate(plan.date);
    const fields = {
      days: document.getElementById("planned-countdown-days"),
      hours: document.getElementById("planned-countdown-hours"),
      minutes: document.getElementById("planned-countdown-minutes"),
      seconds: document.getElementById("planned-countdown-seconds")
    };
    function tick() {
      const seconds = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
      fields.days.textContent = String(Math.floor(seconds / 86400)).padStart(2, "0");
      fields.hours.textContent = String(Math.floor((seconds % 86400) / 3600)).padStart(2, "0");
      fields.minutes.textContent = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
      fields.seconds.textContent = String(seconds % 60).padStart(2, "0");
      if (seconds === 0 && countdownTimer) window.clearInterval(countdownTimer);
    }
    tick();
    countdownTimer = window.setInterval(tick, 1000);
  }

  async function requestPlan(method = "GET", plan = null, path = "/plan") {
    if (!apiRoot) throw new Error("Shared plan sync is not connected yet.");
    const response = await fetch(apiUrl(path), {
      method,
      headers: plan ? { "Content-Type": "application/json" } : {},
      body: plan ? JSON.stringify(plan) : undefined
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "The shared plan service could not save that change.");
      error.status = response.status;
      error.plan = body.plan;
      throw error;
    }
    return body;
  }

  async function requestLateStatus(method, minutes) {
    if (!apiRoot) throw new Error("Shared plan sync is not connected yet.");
    const response = await fetch(apiUrl("/plan/late"), {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : {},
      body: method === "POST" ? JSON.stringify({ minutes }) : undefined
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "The late update could not be saved.");
      error.status = response.status;
      error.plan = body.plan;
      throw error;
    }
    return body;
  }

  async function setRunningLate(minutes) {
    const errorElement = document.getElementById("late-error");
    const options = document.getElementById("late-options");
    const buttons = [...options.querySelectorAll("button")];
    errorElement.hidden = true;
    options.hidden = true;
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const data = await requestLateStatus("POST", minutes);
      activePlan = data.plan;
      renderPlan();
      postPlanActivity("plan.late", `is running about ${minutes} minutes late`, activePlan, { icon: "clock" });
      const delivered = await notifyOwner(`running about ${minutes} minutes late`, activePlan);
      if (!delivered) {
        errorElement.textContent = "The update is saved for both of you, but the notification didn’t go through.";
        errorElement.hidden = false;
      }
    } catch (error) {
      if (error.plan) {
        activePlan = error.plan;
        renderPlan();
      }
      errorElement.textContent = error.message || "Couldn’t send the late update. Please try again.";
      errorElement.hidden = false;
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function clearRunningLate() {
    const errorElement = document.getElementById("late-error");
    errorElement.hidden = true;
    const button = document.getElementById("late-arrived");
    button.disabled = true;
    try {
      const data = await requestLateStatus("DELETE");
      activePlan = data.plan;
      renderPlan();
      postPlanActivity("plan.here", "is here", activePlan, { detail: activePlan.place, icon: "map-pin" });
      const delivered = await notifyOwner("is here now", activePlan);
      if (!delivered) {
        errorElement.textContent = "The arrival update is saved, but the notification didn’t go through.";
        errorElement.hidden = false;
      }
    } catch (error) {
      errorElement.textContent = error.message || "Couldn’t clear the late update. Please try again.";
      errorElement.hidden = false;
      button.disabled = false;
    }
  }

  async function sendNotification(title, message, tags = []) {
    if (!CONFIG.ntfyTopic) return false;
    try {
      const response = await fetch("https://ntfy.sh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: CONFIG.ntfyTopic, title: previewMode ? `🧪 Preview · ${title}` : title, message, tags, priority: 4 })
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  function notifyOwner(action, plan) {
    return sendNotification(
      `${CONFIG.herName || "Date plan"}: ${action}`,
      `${action.toUpperCase()}\n${formatDate(plan.date)} · ${formatTime(plan.time)} · Bern\n${plan.activity}\nMeet at: ${plan.place}${plan.note ? `\nNote: ${plan.note}` : ""}`
    );
  }

  // Shows a plan change in the other phone's activity bell (and as a push), for both of us.
  // activity.js owns DateActivity; it never throws, but the plan is saved either way.
  function postPlanActivity(kind, text, plan, { detail, icon = "calendar-heart" } = {}) {
    const clip = (words, length) => (words.length > length ? `${words.slice(0, length - 1).trimEnd()}…` : words);
    const when = plan ? `${formatDate(plan.date)} · ${formatTime(plan.time)}` : "";
    try {
      window.DateActivity?.post?.({ kind, text: clip(text, 140), detail: clip(detail ?? when, 200), step: "planned", icon })?.catch?.(() => {});
    } catch { /* The bell is a bonus. */ }
  }

  function displayPlanError(message) {
    const error = document.getElementById("planError");
    error.textContent = message;
    error.hidden = false;
  }

  function displaySyncError(message) {
    showStep("loading");
    document.getElementById("loading-heading").textContent = "Letter unavailable";
    document.getElementById("loading-message").textContent = message;
    document.getElementById("retry-load").hidden = false;
  }

  async function loadPlan() {
    if (!apiRoot) {
      showStep("intro");
      serviceNote.hidden = false;
      serviceNote.textContent = "The shared plan store still needs to be connected.";
      document.querySelector(".envelope-open").disabled = true;
      document.getElementById("envelope-caption").textContent = "The letter is being prepared";
      return;
    }
    const openButton = document.querySelector(".envelope-open");
    const caption = document.getElementById("envelope-caption");
    openButton.disabled = true;
    caption.textContent = "Checking the shared plan…";
    try {
      const data = await requestPlan("GET");
      activePlan = data.plan;
      showStep(activePlan ? "planned" : "intro");
      if (!activePlan) {
        openButton.disabled = false;
        caption.textContent = "Tap to open";
        serviceNote.hidden = true;
      }
      window.setInterval(refreshPlanIfVisible, 20000);
    } catch {
      displaySyncError("We couldn’t load the shared plan. Check your connection and try again.");
    }
  }

  async function refreshPlanIfVisible() {
    if (document.hidden || !apiRoot || isRescheduling) return;
    try {
      const data = await requestPlan("GET");
      if (data.plan && (!activePlan || data.plan.updatedAt !== activePlan.updatedAt)) {
        activePlan = data.plan;
        if (["intro", "planned"].includes(currentStepName())) showStep("planned");
      }
    } catch { /* Keep the last loaded plan visible while offline. */ }
  }

  function reviewMode() {
    if (planningNext) return "next";
    return isRescheduling ? "reschedule" : "invite";
  }

  function setReviewCopy(mode = reviewMode()) {
    document.getElementById("review-heading").textContent = reviewCopy[mode].heading;
    document.querySelector('[data-action="send"]').innerHTML = `${reviewCopy[mode].button} ${iconMarkup("heart")}`;
  }

  async function setPlan() {
    const button = document.querySelector('[data-action="send"]');
    const error = document.getElementById("sendError");
    const mode = reviewMode();
    error.hidden = true;
    button.disabled = true;
    button.textContent = reviewCopy[mode].saving;
    const plan = buildPlan();
    try {
      const data = mode === "next"
        ? await requestPlan("POST", plan, "/plan/next")
        : await requestPlan(isRescheduling ? "PUT" : "POST", plan);
      activePlan = data.plan;
      const action = { invite: "date plan set", reschedule: "rescheduled", next: "planned our next date" }[mode];
      isRescheduling = false;
      planningNext = false;
      button.disabled = false;
      setReviewCopy("invite");
      showStep("planned");
      window.LetterFX?.celebrate();
      if (mode === "next") {
        const fromJar = markJarIdeaUsed(activePlan);
        postPlanActivity("plan.next", `planned our next date: ${activePlan.activity}`, activePlan, {
          detail: fromJar ? `${formatDate(activePlan.date)} · ${formatTime(activePlan.time)} · from our ideas jar` : undefined
        });
      } else if (mode === "reschedule") {
        postPlanActivity("plan.reschedule", `moved our date to ${formatDate(activePlan.date)}`, activePlan, {
          detail: `${formatTime(activePlan.time)} · ${activePlan.activity}`, icon: "calendar-clock"
        });
      } else {
        postPlanActivity("plan.set", `set our date: ${activePlan.activity}`, activePlan);
      }
      // Dee only wants to hear about her planning the next date, not about himself.
      if (mode === "next" && me() !== "her") return;
      const delivered = await notifyOwner(action, activePlan);
      if (!delivered) displayPlanError("The plan is saved across devices, but the notification didn’t go through.");
    } catch (saveError) {
      if (mode === "next" && saveError.status === 409 && saveError.plan) {
        // The other phone planned the next date first (that one hasn't happened yet): show it.
        activePlan = saveError.plan;
        planningNext = false;
        button.disabled = false;
        setReviewCopy("invite");
        showStep("planned");
        displayPlanError("Our next date was already planned on the other phone, so here it is.");
      } else if (mode === "next") {
        if (saveError.plan) activePlan = saveError.plan;
        error.textContent = saveError.message || "Couldn’t plan our next date. Please try again.";
        error.hidden = false;
        button.disabled = false;
        setReviewCopy(mode);
      } else if (saveError.status === 409 && saveError.plan) {
        activePlan = saveError.plan;
        isRescheduling = false;
        button.disabled = false;
        setReviewCopy("invite");
        showStep("planned");
        displayPlanError("A plan was already set on another device, so this invitation is now showing that plan.");
      } else {
        error.textContent = saveError.message || "Couldn’t save the plan. Please try again.";
        error.hidden = false;
        button.disabled = false;
        setReviewCopy(mode);
      }
    }
  }

  async function cancelPlan() {
    if (!activePlan || activePlan.status === "cancelled") return;
    if (!window.confirm("Cancel this date plan? She’ll see that it was cancelled, and the same plan can still be rescheduled.")) return;
    const button = document.querySelector('[data-action="cancel"]');
    button.disabled = true;
    try {
      const data = await requestPlan("DELETE");
      activePlan = data.plan;
      renderPlan();
      postPlanActivity("plan.cancel", "cancelled our date", activePlan, {
        detail: `${activePlan.activity} · ${formatDate(activePlan.date)}`, icon: "calendar-x"
      });
      const delivered = await notifyOwner("date cancelled", activePlan);
      if (!delivered) displayPlanError("The date is cancelled, but the notification didn’t go through.");
    } catch (error) {
      displayPlanError(error.message || "Couldn’t cancel the plan. Please try again.");
      button.disabled = false;
    }
  }

  function restorePlanForEditing() {
    if (!activePlan) return;
    isRescheduling = true;
    planningNext = false;
    jarIdea = null;
    if (datePicker) datePicker.setDate(activePlan.date, false, "Y-m-d");
    else dateInput.value = activePlan.date;
    timeInput.value = activePlan.time;
    if (timePicker) timePicker.setDate(activePlan.time, false, "H:i");
    chooseDaypart(daypartForTime(activePlan.time), { preserveTime: true });
    document.getElementById("note").value = activePlan.note || "";
    // A typed activity or place lands in its "Something else" field.
    setChoice("activity", activePlan.activity, activePlan.activity);
    setChoice("place", activePlan.place, activePlan.place);
    updatePlaceMap();
    document.getElementById("sendError").hidden = true;
    setReviewCopy("reschedule");
    showStep("date");
    validateStep(stepEls.date);
  }

  // Empties the date, time, place and note questions (and their pickers) for a fresh plan.
  function clearQuestions() {
    dateInput.min = bernTodayISO();
    if (datePicker) {
      datePicker.set("minDate", dateInput.min);
      datePicker.clear(false);
    }
    dateInput.value = "";
    if (timePicker) timePicker.clear(false);
    timeInput.value = "";
    updateSelectedDaypart("");
    timePickerHint.textContent = "Choose any time, or tap one of the suggestions above.";
    clearChoice("place");
    updatePlaceMap();
    document.getElementById("note").value = "";
    document.getElementById("sendError").hidden = true;
    questionSteps.forEach((name) => validateStep(stepEls[name]));
  }

  // The journal's "What's next?" button: a fresh next-date page, nothing picked yet.
  // The ideas jar's "Plan it" passes `{ idea: { id, text } }` to start with that idea picked.
  function startNextPlan({ idea } = {}) {
    isRescheduling = false;
    planningNext = false;
    jarIdea = null;
    nextBackStep = "journal";
    clearChoice("next-activity");
    resetChoiceMessage("next-activity");
    clearQuestions();
    if (idea && typeof idea.text === "string" && idea.text.trim()) {
      useJarIdea({ id: idea.id, text: idea.text.trim() });
      showChoiceMessage("next-activity", "Straight from our ideas jar.");
      nextBackStep = "ideas";
    }
    showStep("next", { forward: true });
  }

  /* ---------- Ideas jar on the next-date page ---------- */
  const jarButton = document.createElement("button");
  jarButton.type = "button";
  jarButton.className = "btn btn-secondary jar-pull-next";
  jarButton.hidden = true;
  jarButton.innerHTML = '<i class="icon" data-lucide="lightbulb" aria-hidden="true"></i><span>Pull from the jar</span>';
  stepEls.next.querySelector(".choices").before(jarButton);

  // The idea card with the same wording, if there is one ("Movie night", "Cook dinner together"…).
  function jarIdeaCard(text) {
    const wanted = text.trim().toLowerCase();
    return [...document.querySelectorAll('.choices[data-field="next-activity"] .choice')].find((choice) => choice.dataset.value !== "other"
      && [choice.dataset.value, choice.querySelector("strong")?.textContent].some((label) => (label || "").trim().toLowerCase() === wanted));
  }

  // Picks the matching card, or "Something else" with the idea typed in.
  function useJarIdea(idea) {
    const card = jarIdeaCard(idea.text);
    if (card) {
      setChoice("next-activity", card.dataset.value);
    } else {
      setChoice("next-activity", idea.text, idea.text);
      document.getElementById("nextCustomActivity").value = idea.text;
    }
    jarIdea = { id: idea.id, activity: card ? card.dataset.value : idea.text };
    validateStep(stepEls.next);
  }

  async function unusedJarIdeas() {
    const data = await apiRequest("/ideas");
    return (Array.isArray(data.ideas) ? data.ideas : []).filter((idea) => idea && !idea.usedAt && typeof idea.text === "string" && idea.text.trim());
  }

  async function refreshJarButton() {
    try {
      const ideas = await unusedJarIdeas();
      jarButton.hidden = !ideas.length;
    } catch {
      jarButton.hidden = true;
    }
  }

  async function pullFromJar() {
    if (jarButton.disabled) return;
    jarButton.disabled = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    jarButton.classList.remove("is-shaking");
    void jarButton.offsetWidth;
    if (!reduced) jarButton.classList.add("is-shaking");
    try {
      const [ideas] = await Promise.all([unusedJarIdeas(), new Promise((resolve) => window.setTimeout(resolve, reduced ? 0 : 600))]);
      if (currentStepName() !== "next") return;
      // Don't hand back the same idea twice in a row when there's a choice.
      const pool = ideas.length > 1 ? ideas.filter((idea) => idea.id !== jarIdea?.id) : ideas;
      if (!pool.length) {
        jarButton.hidden = true;
        return;
      }
      const idea = pool[Math.floor(Math.random() * pool.length)];
      useJarIdea({ id: idea.id, text: idea.text.trim() });
      const author = window.DateApp?.names?.[idea.author];
      showChoiceMessage("next-activity", author ? `From our ideas jar, dropped in by ${author}.` : "From our ideas jar.");
      window.LetterFX?.burstFrom?.(jarButton, 14);
      // Show what came out, even when it landed below the fold ("Something else" sits at the bottom).
      const picked = state["next-activity"] === "other"
        ? stepEls.next.querySelector('[data-reveal-for="other"]')
        : stepEls.next.querySelector(".choice.selected");
      picked?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    } catch {
      showChoiceMessage("next-activity", "Couldn’t reach the jar. Check your connection and try again.");
    } finally {
      jarButton.disabled = false;
      jarButton.classList.remove("is-shaking");
    }
  }

  // Once the next date is saved with the jar's idea (still unchanged), it leaves the jar.
  // Returns whether the saved plan came from the jar.
  function markJarIdeaUsed(plan) {
    const idea = jarIdea;
    jarIdea = null;
    const same = (text) => String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
    if (!idea?.id || !plan || same(plan.activity) !== same(idea.activity)) return false;
    apiRequest("/ideas", "POST", { action: "use", id: idea.id, author: me() }).catch(() => { /* It can be marked by hand in the jar. */ });
    return true;
  }

  jarButton.addEventListener("click", pullFromJar);
  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "next") refreshJarButton();
  });

  // "Next" on the next-date page: carry the idea into the normal questions, starting at the date.
  function beginNextPlan() {
    const activity = nextActivityChoice();
    if (!activity) return;
    setChoice("activity", activity, state["next-activity"] === "other" ? activity : "");
    showChoiceMessage("activity", document.querySelector('.choices[data-field="activity"] .choice.selected')?.dataset.message);
    clearQuestions();
    isRescheduling = false;
    planningNext = true;
    setReviewCopy("next");
    showStep("date", { forward: true });
  }

  function updatePlaceMap() {
    const place = getPlace();
    const link = document.getElementById("place-map-link");
    link.hidden = !canShowDirections(place);
    if (canShowDirections(place)) link.href = mapUrl(place);
  }

  async function openEnvelope(button) {
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add("is-opening");
    const animation = window.LetterFX?.open?.();
    if (animation) {
      try { await animation; } catch { /* Show the questions even if the animation fails. */ }
      showStep("ask");
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => showStep("ask"), reduced ? 0 : 650);
  }

  // Scrolling or swiping on the landing scrubs the envelope open (effects.js).
  document.addEventListener("letter:open-request", () => {
    openEnvelope(document.querySelector(".envelope-open"));
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    switch (button.dataset.action) {
      case "open-envelope": openEnvelope(button); break;
      case "next": goNext(); break;
      case "back": goBack(); break;
      case "send": setPlan(); break;
      case "reschedule": restorePlanForEditing(); break;
      case "start-next": startNextPlan(); break;
      case "cancel": cancelPlan(); break;
      case "retry": loadPlan(); break;
      case "add-calendar": if (activePlan && activePlan.status === "confirmed") downloadCalendar(activePlan); break;
      case "show-late-options": document.getElementById("late-options").hidden = false; break;
      case "hide-late-options": document.getElementById("late-options").hidden = true; break;
      case "set-late": setRunningLate(Number(button.dataset.minutes)); break;
      case "clear-late": clearRunningLate(); break;
      case "goto": if (extraSteps.includes(button.dataset.target)) showStep(button.dataset.target); break;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || ["TEXTAREA", "SELECT", "BUTTON"].includes(event.target.tagName)) return;
    const next = stepEls[currentStepName()]?.querySelector('[data-action="next"]:not(:disabled)');
    if (next) next.click();
  });

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.getElementById("background-video")?.pause();
  }

  async function apiRequest(path, method = "GET", body = undefined) {
    if (!apiRoot) throw new Error("Shared sync is not connected yet.");
    const response = await fetch(apiUrl(path), {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "That couldn’t be saved. Please try again.");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function showPreviewBar() {
    const bar = document.createElement("div");
    bar.className = "preview-bar";
    bar.innerHTML = "<span><strong>Preview mode</strong> · her letter isn’t touched</span><button type=\"button\">Reset</button>";
    bar.querySelector("button").addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try { await apiRequest("/reset", "POST"); } catch { /* Reload either way. */ }
      try {
        Object.keys(window.localStorage)
          .filter((key) => key.startsWith("date-letter-") && !["date-letter-sound", "date-letter-author"].includes(key))
          .forEach((key) => window.localStorage.removeItem(key));
      } catch { /* Private browsing. */ }
      window.location.reload();
    });
    document.body.append(bar);
  }

  // Who is using this phone: "sender" once Dee marked it (?me or the journal), otherwise "her".
  function me() {
    try { return window.localStorage.getItem("date-letter-author") === "sender" ? "sender" : "her"; } catch { return "her"; }
  }

  function entryKey(plan) {
    return plan ? `${plan.date}T${plan.time}` : "";
  }

  function planStarted(plan) {
    if (!plan || plan.status !== "confirmed") return false;
    const [year, month, day] = plan.date.split("-").map(Number);
    const [hour, minute] = plan.time.split(":").map(Number);
    return dateInTimeZone(year, month, day, hour, minute).getTime() <= Date.now();
  }

  // Shared helpers for the feature scripts (ask.js, extras.js, coupons.js, media.js, journal.js, outfits.js, snacks.js).
  window.DateApp = {
    preview: previewMode,
    get plan() { return activePlan; },
    get step() { return currentStepName(); },
    showStep,
    apiRequest,
    notify: sendNotification,
    formatDate,
    formatTime,
    escapeHtml,
    refreshIcons,
    dateInTimeZone,
    todayISO: bernTodayISO,
    apiUrl,
    me,
    names: { her: CONFIG.herName || "Her", sender: (CONFIG.yourName || "").trim() || "Your date" },
    entryKey,
    planStarted,
    startNextPlan
  };

  refreshIcons();
  setGreeting();
  initializePickers();
  if (previewMode) showPreviewBar();
  showStep("intro");
  loadPlan();
})();
