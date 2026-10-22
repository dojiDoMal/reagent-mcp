/**
 * Public browser entry point. Call this from your app, guarded by a
 * development check, e.g.:
 *
 *   if (process.env.NODE_ENV === "development") {
 *     import("react-debug-mcp/react").then(({ initDebugRuntime }) => {
 *       initDebugRuntime({ adapters: { redux: { store } } });
 *     });
 *   }
 *
 * The guard is the production-exclusion mechanism: in a CRA/Webpack build
 * the branch is eliminated as dead code, so nothing here ships to prod.
 */

import { DEFAULT_BRIDGE_PORT, type AppSnapshot } from "../core/protocol.js";
import { applyLimits, DEFAULT_LIMITS, type Limits } from "../core/limits.js";
import { encode } from "../core/serialize.js";
import { DebugBridge } from "./debug-bridge.js";
import { ErrorCapture } from "./error-capture.js";
import { NetworkCapture } from "./network-capture.js";
import {
  readPath,
  readRoute,
  readStorage,
  type AdaptersConfig,
} from "./adapters.js";

export interface InitDebugRuntimeOptions {
  adapters?: AdaptersConfig;
  /** Loopback port the MCP server listens on. */
  port?: number;
  /** Override response limits. */
  limits?: Partial<Limits>;
  /** Max runtime errors retained in the ring buffer. */
  maxErrors?: number;
}

export interface DebugRuntimeHandle {
  sessionId: string;
  stop(): void;
}

let activeHandle: DebugRuntimeHandle | null = null;

export function initDebugRuntime(
  options: InitDebugRuntimeOptions = {}
): DebugRuntimeHandle {
  if (typeof window === "undefined") {
    throw new Error("initDebugRuntime must run in a browser environment");
  }
  if (activeHandle) {
    return activeHandle;
  }

  const adapters = options.adapters ?? {};
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const port = options.port ?? DEFAULT_BRIDGE_PORT;
  const sessionId = makeSessionId();
  const origin = window.location.origin;

  const errorCapture = new ErrorCapture(options.maxErrors);
  errorCapture.start();

  const networkCapture = adapters.network ? new NetworkCapture(adapters.network.max) : null;
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
    capturedAt: new Date().toISOString(),
  });

  const bridge = new DebugBridge({
    url: `ws://127.0.0.1:${port}`,
    encode,
    handshake: { sessionId, origin, adapters: adapterNames },
    onRequest: (request) => {
      switch (request.type) {
        case "get_app_snapshot":
          return snapshot();

        case "get_redux_state": {
          if (!adapters.redux) {
            throw new Error("redux adapter is not registered");
          }
          const state = adapters.redux.store.getState();
          const selected = readPath(state, request.path);
          return applyLimits(selected, limits);
        }

        case "get_storage": {
          if (!adapters.storage) {
            throw new Error("storage adapter is not registered");
          }
          const area = request.area === "local" ? window.localStorage : window.sessionStorage;
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

        case "get_runtime_errors":
          return errorCapture.recent(request.limit);

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
          return networkCapture.recent(request.limit);
        }

        default: {
          const _exhaustive: never = request;
          throw new Error(`unknown request: ${JSON.stringify(_exhaustive)}`);
        }
      }
    },
  });

  bridge.connect();

  activeHandle = {
    sessionId,
    stop() {
      bridge.close();
      errorCapture.stop();
      activeHandle = null;
    },
  };
  return activeHandle;
}

function makeSessionId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
