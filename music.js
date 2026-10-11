/*
 * Background music. Loops CONFIG.musicUrl if set (a same-origin file such as
 * assets/music.mp3); otherwise plays a soft generated music-box lullaby.
 * Browsers block audio until the visitor interacts, so it starts on the first
 * tap, click or key press. Exposes window.LetterMusic for the sound toggle.
 */
(function () {
  "use strict";

  const url = CONFIG.musicUrl || "";
  let enabled = true;
  try {
    const saved = window.localStorage.getItem("date-letter-sound");
    if (saved !== null) enabled = saved === "on";
  } catch { /* Storage may be unavailable in private browsing. */ }

  // iOS 17+: without this, Web Audio stays silent while the ringer switch is off.
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch { /* Unsupported. */ }

  let ctx = null;
  let master = null;
  let bus = null;
  let padFilter = null;
  let audioEl = null;
  let unlocked = false;
  let playing = false;
  let stopTimer = null;

  function ensureContext() {
    if (ctx) return true;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return true;
  }

  // Fading through a gain node because iOS ignores HTMLMediaElement.volume.
  function rampTo(value, seconds) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  /* ---------------------------- Own song file ---------------------------- */
  function startFile() {
    if (!audioEl) {
      audioEl = new Audio(url);
      audioEl.loop = true;
      audioEl.preload = "auto";
      ctx.createMediaElementSource(audioEl).connect(master);
    }
    audioEl.play().catch(() => { /* Retried on the next tap (see onGesture). */ });
  }

  /* ------------------------ Generated music box --------------------------- */
  const EIGHTH = 60 / 74 / 2;
  // I – vi – IV – V in C major, voiced close together so the arpeggio flows.
  const CHORDS = [
    { tones: [60, 64, 67, 72], bass: 48 },
    { tones: [57, 60, 64, 69], bass: 45 },
    { tones: [57, 60, 65, 69], bass: 41 },
    { tones: [55, 59, 62, 67], bass: 43 }
  ];
  const ARPEGGIO = [0, 2, 1, 3, 2, 1, 3, 2];
  const MELODY_A = [[76, 79], [76, 72], [77, 81], [79, 74]];
  const MELODY_B = [[79, 76], [72, 76], [81, 77], [74, 71]];
  let nextTime = 0;
  let step = 0;
  let scheduler = null;

  const mtof = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  function buildGraph() {
    if (bus) return;
    bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(master);

    const reverb = ctx.createConvolver();
    const length = Math.floor(ctx.sampleRate * 2.6);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
    reverb.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    bus.connect(reverb);
    reverb.connect(wet);
    wet.connect(master);

    padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = 900;
    padFilter.connect(bus);
  }

  function pluck(time, midi, velocity) {
    const frequency = mtof(midi);
    const body = ctx.createOscillator();
    const tine = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const tineGain = ctx.createGain();
    body.type = "sine";
    tine.type = "sine";
    body.frequency.value = frequency;
    tine.frequency.value = frequency * 3.01;
    bodyGain.gain.setValueAtTime(0.0001, time);
    bodyGain.gain.exponentialRampToValueAtTime(velocity, time + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 2.2);
    tineGain.gain.setValueAtTime(0.0001, time);
    tineGain.gain.exponentialRampToValueAtTime(velocity * 0.22, time + 0.003);
    tineGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
    body.connect(bodyGain);
    bodyGain.connect(bus);
    tine.connect(tineGain);
    tineGain.connect(bus);
    body.start(time);
    tine.start(time);
    body.stop(time + 2.3);
    tine.stop(time + 0.35);
  }

  function sustain(time, midi, duration, level, type, destination) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = mtof(midi);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(level, time + 0.9);
    gain.gain.setValueAtTime(level, time + duration - 0.2);
    gain.gain.linearRampToValueAtTime(0.0001, time + duration + 1.1);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(time);
    oscillator.stop(time + duration + 1.2);
  }

  function playStep(index, time) {
    const bar = Math.floor(index / 8) % 16;
    const position = index % 8;
    const chord = CHORDS[bar % 4];
    const humanize = Math.random() * 0.008;

    pluck(time + humanize, chord.tones[ARPEGGIO[position]], (position === 0 ? 0.05 : 0.036) * (0.9 + Math.random() * 0.2));

    if (position === 0) {
      const barLength = EIGHTH * 8;
      chord.tones.slice(0, 3).forEach((midi) => sustain(time, midi - 12, barLength, 0.011, "triangle", padFilter));
      sustain(time, chord.bass, barLength, 0.028, "sine", bus);
    }

    // The melody joins after four bars of arpeggio, then alternates two phrases.
    if (bar >= 4 && (position === 0 || position === 4)) {
      const phrase = bar >= 8 && bar < 12 ? MELODY_B : MELODY_A;
      pluck(time + humanize, phrase[bar % 4][position / 4], 0.06);
    }
  }

  function scheduleAhead() {
    while (nextTime < ctx.currentTime + 0.4) {
      playStep(step, nextTime);
      step += 1;
      nextTime += EIGHTH;
    }
  }

  function startBox() {
    if (scheduler) return;
    buildGraph();
    step = 0;
    nextTime = ctx.currentTime + 0.12;
    scheduleAhead();
    scheduler = window.setInterval(scheduleAhead, 100);
  }

  function stopBox() {
    window.clearInterval(scheduler);
    scheduler = null;
  }

  /* ------------------------------ Control -------------------------------- */
  function start() {
    if (!enabled || !unlocked || playing || !ensureContext()) return;
    playing = true;
    window.clearTimeout(stopTimer);
    ctx.resume().catch(() => {});
    if (url) startFile();
    else startBox();
    rampTo(url ? 0.8 : 1.7, 2.5);
  }

  function stop() {
    if (!playing) return;
    playing = false;
    rampTo(0, 0.6);
    window.clearTimeout(stopTimer);
    stopTimer = window.setTimeout(() => {
      if (playing) return;
      stopBox();
      audioEl?.pause();
    }, 700);
  }

  function onGesture(event) {
    unlocked = true;
    if (!enabled || event.target.closest?.("#sound-toggle")) return;
    if (!playing) { start(); return; }
    // Some browsers only allow audio after a "real" tap, not a swipe.
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    if (audioEl?.paused) audioEl.play().catch(() => {});
  }

  ["pointerup", "touchend", "click", "keydown"].forEach((type) => {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) {
      ctx.suspend().catch(() => {});
      audioEl?.pause();
    } else if (playing) {
      ctx.resume().catch(() => {});
      audioEl?.play().catch(() => {});
    }
  });

  window.LetterMusic = {
    setEnabled(on) {
      enabled = on;
      if (on) { unlocked = true; start(); }
      else stop();
    }
  };
})();
