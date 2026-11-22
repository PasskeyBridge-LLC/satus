/**
 * Build a JSON Schema for one table that the LLM will fill via OpenAI
 * structured outputs. We deliberately:
 *
 *   - Skip columns the database fills itself (defaults, identity, generated).
 *     Those land via DEFAULT in the INSERT, which means we don't have to
 *     fight the model about sequences, gen_random_uuid(), now(), etc.
 *   - Skip FK columns entirely. We inject FK values directly from the
 *     already-inserted parent rows after the model returns — letting the
 *     model invent UUIDs would defeat referential integrity.
 *   - Translate each kept column to the narrowest JSON type we can prove
 *     from the catalog. Array udt_names (`_int4`, `_text`, …) become arrays
 *     of the element type. Enums are strings (with labels when introspected).
 *     Domains keep the base type reported by information_schema, and any
 *     domain CHECK text is attached as a description for the planner.
 *     An unmapped type throws rather than being planned as a string.
 *
 * Strict mode forces every property to be required and disallows extras,
 * which OpenAI enforces server-side. Nullability is expressed via type
 * unions (["string","null"]) rather than nullable: true because the
 * latter is not part of the JSON Schema dialect OpenAI accepts.
 */
import type { Column, ForeignKey, Table } from "./introspect.js";

export interface RowSchema {
  jsonSchema: { name: string; schema: Record<string, unknown> };
  /** Columns the model is asked to produce, in property order. */
  modelColumns: Column[];
  /** FK columns we inject after the model returns. */
  fkColumns: ForeignKey[];
  /** All columns that will be present in the INSERT (modelColumns + fkColumns). */
  insertColumns: string[];
}

export interface JsonType {
  type: string | string[];
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  items?: JsonType;
  enum?: string[];
  description?: string;
}

/**
 * Thrown when a column the model or simulator would have to fill has a
 * Postgres type we cannot plan. The message names every offending
 * table.column and its udt_name.
 */
export class UnsupportedTypeError extends Error {
  readonly unsupported: Array<{ table: string; column: string; udtName: string }>;

  constructor(unsupported: Array<{ table: string; column: string; udtName: string }>) {
    const lines = unsupported.map((u) => `  ${u.table}.${u.column} (${u.udtName})`);
    const heading =
      unsupported.length === 1
        ? `Unsupported Postgres type "${unsupported[0]!.udtName}" on ${unsupported[0]!.table}.${unsupported[0]!.column}.`
        : `Unsupported Postgres types:\n${lines.join("\n")}`;
    super(heading);
    this.name = "UnsupportedTypeError";
    this.unsupported = unsupported;
  }
}

/** typcategory 'A' is an array. The `_int4` name is the fallback when catalog flags are absent (unit tests). */
export function isArrayColumn(col: Column): boolean {
  if (col.typeCategory === "A") return true;
  if (col.typeCategory && col.typeCategory !== "A") return false;
  if (col.elementUdtName) return true;
  const udt = col.udtName.toLowerCase();
  return udt.startsWith("_") && udt.length > 1;
}

/** Element typname for an array column, with one domain unwrap when introspect supplied it. */
export function elementUdtName(col: Column): string {
  if (col.elementUdtName) return col.elementUdtName.toLowerCase();
  const udt = col.udtName.toLowerCase();
  return udt.startsWith("_") ? udt.slice(1) : udt;
}

function scalarJsonType(udt: string, col: Column): JsonType | null {
  const t = udt.toLowerCase();
  switch (t) {
    case "bool":
      return { type: "boolean" };
    case "int2":
      return { type: "integer", minimum: -32768, maximum: 32767 };
    case "int4":
      return { type: "integer", minimum: -2147483648, maximum: 2147483647 };
    case "int8":
      // JSON cannot safely represent 64-bit ints; cap at 53-bit safe range.
      return { type: "integer", minimum: -9007199254740991, maximum: 9007199254740991 };
    case "numeric":
    case "float4":
    case "float8":
      return { type: "number" };
    case "uuid":
      return {
        type: "string",
        pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
      };
    case "date":
      return { type: "string", format: "date" };
    case "timestamp":
    case "timestamptz":
      return { type: "string", format: "date-time" };
    case "json":
    case "jsonb":
      // Allow any JSON object. We keep it permissive because the column
      // semantics are user-defined.
      return { type: "object" };
    case "text":
    case "varchar":
    case "bpchar":
    case "citext":
      return { type: "string" };
    default:
      if (col.isEnum || (col.enumLabels && col.enumLabels.length > 0)) {
        const node: JsonType = { type: "string" };
        if (col.enumLabels && col.enumLabels.length > 0) node.enum = col.enumLabels;
        return node;
      }
      return null;
  }
}

/**
 * Map one column to a JSON Schema node, or null when the type is unmapped.
 * Array udt_names reuse the scalar map for the element type.
 */
export function jsonTypeFor(col: Column): JsonType | null {
  if (isArrayColumn(col)) {
    const inner = scalarJsonType(elementUdtName(col), col);
    if (!inner) return null;
    return { type: "array", items: inner };
  }
  return scalarJsonType(col.udtName, col);
}

function modelColumnsOf(table: Table): Column[] {
  const fkColumnSet = new Set(table.foreignKeys.map((fk) => fk.column));
  return table.columns.filter((c) => {
    if (c.isGenerated) return false;
    if (c.isIdentity) return false;
    if (fkColumnSet.has(c.name)) return false;
    if (c.hasDefault) return false;
    return true;
  });
}

/** Collect every model column whose type we cannot plan, across the run set. */
export function unsupportedModelColumns(
  tables: Table[],
): Array<{ table: string; column: string; udtName: string }> {
  const found: Array<{ table: string; column: string; udtName: string }> = [];
  for (const table of tables) {
    for (const col of modelColumnsOf(table)) {
      if (jsonTypeFor(col) === null) {
        found.push({ table: table.name, column: col.name, udtName: col.udtName });
      }
    }
  }
  return found;
}

export function assertSupportedTypes(tables: Table[]): void {
  const found = unsupportedModelColumns(tables);
  if (found.length > 0) throw new UnsupportedTypeError(found);
}

function colDescription(col: Column): string | undefined {
  // Light semantic nudges based on column name. Cheap and often decisive
  // for the model — naming "email" vs "address" vs "phone" routes it to
  // the right generator instinct.
  const n = col.name.toLowerCase();
  if (n === "email" || n.endsWith("_email")) return "A realistic email address.";
  if (n === "phone" || n.endsWith("_phone"))
    return "A phone number with country code, e.g. +1-415-555-0142.";
  if (n === "url" || n.endsWith("_url")) return "A plausible https URL.";
  if (n === "name" || n.endsWith("_name"))
    return "A realistic human or product name suited to the profile.";
  if (n.includes("price") || n.includes("amount") || n.includes("cost"))
    return "A plausible price in the column units.";
  if (n.includes("description") || n.includes("bio") || n.includes("note"))
    return "A short, plausible description.";
  if (n.includes("status"))
    return "A status keyword. Prefer values typical for the domain (active, pending, archived, etc.).";
  return undefined;
}

function domainCheckDescription(col: Column): string | undefined {
  const checks = col.domainChecks ?? [];
  if (checks.length === 0) return undefined;
  const name = col.domainName ? `Domain ${col.domainName}` : "Domain check";
  return `${name}: ${checks.join("; ")}.`;
}

export function buildRowSchema(table: Table, batchSize: number): RowSchema {
  assertSupportedTypes([table]);

  const modelColumns = modelColumnsOf(table);

  const properties: Record<string, unknown> = {};
  for (const col of modelColumns) {
    const t = jsonTypeFor(col)!;
    const desc = [colDescription(col), domainCheckDescription(col)].filter(Boolean).join(" ");
    const node: Record<string, unknown> = {};
    if (col.isNullable) {
      node.type = Array.isArray(t.type) ? t.type : [t.type, "null"];
    } else {
      node.type = t.type;
    }
    if (t.format) node.format = t.format;
    if (t.pattern) node.pattern = t.pattern;
    if (typeof t.minimum === "number") node.minimum = t.minimum;
    if (typeof t.maximum === "number") node.maximum = t.maximum;
    if (t.items) node.items = t.items;
    if (t.enum) node.enum = t.enum;
    // Cap string length to the column's declared max so the model does not
    // overshoot varchar(N). Falls back to a sane upper bound for unbounded text.
    if (
      node.type === "string" ||
      (Array.isArray(node.type) && (node.type as string[]).includes("string"))
    ) {
      const max = col.charMaxLength ?? 280;
      node.maxLength = max;
    }
    if (desc) node.description = desc;
    properties[col.name] = node;
  }

  const rowSchema = {
    type: "object",
    properties,
    required: modelColumns.map((c) => c.name),
    additionalProperties: false,
  };

  const jsonSchema = {
    name: `${table.name}_rows`,
    schema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          minItems: batchSize,
          maxItems: batchSize,
          items: rowSchema,
        },
      },
      required: ["rows"],
      additionalProperties: false,
    },
  };

  const insertColumns = [
    ...modelColumns.map((c) => c.name),
    ...table.foreignKeys.map((fk) => fk.column),
  ];

  return {
    jsonSchema,
    modelColumns,
    fkColumns: table.foreignKeys,
    insertColumns,
  };
}
