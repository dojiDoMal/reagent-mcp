#!/usr/bin/env node
/**
 * CLI entry: `react-debug-mcp start`.
 *
 * Intended to be launched by Kiro's MCP config. Prefer the locally installed
 * binary over a remote/unpinned resolution.
 *
 * Usage:
 *   react-debug-mcp start [--port <n>] [--allowed-origin <origin>]
 */

import { start } from "./index.js";
import { DEFAULT_BRIDGE_PORT } from "../core/protocol.js";

function parseArgs(argv: string[]): {
  command: string | undefined;
  port: number;
  allowedOrigin: string | undefined;
} {
  const args = argv.slice(2);
  const command = args[0];
  let port = DEFAULT_BRIDGE_PORT;
  let allowedOrigin: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        console.error(`[react-debug-mcp] invalid --port value`);
        process.exit(1);
      }
      port = value;
    } else if (arg === "--allowed-origin") {
      allowedOrigin = args[++i];
    } else {
      console.error(`[react-debug-mcp] unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return { command, port, allowedOrigin };
}

const { command, port, allowedOrigin } = parseArgs(process.argv);

if (command !== "start") {
  console.error("Usage: react-debug-mcp start [--port <n>] [--allowed-origin <origin>]");
  process.exit(command ? 1 : 0);
}

void start({ port, allowedOrigin }).catch((err) => {
  console.error("[react-debug-mcp] failed to start:", err);
  process.exit(1);
});
