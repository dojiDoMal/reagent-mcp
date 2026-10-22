/**
 * Captures recent runtime errors in a bounded ring buffer so the agent can
 * query them via get_runtime_errors. Dev-only; installed by the runtime.
 */

export interface CapturedError {
  message: string;
  stack?: string;
  source: "error" | "unhandledrejection";
  at: string;
}

export class ErrorCapture {
  private buffer: CapturedError[] = [];
  private detach: (() => void) | null = null;

  constructor(private readonly max: number = 50) {}

  start(): void {
    if (this.detach) return;

    const onError = (event: ErrorEvent) => {
      this.push({
        message: event.message,
        stack: event.error?.stack,
        source: "error",
        at: new Date().toISOString(),
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      this.push({
        message: reason?.message ?? String(reason),
        stack: reason?.stack,
        source: "unhandledrejection",
        at: new Date().toISOString(),
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    this.detach = () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }

  stop(): void {
    this.detach?.();
    this.detach = null;
  }

  private push(err: CapturedError): void {
    this.buffer.push(err);
    if (this.buffer.length > this.max) {
      this.buffer.shift();
    }
  }

  recent(limit?: number): CapturedError[] {
    if (limit == null) return [...this.buffer];
    return this.buffer.slice(-limit);
  }
}
