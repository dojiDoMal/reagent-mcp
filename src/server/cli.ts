#!/usr/bin/env node
/**
 * CLI entry: `reagent-mcp start`.
 *
 * Intended to be launched by Kiro's MCP config. Prefer the locally installed
 * binary over a remote/unpinned resolution.
 *
 * Usage:
 *   reagent-mcp start [--port <n>] [--host <h>]
 *                         [--allowed-origin <origin>]... [--no-takeover]
 *
 * --host defaults to 127.0.0.1 (loopback). Use 0.0.0.0 to also accept
 * connections routed in from an emulator/device (e.g. Android emulator via
 * 10.0.2.2). --allowed-origin may be repeated to allow several origins, e.g.
 * a browser dev server plus the WebView schemes (https://meu.inss, app://meu.inss).
 *
 * By default, if the port is busy and held by a confirmed reagent-mcp
 * bridge, this instance terminates that one and takes over. Pass --no-takeover
 * to always fail on a busy port instead.
 */

import { start } from "./index.js";
import { DEFAULT_BRIDGE_PORT } from "../core/protocol.js";

function parseArgs(argv: string[]): {
  command: string | undefined;
  port: number;
  host: string | undefined;
  allowedOrigin: string[];
  takeover: boolean;
} {
  const args = argv.slice(2);
  const command = args[0];
  let port = DEFAULT_BRIDGE_PORT;
  let host: string | undefined;
  const allowedOrigin: string[] = [];
  let takeover = true;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        console.error(`[reagent-mcp] invalid --port value`);
        process.exit(1);
      }
      port = value;
    } else if (arg === "--host") {
      host = args[++i];
    } else if (arg === "--allowed-origin") {
      allowedOrigin.push(args[++i]);
    } else if (arg === "--no-takeover") {
      takeover = false;
    } else {
      console.error(`[reagent-mcp] unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return { command, port, host, allowedOrigin, takeover };
}

const { command, port, host, allowedOrigin, takeover } = parseArgs(process.argv);

if (command !== "start") {
  console.error(
    "Usage: reagent-mcp start [--port <n>] [--host <h>] " +
      "[--allowed-origin <origin>]... [--no-takeover]"
  );
  process.exit(command ? 1 : 0);
}

void start({ port, host, allowedOrigin, takeover }).catch((err) => {
  console.error("[reagent-mcp] failed to start:", err);
  process.exit(1);
});
