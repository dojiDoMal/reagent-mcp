/**
 * Shared request handler for the browser runtime.
 *
 * This is the heart of the diagnostic runtime: it answers BridgeRequests by
 * reading the app's live state through the registered adapters. It is factored
 * out of init-debug-runtime so it can run in two transports without
 * duplicating (and drifting from) the tool logic:
 *
 *   - the WS runtime (init-debug-runtime), where the MCP server calls it
 *     remotely over the loopback bridge;
 *   - an in-page bridge (LocalBridge), where a playground calls it
 *     in-process, e.g. an embedded demo.
 *
 * The handler is the source of truth for what each tool returns.
 */

import { applyLimits, DEFAULT_LIMITS, type Limits } from "../core/limits.js";
import type { AppSnapshot, BridgeRequest } from "../core/protocol.js";
import { NetworkCapture, resolveBodyOptions } from "./network-capture.js";
import {
  filterReduxState,
  readAllStorage,
  readPath,
  readRoute,
  readStorage,
  type AdaptersConfig,
} from "./adapters.js";

export interface RequestHandlerOptions {
  adapters?: AdaptersConfig;
  /** Override response limits. */
  limits?: Partial<Limits>;
  /** Strict mode. Default true (allowlists enforced). */
  strictMode?: boolean;
  /** Session id advertised in snapshots. */
  sessionId?: string;
  /** Origin advertised in snapshots (e.g. the host page origin). */
  origin?: string;
}

export interface RuntimeHandler {
  /** Append the adapters that were actually registered. */
  adapterNames: string[];
  strictMode: boolean;
  /** Answer one diagnostic request against live app state. */
  handle: (request: BridgeRequest) => unknown;
  /** Build the current app snapshot. */
  snapshot: () => AppSnapshot;
}

export function createRequestHandler(
  options: RequestHandlerOptions = {}
): RuntimeHandler {
  const adapters = options.adapters ?? {};
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const strictMode = options.strictMode ?? true;
  const sessionId = options.sessionId ?? "";
  const origin = options.origin ?? "";

  const networkCapture = adapters.network
    ? new NetworkCapture(
        adapters.network.max,
        resolveBodyOptions(adapters.network.profile, adapters.network.body),
        adapters.network.urlFilter
      )
    : null;
  if (networkCapture && adapters.network) {
    networkCapture.attach(adapters.network.axios);
  }

  const adapterNames: string[] = [];
  if (adapters.redux) adapterNames.push("redux");
  if (adapters.storage) adapterNames.push("storage");
  if (adapters.router) adapterNames.push("router");
  if (adapters.network) adapterNames.push("network");

  const snapshot = (): AppSnapshot => ({
    connected: true,
    sessionId,
    origin,
    adapters: adapterNames,
    route: adapters.router ? readRoute(adapters.router.history).pathname : undefined,
    strictMode,
    capturedAt: new Date().toISOString(),
  });

  const handle = (request: BridgeRequest): unknown => {
    switch (request.type) {
      case "get_app_snapshot":
        return snapshot();

      case "get_redux_state": {
        if (!adapters.redux) {
          throw new Error("redux adapter is not registered");
        }
        const state = adapters.redux.store.getState();
        // Strict mode restricts reads to the configured allowlist, applied to
        // the full store first (entries are anchored to the store root). The
        // agent's `path` selection is then resolved against the filtered tree,
        // so it can never reach outside the allowlist.
        const visible = strictMode
          ? filterReduxState(state, adapters.redux.allow, adapters.redux.allowMode)
          : state;
        const selected = readPath(visible, request.path);
        return applyLimits(selected, limits);
      }

      case "get_storage": {
        if (!adapters.storage) {
          throw new Error("storage adapter is not registered");
        }
        const area =
          request.area === "local" ? window.localStorage : window.sessionStorage;
        // Non-strict mode ignores the allowlist: full storage access.
        if (!strictMode) {
          return readAllStorage(area, request.keys);
        }
        const allow =
          request.area === "local"
            ? adapters.storage.localStorage
            : adapters.storage.sessionStorage;
        // Only keys that are both requested and allowlisted are returned.
        const effective = request.keys
          ? request.keys.filter((k) => (allow ?? []).includes(k))
          : allow;
        return readStorage(area, effective);
      }

      case "get_route": {
        if (!adapters.router) {
          throw new Error("router adapter is not registered");
        }
        return readRoute(adapters.router.history);
      }

      case "get_network_activity": {
        if (!networkCapture) {
          throw new Error("network adapter is not registered");
        }
        // Apply depth/entry limits: captured bodies may be deep or cyclic.
        return applyLimits(networkCapture.recent(request.limit), limits);
      }

      default: {
        const _exhaustive: never = request;
        throw new Error(`unknown request: ${JSON.stringify(_exhaustive)}`);
      }
    }
  };

  return { adapterNames, strictMode, handle, snapshot };
}
