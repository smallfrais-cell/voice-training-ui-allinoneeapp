export interface PracticeScript {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "voice-garden.practiceScripts.v1";
const SEEDED_KEY = "voice-garden.practiceScripts.seededDefaults.v1";

const DEFAULT_DRILL_TEXT = `Warmup: easy hums
mmm... mmm... mmm...
mmm-may, mmm-mee, mmm-my
Keep it gentle. No pushing, no throat squeeze.

Pitch floor drill
mm-hmm. mm-hmm. I mean, I was thinking...
I was going to say something.
I don't know, maybe we can try it again.
Keep the last word from dropping below your floor.

Forward resonance drill
mee, may, my, moe, moo
nee, nay, nye, no, noo
key, kitty, tiny, city, silly, sunny
Aim for small, bright, buzzy, forward sound. Not louder. Not strained.

Light weight drill
hee hee, huh huh, hey hey
very light, very easy, very small
I can keep this soft and clear.
Use less force than your brain thinks is necessary, because brains are dramatic.

Sentence endings drill
I wanted to go today.
I thought it was really cute.
I don't know if that works for me.
Can we try that one more time?
Land the final word gently without falling into the basement.

Intonation drill
Really?
I mean... maybe?
That's cute, but I don't know.
I wanted the pink one, not the black one.
Let the melody move without yanking your throat around.

Cooldown
mmm... easy sigh
soft hum
sip water
Stop if anything hurts.`;

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

    if (saved.length === 0 && cached.length === 0 && !defaultsWereSeeded()) {
      const defaults = makeDefaultScripts();
      markDefaultsSeeded();
      await saveScripts(defaults);
      return defaults;
    }

    saveCachedScripts(saved);
    return saved;
  } catch {
    if (cached.length > 0) return cached;

    if (!defaultsWereSeeded()) {
      const defaults = makeDefaultScripts();
      markDefaultsSeeded();
      saveCachedScripts(defaults);
      return defaults;
    }

    return [];
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

function makeDefaultScripts(): PracticeScript[] {
  return [makeScript("Transfem starter drills", DEFAULT_DRILL_TEXT)];
}

function defaultsWereSeeded(): boolean {
  return window.localStorage.getItem(SEEDED_KEY) === "yes";
}

function markDefaultsSeeded(): void {
  window.localStorage.setItem(SEEDED_KEY, "yes");
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
