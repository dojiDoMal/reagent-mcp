/**
 * Adapter contracts for the browser runtime.
 *
 * Adapters that need a reference to an app object (store, router) are
 * registered explicitly via initDebugRuntime. There is no auto-discovery
 * through React internals, which would be fragile and version-dependent.
 */

import type { NetworkCaptureProfile } from "./network-capture.js";

/** Minimal Redux store surface we rely on. Works for classic Redux and RTK. */
export interface ReduxStoreLike {
  getState(): unknown;
  subscribe(listener: () => void): () => void;
}

/**
 * How Redux allowlist entries are matched against the state tree. "path"
 * (default) treats each entry as a root-anchored path prefix, e.g. "session"
 * or "session.user". "name" treats each entry as a property name matched at
 * any depth. Path mode is fail-closed and predictable; name mode is more
 * permissive and meant for exploratory debugging only.
 */
export type ReduxAllowMode = "path" | "name";

export interface ReduxAdapterConfig {
  store: ReduxStoreLike;
  /**
   * Allowlist that restricts which parts of the state the agent may read while
   * strict mode is on. Omit (or leave empty) to expose nothing — strict mode
   * with no allowlist returns an empty object. When strict mode is off, the
   * allowlist is ignored and the whole store is readable.
   */
  allow?: string[];
  /**
   * How `allow` entries are interpreted. Default "path" (root-anchored path
   * prefixes). "name" matches property names at any depth; prefer "path".
   * Matching is always case-sensitive and against full segment/property names
   * (not substrings).
   */
  allowMode?: ReduxAllowMode;
}

/** Allowlist of storage keys the agent may read. Empty array = none. */
export interface StorageAdapterConfig {
  localStorage?: string[];
  sessionStorage?: string[];
}

/** Minimal history surface (React Router v5 / history v4). */
export interface HistoryLike {
  location: {
    pathname: string;
    search: string;
    hash: string;
    state?: unknown;
  };
}

export interface RouterAdapterConfig {
  /** The history object the app uses (e.g. the one passed to <Router history>). */
  history: HistoryLike;
}

/**
 * Minimal axios surface needed to register interceptors.
 *
 * Parameters are intentionally permissive (`any`): a real `AxiosInstance` has
 * generic, contravariant interceptor signatures that are not assignable to a
 * narrower `unknown`-based shape. This is an interop boundary, so we keep it
 * loose enough that `axios.create()` results are accepted as-is.
 */
export interface AxiosLike {
  interceptors: {
    request: { use(onFulfilled: (config: any) => any): number };
    response: {
      use(onFulfilled: (response: any) => any, onRejected: (error: any) => any): number;
    };
  };
}

export interface NetworkBodyCaptureConfig {
  /** Capture the response body (response.data). Default false. */
  responseBody?: boolean;
  /** Capture the request body (config.data). Default false. */
  requestBody?: boolean;
  /** Capture request/response headers. Default false. */
  headers?: boolean;
  /** Max serialized chars retained per captured body. Default 10000. */
  maxBodyLength?: number;
  /** Raw mode: keep bodies uncut (ignores maxBodyLength). Default false. */
  raw?: boolean;
}

export interface NetworkAdapterConfig {
  /** The axios instance to observe (the app's default axios or a created one). */
  axios: AxiosLike;
  /** Max requests retained in the ring buffer. Default 25. */
  max?: number;
  /**
   * Restrict which requests are recorded. A single term or a list of terms;
   * a request is captured only when its URL contains at least one term
   * (case-insensitive substring match), e.g. "usuarioservices". Omit to
   * capture every request.
   */
  urlFilter?: string | string[];
  /**
   * Capture profile preset. "minimal" (default) records metadata only;
   * "detailed" also captures request/response bodies and headers. Individual
   * fields in `body` override the chosen preset.
   */
  profile?: NetworkCaptureProfile;
  /**
   * Per-field overrides on top of `profile`. Opt-in capture of bodies and
   * headers is off by default to keep payloads small and avoid recording
   * sensitive data. Dev-only.
   */
  body?: NetworkBodyCaptureConfig;
}

export interface AdaptersConfig {
  redux?: ReduxAdapterConfig;
  storage?: StorageAdapterConfig;
  router?: RouterAdapterConfig;
  network?: NetworkAdapterConfig;
}

/** Parse a location into a route summary. */
export function readRoute(history: HistoryLike): {
  pathname: string;
  search: string;
  hash: string;
  query: Record<string, string>;
  state?: unknown;
} {
  const loc = history.location;
  const query: Record<string, string> = {};
  const search = loc.search?.startsWith("?") ? loc.search.slice(1) : loc.search ?? "";
  for (const pair of search.split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    const key = decodeURIComponent(idx >= 0 ? pair.slice(0, idx) : pair);
    const value = idx >= 0 ? decodeURIComponent(pair.slice(idx + 1)) : "";
    query[key] = value;
  }
  return {
    pathname: loc.pathname,
    search: loc.search,
    hash: loc.hash,
    query,
    state: loc.state,
  };
}

/** Read a value at a dot/bracket path from an object, e.g. "auth.user[0]". */
export function readPath(root: unknown, path: string | undefined): unknown {
  if (!path) return root;
  const parts = path
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Split a dot/bracket path into its segments, e.g. "a.b[0]" -> ["a","b","0"]. */
function pathSegments(path: string): string[] {
  return path
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
}

function isPlainIndexable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * Filter a Redux state tree against a path-prefix allowlist (root-anchored,
 * case-sensitive). An entry like "session.user" exposes that node and its
 * whole subtree; a shorter prefix like "session" exposes everything under it.
 * Branches are preserved only as far as needed to reach an allowed node, so
 * siblings outside the allowlist never appear. Returns an empty object when
 * the allowlist is empty.
 */
export function filterByPaths(root: unknown, allow: string[]): unknown {
  if (!allow || allow.length === 0) return {};
  const specs = allow.map(pathSegments).filter((s) => s.length > 0);

  const build = (node: unknown, matchers: string[][]): unknown => {
    // An empty-remainder matcher means this node is fully allowed: keep as-is.
    if (matchers.some((m) => m.length === 0)) return node;
    if (!isPlainIndexable(node)) return undefined;

    // Group the remaining matchers by their next segment.
    const byHead = new Map<string, string[][]>();
    for (const m of matchers) {
      const head = m[0];
      const rest = m.slice(1);
      const group = byHead.get(head) ?? [];
      group.push(rest);
      byHead.set(head, group);
    }

    const out: Record<string, unknown> = {};
    let kept = false;
    for (const [head, rests] of byHead) {
      if (!(head in node)) continue;
      const child = build((node as Record<string, unknown>)[head], rests);
      if (child !== undefined) {
        out[head] = child;
        kept = true;
      }
    }
    return kept ? out : undefined;
  };

  const result = build(root, specs);
  return result === undefined ? {} : result;
}

/**
 * Filter a Redux state tree by property name (case-sensitive, full-name
 * match) at any depth. When a property name is in the allowlist, that node and
 * its entire subtree are kept; otherwise the node is retained only if some
 * descendant matches. More permissive than path mode — exploratory use only.
 * Returns an empty object when the allowlist is empty.
 */
export function filterByNames(root: unknown, allow: string[]): unknown {
  if (!allow || allow.length === 0) return {};
  const names = new Set(allow);

  const build = (node: unknown): unknown => {
    if (!isPlainIndexable(node)) return undefined;
    const out: Record<string, unknown> = {};
    let kept = false;
    for (const key of Object.keys(node)) {
      const value = (node as Record<string, unknown>)[key];
      if (names.has(key)) {
        // Name matched: keep this node and its whole subtree.
        out[key] = value;
        kept = true;
        continue;
      }
      // Otherwise descend; keep only if a descendant matched.
      const child = build(value);
      if (child !== undefined) {
        out[key] = child;
        kept = true;
      }
    }
    return kept ? out : undefined;
  };

  const result = build(root);
  return result === undefined ? {} : result;
}

/**
 * Apply the Redux allowlist to a selected state value under strict mode.
 * `mode` selects path-prefix (default) or name matching. The allowlist is
 * fail-closed: an empty/omitted allowlist exposes nothing.
 */
export function filterReduxState(
  selected: unknown,
  allow: string[] | undefined,
  mode: ReduxAllowMode = "path"
): unknown {
  const list = allow ?? [];
  return mode === "name"
    ? filterByNames(selected, list)
    : filterByPaths(selected, list);
}

/** Read only allowlisted keys from a Storage area. */
export function readStorage(
  area: Storage,
  allow: string[] | undefined
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of allow ?? []) {
    out[key] = area.getItem(key);
  }
  return out;
}

/**
 * Read every key from a Storage area, ignoring any allowlist. Used only when
 * strict mode is disabled. When `keys` is given, reads just those keys (still
 * unrestricted). Dev-only; grants full storage access.
 */
export function readAllStorage(
  area: Storage,
  keys?: string[]
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (keys) {
    for (const key of keys) out[key] = area.getItem(key);
    return out;
  }
  for (let i = 0; i < area.length; i++) {
    const key = area.key(i);
    if (key != null) out[key] = area.getItem(key);
  }
  return out;
}
