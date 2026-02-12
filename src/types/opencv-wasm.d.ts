declare module 'opencv-wasm' {
  export interface Mat {
    data: Uint8Array;
    rows: number;
    cols: number;
    channels(): number;
    delete(): void;
  }

  export const cv: {
    Mat: new (rows: number, cols: number, type: number) => Mat;
    Size: new (width: number, height: number) => unknown;
    CV_8UC3: number;
    INTER_LINEAR: number;
    COLOR_RGB2BGR: number;
    resize(
      src: Mat,
      dst: Mat,
      size: unknown,
      fx: number,
      fy: number,
      interpolation: number,
    ): void;
    cvtColor(src: Mat, dst: Mat, code: number): void;
  };
}
