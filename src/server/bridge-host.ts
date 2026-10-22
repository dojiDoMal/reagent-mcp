/**
 * Debug bridge — server side.
 *
 * Hosts the loopback WS listener that the browser runtime connects to.
 * Tracks the currently connected runtime session and relays agent requests
 * to it, matching responses by id.
 *
 * Origin validation: only accepts connections whose Origin matches the
 * configured allowed origin (the host app, e.g. http://localhost:5000),
 * so another local page cannot read the app's state.
 */

import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import {
  PROTOCOL_VERSION,
  type BridgeRequest,
  type BridgeRequestEnvelope,
  type BridgeResponse,
  type RuntimeHandshake,
} from "../core/protocol.js";

interface Session {
  socket: WebSocket;
  handshake: RuntimeHandshake;
}

export interface BridgeHostOptions {
  port: number;
  host?: string;
  /** Allowed Origin of the host app, e.g. "http://localhost:5000". */
  allowedOrigin?: string;
  requestTimeoutMs?: number;
}

export class BridgeHost {
  private wss: WebSocketServer | null = null;
  private session: Session | null = null;
  private readonly pending = new Map<
    string,
    { resolve: (r: BridgeResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly opts: BridgeHostOptions) {}

  start(): void {
    const host = this.opts.host ?? "127.0.0.1";
    this.wss = new WebSocketServer({ port: this.opts.port, host });

    this.wss.on("connection", (socket, req) => {
      if (!this.isOriginAllowed(req)) {
        socket.close(1008, "origin not allowed");
        return;
      }
      socket.on("message", (data) => this.onMessage(socket, String(data)));
      socket.on("close", () => {
        if (this.session?.socket === socket) {
          this.session = null;
        }
      });
    });
  }

  stop(): void {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("bridge host stopped"));
    }
    this.pending.clear();
    this.wss?.close();
    this.wss = null;
    this.session = null;
  }

  /** Whether a runtime (browser tab) is currently connected. */
  isConnected(): boolean {
    return this.session !== null;
  }

  getHandshake(): RuntimeHandshake | null {
    return this.session?.handshake ?? null;
  }

  /** Send a request to the connected runtime and await its response. */
  request(request: BridgeRequest): Promise<BridgeResponse> {
    if (!this.session) {
      return Promise.reject(new Error("application not connected"));
    }
    const id = `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const envelope: BridgeRequestEnvelope = {
      id,
      protocolVersion: PROTOCOL_VERSION,
      request,
    };

    return new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("runtime request timed out"));
      }, this.opts.requestTimeoutMs ?? 5000);

      this.pending.set(id, { resolve, reject, timer });
      this.session!.socket.send(JSON.stringify(envelope));
    });
  }

  private onMessage(socket: WebSocket, data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    // Handshake establishes/updates the active session.
    if (isHandshakeMessage(parsed)) {
      this.session = { socket, handshake: parsed.handshake };
      return;
    }

    // Otherwise it is a response to a pending request.
    if (isBridgeResponse(parsed)) {
      const entry = this.pending.get(parsed.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(parsed.id);
        entry.resolve(parsed);
      }
    }
  }

  private isOriginAllowed(req: IncomingMessage): boolean {
    if (!this.opts.allowedOrigin) return true;
    return req.headers.origin === this.opts.allowedOrigin;
  }
}

function isHandshakeMessage(
  value: unknown
): value is { type: "handshake"; handshake: RuntimeHandshake } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "handshake" &&
    typeof (value as { handshake?: unknown }).handshake === "object"
  );
}

function isBridgeResponse(value: unknown): value is BridgeResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}
