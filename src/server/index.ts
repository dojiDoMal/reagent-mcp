import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_BRIDGE_PORT } from "../core/protocol.js";
import { BridgeHost } from "./bridge-host.js";
import { createMcpServer } from "./mcp-server.js";

export interface StartOptions {
  /** Loopback port the browser runtime connects to. */
  port?: number;
  /** Allowed Origin of the host app, e.g. "http://localhost:5000". */
  allowedOrigin?: string;
}

/**
 * Start the MCP server: open the loopback WS listener for the browser runtime
 * and serve MCP tools over stdio.
 *
 * stdout is the MCP protocol channel — log only to stderr.
 */
export async function start(options: StartOptions = {}): Promise<void> {
  const port = options.port ?? DEFAULT_BRIDGE_PORT;

  const bridge = new BridgeHost({
    port,
    allowedOrigin: options.allowedOrigin,
  });
  bridge.start();
  console.error(`[react-debug-mcp] bridge listening on ws://127.0.0.1:${port}`);
  if (options.allowedOrigin) {
    console.error(`[react-debug-mcp] allowed origin: ${options.allowedOrigin}`);
  }

  const server = createMcpServer(bridge);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[react-debug-mcp] MCP server running on stdio");

  const shutdown = () => {
    bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { BridgeHost } from "./bridge-host.js";
export { createMcpServer } from "./mcp-server.js";
