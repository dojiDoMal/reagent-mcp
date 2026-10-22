/**
 * Type-preserving serialization for diagnostic payloads.
 *
 * We never use raw JSON.stringify for app state: it silently drops
 * `undefined`, mangles `Date`, and cannot represent `Map`/`Set` or cyclic
 * references. `jsan` (used by Redux DevTools) encodes these so the agent
 * sees faithful data instead of misleading output.
 *
 * `encode` runs in the browser runtime; `decode` runs in the MCP server.
 */

import jsan from "jsan";

/** Encode a value into a type-preserving JSON string. */
export function encode(value: unknown): string {
  // refs: true -> circular references; date: true -> encode Date/Map/Set/etc.
  // Without date:true, jsan degrades Date to a plain string, which is exactly
  // the information loss we want to avoid.
  return jsan.stringify(value, null, null, { refs: true, date: true });
}

/** Decode a string produced by `encode` back into a JS value. */
export function decode(text: string): unknown {
  return jsan.parse(text);
}
