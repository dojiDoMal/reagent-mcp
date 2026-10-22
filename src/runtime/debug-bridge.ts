/**
 * Debug bridge — browser side.
 *
 * A browser page cannot host a listening socket: the WebSocket API is
 * client-only. So the MCP server process hosts the loopback WS listener and
 * the runtime connects to it as a client.
 *
 * The logical roles are unchanged from the design: the runtime is the source
 * of truth and only *answers* requests; the server merely relays the agent's
 * requests. Lifecycle stays keyed to the browser — if no tab is open, no
 * client connects and the server reports "application not connected".
 *
 * On connect, the runtime sends a handshake (origin + sessionId + adapters)
 * so the server can track the session and surface it via get_app_snapshot.
 */

import {
  PROTOCOL_VERSION,
  type BridgeRequest,
  type BridgeRequestEnvelope,
  type BridgeResponse,
  type RuntimeHandshake,
} from "../core/protocol.js";

export type RequestHandler = (request: BridgeRequest) => Promise<unknown> | unknown;

export interface DebugBridgeOptions {
  url: string;
  handshake: Omit<RuntimeHandshake, "protocolVersion">;
  onRequest: RequestHandler;
  /** Encode a result value into a type-preserving string. */
  encode: (value: unknown) => string;
  reconnectDelayMs?: number;
}

export class DebugBridge {
  private socket: WebSocket | null = null;
  private closed = false;

  constructor(private readonly opts: DebugBridgeOptions) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  private open(): void {
    const socket = new WebSocket(this.opts.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      const handshake: RuntimeHandshake = {
        protocolVersion: PROTOCOL_VERSION,
        ...this.opts.handshake,
      };
      socket.send(JSON.stringify({ type: "handshake", handshake }));
    });

    socket.addEventListener("message", (event) => {
      void this.handleMessage(String(event.data));
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      if (!this.closed) {
        setTimeout(() => this.open(), this.opts.reconnectDelayMs ?? 1500);
      }
    });

    // Swallow errors; the close handler drives reconnection.
    socket.addEventListener("error", () => {});
  }

  private async handleMessage(data: string): Promise<void> {
    let envelope: BridgeRequestEnvelope;
    try {
      envelope = JSON.parse(data) as BridgeRequestEnvelope;
    } catch {
      return;
    }
    if (!envelope || typeof envelope.id !== "string" || !envelope.request) {
      return;
    }

    const response: BridgeResponse = { id: envelope.id, ok: false };
    try {
      if (envelope.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(
          `protocol mismatch: runtime ${PROTOCOL_VERSION}, server ${envelope.protocolVersion}`
        );
      }
      const result = await this.opts.onRequest(envelope.request);
      response.ok = true;
      response.result = this.opts.encode(result);
    } catch (err) {
      response.error = err instanceof Error ? err.message : String(err);
    }

    this.socket?.send(JSON.stringify(response));
  }
}
