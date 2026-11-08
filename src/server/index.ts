import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_BRIDGE_PORT } from "../core/protocol.js";
import { BridgeHost } from "./bridge-host.js";
import { createMcpServer } from "./mcp-server.js";

export interface StartOptions {
  /** Loopback port the browser runtime connects to. */
  port?: number;
  /**
   * Interface the WS listener binds to. Defaults to "127.0.0.1" (loopback).
   * Set "0.0.0.0" to also accept connections routed in from a device/emulator
   * (e.g. the Android emulator reaching the host via 10.0.2.2). Only loosen
   * this for a trusted dev environment with fake data.
   */
  host?: string;
  /**
   * Allowed Origin(s) of the host app. A single origin or a list, to cover a
   * browser dev server plus WebView schemes, e.g.
   * ["https://meu.inss", "app://meu.inss"].
   */
  allowedOrigin?: string | string[];
  /**
   * When the port is busy, probe the holder and, if it is a confirmed
   * reagent-mcp bridge, terminate it and take the port over. Defaults to
   * true. Set false (CLI `--no-takeover`) to always fail on a busy port.
   */
  takeover?: boolean;
}

/** Signal a pid and resolve once it is gone, escalating to SIGKILL if needed. */
async function terminatePid(pid: number, timeoutMs = 3000): Promise<boolean> {
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  if (!alive()) return true;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone, or not permitted. Re-check below.
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Still alive after the grace period — escalate.
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore; final check decides the outcome.
  }
  await new Promise((r) => setTimeout(r, 200));
  return !alive();
}

/**
 * Try to reclaim a busy port from a previous reagent-mcp instance.
 * Returns true if the port was freed (safe to retry bind), false if the
 * holder is not ours / could not be reclaimed (caller should surface the
 * original error).
 */
async function tryTakeover(port: number): Promise<boolean> {
  const hello = await BridgeHost.probeExisting(port);
  if (!hello) {
    console.error(
      `[reagent-mcp] port ${port} is held by an unidentified process; ` +
        `not touching it.`
    );
    return false;
  }

  console.error(
    `[reagent-mcp] port ${port} held by a reagent-mcp bridge ` +
      `(pid ${hello.pid}); attempting takeover.`
  );
  const freed = await terminatePid(hello.pid);
  if (!freed) {
    console.error(
      `[reagent-mcp] could not terminate pid ${hello.pid}; giving up takeover.`
    );
    return false;
  }
  console.error(`[reagent-mcp] previous instance (pid ${hello.pid}) stopped.`);
  return true;
}

/**
 * Start the MCP server: open the loopback WS listener for the browser runtime
 * and serve MCP tools over stdio.
 *
 * stdout is the MCP protocol channel — log only to stderr.
 */
export async function start(options: StartOptions = {}): Promise<void> {
  const port = options.port ?? DEFAULT_BRIDGE_PORT;
  const host = options.host ?? "127.0.0.1";
  const takeover = options.takeover ?? true;

  const bridge = new BridgeHost({
    port,
    host,
    allowedOrigin: options.allowedOrigin,
  });
  try {
    await bridge.start();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const message = err instanceof Error ? err.message : String(err);

    // On a busy port, try to reclaim it from a previous instance of ourselves,
    // then retry the bind exactly once. Any other error is fatal as before.
    if (code === "EADDRINUSE" && takeover && (await tryTakeover(port))) {
      try {
        await bridge.start();
      } catch (retryErr) {
        const retryMsg =
          retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error(
          `[reagent-mcp] failed to open bridge after takeover: ${retryMsg}`
        );
        throw retryErr;
      }
    } else {
      console.error(`[reagent-mcp] failed to open bridge: ${message}`);
      throw err;
    }
  }
  console.error(`[reagent-mcp] bridge listening on ws://${host}:${port}`);
  const origins = options.allowedOrigin;
  if (origins && (Array.isArray(origins) ? origins.length > 0 : true)) {
    const list = Array.isArray(origins) ? origins.join(", ") : origins;
    console.error(`[reagent-mcp] allowed origin(s): ${list}`);
  } else {
    console.error(
      `[reagent-mcp] WARNING: no origin allowlist set; accepting any origin`
    );
  }

  const server = createMcpServer(bridge);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[reagent-mcp] MCP server running on stdio");

  const shutdown = () => {
    bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { BridgeHost } from "./bridge-host.js";
export { createMcpServer } from "./mcp-server.js";
export { TOOL_DEFINITIONS, getToolDefinition } from "../core/tools.js";
export type { ToolDefinition, JsonSchema } from "../core/tools.js";
