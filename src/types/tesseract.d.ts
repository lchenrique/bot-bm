declare module 'tesseract.js' {
  export interface WorkerParams {
    tessedit_char_whitelist?: string;
    [key: string]: any;
  }

  export interface WorkerResult {
    data: {
      text: string;
      [key: string]: any;
    };
  }

  export interface Worker {
    recognize(image: string): Promise<WorkerResult>;
    setParameters(params: WorkerParams): Promise<void>;
    terminate(): Promise<void>;
  }

  export function createWorker(language?: string): Promise<Worker>;
} 