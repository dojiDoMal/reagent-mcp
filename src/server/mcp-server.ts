/**
 * MCP server. Registers read-only diagnostic tools and relays their calls to
 * the connected browser runtime through the BridgeHost.
 *
 * Note: stdout is the MCP protocol channel. All logging must go to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { decode } from "../core/serialize.js";
import type { BridgeHost } from "./bridge-host.js";
import type { BridgeRequest } from "../core/protocol.js";

/** Run a bridge request and render its result as an MCP text block. */
async function relay(bridge: BridgeHost, request: BridgeRequest) {
  try {
    const response = await bridge.request(request);
    if (!response.ok) {
      return {
        content: [{ type: "text" as const, text: `error: ${response.error}` }],
        isError: true,
      };
    }
    const value = response.result != null ? decode(response.result) : null;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `error: ${message}` }],
      isError: true,
    };
  }
}

export function createMcpServer(bridge: BridgeHost): McpServer {
  const server = new McpServer({
    name: "react-debug-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "get_app_snapshot",
    {
      description:
        "Summary of the running React app: whether it is connected, current origin, session id, and which diagnostic adapters are available. Call this first to confirm the app is inspectable.",
      inputSchema: {},
    },
    async () => relay(bridge, { type: "get_app_snapshot" })
  );

  server.registerTool(
    "get_redux_state",
    {
      description:
        "Read the Redux state of the running app. Prefer a specific slice/path (e.g. 'auth.user') over the whole store. Returns the current live state, not source code.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Dot/bracket path into the state, e.g. 'auth.user' or 'cart.items[0]'. Omit to read the whole store."),
      },
    },
    async ({ path }) => relay(bridge, { type: "get_redux_state", path })
  );

  server.registerTool(
    "get_storage",
    {
      description:
        "Read allowlisted keys from the app's localStorage or sessionStorage. Only keys the project allowlisted are returned.",
      inputSchema: {
        area: z.enum(["local", "session"]).describe("Which storage area to read."),
        keys: z
          .array(z.string())
          .optional()
          .describe("Specific keys to read (still subject to the allowlist). Omit to read all allowlisted keys."),
      },
    },
    async ({ area, keys }) => relay(bridge, { type: "get_storage", area, keys })
  );

  server.registerTool(
    "get_runtime_errors",
    {
      description:
        "Recent runtime errors and unhandled promise rejections captured in the browser during development.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max number of most-recent errors to return."),
      },
    },
    async ({ limit }) => relay(bridge, { type: "get_runtime_errors", limit })
  );

  server.registerTool(
    "get_route",
    {
      description:
        "Current route of the running app (React Router): pathname, search, hash, parsed query and router state. Requires the router adapter.",
      inputSchema: {},
    },
    async () => relay(bridge, { type: "get_route" })
  );

  server.registerTool(
    "get_network_activity",
    {
      description:
        "Recent HTTP requests made via axios: method, URL, status, duration and phase (pending/success/error). Useful to see which request failed. Requires the network adapter.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max number of most-recent requests to return."),
      },
    },
    async ({ limit }) => relay(bridge, { type: "get_network_activity", limit })
  );

  return server;
}
