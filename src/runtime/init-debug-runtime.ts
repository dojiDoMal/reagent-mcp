/**
 * Public browser entry point. Call this from your app, guarded by a
 * development check, e.g.:
 *
 *   if (process.env.NODE_ENV === "development") {
 *     import("reagent-mcp/react").then(({ initDebugRuntime }) => {
 *       initDebugRuntime({ adapters: { redux: { store } } });
 *     });
 *   }
 *
 * The guard is the production-exclusion mechanism: in a CRA/Webpack build
 * the branch is eliminated as dead code, so nothing here ships to prod.
 */

import { DEFAULT_BRIDGE_PORT } from "../core/protocol.js";
import { encode } from "../core/serialize.js";
import { DebugBridge } from "./debug-bridge.js";
import {
  createRequestHandler,
  type RequestHandlerOptions,
} from "./handle-request.js";
import { makeSessionId } from "./session.js";

export interface InitDebugRuntimeOptions extends RequestHandlerOptions {
  /** Loopback port the MCP server listens on. */
  port?: number;
  /**
   * Host the MCP server's WS listener is reachable at, from the runtime's
   * point of view. Defaults to "127.0.0.1" (browser and server on the same
   * machine, the `npm start` case).
   *
   * When the runtime runs inside a WebView on another device (e.g. a Cordova
   * build on the Android emulator), the server is not on loopback relative to
   * the WebView. Point this at the host the device can reach:
   *   - Android emulator: "10.0.2.2" (the emulator's alias for the host)
   *   - Physical device:  the host machine's LAN IP, e.g. "192.168.0.10"
   *
   * Ignored when `url` is given.
   */
  host?: string;
  /**
   * Full WS URL of the MCP server listener, overriding `host`/`port`.
   * Use when neither a plain host nor the default port fit, e.g.
   * "ws://10.0.2.2:7345".
   */
  url?: string;
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

  const port = options.port ?? DEFAULT_BRIDGE_PORT;
  const host = options.host ?? "127.0.0.1";
  const url = options.url ?? `ws://${host}:${port}`;
  const sessionId = options.sessionId ?? makeSessionId();
  const origin = options.origin ?? window.location.origin;

  // One handler instance drives every request, over the WS transport.
  const handler = createRequestHandler({ ...options, sessionId, origin });

  const bridge = new DebugBridge({
    url,
    encode,
    handshake: {
      sessionId,
      origin,
      adapters: handler.adapterNames,
      strictMode: handler.strictMode,
    },
    onRequest: handler.handle,
  });

  bridge.connect();

  activeHandle = {
    sessionId,
    stop() {
      bridge.close();
      activeHandle = null;
    },
  };
  return activeHandle;
}
