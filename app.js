(function () {
  const steps = ["intro", "availability", "time", "activity", "place", "note", "review", "sent"];
  const dotSteps = ["availability", "time", "activity", "place", "note"];

  const state = {
    free: null,
    time: null,
    activity: null,
    place: null
  };

  const stepEls = {};
  steps.forEach((s) => { stepEls[s] = document.querySelector(`[data-step="${s}"]`); });

  function setGreeting() {
    document.getElementById("greeting-name").textContent = CONFIG.herName ? ` ${CONFIG.herName}` : " you";
    document.getElementById("availability-heading").textContent =
      `Are you free ${CONFIG.dateLabel || "this Saturday"}?`;
  }

  function currentStepName() {
    return steps.find((s) => stepEls[s].classList.contains("is-active"));
  }

  function showStep(name) {
    steps.forEach((s) => stepEls[s].classList.toggle("is-active", s === name));
    updateProgress(name);
    if (name === "review") renderSummary();

    const heading = stepEls[name].querySelector("h1, h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }

  function updateProgress(name) {
    const idx = dotSteps.indexOf(name);
    document.querySelectorAll(".dot").forEach((dot, i) => {
      dot.classList.toggle("done", idx >= 0 && i < idx);
      dot.classList.toggle("current", i === idx);
    });
    document.getElementById("progress").style.visibility = idx === -1 ? "hidden" : "visible";
  }

  function goNext() {
    const next = steps[steps.indexOf(currentStepName()) + 1];
    if (next) showStep(next);
  }

  function goBack() {
    const prev = steps[steps.indexOf(currentStepName()) - 1];
    if (prev) showStep(prev);
  }

  // Choice groups (Saturday / time / activity / place)
  document.querySelectorAll(".choices").forEach((group) => {
    const field = group.dataset.field;
    group.addEventListener("click", (e) => {
      const btn = e.target.closest(".choice");
      if (!btn) return;

      group.querySelectorAll(".choice").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      state[field] = btn.dataset.value;

      const step = btn.closest(".step");
      step.querySelectorAll(".reveal").forEach((reveal) => {
        const show = reveal.dataset.revealFor === btn.dataset.value;
        reveal.classList.toggle("is-visible", show);
        const input = reveal.querySelector("input");
        if (show) input?.focus();
        else if (input) input.value = "";
      });

      validateStep(step);
    });
  });

  document.querySelectorAll('input[type="text"], input[type="time"]').forEach((el) => {
    el.addEventListener("input", () => validateStep(el.closest(".step")));
  });

  function validateStep(step) {
    const nextBtn = step.querySelector('[data-action="next"]');
    if (!nextBtn) return;

    const name = step.dataset.step;
    let ok = true;

    if (name === "availability") {
      ok = state.free === "yes" || (state.free === "other" && val("altTime"));
    } else if (name === "time") {
      ok = !!state.time || val("exactTime");
    } else if (name === "activity") {
      ok = (state.activity && state.activity !== "other") || (state.activity === "other" && val("customActivity"));
    } else if (name === "place") {
      ok = (state.place && state.place !== "other") || (state.place === "other" && val("customPlace"));
    }

    nextBtn.disabled = !ok;
  }

  function val(id) {
    return document.getElementById(id).value.trim();
  }

  function formatTime(t) {
    const [h, m] = t.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour = ((h + 11) % 12) + 1;
    return `${hour}:${String(m).padStart(2, "0")} ${period}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function pickedTime() {
    const exact = val("exactTime");
    return exact ? formatTime(exact) : state.time;
  }

  function pickedActivity() {
    return state.activity === "other" ? val("customActivity") : state.activity;
  }

  function pickedPlace() {
    return state.place === "other" ? val("customPlace") : state.place;
  }

  function renderSummary() {
    const rows = [
      ["Saturday", state.free === "yes" ? "Yes, I'm free" : `Not Saturday — ${val("altTime") || "no alternative given"}`],
      ["Time", pickedTime() || "—"],
      ["Doing", pickedActivity() || "—"],
      ["Where", pickedPlace() || "—"]
    ];
    const note = val("note");
    if (note) rows.push(["Note", note]);

    document.getElementById("summary").innerHTML = rows
      .map(([k, v]) => `<div class="row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
      .join("");
  }

  function buildMessage() {
    const lines = [
      state.free === "yes"
        ? `${CONFIG.dateLabel || "Saturday"}: Yes, she's free!`
        : `${CONFIG.dateLabel || "Saturday"}: not free. Alternative: ${val("altTime") || "none given"}`,
      `Time: ${pickedTime() || "no preference"}`,
      `Doing: ${pickedActivity() || "no preference"}`,
      `Where: ${pickedPlace() || "no preference"}`
    ];
    const note = val("note");
    if (note) lines.push(`Note: ${note}`);
    return lines.join("\n");
  }

  async function send() {
    const sendBtn = document.querySelector('[data-action="send"]');
    const errorEl = document.getElementById("sendError");
    errorEl.hidden = true;
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";

    try {
      if (!CONFIG.ntfyTopic) throw new Error("missing-topic");

      const res = await fetch("https://ntfy.sh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: CONFIG.ntfyTopic,
          title: `${CONFIG.herName || "She"} answered your Saturday question`,
          message: buildMessage(),
          priority: 4,
          tags: ["heart", "sparkles"]
        })
      });

      if (!res.ok) throw new Error("bad-response");
      showStep("sent");
    } catch (err) {
      errorEl.hidden = false;
      sendBtn.disabled = false;
      sendBtn.textContent = "Send 💌";
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "next") goNext();
    else if (btn.dataset.action === "back") goBack();
    else if (btn.dataset.action === "send") send();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName === "TEXTAREA") return;
    const step = stepEls[currentStepName()];
    const nextBtn = step.querySelector('[data-action="next"]:not(:disabled)');
    if (nextBtn) nextBtn.click();
  });

  setGreeting();
  showStep("intro");
})();
