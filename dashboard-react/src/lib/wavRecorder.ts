export interface WavRecording {
  blob: Blob;
  durationMs: number;
  sampleRate: number;
}

export type AudioFrameHandler = (samples: Float32Array, sampleRate: number) => void;

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export class WavRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private stopped = false;
  private onAudioFrame?: AudioFrameHandler;

  constructor(onAudioFrame?: AudioFrameHandler) {
    this.onAudioFrame = onAudioFrame;
  }

  async start(): Promise<void> {
    if (this.context) {
      throw new Error("Recorder is already running.");
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("This browser does not support Web Audio recording.");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });

    this.context = new AudioContextCtor();
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.startedAt = performance.now();
    this.stopped = false;

    this.processor.onaudioprocess = (event) => {
      if (this.stopped || !this.context) return;

      const input = event.inputBuffer.getChannelData(0);
      const frame = new Float32Array(input);
      this.chunks.push(frame);
      this.onAudioFrame?.(frame, this.context.sampleRate);

      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  async stop(): Promise<WavRecording> {
    if (!this.context) {
      throw new Error("Recorder is not running.");
    }

    this.stopped = true;
    const durationMs = performance.now() - this.startedAt;
    const sampleRate = this.context.sampleRate;
    const samples = mergeChunks(this.chunks);
    const wavBuffer = encodeWav(samples, sampleRate);

    await this.cleanup();

    return {
      blob: new Blob([wavBuffer], { type: "audio/wav" }),
      durationMs,
      sampleRate,
    };
  }

  async abort(): Promise<void> {
    this.stopped = true;
    this.chunks = [];
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.processor = null;
    this.source = null;

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }

    this.context = null;
  }
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const channelCount = 1;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
