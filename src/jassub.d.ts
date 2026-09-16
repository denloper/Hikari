declare module "jassub" {
  export default class JASSUB {
    constructor(opts: {
      video: HTMLVideoElement;
      canvas?: HTMLCanvasElement;
      subContent?: string;
      subUrl?: string;
      workerUrl?: string;
      wasmUrl?: string;
      legacyWasmUrl?: string;
    });
    destroy(): void;
  }
}
