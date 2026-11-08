/**
 * MCP server. Registers read-only diagnostic tools and relays their calls to
 * the connected browser runtime through the BridgeHost.
 *
 * Tool metadata (name, description, schema, request mapping) comes from the
 * shared registry in ../core/tools.ts, so the MCP surface and any in-page
 * consumer (playground, docs) never drift apart.
 *
 * Note: stdout is the MCP protocol channel. All logging must go to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { decode } from "../core/serialize.js";
import { TOOL_DEFINITIONS } from "../core/tools.js";
import type { BridgeHost } from "./bridge-host.js";

/** Text returned when strict mode is off and risk has not been acknowledged. */
function strictModeWarning(): string {
  return [
    "⚠️ Modo estrito desativado.",
    "",
    "Por questões de segurança recomendamos ativá-lo (strictMode: true). Com o modo estrito desativado, os allowlists são ignorados: o agente tem acesso total ao store do Redux e a todo o localStorage/sessionStorage. Isso pode fazer com que dados sensíveis (tokens, credenciais, dados pessoais) trafeguem até o provedor de LLM.",
    "",
    "Pergunte ao usuário se deseja continuar. Se, e somente se, ele confirmar, chame a ferramenta novamente com acknowledgeRisk: true. Caso contrário, não prossiga.",
  ].join("\n");
}

/**
 * Enforce the non-strict safety gate. Returns a warning result (and skips the
 * bridge call) when the runtime is in non-strict mode and the agent has not
 * acknowledged the risk. Returns null when it is safe to proceed.
 */
function guardNonStrict(
  bridge: BridgeHost,
  acknowledgeRisk: boolean | undefined
) {
  const handshake = bridge.getHandshake();
  // strictMode may be absent from older runtimes; treat missing as strict.
  const strict = handshake?.strictMode ?? true;
  if (!strict && acknowledgeRisk !== true) {
    return {
      content: [{ type: "text" as const, text: strictModeWarning() }],
      // Not an error: this is a confirmation gate, not a failure.
    };
  }
  return null;
}

export function createMcpServer(bridge: BridgeHost): McpServer {
  const server = new McpServer({
    name: "reagent-mcp",
    version: "0.1.0",
  });

  for (const tool of TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
      },
      async (args: Record<string, unknown>) => {
        const gated = guardNonStrict(
          bridge,
          args.acknowledgeRisk as boolean | undefined
        );
        if (gated) return gated;

        try {
          const response = await bridge.request(tool.buildRequest(args));
          if (!response.ok) {
            return {
              content: [
                { type: "text" as const, text: `error: ${response.error}` },
              ],
              isError: true,
            };
          }
          const value = response.result != null ? decode(response.result) : null;
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(value, null, 2) },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `error: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}
