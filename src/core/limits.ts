/**
 * Response limits. These keep payloads small and relevant so the agent's
 * context is not polluted, and guard against accidentally walking a huge
 * or cyclic object graph.
 */

export interface Limits {
  /** Maximum object depth to walk before replacing with a marker. */
  maxDepth: number;
  /** Maximum number of entries per object/array before truncation. */
  maxEntries: number;
  /** Maximum serialized string length (characters) for a single response. */
  maxStringLength: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxDepth: 8,
  maxEntries: 200,
  maxStringLength: 100_000,
};

/** Placeholder inserted when a limit is hit. */
export const TRUNCATED = "[truncated: limit reached]";

/**
 * Walk a value applying depth/entry limits, returning a plain structure
 * safe to hand to the type-preserving serializer. Cyclic references are
 * replaced with a marker.
 */
export function applyLimits(value: unknown, limits: Limits = DEFAULT_LIMITS): unknown {
  const seen = new WeakSet<object>();

  function walk(val: unknown, depth: number): unknown {
    if (val === null || typeof val !== "object") {
      return val;
    }
    if (depth >= limits.maxDepth) {
      return TRUNCATED;
    }
    if (seen.has(val as object)) {
      return "[circular]";
    }
    seen.add(val as object);

    if (Array.isArray(val)) {
      const out = val.slice(0, limits.maxEntries).map((item) => walk(item, depth + 1));
      if (val.length > limits.maxEntries) {
        out.push(TRUNCATED);
      }
      return out;
    }

    // Preserve well-known structured types for the serializer to encode.
    if (val instanceof Date || val instanceof Map || val instanceof Set) {
      return val;
    }

    const entries = Object.entries(val as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries.slice(0, limits.maxEntries)) {
      out[k] = walk(v, depth + 1);
    }
    if (entries.length > limits.maxEntries) {
      out.__truncated__ = TRUNCATED;
    }
    return out;
  }

  return walk(value, 0);
}
