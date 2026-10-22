/**
 * Shared wire protocol between the browser runtime (WS server) and the
 * MCP server (WS client).
 *
 * The runtime is the source of truth: it hosts the WS server and answers
 * requests. The MCP server connects as a client and issues requests on
 * behalf of the agent.
 *
 * Messages are JSON strings. Non-trivial payloads (e.g. serialized Redux
 * state) are already type-preserving-encoded by the runtime (see
 * ./serialize) before being placed into a response.
 */

export const PROTOCOL_VERSION = 1;

/** Default loopback port the runtime listens on. */
export const DEFAULT_BRIDGE_PORT = 7345;

/** Requests: MCP server -> runtime. */
export type BridgeRequest =
  | { type: "get_app_snapshot" }
  | { type: "get_redux_state"; path?: string }
  | { type: "get_storage"; area: "local" | "session"; keys?: string[] }
  | { type: "get_runtime_errors"; limit?: number }
  | { type: "get_route" }
  | { type: "get_network_activity"; limit?: number };

/** Responses: runtime -> MCP server. */
export interface BridgeResponse {
  /** Echoes the request id so the client can match replies. */
  id: string;
  /** True when the request was handled; false carries `error`. */
  ok: boolean;
  /** Type-preserving-encoded payload (see ./serialize). Present when ok. */
  result?: string;
  /** Human-readable error when ok is false. */
  error?: string;
}

/** Envelope wrapping every request on the wire. */
export interface BridgeRequestEnvelope {
  id: string;
  protocolVersion: number;
  request: BridgeRequest;
}

/** Info the runtime advertises on connect, so the server knows capabilities. */
export interface RuntimeHandshake {
  protocolVersion: number;
  sessionId: string;
  /** Origin of the host app, e.g. "http://localhost:5000". */
  origin: string;
  /** Adapters the app registered (redux, storage, router, ...). */
  adapters: string[];
}

/** Summary returned by get_app_snapshot. */
export interface AppSnapshot {
  connected: boolean;
  sessionId: string;
  origin: string;
  adapters: string[];
  /** Current route path when a router adapter is present. */
  route?: string;
  capturedAt: string;
}
