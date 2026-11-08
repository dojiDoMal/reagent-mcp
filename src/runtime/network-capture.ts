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

/**
 * Capture profiles — presets that set sensible defaults so most users just
 * pick one. Fields in `BodyCaptureOptions` override individual preset values.
 *
 * - "minimal" (default): metadata only. No bodies, no headers.
 * - "detailed": request/response bodies and headers, with size caps applied.
 */
export type NetworkCaptureProfile = "minimal" | "detailed";

/** What parts of request/response bodies to capture. Off by default. */
export interface BodyCaptureOptions {
  /** Capture the response body (response.data). Default false. */
  responseBody?: boolean;
  /** Capture the request body (config.data). Default false. */
  requestBody?: boolean;
  /** Capture request/response headers. Default false. */
  headers?: boolean;
  /**
   * Max serialized length (characters) retained per captured body before
   * truncation. Guards the agent's context from huge payloads. Default 10000.
   */
  maxBodyLength?: number;
  /**
   * Raw mode: keep bodies uncut (ignores `maxBodyLength`). For heavy debugging
   * where you need the full payload, e.g. an entire token or large response.
   * Default false.
   */
  raw?: boolean;
}

const DEFAULT_MAX_BODY_LENGTH = 10_000;

/** Preset values for each profile, before per-field overrides. */
const PROFILE_PRESETS: Record<NetworkCaptureProfile, Required<BodyCaptureOptions>> = {
  minimal: {
    responseBody: false,
    requestBody: false,
    headers: false,
    maxBodyLength: DEFAULT_MAX_BODY_LENGTH,
    raw: false,
  },
  detailed: {
    responseBody: true,
    requestBody: true,
    headers: true,
    maxBodyLength: DEFAULT_MAX_BODY_LENGTH,
    raw: false,
  },
};

/**
 * Resolve the final capture options from a profile plus per-field overrides.
 *
 * Precedence: the profile (default "minimal") sets the base, then each field
 * present in `overrides` wins. Passing only `overrides` keeps backward
 * compatibility (base "minimal" + your overrides).
 */
export function resolveBodyOptions(
  profile: NetworkCaptureProfile | undefined,
  overrides: BodyCaptureOptions | undefined
): Required<BodyCaptureOptions> {
  const base = PROFILE_PRESETS[profile ?? "minimal"];
  const o = overrides ?? {};
  return {
    responseBody: o.responseBody ?? base.responseBody,
    requestBody: o.requestBody ?? base.requestBody,
    headers: o.headers ?? base.headers,
    maxBodyLength: o.maxBodyLength ?? base.maxBodyLength,
    raw: o.raw ?? base.raw,
  };
}

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
  /** Request body, when requestBody capture is enabled. */
  requestBody?: unknown;
  /** Response body (response.data), when responseBody capture is enabled. */
  responseBody?: unknown;
  /** Request headers, when headers capture is enabled. */
  requestHeaders?: Record<string, unknown>;
  /** Response headers, when headers capture is enabled. */
  responseHeaders?: Record<string, unknown>;
}

interface AxiosConfigShape {
  method?: string;
  url?: string;
  data?: unknown;
  headers?: Record<string, unknown>;
  __rdmStart?: number;
  __rdmId?: number;
}

interface AxiosResponseShape {
  status?: number;
  data?: unknown;
  headers?: Record<string, unknown>;
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
  private readonly body: Required<BodyCaptureOptions>;
  private readonly urlFilters: string[];

  constructor(
    private readonly max: number = 25,
    body: Required<BodyCaptureOptions> = PROFILE_PRESETS.minimal,
    urlFilter?: string | string[]
  ) {
    this.body = body;
    this.urlFilters = normalizeUrlFilter(urlFilter);
  }

  /**
   * Whether a request URL should be captured. When no filters are configured
   * every request is kept; otherwise the URL must contain at least one filter
   * term (case-insensitive substring match).
   */
  private shouldCapture(url: string): boolean {
    if (this.urlFilters.length === 0) return true;
    const haystack = url.toLowerCase();
    return this.urlFilters.some((term) => haystack.includes(term));
  }

  attach(axios: AxiosLike): void {
    axios.interceptors.request.use((config) => {
      const cfg = (config ?? {}) as AxiosConfigShape;
      const url = cfg.url ?? "";
      // Skip requests that don't match the configured URL filter(s). We never
      // assign an __rdmId, so the response interceptor also ignores them.
      if (!this.shouldCapture(url)) {
        return config;
      }
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
      if (this.body.requestBody && cfg.data !== undefined) {
        record.requestBody = this.sanitizeBody(cfg.data);
      }
      if (this.body.headers && cfg.headers) {
        record.requestHeaders = this.sanitizeHeaders(cfg.headers);
      }
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

    // The response carrying the body is either the success response or, on
    // error, the error.response (e.g. a 4xx/5xx with an error payload).
    const payload = response ?? error?.response ?? null;
    if (this.body.responseBody && payload?.data !== undefined) {
      record.responseBody = this.sanitizeBody(payload.data);
    }
    if (this.body.headers && payload?.headers) {
      record.responseHeaders = this.sanitizeHeaders(payload.headers);
    }

    if (error) {
      record.phase = "error";
      record.ok = false;
      record.error = error.message ?? "request failed";
    } else {
      record.phase = "success";
      record.ok = record.status != null && record.status >= 200 && record.status < 400;
    }
  }

  /**
   * Make a body safe for transport: strings are length-capped; everything
   * else is passed through (the shared `applyLimits` + serializer downstream
   * handle depth/entry limits and type preservation). Non-serializable
   * values are replaced with a marker.
   */
  private sanitizeBody(data: unknown): unknown {
    if (typeof data === "string") {
      return this.truncateString(data);
    }
    // Binary payloads we can't meaningfully serialize for the agent.
    if (
      (typeof Blob !== "undefined" && data instanceof Blob) ||
      (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer)
    ) {
      return "[binary content]";
    }
    if (typeof FormData !== "undefined" && data instanceof FormData) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of (data as FormData).entries()) {
        out[k] = typeof v === "string" ? this.truncateString(v) : "[file]";
      }
      return out;
    }
    return data;
  }

  private sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(headers)) {
      out[k] = typeof v === "string" ? this.truncateString(v) : v;
    }
    return out;
  }

  private truncateString(s: string): string {
    // Raw mode keeps the full payload, bypassing the size cap.
    if (this.body.raw) return s;
    const max = this.body.maxBodyLength;
    return s.length > max
      ? s.slice(0, max) + `... [truncated: ${s.length - max} more chars]`
      : s;
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

/**
 * Normalize the `urlFilter` option into a list of lowercased, non-empty terms.
 * Accepts a single string or a list of strings; blank entries are dropped so
 * an empty/whitespace filter doesn't silently reject every request.
 */
function normalizeUrlFilter(urlFilter: string | string[] | undefined): string[] {
  if (urlFilter == null) return [];
  const list = Array.isArray(urlFilter) ? urlFilter : [urlFilter];
  return list
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0);
}
