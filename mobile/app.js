const STORE = {
  scripts: "voice-pocket.scripts",
  selectedScriptId: "voice-pocket.selectedScriptId",
  module: "voice-pocket.module",
  floor: "voice-pocket.pitchFloorHz",
  ceiling: "voice-pocket.pitchCeilingHz",
  gain: "voice-pocket.inputGain",
  noiseFloor: "voice-pocket.noiseFloorDb",
};

const DEFAULT_SCRIPT = {
  id: "transfem-starter-drills",
  title: "Transfem starter drills",
  text: `1. Gentle warmup
Humm lightly on mmm for 20 seconds. Keep the throat easy. No pushing.

2. Pitch floor check
Speak these softly while keeping the line above your floor:
me me me, may may may, moon moon moon

3. Forward resonance
Use a tiny bright smile and feel the buzz near lips/teeth:
nee nee nee, nyah nyah nyah, zhee zhee zhee

4. Light weight
Say each phrase with less vocal heaviness, like the sound is smaller and cleaner:
I am just checking my voice.
This is easy and gentle.
I can stop before it gets strained.

5. Sentence endings
Keep the last word from dropping hard:
I am going to the shop.
Can you pass me that?
That sounds really nice.

6. Cooldown
Hum softly again. Let the pitch fall where comfortable. Done is better than fried.`
};

const noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

const els = {
  installButton: document.querySelector("#install-button"),
  micToggle: document.querySelector("#mic-toggle"),
  micStatus: document.querySelector("#mic-status"),
  tabs: [...document.querySelectorAll(".tab")],
  modules: {
    pitch: document.querySelector("#pitch-module"),
    volume: document.querySelector("#volume-module"),
    waveform: document.querySelector("#waveform-module"),
  },
  gainSlider: document.querySelector("#gain-slider"),
  gainValue: document.querySelector("#gain-value"),
  gainReset: document.querySelector("#gain-reset"),
  pitchReadout: document.querySelector("#pitch-readout"),
  pitchHz: document.querySelector("#pitch-hz"),
  pitchNote: document.querySelector("#pitch-note"),
  pitchPath: document.querySelector("#pitch-path"),
  floorLine: document.querySelector("#floor-line"),
  floorInput: document.querySelector("#floor-input"),
  ceilingInput: document.querySelector("#ceiling-input"),
  noiseLabel: document.querySelector("#noise-label"),
  calibrateNoise: document.querySelector("#calibrate-noise"),
  clearNoise: document.querySelector("#clear-noise"),
  volumeValue: document.querySelector("#volume-value"),
  volumeBar: document.querySelector("#volume-bar"),
  waveformPath: document.querySelector("#waveform-path"),
  scriptCount: document.querySelector("#script-count"),
  scriptSelect: document.querySelector("#script-select"),
  scriptText: document.querySelector("#script-text"),
  saveScript: document.querySelector("#save-script"),
  deleteScript: document.querySelector("#delete-script"),
  newScriptTitle: document.querySelector("#new-script-title"),
  newScriptText: document.querySelector("#new-script-text"),
  addScript: document.querySelector("#add-script"),
  wakeToggle: document.querySelector("#wake-toggle"),
};

let state = {
  module: loadString(STORE.module, "pitch"),
  floor: loadNumber(STORE.floor, 130),
  ceiling: clamp(loadNumber(STORE.ceiling, 320), 180, 450),
  gain: clamp(loadNumber(STORE.gain, 1), 0.25, 3),
  noiseFloorDb: loadNullableNumber(STORE.noiseFloor),
  scripts: loadScripts(),
  selectedScriptId: localStorage.getItem(STORE.selectedScriptId) || null,
  volumeDb: null,
  pitchHz: null,
  pitchPoints: [],
  waveform: [],
};

let audio = {
  ctx: null,
  stream: null,
  source: null,
  analyser: null,
  data: null,
  running: false,
  raf: 0,
  lastPitchAt: 0,
  smoothedHz: null,
};

let deferredInstallPrompt = null;
let wakeLock = null;

init();

function init() {
  if (!state.scripts.length) {
    state.scripts = [DEFAULT_SCRIPT];
    saveScripts();
  }

  if (!state.selectedScriptId || !state.scripts.some((script) => script.id === state.selectedScriptId)) {
    state.selectedScriptId = state.scripts[0].id;
  }

  bindEvents();
  renderAll();
  registerServiceWorker();
}

function bindEvents() {
  els.micToggle.addEventListener("click", () => {
    if (audio.running) {
      stopMic();
    } else {
      void startMic();
    }
  });

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.module = tab.dataset.module;
      localStorage.setItem(STORE.module, state.module);
      renderModule();
    });
  });

  els.gainSlider.addEventListener("input", () => {
    state.gain = clamp(Number(els.gainSlider.value) || 1, 0.25, 3);
    localStorage.setItem(STORE.gain, String(state.gain));
    renderGain();
  });

  els.gainReset.addEventListener("click", () => {
    state.gain = 1;
    localStorage.setItem(STORE.gain, "1");
    renderGain();
  });

  els.floorInput.addEventListener("change", () => {
    state.floor = clamp(Number(els.floorInput.value) || 130, 80, 240);
    localStorage.setItem(STORE.floor, String(state.floor));
    renderPitchSettings();
  });

  els.ceilingInput.addEventListener("change", () => {
    state.ceiling = clamp(Number(els.ceilingInput.value) || 320, 180, 450);
    localStorage.setItem(STORE.ceiling, String(state.ceiling));
    renderPitchSettings();
  });

  els.calibrateNoise.addEventListener("click", () => {
    if (state.volumeDb === null || !Number.isFinite(state.volumeDb)) {
      setStatus("No room level yet. Start the mic, stay quiet with the fan on, then calibrate.");
      return;
    }

    state.noiseFloorDb = Math.round(state.volumeDb);
    localStorage.setItem(STORE.noiseFloor, String(state.noiseFloorDb));
    audio.smoothedHz = null;
    state.pitchHz = null;
    state.pitchPoints = [];
    setStatus(`Fan calibrated at ${state.noiseFloorDb} dB. Speak clearly above it.`);
    renderNoise();
  });

  els.clearNoise.addEventListener("click", () => {
    state.noiseFloorDb = null;
    localStorage.removeItem(STORE.noiseFloor);
    setStatus("Room noise gate cleared.");
    renderNoise();
  });

  els.scriptSelect.addEventListener("change", () => {
    state.selectedScriptId = els.scriptSelect.value;
    localStorage.setItem(STORE.selectedScriptId, state.selectedScriptId);
    renderScriptText();
  });

  els.saveScript.addEventListener("click", () => {
    const script = currentScript();
    if (!script) return;
    script.text = els.scriptText.value.trim();
    script.updatedAt = new Date().toISOString();
    saveScripts();
    setStatus("Script saved locally on this phone.");
    renderScripts();
  });

  els.deleteScript.addEventListener("click", () => {
    const script = currentScript();
    if (!script || state.scripts.length <= 1) {
      setStatus("Keep at least one script. Tiny app, tiny boundary.");
      return;
    }
    const confirmed = window.confirm(`Delete “${script.title}”?`);
    if (!confirmed) return;
    state.scripts = state.scripts.filter((candidate) => candidate.id !== script.id);
    state.selectedScriptId = state.scripts[0].id;
    saveScripts();
    localStorage.setItem(STORE.selectedScriptId, state.selectedScriptId);
    renderScripts();
  });

  els.addScript.addEventListener("click", () => {
    const title = els.newScriptTitle.value.trim();
    const text = els.newScriptText.value.trim();
    if (!title || !text) {
      setStatus("Give the new script a title and some text first.");
      return;
    }
    const script = { id: makeId(), title, text, updatedAt: new Date().toISOString() };
    state.scripts.push(script);
    state.selectedScriptId = script.id;
    saveScripts();
    localStorage.setItem(STORE.selectedScriptId, script.id);
    els.newScriptTitle.value = "";
    els.newScriptText.value = "";
    renderScripts();
    setStatus("New script saved locally.");
  });

  els.wakeToggle.addEventListener("click", () => void toggleWakeLock());

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installButton.classList.remove("hidden");
  });

  els.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    els.installButton.classList.add("hidden");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wakeLock) {
      void requestWakeLock();
    }
  });
}

async function startMic() {
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error("This browser does not support Web Audio.");

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });

    const ctx = new AudioContextCtor();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);

    audio = {
      ...audio,
      ctx,
      stream,
      source,
      analyser,
      data: new Float32Array(analyser.fftSize),
      running: true,
      lastPitchAt: 0,
      smoothedHz: null,
    };

    setStatus("listening");
    els.micToggle.textContent = "Pause mic";
    loop();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function stopMic() {
  audio.running = false;
  if (audio.raf) cancelAnimationFrame(audio.raf);
  audio.source?.disconnect();
  audio.stream?.getTracks().forEach((track) => track.stop());
  audio.ctx?.close().catch(() => null);
  audio.ctx = null;
  audio.stream = null;
  audio.source = null;
  audio.analyser = null;
  audio.data = null;
  audio.smoothedHz = null;
  state.pitchHz = null;
  state.pitchPoints = [];
  state.volumeDb = null;
  state.waveform = [];
  els.micToggle.textContent = "Start mic";
  setStatus("paused");
  renderLiveData();
}

function loop() {
  if (!audio.running || !audio.analyser || !audio.data || !audio.ctx) return;

  audio.analyser.getFloatTimeDomainData(audio.data);
  const samples = applyGain(audio.data, state.gain);
  const now = performance.now();

  const rms = calculateRms(samples);
  const db = rms > 0 ? 20 * Math.log10(rms) : null;
  state.volumeDb = db !== null && Number.isFinite(db) ? clamp(db, -80, 0) : null;
  state.waveform = sampleWaveform(samples);

  if (now - audio.lastPitchAt > 90) {
    audio.lastPitchAt = now;
    const measured = estimatePitch(samples, audio.ctx.sampleRate, {
      minHz: 70,
      maxHz: state.ceiling,
      minRms: 0.016,
      minClarity: 0.58,
      noiseFloorDb: state.noiseFloorDb,
      noiseMarginDb: 8,
    });

    const smoothed = measured
      ? audio.smoothedHz
        ? audio.smoothedHz * 0.68 + measured * 0.32
        : measured
      : null;

    audio.smoothedHz = smoothed;
    state.pitchHz = smoothed;
    state.pitchPoints = [...state.pitchPoints, { t: now, hz: smoothed }]
      .filter((point) => now - point.t <= 8000)
      .slice(-90);

    renderPitch();
  }

  renderVolume();
  renderWaveform();
  audio.raf = requestAnimationFrame(loop);
}

function estimatePitch(samples, sampleRate, options = {}) {
  if (!samples.length) return null;

  const minHz = options.minHz ?? 70;
  const maxHz = options.maxHz ?? 320;
  const minRms = options.minRms ?? 0.014;
  const minClarity = options.minClarity ?? 0.52;
  const noiseMarginDb = options.noiseMarginDb ?? 8;

  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i];
  const mean = sum / samples.length;

  let rmsSum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const centered = samples[i] - mean;
    rmsSum += centered * centered;
  }
  const rms = Math.sqrt(rmsSum / samples.length);
  if (rms < minRms) return null;

  const currentDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  if (
    options.noiseFloorDb !== null &&
    options.noiseFloorDb !== undefined &&
    Number.isFinite(options.noiseFloorDb) &&
    currentDb < options.noiseFloorDb + noiseMarginDb
  ) {
    return null;
  }

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(Math.floor(sampleRate / minHz), samples.length - 2);
  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;

    for (let i = 0; i < samples.length - lag; i += 1) {
      const left = samples[i] - mean;
      const right = samples[i + lag] - mean;
      corr += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }

    const denom = Math.sqrt(leftEnergy * rightEnergy);
    if (denom <= 0) continue;
    const normalised = corr / denom;
    if (normalised > bestCorr) {
      bestCorr = normalised;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorr < minClarity) return null;
  const hz = sampleRate / bestLag;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) return null;
  return hz;
}

function renderAll() {
  els.floorInput.value = String(state.floor);
  els.ceilingInput.value = String(state.ceiling);
  renderModule();
  renderGain();
  renderNoise();
  renderScripts();
  renderLiveData();
}

function renderModule() {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.module === state.module));
  Object.entries(els.modules).forEach(([name, node]) => node.classList.toggle("active", name === state.module));
}

function renderGain() {
  els.gainSlider.value = String(state.gain);
  els.gainValue.textContent = `${state.gain.toFixed(2)}x`;
  els.gainReset.disabled = Math.abs(state.gain - 1) < 0.01;
}

function renderPitchSettings() {
  els.floorInput.value = String(state.floor);
  els.ceilingInput.value = String(state.ceiling);
  renderPitch();
}

function renderNoise() {
  els.noiseLabel.textContent = state.noiseFloorDb === null ? "No room noise gate" : `Room noise: ${state.noiseFloorDb} dB`;
  els.clearNoise.disabled = state.noiseFloorDb === null;
}

function renderLiveData() {
  renderPitch();
  renderVolume();
  renderWaveform();
}

function renderPitch() {
  const hz = state.pitchHz;
  const hasPitch = hz !== null && Number.isFinite(hz);
  els.pitchHz.textContent = hasPitch ? `${Math.round(hz)} Hz` : "—";
  els.pitchNote.textContent = hasPitch ? hzToNote(hz) : "—";
  els.pitchReadout.classList.toggle("ok", hasPitch && hz >= state.floor);
  els.pitchReadout.classList.toggle("low", hasPitch && hz < state.floor);
  els.pitchReadout.classList.toggle("quiet", !hasPitch);

  const minHz = 80;
  const maxHz = Math.max(state.ceiling, 180);
  const floorY = pitchToY(state.floor, minHz, maxHz);
  els.floorLine.setAttribute("y1", String(floorY));
  els.floorLine.setAttribute("y2", String(floorY));
  els.pitchPath.setAttribute("d", makePitchPath(state.pitchPoints, minHz, maxHz));
}

function renderVolume() {
  const value = state.volumeDb;
  els.volumeValue.textContent = value === null ? "— dB" : `${Math.round(value)} dB`;
  const pct = value === null ? 0 : clamp(((value + 60) / 60) * 100, 0, 100);
  els.volumeBar.style.width = `${pct}%`;
}

function renderWaveform() {
  els.waveformPath.setAttribute("d", makeWaveformPath(state.waveform));
}

function renderScripts() {
  els.scriptSelect.replaceChildren();
  state.scripts.forEach((script) => {
    const option = document.createElement("option");
    option.value = script.id;
    option.textContent = script.title;
    els.scriptSelect.append(option);
  });
  els.scriptSelect.value = state.selectedScriptId;
  els.scriptCount.textContent = `${state.scripts.length} saved locally`;
  renderScriptText();
}

function renderScriptText() {
  const script = currentScript();
  els.scriptText.value = script?.text ?? "";
  els.deleteScript.disabled = state.scripts.length <= 1;
}

function currentScript() {
  return state.scripts.find((script) => script.id === state.selectedScriptId) ?? state.scripts[0] ?? null;
}

function loadScripts() {
  try {
    const raw = localStorage.getItem(STORE.scripts);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((script) => script && script.id && script.title && script.text);
  } catch {
    return [];
  }
}

function saveScripts() {
  localStorage.setItem(STORE.scripts, JSON.stringify(state.scripts));
}

function setStatus(text) {
  els.micStatus.textContent = text;
}

async function toggleWakeLock() {
  if (wakeLock) {
    await wakeLock.release().catch(() => null);
    wakeLock = null;
    els.wakeToggle.textContent = "Keep awake";
    setStatus("screen wake lock released");
    return;
  }
  await requestWakeLock();
}

async function requestWakeLock() {
  try {
    if (!("wakeLock" in navigator)) throw new Error("Wake lock is not supported here.");
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
      els.wakeToggle.textContent = "Keep awake";
    });
    els.wakeToggle.textContent = "Awake on";
    setStatus("screen will stay awake");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function applyGain(input, gain) {
  const safeGain = clamp(Number.isFinite(gain) ? gain : 1, 0, 4);
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    output[i] = clamp(input[i] * safeGain, -1, 1);
  }
  return output;
}

function calculateRms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function sampleWaveform(samples) {
  if (!samples.length) return [];
  const points = 80;
  const step = Math.max(1, Math.floor(samples.length / points));
  const out = [];
  for (let i = 0; i < samples.length; i += step) {
    out.push(clamp(samples[i], -1, 1));
    if (out.length >= points) break;
  }
  return out;
}

function makePitchPath(points, minHz, maxHz) {
  if (!points.length) return "";
  const now = points[points.length - 1].t;
  const windowMs = 8000;
  let path = "";
  let drawing = false;

  for (const point of points) {
    if (point.hz === null) {
      drawing = false;
      continue;
    }
    const x = clamp(100 - ((now - point.t) / windowMs) * 100, 0, 100);
    const y = pitchToY(point.hz, minHz, maxHz);
    path += `${drawing ? " L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    drawing = true;
  }
  return path;
}

function makeWaveformPath(values) {
  if (!values.length) return "";
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 29 - value * 23;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function pitchToY(hz, minHz, maxHz) {
  const clamped = clamp(hz, minHz, maxHz);
  const pct = (clamped - minHz) / (maxHz - minHz);
  return 54 - pct * 50;
}

function hzToNote(hz) {
  if (!hz || !Number.isFinite(hz) || hz <= 0) return "—";
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const note = noteNames[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

function makeId() {
  return `script-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadNumber(key, fallback) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

function loadNullableNumber(key) {
  const raw = localStorage.getItem(key);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function loadString(key, fallback) {
  return localStorage.getItem(key) || fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => null);
  });
}
