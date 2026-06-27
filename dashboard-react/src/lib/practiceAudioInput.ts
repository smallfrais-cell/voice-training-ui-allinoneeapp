import type { AudioFrameHandler } from "./wavRecorder";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export class PracticeAudioInput {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stopped = true;

  constructor(
    private readonly onAudioFrame: AudioFrameHandler,
    private readonly getInputGain: () => number = () => 1,
  ) {}

  async start(): Promise<void> {
    if (this.context) return;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("This browser does not support Web Audio input.");
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
    this.processor = this.context.createScriptProcessor(2048, 1, 1);
    this.stopped = false;

    this.processor.onaudioprocess = (event) => {
      if (this.stopped || !this.context) return;

      const input = event.inputBuffer.getChannelData(0);
      this.onAudioFrame(applyGain(input, this.getInputGain()), this.context.sampleRate);
      event.outputBuffer.getChannelData(0).fill(0);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  async stop(): Promise<void> {
    this.stopped = true;

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

function applyGain(input: Float32Array, gain: number): Float32Array {
  const safeGain = Number.isFinite(gain) ? Math.max(0, Math.min(4, gain)) : 1;
  const output = new Float32Array(input.length);

  for (let i = 0; i < input.length; i += 1) {
    output[i] = Math.max(-1, Math.min(1, input[i] * safeGain));
  }

  return output;
}
