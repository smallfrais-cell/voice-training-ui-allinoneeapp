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

  constructor(private readonly onAudioFrame: AudioFrameHandler) {}

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
      this.onAudioFrame(new Float32Array(input), this.context.sampleRate);
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
