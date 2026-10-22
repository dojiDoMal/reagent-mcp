/**
 * Adapter contracts for the browser runtime.
 *
 * Adapters that need a reference to an app object (store, router) are
 * registered explicitly via initDebugRuntime. There is no auto-discovery
 * through React internals, which would be fragile and version-dependent.
 */

/** Minimal Redux store surface we rely on. Works for classic Redux and RTK. */
export interface ReduxStoreLike {
  getState(): unknown;
  subscribe(listener: () => void): () => void;
}

export interface ReduxAdapterConfig {
  store: ReduxStoreLike;
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

/** Minimal axios surface needed to register interceptors. */
export interface AxiosLike {
  interceptors: {
    request: { use(onFulfilled: (config: unknown) => unknown): number };
    response: {
      use(
        onFulfilled: (response: unknown) => unknown,
        onRejected: (error: unknown) => unknown
      ): number;
    };
  };
}

export interface NetworkAdapterConfig {
  /** The axios instance to observe (the app's default axios or a created one). */
  axios: AxiosLike;
  /** Max requests retained in the ring buffer. Default 50. */
  max?: number;
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
