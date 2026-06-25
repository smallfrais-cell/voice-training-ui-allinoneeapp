export interface PracticeScript {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "voice-garden.practiceScripts.v1";

export async function loadScripts(): Promise<PracticeScript[]> {
  const cached = loadCachedScripts();

  try {
    const response = await fetch("/api/scripts", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const parsed = await response.json();
    const saved = Array.isArray(parsed) ? parsed.filter(isPracticeScript) : [];

    // First run after upgrading from localStorage: migrate the old browser cache to
    // the real local script file. Software archaeology, but with less dust.
    if (saved.length === 0 && cached.length > 0) {
      await saveScripts(cached);
      return cached;
    }

    saveCachedScripts(saved);
    return saved;
  } catch {
    return cached;
  }
}

export async function saveScripts(scripts: PracticeScript[]): Promise<void> {
  const clean = scripts.filter(isPracticeScript);
  saveCachedScripts(clean);

  const response = await fetch("/api/scripts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clean),
  });

  if (!response.ok) {
    throw new Error(`Could not save scripts: HTTP ${response.status}`);
  }
}

export function loadCachedScripts(): PracticeScript[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isPracticeScript);
  } catch {
    return [];
  }
}

export function saveCachedScripts(scripts: PracticeScript[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts.filter(isPracticeScript), null, 2));
}

export function makeScript(title: string, text: string): PracticeScript {
  const now = new Date().toISOString();

  return {
    id: makeId(),
    title: title.trim(),
    text: text.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

export function updateScript(script: PracticeScript, patch: Partial<Pick<PracticeScript, "title" | "text">>): PracticeScript {
  return {
    ...script,
    ...patch,
    title: patch.title?.trim() ?? script.title,
    text: patch.text?.trim() ?? script.text,
    updatedAt: new Date().toISOString(),
  };
}

function makeId(): string {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `script-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isPracticeScript(value: unknown): value is PracticeScript {
  if (!value || typeof value !== "object") return false;
  const script = value as Record<string, unknown>;

  return (
    typeof script.id === "string" &&
    typeof script.title === "string" &&
    typeof script.text === "string" &&
    typeof script.createdAt === "string" &&
    typeof script.updatedAt === "string"
  );
}
