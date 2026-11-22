/**
 * Deterministic, offline LLM substitute for `satus generate --dry-run`.
 *
 * The runner is provider-agnostic: it calls `provider.generate()` per batch
 * and trusts the rows. We exploit that by injecting a "simulated" provider
 * in dry-run mode. The simulator walks the JSON schema the runner already
 * built (see schema.ts) and emits values that conform to it, then the
 * runner injects FKs and the validator (see validate.ts) checks the
 * combined rows against the live Postgres metadata.
 *
 * Why determinism: two dry-runs against the same schema produce identical
 * findings. That makes the dry-run safe to wire into CI as a smoke gate
 * without flaky pass/fail.
 *
 * The simulator deliberately emits non-null whenever the schema allows
 * either, so NOT NULL violations the validator surfaces are real bugs in
 * the generation plan, not artifacts of randomized nulls.
 */
import type { Provider, ProviderRequest, ProviderResponse } from "./providers/types.js";
import type { Table } from "./introspect.js";
import { TYPE_PATTERNS } from "./schema.js";

interface JsonSchemaNode {
  type?: string | string[];
  format?: string;
  pattern?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  minItems?: number;
  maxItems?: number;
  required?: string[];
  enum?: string[];
}

export function createSimulatedProvider(): Provider {
  return {
    id: "simulated",
    model: "simulated/dry-run",
    // The simulator never calls an upstream API, so it costs nothing and
    // reports zero usage. The dry-run *estimate* is priced separately, off
    // the real provider the user selected (see planRun in runner.ts).
    rates: { inputPerMTok: 0, outputPerMTok: 0 },
    async generate<T>(req: ProviderRequest): Promise<ProviderResponse<T>> {
      const root = req.jsonSchema.schema as unknown as JsonSchemaNode;
      const rowsNode = (root.properties?.rows ?? {}) as JsonSchemaNode;
      const count = rowsNode.minItems ?? rowsNode.maxItems ?? 1;
      const itemSchema = (rowsNode.items ?? {}) as JsonSchemaNode;
      const tableTag = req.jsonSchema.name.replace(/_rows$/, "");
      const rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < count; i++) {
        rows.push(synthRow(itemSchema, i, tableTag));
      }
      return {
        data: { rows } as unknown as T,
        usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
      };
    },
  };
}

function synthRow(item: JsonSchemaNode, i: number, tableTag: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = item.properties ?? {};
  for (const [name, node] of Object.entries(props)) {
    out[name] = synthValue(name, node, i, tableTag);
  }
  return out;
}

function synthValue(name: string, node: JsonSchemaNode, i: number, tableTag: string): unknown {
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : ["string"];
  // Pick the first concrete (non-null) type. Always emit non-null so the
  // validator's NOT NULL findings reflect real planning bugs, not coin flips.
  const primary = types.find((t) => t !== "null") ?? "string";

  switch (primary) {
    case "boolean":
      return i % 2 === 0;
    case "integer": {
      const min = typeof node.minimum === "number" ? node.minimum : 1;
      const max = typeof node.maximum === "number" ? node.maximum : min + 1_000_000;
      const v = min < 0 ? i + 1 : min + i;
      return clamp(v, min, max);
    }
    case "number": {
      const base = typeof node.minimum === "number" ? node.minimum : 0;
      return Number((base + i + 0.5).toFixed(2));
    }
    case "object":
      return {};
    case "array": {
      const item = node.items ?? { type: "string" };
      // One to three elements, deterministic on the row index, so a dry
      // run is stable and the value is a real array rather than "col_1".
      const n = (i % 3) + 1;
      const out: unknown[] = [];
      for (let j = 0; j < n; j++) {
        out.push(synthValue(name, item, i * 10 + j, tableTag));
      }
      return out;
    }
    case "string":
    default:
      return synthString(name, node, i, tableTag);
  }
}

function synthString(name: string, node: JsonSchemaNode, i: number, tableTag: string): string {
  if (node.enum && node.enum.length > 0) {
    return node.enum[i % node.enum.length]!;
  }
  if (
    node.pattern === TYPE_PATTERNS.uuid ||
    (node.pattern && /\[0-9a-fA-F\]\{8\}-/.test(node.pattern))
  ) {
    return deterministicUuid(i);
  }
  if (node.pattern === TYPE_PATTERNS.inet) return `192.0.2.${(i % 254) + 1}`;
  if (node.pattern === TYPE_PATTERNS.cidr) {
    // cidr rejects host bits to the right of the mask, so these are network addresses.
    const nets = ["192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"];
    return nets[i % nets.length]!;
  }
  if (node.pattern === TYPE_PATTERNS.bytea) {
    const hex = ((i + 1) % 256).toString(16).padStart(2, "0");
    return `\\x${hex}`;
  }
  if (node.pattern === TYPE_PATTERNS.interval) {
    const n = (i % 60) + 1;
    return n === 1 ? "1 second" : `${n} seconds`;
  }
  if (node.pattern === TYPE_PATTERNS.time) {
    return clockTime(i);
  }
  if (node.pattern === TYPE_PATTERNS.timetz) {
    return `${clockTime(i)}+00`;
  }
  if (node.format === "date") return shiftedDate(i).slice(0, 10);
  if (node.format === "date-time") return shiftedDate(i);

  const n = name.toLowerCase();
  let v: string;
  if (n === "email" || n.endsWith("_email")) v = `user${i + 1}@example.test`;
  else if (n === "url" || n.endsWith("_url")) v = `https://example.test/${tableTag}/${i + 1}`;
  else if (n === "phone" || n.endsWith("_phone"))
    v = `+1-415-555-${String(1000 + (i % 9000)).slice(-4)}`;
  else v = `${name}_${i + 1}`;

  return capLen(v, node.maxLength);
}

function capLen(s: string, max?: number): string {
  if (typeof max === "number" && s.length > max) return s.slice(0, max);
  return s;
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function clockTime(i: number): string {
  const hh = String(i % 24).padStart(2, "0");
  const mm = String((i * 7) % 60).padStart(2, "0");
  const ss = String((i * 13) % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function shiftedDate(i: number): string {
  // Stable anchor so two dry-runs produce identical timestamps.
  const ms = Date.UTC(2026, 0, 1) - i * 86_400_000;
  return new Date(ms).toISOString();
}

function deterministicUuid(i: number): string {
  const hex = (i + 1).toString(16).padStart(12, "0");
  // v4 UUID shape with deterministic suffix; the version/variant bits stay
  // valid so the value survives strict UUID parsers.
  return `00000000-0000-4000-8000-${hex}`;
}

/**
 * Fabricate the rows the writer would normally RETURN. Called by the
 * runner in dry-run mode so downstream tables can pull FK targets from
 * `pkPool` without touching the database.
 *
 * Two kinds of column land in the pool:
 *
 *   - Primary keys, which the database would have generated. Synthesized
 *     here via deterministicUuid()/integer-counter so the same parent rows
 *     appear in every dry-run.
 *   - Any column another table's FK references. When the simulator already
 *     produced a value for it (the common case for a UNIQUE text column
 *     like `users.email`) the real value is carried through rather than
 *     re-invented, so the validator compares against what a real run would
 *     actually have written. Columns filled by a DB default fall back to
 *     the same deterministic synthesis as PKs.
 *
 * Without the second kind, a FK targeting a non-PK column found nothing in
 * the pool and the run either NULLed the child silently (pre-v0.3.7) or
 * now aborts.
 */
export function synthesizePkRows(
  table: Table,
  generatedRows: Array<Record<string, unknown>>,
  referencedColumns: string[] = [],
): Array<Record<string, unknown>> {
  const poolColumns = [...new Set([...table.primaryKey, ...referencedColumns])];
  if (poolColumns.length === 0 || generatedRows.length === 0) return [];
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < generatedRows.length; i++) {
    const row: Record<string, unknown> = {};
    for (const name of poolColumns) {
      const produced = generatedRows[i]?.[name];
      if (produced !== undefined) {
        row[name] = produced;
        continue;
      }
      const col = table.columns.find((c) => c.name === name);
      const udt = col?.udtName.toLowerCase() ?? "int4";
      row[name] = udt === "uuid" ? deterministicUuid(i) : i + 1;
    }
    rows.push(row);
  }
  return rows;
}
