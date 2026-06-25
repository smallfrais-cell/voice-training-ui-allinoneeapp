export interface PitchPoint {
  t: number;
  hz: number | null;
}

const noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function estimatePitch(samples: Float32Array, sampleRate: number): number | null {
  if (!samples.length) return null;

  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i];
  }
  const mean = sum / samples.length;

  let rmsSum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const centered = samples[i] - mean;
    rmsSum += centered * centered;
  }
  const rms = Math.sqrt(rmsSum / samples.length);
  if (rms < 0.012) return null;

  const minHz = 70;
  const maxHz = 450;
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

  if (bestLag <= 0 || bestCorr < 0.38) return null;

  const hz = sampleRate / bestLag;
  return Number.isFinite(hz) ? hz : null;
}

export function hzToNote(hz: number | null | undefined): string {
  if (!hz || !Number.isFinite(hz) || hz <= 0) return "—";

  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const note = noteNames[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export function formatHz(hz: number | null | undefined): string {
  if (!hz || !Number.isFinite(hz)) return "—";
  return `${Math.round(hz)} Hz`;
}
