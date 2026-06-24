export interface PracticeScript {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "voice-garden.practiceScripts.v1";

export function loadScripts(): PracticeScript[] {
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

export function saveScripts(scripts: PracticeScript[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts, null, 2));
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
