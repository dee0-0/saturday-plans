/*
 * "Will you go out with me?" — the No button runs away whenever she gets
 * close to it, and the Yes button grows a little every time she tries.
 */
(function () {
  "use strict";

  const arena = document.getElementById("ask-arena");
  const yes = document.getElementById("ask-yes");
  const no = document.getElementById("ask-no");
  const taunt = document.getElementById("ask-taunt");
  if (!arena || !yes || !no) return;

  const TAUNTS = ["Are you sure?", "Really sure?", "Think again 🥺", "Wrong button", "Nice try 😏", "Not happening", "The other one!", "You can't catch me"];
  let dodges = 0;
  let lastDodge = 0;
  let answered = false;

  function reset() {
    dodges = 0;
    answered = false;
    no.classList.remove("is-loose");
    no.style.left = "";
    no.style.top = "";
    no.style.transform = "";
    no.textContent = "No";
    yes.style.transform = "";
    yes.disabled = false;
    yes.innerHTML = `Yes ${document.querySelector("svg.lucide-heart")?.outerHTML || ""}`;
    taunt.textContent = "";
  }

  function overlaps(a, b, pad) {
    return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
  }

  function dodge() {
    const now = performance.now();
    if (answered || now - lastDodge < 160) return;
    lastDodge = now;

    const box = arena.getBoundingClientRect();
    const current = no.getBoundingClientRect();
    const yesRect = yes.getBoundingClientRect();
    if (!no.classList.contains("is-loose")) {
      // Pin it where it is first, so the jump animates from its real position.
      no.style.left = `${current.left - box.left}px`;
      no.style.top = `${current.top - box.top}px`;
      no.classList.add("is-loose");
      void no.offsetWidth;
    }

    const maxX = Math.max(0, box.width - current.width);
    const maxY = Math.max(0, box.height - current.height);
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      x = Math.random() * maxX;
      y = Math.random() * maxY;
      const candidate = { left: box.left + x, top: box.top + y, right: box.left + x + current.width, bottom: box.top + y + current.height };
      const moved = Math.hypot(candidate.left - current.left, candidate.top - current.top);
      if (!overlaps(candidate, yesRect, 14) && moved > 70) break;
    }
    no.style.left = `${x}px`;
    no.style.top = `${y}px`;

    dodges += 1;
    no.textContent = TAUNTS[(dodges - 1) % TAUNTS.length];
    no.style.transform = `scale(${Math.max(0.72, 1 - dodges * 0.035)})`;
    yes.style.transform = `scale(${Math.min(1.35, 1 + dodges * 0.06)})`;
    taunt.textContent = dodges >= 4 ? "The Yes button is right there, getting bigger… 👀" : "";
  }

  // Touch: it moves before the finger lands. Mouse: it moves when the cursor gets close.
  no.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dodge();
  });
  no.addEventListener("click", (event) => {
    event.preventDefault();
    dodge();
  });
  arena.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const rect = no.getBoundingClientRect();
    const distance = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
    if (distance < Math.max(rect.width, rect.height) * 0.9) dodge();
  });

  yes.addEventListener("click", () => {
    if (answered) return;
    answered = true;
    yes.disabled = true;
    yes.textContent = "Yay! 🎉";
    taunt.textContent = "";
    window.LetterFX?.burstFrom(yes, 34);
    window.LetterFX?.chime?.();
    const name = CONFIG.herName || "She";
    const message = dodges === 0
      ? "She said yes right away, no hesitation. 💕"
      : `She tried to press "No" ${dodges} time${dodges === 1 ? "" : "s"} first, but said yes. 😏`;
    window.DateApp?.notify(`${name} said YES 💕`, message, ["heart", "tada"]);
    window.setTimeout(() => window.DateApp?.showStep("date"), 950);
  });

  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "ask" && event.detail.previous !== "ask") reset();
  });
})();
