(function () {
  const TIME_ZONE = "Europe/Zurich";
  const steps = ["loading", "intro", "date", "time", "activity", "place", "note", "review", "planned"];
  const questionSteps = ["date", "time", "activity", "place", "note"];
  const state = { date: "", time: "", activity: null, place: null };
  const stepEls = Object.fromEntries(steps.map((name) => [name, document.querySelector(`[data-step="${name}"]`)]));
  const dateInput = document.getElementById("planDate");
  const timeInput = document.getElementById("planTime");
  const serviceNote = document.getElementById("service-note");
  const apiRoot = String(CONFIG.planApiUrl || "").replace(/\/+$/, "").replace(/\/plan$/, "");
  let activePlan = null;
  let isRescheduling = false;
  let countdownTimer = null;

  function currentStepName() {
    return steps.find((name) => stepEls[name].classList.contains("is-active"));
  }

  function showStep(name) {
    const previous = currentStepName();
    const forward = steps.indexOf(name) >= steps.indexOf(previous);
    document.body.classList.toggle("is-envelope-landing", name === "intro");
    steps.forEach((step) => {
      const element = stepEls[step];
      element.classList.toggle("is-active", step === name);
      element.classList.toggle("enter-forward", step === name && forward);
      element.classList.toggle("enter-backward", step === name && !forward);
    });
    updateProgress(name);
    if (["date", "time", "activity", "place"].includes(name)) validateStep(stepEls[name]);
    if (name === "review") renderSummary();
    if (name === "planned") renderPlan();

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
    if (field === "activity") document.getElementById("customActivity").value = match ? "" : customValue;
    if (field === "place") document.getElementById("customPlace").value = match ? "" : customValue;
    const reveal = document.querySelector(`[data-reveal-for="other"]`);
    if (reveal && reveal.closest(".step").dataset.step === field) reveal.classList.toggle("is-visible", state[field] === "other");
  }

  document.querySelectorAll(".choices[data-field]").forEach((group) => {
    group.addEventListener("click", (event) => {
      const button = event.target.closest(".choice");
      if (!button) return;
      const field = group.dataset.field;
      setChoice(field, button.dataset.value);
      if (field === "activity") {
        const message = document.getElementById("activity-message");
        message.textContent = button.dataset.message || "A custom plan. The plot thickens.";
        message.classList.add("is-revealed");
      }
      if (field === "place") updatePlaceMap();
      validateStep(button.closest(".step"));
    });
  });

  [dateInput, timeInput, ...document.querySelectorAll('input[type="text"], textarea')].forEach((input) => {
    input.addEventListener("input", () => {
      const step = input.closest(".step");
      if (step) validateStep(step);
      if (input.id === "customPlace") updatePlaceMap();
    });
    input.addEventListener("change", () => {
      const step = input.closest(".step");
      if (step) validateStep(step);
      if (input.id === "customPlace") updatePlaceMap();
    });
  });

  function goNext() {
    const next = steps[steps.indexOf(currentStepName()) + 1];
    if (next) showStep(next);
  }

  function goBack() {
    if (isRescheduling && currentStepName() === "date") {
      isRescheduling = false;
      showStep("planned");
      return;
    }
    if (!isRescheduling && currentStepName() === "date") {
      const envelope = document.querySelector(".envelope-open");
      envelope.disabled = false;
      envelope.classList.remove("is-opening");
      document.getElementById("envelope-caption").textContent = "Tap to open your letter";
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
    const note = CONFIG.closingNote || "You owe me a döner now.";
    document.getElementById("closing-note").textContent = note.replace(/\{name\}/g, CONFIG.herName || "you");
    document.getElementById("planError").hidden = true;
    updatePlanCountdown(isCancelled ? null : activePlan);
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

  async function requestPlan(method = "GET", plan = null) {
    if (!apiRoot) throw new Error("Shared plan sync is not connected yet.");
    const response = await fetch(`${apiRoot}/plan`, {
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
    const response = await fetch(`${apiRoot}/plan/late`, {
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

  async function notifyOwner(action, plan) {
    if (!CONFIG.ntfyTopic) return false;
    try {
      const response = await fetch("https://ntfy.sh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: CONFIG.ntfyTopic,
          title: `${CONFIG.herName || "Date plan"}: ${action}`,
          message: `${action.toUpperCase()}\n${formatDate(plan.date)} · ${formatTime(plan.time)} · Bern\n${plan.activity}\nMeet at: ${plan.place}${plan.note ? `\nNote: ${plan.note}` : ""}`,
          priority: 4
        })
      });
      return response.ok;
    } catch {
      return false;
    }
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
        caption.textContent = "Tap to open your letter";
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

  async function setPlan() {
    const button = document.querySelector('[data-action="send"]');
    const error = document.getElementById("sendError");
    error.hidden = true;
    button.disabled = true;
    button.textContent = isRescheduling ? "Saving changes…" : "Setting the plan…";
    const plan = buildPlan();
    try {
      const data = await requestPlan(isRescheduling ? "PUT" : "POST", plan);
      activePlan = data.plan;
      const action = isRescheduling ? "rescheduled" : "date plan set";
      isRescheduling = false;
      showStep("planned");
      const delivered = await notifyOwner(action, activePlan);
      if (!delivered) displayPlanError("The plan is saved across devices, but the notification didn’t go through.");
    } catch (saveError) {
      if (saveError.status === 409 && saveError.plan) {
        activePlan = saveError.plan;
        isRescheduling = false;
        showStep("planned");
        displayPlanError("A plan was already set on another device, so this invitation is now showing that plan.");
      } else {
        error.textContent = saveError.message || "Couldn’t save the plan. Please try again.";
        error.hidden = false;
        button.disabled = false;
        button.innerHTML = `${isRescheduling ? "Save changes" : "Set this date"} <svg class="icon"><use href="#icon-check-heart"></use></svg>`;
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
    dateInput.value = activePlan.date;
    timeInput.value = activePlan.time;
    document.getElementById("note").value = activePlan.note || "";
    setChoice("activity", activePlan.activity);
    setChoice("place", activePlan.place);
    updatePlaceMap();
    document.getElementById("review-heading").textContent = "Review your changes";
    const sendButton = document.querySelector('[data-action="send"]');
    sendButton.innerHTML = 'Save changes <svg class="icon"><use href="#icon-check-heart"></use></svg>';
    showStep("date");
    validateStep(stepEls.date);
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
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => showStep("date"), reduced ? 0 : 650);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    switch (button.dataset.action) {
      case "open-envelope": openEnvelope(button); break;
      case "next": goNext(); break;
      case "back": goBack(); break;
      case "send": setPlan(); break;
      case "reschedule": restorePlanForEditing(); break;
      case "cancel": cancelPlan(); break;
      case "retry": loadPlan(); break;
      case "add-calendar": if (activePlan && activePlan.status === "confirmed") downloadCalendar(activePlan); break;
      case "show-late-options": document.getElementById("late-options").hidden = false; break;
      case "hide-late-options": document.getElementById("late-options").hidden = true; break;
      case "set-late": setRunningLate(Number(button.dataset.minutes)); break;
      case "clear-late": clearRunningLate(); break;
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

  setGreeting();
  showStep("intro");
  loadPlan();
})();
