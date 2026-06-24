import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { WavRecorder } from "../lib/wavRecorder";
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

export function PracticeRecorder({ onAnalyzed }: PracticeRecorderProps) {
  const [scripts, setScripts] = useState<PracticeScript[]>(() => loadScripts());
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(() => {
    const loaded = loadScripts();
    return loaded[0]?.id ?? null;
  });
  const [label, setLabel] = useState("Practice take");
  const [note, setNote] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newText, setNewText] = useState("");
  const [editingText, setEditingText] = useState("");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [status, setStatus] = useState("Pick or add a script, then record a take.");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<WavRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const selectedScript = useMemo(
    () => scripts.find((script) => script.id === selectedScriptId) ?? null,
    [scripts, selectedScriptId],
  );

  useEffect(() => {
    saveScripts(scripts);
  }, [scripts]);

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

  function addScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    const text = newText.trim();

    if (!title || !text) {
      setError("Give the script a title and some text first.");
      return;
    }

    const script = makeScript(title, text);
    setScripts((current) => [...current, script]);
    setSelectedScriptId(script.id);
    setNewTitle("");
    setNewText("");
    setError(null);
    setStatus("Script saved locally. Tiny miracle, data persisted without a cloud login.");
  }

  function saveCurrentScript() {
    if (!selectedScript) return;

    const nextText = editingText.trim();
    if (!nextText) {
      setError("The selected script cannot be empty.");
      return;
    }

    setScripts((current) =>
      current.map((script) =>
        script.id === selectedScript.id ? updateScript(script, { text: nextText }) : script,
      ),
    );
    setError(null);
    setStatus("Script updated locally.");
  }

  function deleteScript(script: PracticeScript) {
    const confirmed = window.confirm(`Delete script “${script.title}”?`);
    if (!confirmed) return;

    setScripts((current) => current.filter((candidate) => candidate.id !== script.id));
    setSelectedScriptId((currentId) => {
      if (currentId !== script.id) return currentId;
      const remaining = scripts.filter((candidate) => candidate.id !== script.id);
      return remaining[0]?.id ?? null;
    });
    setStatus("Script deleted locally.");
  }

  async function startRecording() {
    try {
      setError(null);
      const recorder = new WavRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = performance.now();
      setElapsedMs(0);
      setRecorderState("recording");
      setStatus("Recording. Read the script, then stop and analyze.");

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

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Analyzer failed with HTTP ${response.status}`);
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
    setError(null);
    setStatus("Take scrapped. Start again when ready.");
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
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
            record a local WAV, run the analyzer, and keep the reading script on-screen
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
            <span>{scripts.length} saved</span>
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
                      if (!isBusy) deleteScript(script);
                    }}
                    onKeyDown={(event) => {
                      if ((event.key === "Enter" || event.key === " ") && !isBusy) {
                        event.preventDefault();
                        event.stopPropagation();
                        deleteScript(script);
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
                disabled={isBusy}
              />
            </label>
            <label>
              New script text
              <textarea
                value={newText}
                onChange={(event) => setNewText(event.target.value)}
                placeholder="Paste the passage here. We are not hardcoding a script, because apparently copyright exists."
                rows={5}
                disabled={isBusy}
              />
            </label>
            <button type="submit" className="soft-btn" disabled={isBusy}>
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
              rows={12}
              disabled={!selectedScript || recorderState === "analyzing"}
            />
          </label>

          <div className="script-actions">
            <button
              type="button"
              className="soft-btn"
              onClick={saveCurrentScript}
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
