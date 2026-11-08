/**
 * In-page bridge (browser side).
 *
 * A drop-in alternative to the WS transport for cases where the caller and the
 * app under inspection live in the same page — an embedded playground, a demo,
 * or tests. It exposes the same `request()`/`isConnected()`/`getHandshake()`
 * surface as `BridgeHost`, so consumer code (and an MCP client layer) is
 * identical whether the runtime is reached over the loopback socket or
 * in-process.
 *
 * It reuses the exact same request handler as the WS runtime (see
 * ./handle-request), so results are the real tool output — nothing is
 * simulated.
 */

import {
  PROTOCOL_VERSION,
  type BridgeRequest,
  type BridgeResponse,
  type RuntimeHandshake,
} from "../core/protocol.js";
import { encode } from "../core/serialize.js";
import {
  createRequestHandler,
  type RequestHandlerOptions,
} from "./handle-request.js";
import { makeSessionId } from "./session.js";

/** Handler signature shared with the WS runtime. */
export type LocalRequestHandler = (request: BridgeRequest) => Promise<unknown> | unknown;

export class LocalBridge {
  constructor(
    private readonly handler: LocalRequestHandler,
    private readonly handshake: RuntimeHandshake
  ) {}

  /** Always connected: the runtime lives in this page. */
  isConnected(): boolean {
    return true;
  }

  getHandshake(): RuntimeHandshake {
    return this.handshake;
  }

  /** Execute a request against live app state and return a bridge response. */
  async request(request: BridgeRequest): Promise<BridgeResponse> {
    const id = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const result = await this.handler(request);
      return { id, ok: true, result: encode(result) };
    } catch (err) {
      return {
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export interface InitLocalRuntimeOptions extends RequestHandlerOptions {
  /** Override the generated session id. */
  sessionId?: string;
  /** Override the origin advertised in snapshots. */
  origin?: string;
}

export interface LocalRuntime {
  /** In-page bridge exposing the real diagnostic tools. */
  bridge: LocalBridge;
  sessionId: string;
}

/**
 * Wire up the diagnostic runtime entirely in-process (no WebSocket). Returns
 * the bridge plus the session id. Call `bridge.request(...)` to run tools.
 */
export function initLocalRuntime(
  options: InitLocalRuntimeOptions = {}
): LocalRuntime {
  const sessionId = options.sessionId ?? makeSessionId();
  const origin =
    options.origin ??
    (typeof window !== "undefined" ? window.location.origin : "");

  const handler = createRequestHandler({ ...options, sessionId, origin });

  const bridge = new LocalBridge(handler.handle, {
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    origin,
    adapters: handler.adapterNames,
    strictMode: handler.strictMode,
  });

  return { bridge, sessionId };
}
