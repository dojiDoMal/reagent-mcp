/**
 * Canonical tool registry — the single source of truth for the read-only
 * diagnostic tools.
 *
 * Both the MCP server (validation via zod) and any in-page consumer (the
 * playground, Storybook docs) read from here, so a tool's name, description,
 * parameters and request shape are defined exactly once. The JSON Schema
 * (`parameters`) is written by hand next to the zod schema and is kept
 * deliberately simple: it is what LLM tool-calling APIs and docs consume.
 */

import { z } from "zod";
import type { BridgeRequest } from "./protocol.js";

/** Shared zod field: the agent sets this true to proceed in non-strict mode. */
export const acknowledgeRiskField = z
  .boolean()
  .optional()
  .describe(
    "Set true ONLY after the user has confirmed they accept the risk of running with strict mode disabled. Leave unset otherwise."
  );

/** A JSON Schema fragment subset used for parameters. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** One documented tool. */
export interface ToolDefinition {
  /** Registered name of the MCP tool. */
  name: string;
  /** Human/LLM-facing description. */
  description: string;
  /** zod shape used by the MCP server to validate arguments. */
  schema: z.ZodRawShape;
  /** JSON Schema passed to LLM tool-calling APIs and rendered in the docs. */
  parameters: JsonSchema;
  /** Map validated arguments to the wire request the runtime handles. */
  buildRequest: (args: Record<string, unknown>) => BridgeRequest;
  /** Reproducible example for the interactive docs. */
  example?: {
    /** Sample arguments the user can run. */
    args: Record<string, unknown>;
    /** What the reader should expect to see. */
    expected: string;
  };
}

const acknowledgeRiskProperty = {
  acknowledgeRisk: {
    type: "boolean",
    description:
      "Set true ONLY after the user has confirmed they accept the risk of running with strict mode disabled. Leave unset otherwise.",
  },
} as const;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_app_snapshot",
    description:
      "Summary of the running React app: whether it is connected, current origin, session id, and which diagnostic adapters are available. Call this first to confirm the app is inspectable.",
    schema: { acknowledgeRisk: acknowledgeRiskField },
    parameters: {
      type: "object",
      properties: { ...acknowledgeRiskProperty },
      additionalProperties: false,
    },
    buildRequest: () => ({ type: "get_app_snapshot" }),
    example: {
      args: {},
      expected:
        "connected: true, origin of the demo app, the session id and the adapters list (redux, storage, router, network).",
    },
  },
  {
    name: "get_redux_state",
    description:
      "Read the Redux state of the running app. Prefer a specific slice/path (e.g. 'auth.user') over the whole store. Returns the current live state, not source code. In strict mode only the project-allowlisted branches are returned.",
    schema: {
      path: z
        .string()
        .optional()
        .describe(
          "Dot/bracket path into the state, e.g. 'auth.user' or 'cart.items[0]'. Omit to read the whole store."
        ),
      acknowledgeRisk: acknowledgeRiskField,
    },
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Dot/bracket path into the state, e.g. 'auth.user' or 'cart.items[0]'. Omit to read the whole store.",
        },
        ...acknowledgeRiskProperty,
      },
      additionalProperties: false,
    },
    buildRequest: (args) => ({
      type: "get_redux_state",
      path: typeof args.path === "string" ? args.path : undefined,
    }),
    example: {
      args: { path: "cart.items" },
      expected: "The live array of cart items as held in the Redux store.",
    },
  },
  {
    name: "get_storage",
    description:
      "Read allowlisted keys from the app's localStorage or sessionStorage. Only keys the project allowlisted are returned.",
    schema: {
      area: z.enum(["local", "session"]).describe("Which storage area to read."),
      keys: z
        .array(z.string())
        .optional()
        .describe(
          "Specific keys to read (still subject to the allowlist in strict mode). Omit to read all allowlisted keys."
        ),
      acknowledgeRisk: acknowledgeRiskField,
    },
    parameters: {
      type: "object",
      properties: {
        area: {
          type: "string",
          enum: ["local", "session"],
          description: "Which storage area to read.",
        },
        keys: {
          type: "array",
          items: { type: "string" },
          description:
            "Specific keys to read (still subject to the allowlist in strict mode). Omit to read all allowlisted keys.",
        },
        ...acknowledgeRiskProperty,
      },
      required: ["area"],
      additionalProperties: false,
    },
    buildRequest: (args) => ({
      type: "get_storage",
      area: args.area === "session" ? "session" : "local",
      keys: Array.isArray(args.keys)
        ? (args.keys as unknown[]).filter((k): k is string => typeof k === "string")
        : undefined,
    }),
    example: {
      args: { area: "local", keys: ["cart_snapshot"] },
      expected:
        "The raw value stored under cart_snapshot in localStorage (JSON string).",
    },
  },
  {
    name: "get_route",
    description:
      "Current route of the running app (React Router): pathname, search, hash, parsed query and router state. Requires the router adapter.",
    schema: { acknowledgeRisk: acknowledgeRiskField },
    parameters: {
      type: "object",
      properties: { ...acknowledgeRiskProperty },
      additionalProperties: false,
    },
    buildRequest: () => ({ type: "get_route" }),
    example: {
      args: {},
      expected: "pathname, search, hash and the parsed query object.",
    },
  },
  {
    name: "get_network_activity",
    description:
      "Recent HTTP requests made via axios: method, URL, status, duration and phase (pending/success/error). With the 'detailed' capture profile (or body overrides) enabled in the network adapter, also includes request/response bodies and headers. Useful to see which request failed and what it returned. Requires the network adapter.",
    schema: {
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max number of most-recent requests to return."),
      acknowledgeRisk: acknowledgeRiskField,
    },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of most-recent requests to return.",
        },
        ...acknowledgeRiskProperty,
      },
      additionalProperties: false,
    },
    buildRequest: (args) => ({
      type: "get_network_activity",
      limit: typeof args.limit === "number" ? args.limit : undefined,
    }),
    example: {
      args: { limit: 5 },
      expected:
        "The 5 most recent captured requests with method, URL, status and phase.",
    },
  },
];

/** Look up a tool definition by name. */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}
