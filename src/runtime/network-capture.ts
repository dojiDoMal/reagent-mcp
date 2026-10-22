/**
 * Captures recent axios requests via interceptors into a bounded ring buffer
 * so the agent can inspect network activity (status, method, URL, timing).
 *
 * Dev-only. The app passes its axios instance; we attach request/response
 * interceptors that record metadata without altering the request/response.
 *
 * Note: this environment is dev with fake data, so URLs/params are recorded
 * as-is (no redaction). Do not enable in production.
 */

import type { AxiosLike } from "./adapters.js";

export interface CapturedRequest {
  method: string;
  url: string;
  status: number | null;
  ok: boolean | null;
  /** Duration in ms, when the response/error completed the cycle. */
  durationMs: number | null;
  /** "pending" | "success" | "error". */
  phase: "pending" | "success" | "error";
  startedAt: string;
  /** Error message when phase is "error". */
  error?: string;
}

interface AxiosConfigShape {
  method?: string;
  url?: string;
  __rdmStart?: number;
  __rdmId?: number;
}

interface AxiosResponseShape {
  status?: number;
  config?: AxiosConfigShape;
}

interface AxiosErrorShape {
  message?: string;
  response?: AxiosResponseShape;
  config?: AxiosConfigShape;
}

export class NetworkCapture {
  private buffer: CapturedRequest[] = [];
  private byId = new Map<number, CapturedRequest>();
  private nextId = 1;

  constructor(private readonly max: number = 50) {}

  attach(axios: AxiosLike): void {
    axios.interceptors.request.use((config) => {
      const cfg = (config ?? {}) as AxiosConfigShape;
      const id = this.nextId++;
      cfg.__rdmStart = now();
      cfg.__rdmId = id;

      const record: CapturedRequest = {
        method: (cfg.method ?? "get").toUpperCase(),
        url: cfg.url ?? "",
        status: null,
        ok: null,
        durationMs: null,
        phase: "pending",
        startedAt: new Date().toISOString(),
      };
      this.push(id, record);
      return config;
    });

    axios.interceptors.response.use(
      (response) => {
        this.complete(response as AxiosResponseShape, null);
        return response;
      },
      (error) => {
        const err = error as AxiosErrorShape;
        this.complete(err.response ?? null, err);
        return Promise.reject(error);
      }
    );
  }

  private complete(
    response: AxiosResponseShape | null,
    error: AxiosErrorShape | null
  ): void {
    const cfg = (response?.config ?? error?.config) as AxiosConfigShape | undefined;
    const id = cfg?.__rdmId;
    const record = id != null ? this.byId.get(id) : undefined;
    if (!record) return;

    const start = cfg?.__rdmStart;
    record.durationMs = start != null ? Math.round(now() - start) : null;
    record.status = response?.status ?? error?.response?.status ?? null;

    if (error) {
      record.phase = "error";
      record.ok = false;
      record.error = error.message ?? "request failed";
    } else {
      record.phase = "success";
      record.ok = record.status != null && record.status >= 200 && record.status < 400;
    }
  }

  private push(id: number, record: CapturedRequest): void {
    this.buffer.push(record);
    this.byId.set(id, record);
    if (this.buffer.length > this.max) {
      const removed = this.buffer.shift();
      // Drop the matching id entry to avoid unbounded growth.
      for (const [key, value] of this.byId) {
        if (value === removed) {
          this.byId.delete(key);
          break;
        }
      }
    }
  }

  recent(limit?: number): CapturedRequest[] {
    if (limit == null) return [...this.buffer];
    return this.buffer.slice(-limit);
  }
}

function now(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}
