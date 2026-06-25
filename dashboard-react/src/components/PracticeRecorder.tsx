import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [pitchFloor, setPitchFloor] = useState(() => {
    const saved = Number(window.localStorage.getItem("voice-garden.pitchFloorHz") || "130");
    return Number.isFinite(saved) ? saved : 130;
  });

  const recorderRef = useRef<WavRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const pitchHzRef = useRef<number | null>(null);
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
            ? "Scripts loaded from your local script file. Luxurious, by computer standards."
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
    if (!selectedScript) {
      setEditingText("");
      return;
    }

    setEditingText(selectedScript.text);
    setLabel(selectedScript.title || "Practice take");
  }, [selectedScript]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      void recorderRef.current?.abort();
    };
  }, []);

  const handleAudioFrame = useCallback((samples: Float32Array, sampleRate: number) => {
    const now = performance.now();
    if (now - lastPitchUpdateRef.current < 90) return;
    lastPitchUpdateRef.current = now;

    const measured = estimatePitch(samples, sampleRate);
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
      resetLivePitch();
      const recorder = new WavRecorder(handleAudioFrame);
      await recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = performance.now();
      setElapsedMs(0);
      setRecorderState("recording");
      setStatus("Recording. Watch the tiny pitch monitor and keep reading like a responsible mammal.");

      timerRef.current = window.setInterval(() => {
        setElapsedMs(performance.now() - startedAtRef.current);
      }, 250);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Could not start recording.");
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
    }
  }

  async function restartTake() {
    stopTimer();
    await recorderRef.current?.abort();
    recorderRef.current = null;
    setElapsedMs(0);
    setRecorderState("idle");
    resetLivePitch();
    setError(null);
    setStatus("Take scrapped. Start again when ready.");
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function resetLivePitch() {
    pitchHzRef.current = null;
    lastPitchUpdateRef.current = 0;
    setPitchHz(null);
    setPitchPoints([]);
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
            record a local WAV, save scripts to disk, and watch a tiny live pitch trace
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
                placeholder="Paste the passage here. It saves to a real local script file now, because we are adults apparently."
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

          <label className="reading-script-label">
            Reading script
            <textarea
              className="reading-script"
              value={editingText}
              onChange={(event) => setEditingText(event.target.value)}
              placeholder="Select or add a script. The text stays visible while you record."
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

          <LivePitchMonitor
            active={recorderState === "recording"}
            hz={pitchHz}
            points={pitchPoints}
            floor={pitchFloor}
            onFloorChange={setPitchFloor}
          />

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

interface LivePitchMonitorProps {
  active: boolean;
  hz: number | null;
  points: PitchPoint[];
  floor: number;
  onFloorChange: (value: number) => void;
}

function LivePitchMonitor({ active, hz, points, floor, onFloorChange }: LivePitchMonitorProps) {
  const minHz = 80;
  const maxHz = 280;
  const floorY = pitchToY(floor, minHz, maxHz);
  const path = makePitchPath(points, minHz, maxHz);
  const isAboveFloor = hz !== null && hz >= floor;

  return (
    <div className={`live-pitch ${active ? "active" : ""}`}>
      <div className="live-pitch-head">
        <div>
          <h3>Live pitch floor</h3>
          <p>quick guide only · the full analyzer still judges the recording after</p>
        </div>
        <div className={`live-pitch-readout ${isAboveFloor ? "ok" : hz ? "low" : "quiet"}`}>
          <b>{formatHz(hz)}</b>
          <span>{hzToNote(hz)}</span>
        </div>
      </div>

      <svg className="live-pitch-graph" viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="100" y1="14" y2="14" className="pitch-grid" />
        <line x1="0" x2="100" y1="28" y2="28" className="pitch-grid" />
        <line x1="0" x2="100" y1="42" y2="42" className="pitch-grid" />
        <line x1="0" x2="100" y1={floorY} y2={floorY} className="pitch-floor-line" />
        {path && <path d={path} className="pitch-line" />}
      </svg>

      <div className="live-pitch-footer">
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
        <span>280 Hz</span>
      </div>
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
