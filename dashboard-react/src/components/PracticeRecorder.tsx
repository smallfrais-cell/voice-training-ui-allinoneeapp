import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PracticeAudioInput } from "../lib/practiceAudioInput";
import { WavRecorder } from "../lib/wavRecorder";
import { estimatePitch, formatHz, hzToNote, type PitchPoint } from "../lib/pitchTracker";
import {
  loadScripts,
  makeScript,
  saveScripts,
  updateScript,
  type PracticeScript,
} from "../lib/scriptsStore";
import "./PracticeRecorder.css";

interface PracticeRecorderProps {
  onAnalyzed: () => Promise<void> | void;
}

type RecorderState = "idle" | "recording" | "analyzing";
type MonitorState = "off" | "starting" | "on" | "recording" | "error";
type MonitorModule = "pitch" | "volume" | "waveform";

interface AnalyzeErrorPayload {
  error?: string;
  stdout?: string;
  stderr?: string;
}

export function PracticeRecorder({ onAnalyzed }: PracticeRecorderProps) {
  const [scripts, setScripts] = useState<PracticeScript[]>([]);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [label, setLabel] = useState("Practice take");
  const [note, setNote] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newText, setNewText] = useState("");
  const [editingText, setEditingText] = useState("");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [status, setStatus] = useState("Loading local scripts...");
  const [error, setError] = useState<string | null>(null);
  const [pitchHz, setPitchHz] = useState<number | null>(null);
  const [pitchPoints, setPitchPoints] = useState<PitchPoint[]>([]);
  const [volumeDb, setVolumeDb] = useState<number | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [monitorState, setMonitorState] = useState<MonitorState>("off");
  const [monitorModule, setMonitorModule] = useState<MonitorModule>(() => {
    const saved = window.localStorage.getItem("voice-garden.monitorModule");
    return saved === "volume" || saved === "waveform" ? saved : "pitch";
  });
  const [pitchFloor, setPitchFloor] = useState(() => {
    const saved = Number(window.localStorage.getItem("voice-garden.pitchFloorHz") || "130");
    return Number.isFinite(saved) ? saved : 130;
  });
  const [pitchCeiling, setPitchCeiling] = useState(() => {
    const saved = Number(window.localStorage.getItem("voice-garden.pitchCeilingHz") || "320");
    return Number.isFinite(saved) ? clamp(saved, 180, 450) : 320;
  });
  const [noiseFloorDb, setNoiseFloorDb] = useState<number | null>(() => {
    const saved = window.localStorage.getItem("voice-garden.noiseFloorDb");
    if (!saved) return null;
    const parsed = Number(saved);
    return Number.isFinite(parsed) ? parsed : null;
  });

  const recorderRef = useRef<WavRecorder | null>(null);
  const liveInputRef = useRef<PracticeAudioInput | null>(null);
  const monitorWantedRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const pitchHzRef = useRef<number | null>(null);
  const pitchCeilingRef = useRef(pitchCeiling);
  const noiseFloorDbRef = useRef(noiseFloorDb);
  const lastPitchUpdateRef = useRef(0);

  const selectedScript = useMemo(
    () => scripts.find((script) => script.id === selectedScriptId) ?? null,
    [scripts, selectedScriptId],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrateScripts() {
      try {
        const loaded = await loadScripts();
        if (cancelled) return;

        setScripts(loaded);
        setSelectedScriptId((current) => current ?? loaded[0]?.id ?? null);
        setStatus(
          loaded.length
            ? "Scripts loaded from your local script file."
            : "Pick or add a script, then record a take.",
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("Could not load local scripts.");
        }
      } finally {
        if (!cancelled) setScriptsLoaded(true);
      }
    }

    void hydrateScripts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("voice-garden.pitchFloorHz", String(pitchFloor));
  }, [pitchFloor]);

  useEffect(() => {
    pitchCeilingRef.current = pitchCeiling;
    window.localStorage.setItem("voice-garden.pitchCeilingHz", String(pitchCeiling));
  }, [pitchCeiling]);

  useEffect(() => {
    noiseFloorDbRef.current = noiseFloorDb;
    if (noiseFloorDb === null) {
      window.localStorage.removeItem("voice-garden.noiseFloorDb");
    } else {
      window.localStorage.setItem("voice-garden.noiseFloorDb", String(noiseFloorDb));
    }
  }, [noiseFloorDb]);

  useEffect(() => {
    window.localStorage.setItem("voice-garden.monitorModule", monitorModule);
  }, [monitorModule]);

  useEffect(() => {
    if (!selectedScript) {
      setEditingText("");
      return;
    }

    setEditingText(selectedScript.text);
    setLabel(selectedScript.title || "Practice take");
  }, [selectedScript]);

  const handleAudioFrame = useCallback((samples: Float32Array, sampleRate: number) => {
    const now = performance.now();
    const rms = calculateRms(samples);
    const db = rms > 0 ? 20 * Math.log10(rms) : null;
    setVolumeDb(db !== null && Number.isFinite(db) ? Math.max(-80, Math.min(0, db)) : null);
    setWaveform(sampleWaveform(samples));

    if (now - lastPitchUpdateRef.current < 90) return;
    lastPitchUpdateRef.current = now;

    const measured = estimatePitch(samples, sampleRate, {
      maxHz: pitchCeilingRef.current,
      minClarity: 0.58,
      minRms: 0.016,
      noiseFloorDb: noiseFloorDbRef.current,
      noiseMarginDb: 8,
    });
    const smoothed = measured
      ? pitchHzRef.current
        ? pitchHzRef.current * 0.68 + measured * 0.32
        : measured
      : null;

    pitchHzRef.current = smoothed;
    setPitchHz(smoothed);
    setPitchPoints((current) => {
      const next = [...current, { t: now, hz: smoothed }].filter((point) => now - point.t <= 8000);
      return next.slice(-90);
    });
  }, []);

  const startLiveInput = useCallback(async () => {
    if (liveInputRef.current || recorderRef.current) return;

    try {
      monitorWantedRef.current = true;
      setMonitorState("starting");
      const input = new PracticeAudioInput(handleAudioFrame);
      await input.start();
      liveInputRef.current = input;
      setMonitorState("on");
      setError(null);
    } catch (err) {
      setMonitorState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [handleAudioFrame]);

  const stopLiveInput = useCallback(async (nextState: MonitorState = "off") => {
    await liveInputRef.current?.stop();
    liveInputRef.current = null;
    setMonitorState(nextState);
  }, []);

  useEffect(() => {
    void startLiveInput();

    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      void recorderRef.current?.abort();
      void liveInputRef.current?.stop();
    };
  }, [startLiveInput]);

  async function persistScripts(nextScripts: PracticeScript[], message: string) {
    setScripts(nextScripts);
    try {
      await saveScripts(nextScripts);
      setError(null);
      setStatus(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Script changed in memory, but saving to the local file failed.");
    }
  }

  async function addScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    const text = newText.trim();

    if (!title || !text) {
      setError("Give the script a title and some text first.");
      return;
    }

    const script = makeScript(title, text);
    const nextScripts = [...scripts, script];
    setSelectedScriptId(script.id);
    setNewTitle("");
    setNewText("");
    await persistScripts(nextScripts, "Script saved to your local script file.");
  }

  async function saveCurrentScript() {
    if (!selectedScript) return;

    const nextText = editingText.trim();
    if (!nextText) {
      setError("The selected script cannot be empty.");
      return;
    }

    const nextScripts = scripts.map((script) =>
      script.id === selectedScript.id ? updateScript(script, { text: nextText }) : script,
    );
    await persistScripts(nextScripts, "Script updated in your local script file.");
  }

  async function deleteScript(script: PracticeScript) {
    const confirmed = window.confirm(`Delete script “${script.title}”?`);
    if (!confirmed) return;

    const nextScripts = scripts.filter((candidate) => candidate.id !== script.id);
    if (selectedScriptId === script.id) {
      setSelectedScriptId(nextScripts[0]?.id ?? null);
    }
    await persistScripts(nextScripts, "Script deleted from your local script file.");
  }

  async function startRecording() {
    try {
      setError(null);
      resetLiveData();
      monitorWantedRef.current = monitorState === "on" || monitorState === "starting" || monitorWantedRef.current;
      await stopLiveInput("recording");

      const recorder = new WavRecorder(handleAudioFrame);
      await recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = performance.now();
      setElapsedMs(0);
      setRecorderState("recording");
      setMonitorState("recording");
      setStatus("Recording. The monitor is using the recording input now.");

      timerRef.current = window.setInterval(() => {
        setElapsedMs(performance.now() - startedAtRef.current);
      }, 250);
    } catch (err) {
      setRecorderState("idle");
      setMonitorState("error");
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Could not start recording.");
      if (monitorWantedRef.current) void startLiveInput();
    }
  }

  async function stopAndAnalyze() {
    if (!recorderRef.current) return;

    try {
      setRecorderState("analyzing");
      setError(null);
      stopTimer();
      setStatus("Saving WAV and running analyze.py...");

      const take = await recorderRef.current.stop();
      recorderRef.current = null;
      if (monitorWantedRef.current) void startLiveInput();

      if (take.durationMs < 900) {
        setRecorderState("idle");
        setStatus("Take was too short. Try again.");
        return;
      }

      const params = new URLSearchParams({
        label: label.trim() || selectedScript?.title || "Practice take",
      });
      const cleanNote = note.trim();
      if (cleanNote) params.set("note", cleanNote);

      const response = await fetch(`/api/analyze?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: take.blob,
      });

      const payload = (await response.json().catch(() => ({}))) as AnalyzeErrorPayload;
      if (!response.ok) {
        throw new Error(formatAnalyzeError(payload, response.status));
      }

      setStatus("Analysis saved. Refreshing dashboard data...");
      await delay(1200);
      await onAnalyzed();
      setStatus("Done. New take added to the garden.");
      setElapsedMs(0);
      setRecorderState("idle");
    } catch (err) {
      setRecorderState("idle");
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Analyze step failed.");
      await recorderRef.current?.abort();
      recorderRef.current = null;
      if (monitorWantedRef.current) void startLiveInput();
    }
  }

  async function restartTake() {
    stopTimer();
    await recorderRef.current?.abort();
    recorderRef.current = null;
    setElapsedMs(0);
    setRecorderState("idle");
    resetLiveData();
    setError(null);
    setStatus("Take scrapped. Start again when ready.");
    if (monitorWantedRef.current) void startLiveInput();
  }

  async function toggleLiveInput() {
    if (monitorState === "on" || monitorState === "starting") {
      monitorWantedRef.current = false;
      await stopLiveInput("off");
      resetLiveData();
      return;
    }

    monitorWantedRef.current = true;
    await startLiveInput();
  }

  function calibrateNoiseFloor() {
    if (volumeDb === null || !Number.isFinite(volumeDb)) {
      setStatus("No room noise level detected yet. Let the mic listen to the fan for a second, then calibrate.");
      return;
    }

    const calibrated = Math.round(volumeDb);
    setNoiseFloorDb(calibrated);
    setStatus(`Room noise calibrated at ${calibrated} dB. Voice needs to be clearly above that to count as pitch.`);
  }

  function clearNoiseFloor() {
    setNoiseFloorDb(null);
    setStatus("Room noise gate cleared.");
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function resetLiveData() {
    pitchHzRef.current = null;
    lastPitchUpdateRef.current = 0;
    setPitchHz(null);
    setPitchPoints([]);
    setVolumeDb(null);
    setWaveform([]);
  }

  const isBusy = recorderState !== "idle";
  const canRecord = recorderState === "idle";
  const canStop = recorderState === "recording";
  const hasScripts = scripts.length > 0;

  return (
    <section className="practice-card" aria-labelledby="practice-recorder-title">
      <div className="practice-head">
        <div>
          <h2 id="practice-recorder-title" className="section-title practice-title">
            🎙️ Practice recorder
          </h2>
          <p className="practice-subtitle">
            default drills, local scripts, recording, and always-available mic modules
          </p>
        </div>
        <div className={`recording-badge ${recorderState}`}>
          {recorderState === "recording" ? "recording" : recorderState === "analyzing" ? "analyzing" : "ready"}
        </div>
      </div>

      <div className="practice-grid">
        <div className="script-panel">
          <div className="script-menu-head">
            <h3>Scripts</h3>
            <span>{scriptsLoaded ? `${scripts.length} saved locally` : "loading..."}</span>
          </div>

          {hasScripts ? (
            <div className="script-list" aria-label="Saved scripts">
              {scripts.map((script) => (
                <button
                  key={script.id}
                  type="button"
                  className={`script-pill ${script.id === selectedScriptId ? "active" : ""}`}
                  onClick={() => setSelectedScriptId(script.id)}
                  disabled={isBusy}
                >
                  <span>{script.title}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Delete ${script.title}`}
                    className="trash"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!isBusy) void deleteScript(script);
                    }}
                    onKeyDown={(event) => {
                      if ((event.key === "Enter" || event.key === " ") && !isBusy) {
                        event.preventDefault();
                        event.stopPropagation();
                        void deleteScript(script);
                      }
                    }}
                  >
                    🗑️
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="script-empty">
              no scripts yet. paste your Rainbow Passage, drill, or other practice text below.
            </div>
          )}

          <form className="add-script" onSubmit={addScript}>
            <label>
              New script title
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Rainbow Passage"
                disabled={isBusy || !scriptsLoaded}
              />
            </label>
            <label>
              New script text
              <textarea
                value={newText}
                onChange={(event) => setNewText(event.target.value)}
                placeholder="Paste your next drill or passage here."
                rows={5}
                disabled={isBusy || !scriptsLoaded}
              />
            </label>
            <button type="submit" className="soft-btn" disabled={isBusy || !scriptsLoaded}>
              + Save script
            </button>
          </form>
        </div>

        <div className="recorder-panel">
          <div className="take-fields">
            <label>
              Take label
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="trying brighter resonance"
                disabled={recorderState === "analyzing"}
              />
            </label>
            <label>
              Optional note
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="felt easy / strained / sleepy data"
                disabled={recorderState === "analyzing"}
              />
            </label>
          </div>

          <LivePracticeMonitor
            module={monitorModule}
            monitorState={monitorState}
            hz={pitchHz}
            points={pitchPoints}
            floor={pitchFloor}
            ceiling={pitchCeiling}
            volumeDb={volumeDb}
            waveform={waveform}
            noiseFloorDb={noiseFloorDb}
            onFloorChange={setPitchFloor}
            onCeilingChange={setPitchCeiling}
            onCalibrateNoise={calibrateNoiseFloor}
            onClearNoise={clearNoiseFloor}
            onModuleChange={setMonitorModule}
            onToggleMonitor={() => void toggleLiveInput()}
          />

          <label className="reading-script-label">
            Reading script
            <textarea
              className="reading-script"
              value={editingText}
              onChange={(event) => setEditingText(event.target.value)}
              placeholder="Select or add a script. The text stays visible while you practice or record."
              rows={10}
              disabled={!selectedScript || recorderState === "analyzing"}
            />
          </label>

          <div className="script-actions">
            <button
              type="button"
              className="soft-btn"
              onClick={() => void saveCurrentScript()}
              disabled={!selectedScript || isBusy}
            >
              Save script edits
            </button>
          </div>

          <div className="recorder-controls">
            <div className="timer" aria-live="polite">
              {formatElapsed(elapsedMs)}
            </div>
            <div className="control-buttons">
              <button type="button" className="primary-btn" onClick={startRecording} disabled={!canRecord}>
                Start recording
              </button>
              <button type="button" className="primary-btn stop" onClick={stopAndAnalyze} disabled={!canStop}>
                Stop & analyze
              </button>
              <button type="button" className="soft-btn danger" onClick={restartTake} disabled={recorderState === "idle"}>
                Restart take
              </button>
            </div>
          </div>

          <div className="practice-status" aria-live="polite">
            {status}
          </div>
          {error && <div className="practice-error">{error}</div>}
        </div>
      </div>
    </section>
  );
}

interface LivePracticeMonitorProps {
  module: MonitorModule;
  monitorState: MonitorState;
  hz: number | null;
  points: PitchPoint[];
  floor: number;
  ceiling: number;
  volumeDb: number | null;
  waveform: number[];
  noiseFloorDb: number | null;
  onFloorChange: (value: number) => void;
  onCeilingChange: (value: number) => void;
  onCalibrateNoise: () => void;
  onClearNoise: () => void;
  onModuleChange: (value: MonitorModule) => void;
  onToggleMonitor: () => void;
}

function LivePracticeMonitor({
  module,
  monitorState,
  hz,
  points,
  floor,
  ceiling,
  volumeDb,
  waveform,
  noiseFloorDb,
  onFloorChange,
  onCeilingChange,
  onCalibrateNoise,
  onClearNoise,
  onModuleChange,
  onToggleMonitor,
}: LivePracticeMonitorProps) {
  const isActive = monitorState === "on" || monitorState === "recording";
  const statusText =
    monitorState === "recording"
      ? "recording input"
      : monitorState === "on"
        ? "listening"
        : monitorState === "starting"
          ? "starting"
          : monitorState === "error"
            ? "mic error"
            : "paused";

  return (
    <div className={`live-pitch ${isActive ? "active" : ""}`}>
      <div className="live-pitch-head">
        <div>
          <h3>Live mic module</h3>
          <p>{statusText} · practice with the drill before recording</p>
        </div>
        <div className="monitor-controls">
          <select
            value={module}
            onChange={(event) => onModuleChange(event.target.value as MonitorModule)}
            aria-label="Live monitor module"
          >
            <option value="pitch">Pitch floor</option>
            <option value="volume">Volume level</option>
            <option value="waveform">Waveform</option>
          </select>
          <button type="button" className="soft-btn" onClick={onToggleMonitor} disabled={monitorState === "recording"}>
            {monitorState === "on" || monitorState === "starting" ? "Pause mic" : "Start mic"}
          </button>
        </div>
      </div>

      {module === "pitch" && (
        <PitchModule
          hz={hz}
          points={points}
          floor={floor}
          ceiling={ceiling}
          noiseFloorDb={noiseFloorDb}
          onFloorChange={onFloorChange}
          onCeilingChange={onCeilingChange}
          onCalibrateNoise={onCalibrateNoise}
          onClearNoise={onClearNoise}
        />
      )}
      {module === "volume" && <VolumeModule volumeDb={volumeDb} />}
      {module === "waveform" && <WaveformModule waveform={waveform} />}
    </div>
  );
}

function PitchModule({
  hz,
  points,
  floor,
  ceiling,
  noiseFloorDb,
  onFloorChange,
  onCeilingChange,
  onCalibrateNoise,
  onClearNoise,
}: Pick<
  LivePracticeMonitorProps,
  "hz" | "points" | "floor" | "ceiling" | "noiseFloorDb" | "onFloorChange" | "onCeilingChange" | "onCalibrateNoise" | "onClearNoise"
>) {
  const minHz = 80;
  const maxHz = Math.max(ceiling, 180);
  const floorY = pitchToY(floor, minHz, maxHz);
  const path = makePitchPath(points, minHz, maxHz);
  const isAboveFloor = hz !== null && hz >= floor;

  return (
    <>
      <div className={`live-pitch-readout ${isAboveFloor ? "ok" : hz ? "low" : "quiet"}`}>
        <b>{formatHz(hz)}</b>
        <span>{hzToNote(hz)}</span>
      </div>
      <svg className="live-pitch-graph" viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="100" y1="14" y2="14" className="pitch-grid" />
        <line x1="0" x2="100" y1="28" y2="28" className="pitch-grid" />
        <line x1="0" x2="100" y1="42" y2="42" className="pitch-grid" />
        <line x1="0" x2="100" y1={floorY} y2={floorY} className="pitch-floor-line" />
        {path && <path d={path} className="pitch-line" />}
      </svg>
      <div className="live-pitch-footer pitch-settings">
        <span>80 Hz</span>
        <label>
          Floor
          <input
            type="number"
            min={80}
            max={240}
            step={1}
            value={floor}
            onChange={(event) => onFloorChange(Number(event.target.value) || 130)}
          />
          Hz
        </label>
        <label>
          Ceiling
          <input
            type="number"
            min={180}
            max={450}
            step={5}
            value={ceiling}
            onChange={(event) => onCeilingChange(clamp(Number(event.target.value) || 320, 180, 450))}
          />
          Hz
        </label>
      </div>
      <div className="noise-tools">
        <span>{noiseFloorDb === null ? "No room noise gate" : `Room noise: ${noiseFloorDb} dB`}</span>
        <button type="button" className="soft-btn" onClick={onCalibrateNoise}>
          Calibrate fan noise
        </button>
        <button type="button" className="soft-btn" onClick={onClearNoise} disabled={noiseFloorDb === null}>
          Clear
        </button>
      </div>
    </>
  );
}

function VolumeModule({ volumeDb }: Pick<LivePracticeMonitorProps, "volumeDb">) {
  const pct = volumeDb === null ? 0 : Math.max(0, Math.min(100, ((volumeDb + 60) / 60) * 100));

  return (
    <div className="module-body">
      <div className="module-big-value">{formatDb(volumeDb)}</div>
      <div className="volume-meter" aria-hidden="true">
        <div style={{ width: `${pct}%` }} />
      </div>
      <p className="module-hint">Aim for steady speaking volume. Louder is not automatically better, tragic though that is.</p>
    </div>
  );
}

function WaveformModule({ waveform }: Pick<LivePracticeMonitorProps, "waveform">) {
  const path = makeWaveformPath(waveform);

  return (
    <div className="module-body">
      <svg className="live-pitch-graph waveform-graph" viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="100" y1="28" y2="28" className="pitch-grid" />
        {path && <path d={path} className="pitch-line waveform-line" />}
      </svg>
      <p className="module-hint">Useful for checking that the mic is hearing you and that phrases are not clipping into chaos.</p>
    </div>
  );
}

function makePitchPath(points: PitchPoint[], minHz: number, maxHz: number): string {
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

    const x = Math.max(0, Math.min(100, 100 - ((now - point.t) / windowMs) * 100));
    const y = pitchToY(point.hz, minHz, maxHz);
    path += `${drawing ? " L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    drawing = true;
  }

  return path;
}

function pitchToY(hz: number, minHz: number, maxHz: number): number {
  const clamped = Math.max(minHz, Math.min(maxHz, hz));
  const pct = (clamped - minHz) / (maxHz - minHz);
  return 52 - pct * 48;
}

function calculateRms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

function sampleWaveform(samples: Float32Array): number[] {
  if (!samples.length) return [];
  const points = 80;
  const step = Math.max(1, Math.floor(samples.length / points));
  const out: number[] = [];

  for (let i = 0; i < samples.length; i += step) {
    out.push(Math.max(-1, Math.min(1, samples[i])));
    if (out.length >= points) break;
  }

  return out;
}

function makeWaveformPath(values: number[]): string {
  if (!values.length) return "";
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 28 - value * 22;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function formatDb(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "— dB";
  return `${Math.round(value)} dB`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatAnalyzeError(payload: AnalyzeErrorPayload, status: number): string {
  const parts = [payload.error || `Analyzer failed with HTTP ${status}`];
  const details = [payload.stderr, payload.stdout]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim())
    .join("\n\n");

  if (details) {
    parts.push(details.slice(0, 1200));
  }

  return parts.join("\n\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
