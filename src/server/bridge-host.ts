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

import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import {
  PROTOCOL_VERSION,
  SERVER_HELLO_NAME,
  type BridgeRequest,
  type BridgeRequestEnvelope,
  type BridgeResponse,
  type RuntimeHandshake,
  type ServerHello,
} from "../core/protocol.js";

interface Session {
  socket: WebSocket;
  handshake: RuntimeHandshake;
}

export interface BridgeHostOptions {
  port: number;
  host?: string;
  /**
   * Allowed Origin(s) of the host app. A single origin
   * ("http://localhost:5000") or a list, to cover a browser dev server and
   * one or more WebView schemes at once, e.g.
   * ["http://localhost:5000", "https://meu.inss", "app://meu.inss"].
   *
   * When omitted, every origin is accepted (no origin check).
   */
  allowedOrigin?: string | string[];
  requestTimeoutMs?: number;
}

export class BridgeHost {
  private wss: WebSocketServer | null = null;
  private session: Session | null = null;
  private readonly pending = new Map<
    string,
    { resolve: (r: BridgeResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  /** Normalized allowed origins; empty means "accept any origin". */
  private readonly allowedOrigins: Set<string>;

  constructor(private readonly opts: BridgeHostOptions) {
    const origins = opts.allowedOrigin;
    const list = origins == null ? [] : Array.isArray(origins) ? origins : [origins];
    this.allowedOrigins = new Set(list.filter((o) => o.length > 0));
  }

  start(): Promise<void> {
    const host = this.opts.host ?? "127.0.0.1";
    const wss = new WebSocketServer({ port: this.opts.port, host });
    this.wss = wss;

    // Resolve once the listener is actually bound; reject if the bind fails
    // (e.g. EADDRINUSE when a previous instance is still holding the port).
    // Without this handler, ws emits an unhandled 'error' event and crashes
    // the whole process *after* start() has already returned.
    const listening = new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        wss.off("listening", onListening);
        if (err.code === "EADDRINUSE") {
          const inUse: NodeJS.ErrnoException = new Error(
            `port ${this.opts.port} is already in use on ${host}. ` +
              `Another reagent-mcp instance may still be running. ` +
              `Stop it, or start this one with --port <n> (and set the same port in the runtime).`
          );
          inUse.code = "EADDRINUSE";
          reject(inUse);
        } else {
          reject(err);
        }
      };
      const onListening = () => {
        wss.off("error", onError);
        // Now that we're bound, keep a permanent error handler so a late
        // server error doesn't crash the process as an unhandled event.
        wss.on("error", (err) => {
          console.error("[reagent-mcp] bridge error:", err);
        });
        resolve();
      };
      wss.once("error", onError);
      wss.once("listening", onListening);
    });

    this.wss.on("connection", (socket, req) => {
      // Advertise identity to every client before any further checks. This is
      // how a competing instance confirms the port is held by a real
      // reagent-mcp bridge (and learns our pid) so it can take over
      // safely. It exposes no app state, so it is safe to send pre-origin.
      const hello: ServerHello = {
        type: "server-hello",
        name: SERVER_HELLO_NAME,
        protocolVersion: PROTOCOL_VERSION,
        pid: process.pid,
      };
      socket.send(JSON.stringify(hello));

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

    return listening;
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
    if (this.allowedOrigins.size === 0) return true;
    const origin = req.headers.origin;
    return typeof origin === "string" && this.allowedOrigins.has(origin);
  }

  /**
   * Connect to whatever is already listening on `port` and read its
   * server-hello to decide whether it is a reagent-mcp bridge we may
   * safely take over.
   *
   * Resolves with the parsed ServerHello when the peer identifies itself as a
   * compatible reagent-mcp bridge, or null in every other case (not a WS
   * server, no hello, wrong name, incompatible protocol, or timeout). It never
   * rejects: an unidentifiable peer is simply "not ours", which the caller
   * treats as "do not touch it".
   */
  static probeExisting(
    port: number,
    host = "127.0.0.1",
    timeoutMs = 1500
  ): Promise<ServerHello | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: ServerHello | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // ignore close errors; we are discarding this probe socket anyway.
        }
        resolve(value);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);

      const ws = new WebSocket(`ws://${host}:${port}`);

      ws.on("message", (data) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(data));
        } catch {
          finish(null);
          return;
        }
        finish(parseServerHello(parsed));
      });
      ws.on("error", () => finish(null));
      ws.on("close", () => finish(null));
    });
  }
}

/** Validate an unknown value as a compatible ServerHello, else return null. */
function parseServerHello(value: unknown): ServerHello | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.type !== "server-hello") return null;
  if (v.name !== SERVER_HELLO_NAME) return null;
  if (v.protocolVersion !== PROTOCOL_VERSION) return null;
  if (typeof v.pid !== "number" || !Number.isInteger(v.pid) || v.pid <= 0) {
    return null;
  }
  return {
    type: "server-hello",
    name: v.name,
    protocolVersion: v.protocolVersion,
    pid: v.pid,
  };
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
