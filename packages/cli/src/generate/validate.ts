/**
 * Relational validator for satus dry-runs. Given a table's metadata, the
 * rows the runner produced for it (after FK injection), and the pool of
 * already-seeded parent PKs, returns a list of findings that would have
 * caused INSERT failures or referential-integrity problems.
 *
 * The validator deliberately mirrors the constraints the database itself
 * would enforce, so a clean dry-run is a strong signal that a real run
 * against the same schema would succeed.
 *
 * Coverage in v0.3.x:
 *   - NOT NULL violations
 *   - Type mismatches (boolean column got string, etc.)
 *   - Integer range overflow (int2 / int4 / int8 safe range)
 *   - String length > char_max_length
 *   - UUID column got a non-UUID-shaped string
 *   - Array columns: value is an array; each non-null element matches the element type
 *   - Enum label membership, when introspection returned labels
 *   - inet, cidr, bytea, interval, time, timetz, and money formats
 *   - FK reference not present in the parent pool (non-null FK only)
 *   - Single-column UNIQUE duplicates within the batch
 *
 * Out of scope for v0.3.x (documented gaps, not silent ones):
 *   - Multi-column UNIQUE constraints
 *   - CHECK constraints, including domain CHECKs attached as planner descriptions
 *   - Exclusion constraints
 *   - Cross-batch UNIQUE clashes against rows already in the database
 *   - Multi-dimensional arrays (an `_int4` column is checked as a 1-D integer array)
 */
import { isIP } from "node:net";
import type { Table, ForeignKey, Column } from "./introspect.js";
import { elementUdtName, isArrayColumn, TYPE_PATTERNS } from "./schema.js";

export type FindingSeverity = "error" | "warn";

export interface Finding {
  severity: FindingSeverity;
  table: string;
  column?: string;
  row?: number;
  rule: string;
  message: string;
}

export interface ValidateOptions {
  /** Rows the runner produced for this table (after FK injection). */
  rows: Array<Record<string, unknown>>;
  /** Parent PK pool keyed by table name. Same shape the runner maintains. */
  pkPool: Map<string, Array<Record<string, unknown>>>;
}

const UUID_RE = new RegExp(TYPE_PATTERNS.uuid);
const BYTEA_RE = new RegExp(TYPE_PATTERNS.bytea);
const INTERVAL_RE = new RegExp(TYPE_PATTERNS.interval);
const TIME_RE = new RegExp(TYPE_PATTERNS.time);
const TIMETZ_RE = new RegExp(TYPE_PATTERNS.timetz);

const INT_RANGES: Record<string, { min: number; max: number }> = {
  int2: { min: -32_768, max: 32_767 },
  int4: { min: -2_147_483_648, max: 2_147_483_647 },
  int8: { min: -9_007_199_254_740_991, max: 9_007_199_254_740_991 },
};

export function validateTable(table: Table, opts: ValidateOptions): Finding[] {
  const findings: Finding[] = [];
  const colByName = new Map(table.columns.map((c) => [c.name, c]));
  const fkByColumn = new Map(table.foreignKeys.map((fk) => [fk.column, fk]));
  // Build FK parent value sets once per table.
  const parentValueSets = new Map<string, Set<unknown>>();
  for (const fk of table.foreignKeys) {
    const key = fkPoolKey(fk);
    if (parentValueSets.has(key)) continue;
    const parents = opts.pkPool.get(fk.refTable) ?? [];
    parentValueSets.set(key, new Set(parents.map((p) => p[fk.refColumn])));
  }
  // Track per-column uniqueness within the batch.
  const seenUnique = new Map<string, Set<string>>();

  for (let i = 0; i < opts.rows.length; i++) {
    const row = opts.rows[i]!;
    for (const col of table.columns) {
      // Generated, identity, and defaulted columns are filled by the DB at
      // INSERT time; the runner intentionally omits them. Skip.
      if (col.isGenerated || col.isIdentity || col.hasDefault) continue;
      // Skip FK columns whose presence is enforced separately below;
      // type/length checks still apply through the general path though.
      const value = row[col.name];
      const fk = fkByColumn.get(col.name);

      // NOT NULL.
      if (value === null || value === undefined) {
        if (!col.isNullable) {
          findings.push({
            severity: "error",
            table: table.name,
            column: col.name,
            row: i,
            rule: "not_null",
            message: `NOT NULL column "${col.name}" got null`,
          });
        }
        continue;
      }

      // FK existence (only when the value is non-null).
      if (fk) {
        const allowed = parentValueSets.get(fkPoolKey(fk))!;
        if (!allowed.has(value) && fk.refTable !== table.name) {
          findings.push({
            severity: "error",
            table: table.name,
            column: col.name,
            row: i,
            rule: "fk_missing_parent",
            message:
              `FK ${col.name} -> ${fk.refTable}.${fk.refColumn} references ` +
              `value not present in the simulated parent pool`,
          });
          continue;
        }
      }

      // Type / shape checks.
      checkType(col, value, table.name, i, findings);

      // Single-column UNIQUE within the batch.
      if (table.uniqueColumns.has(col.name)) {
        const key = `${col.name}\u0000${String(value)}`;
        const set = seenUnique.get(col.name) ?? new Set<string>();
        if (set.has(key)) {
          findings.push({
            severity: "error",
            table: table.name,
            column: col.name,
            row: i,
            rule: "unique_duplicate",
            message: `Duplicate value in UNIQUE column "${col.name}" within the same batch`,
          });
        } else {
          set.add(key);
          seenUnique.set(col.name, set);
        }
      }
    }
  }

  return findings;
}

function fkPoolKey(fk: ForeignKey): string {
  return `${fk.refTable}.${fk.refColumn}`;
}

function checkType(
  col: Column,
  value: unknown,
  tableName: string,
  rowIndex: number,
  findings: Finding[],
): void {
  if (isArrayColumn(col)) {
    if (!Array.isArray(value)) {
      push(
        findings,
        "error",
        tableName,
        col.name,
        rowIndex,
        "type_mismatch",
        `Column "${col.name}" is ${col.udtName} but got ${typeof value}`,
      );
      return;
    }
    const elemCol: Column = {
      ...col,
      udtName: elementUdtName(col),
      typeCategory: col.isEnum ? "E" : "B",
      elementUdtName: null,
    };
    for (const el of value) {
      if (el === null || el === undefined) continue;
      checkScalarType(elemCol, el, tableName, rowIndex, findings);
    }
    return;
  }
  checkScalarType(col, value, tableName, rowIndex, findings);
}

function checkScalarType(
  col: Column,
  value: unknown,
  tableName: string,
  rowIndex: number,
  findings: Finding[],
): void {
  const udt = col.udtName.toLowerCase();

  switch (udt) {
    case "bool":
      if (typeof value !== "boolean")
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "type_mismatch",
          `Column "${col.name}" is bool but got ${typeof value}`,
        );
      return;
    case "int2":
    case "int4":
    case "int8": {
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "type_mismatch",
          `Column "${col.name}" is ${udt} but got non-integer value (${typeof value})`,
        );
        return;
      }
      const range = INT_RANGES[udt]!;
      if (value < range.min || value > range.max) {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "int_overflow",
          `Column "${col.name}" (${udt}) value ${value} outside [${range.min}, ${range.max}]`,
        );
      }
      return;
    }
    case "numeric":
    case "float4":
    case "float8":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "type_mismatch",
          `Column "${col.name}" is ${udt} but got non-finite value (${typeof value})`,
        );
      }
      return;
    case "uuid":
      if (typeof value !== "string" || !UUID_RE.test(value)) {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "uuid_format",
          `Column "${col.name}" is uuid but value does not match UUID pattern`,
        );
      }
      return;
    case "json":
    case "jsonb":
      // Accept objects, arrays, and already-stringified JSON. The writer's
      // serializeValue() handles both shapes; anything that JSON.stringify can
      // round-trip will reach Postgres without error.
      if (value === null) return;
      if (typeof value === "string") {
        try {
          JSON.parse(value);
        } catch {
          push(
            findings,
            "error",
            tableName,
            col.name,
            rowIndex,
            "json_invalid",
            `Column "${col.name}" is ${udt} but string value is not valid JSON`,
          );
        }
        return;
      }
      if (typeof value !== "object") {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "type_mismatch",
          `Column "${col.name}" is ${udt} but got ${typeof value}`,
        );
      }
      return;
    case "inet":
      if (typeof value !== "string" || isIP(value) === 0) {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "inet_format",
          `Column "${col.name}" is inet but value is not an IPv4 or IPv6 address`,
        );
      }
      return;
    case "cidr":
      if (typeof value !== "string" || !isCidr(value)) {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "cidr_format",
          `Column "${col.name}" is cidr but value is not an IPv4 or IPv6 prefix`,
        );
      }
      return;
    case "bytea":
      if (typeof value === "string") {
        if (!BYTEA_RE.test(value)) {
          push(
            findings,
            "error",
            tableName,
            col.name,
            rowIndex,
            "bytea_format",
            `Column "${col.name}" is bytea but value is not a hex literal of the form \\x00`,
          );
        }
        return;
      }
      if (value instanceof Uint8Array) return;
      push(
        findings,
        "error",
        tableName,
        col.name,
        rowIndex,
        "type_mismatch",
        `Column "${col.name}" is bytea but got ${typeof value}`,
      );
      return;
    case "interval":
      if (typeof value !== "string" || !INTERVAL_RE.test(value)) {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "interval_format",
          `Column "${col.name}" is interval but value does not match the accepted form (e.g. "30 seconds")`,
        );
      }
      return;
    case "time":
      if (typeof value !== "string" || !TIME_RE.test(value)) {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "time_format",
          `Column "${col.name}" is time but value is not HH:MM:SS`,
        );
      }
      return;
    case "timetz":
      if (typeof value !== "string" || !TIMETZ_RE.test(value)) {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "timetz_format",
          `Column "${col.name}" is timetz but value is not HH:MM:SS with an offset`,
        );
      }
      return;
    case "money":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        push(
          findings,
          "error",
          tableName,
          col.name,
          rowIndex,
          "type_mismatch",
          `Column "${col.name}" is money but got non-finite value (${typeof value})`,
        );
      }
      return;
    case "date":
    case "timestamp":
    case "timestamptz":
    case "text":
    case "varchar":
    case "bpchar":
    case "citext":
      checkStringLike(col, value, tableName, rowIndex, findings, udt);
      return;
    default: {
      if (col.isEnum || (col.enumLabels && col.enumLabels.length > 0)) {
        checkStringLike(col, value, tableName, rowIndex, findings, udt);
        if (typeof value === "string" && col.enumLabels && col.enumLabels.length > 0) {
          if (!col.enumLabels.includes(value)) {
            push(
              findings,
              "error",
              tableName,
              col.name,
              rowIndex,
              "enum_label",
              `Column "${col.name}" value ${JSON.stringify(value)} is not one of the enum labels`,
            );
          }
        }
        return;
      }
      push(
        findings,
        "error",
        tableName,
        col.name,
        rowIndex,
        "unsupported_type",
        `Column "${col.name}" has unsupported type "${udt}"`,
      );
    }
  }
}

function checkStringLike(
  col: Column,
  value: unknown,
  tableName: string,
  rowIndex: number,
  findings: Finding[],
  udt: string,
): void {
  if (typeof value !== "string") {
    push(
      findings,
      "error",
      tableName,
      col.name,
      rowIndex,
      "type_mismatch",
      `Column "${col.name}" (${udt}) expected a string, got ${typeof value}`,
    );
    return;
  }
  if (typeof col.charMaxLength === "number" && value.length > col.charMaxLength) {
    push(
      findings,
      "error",
      tableName,
      col.name,
      rowIndex,
      "length_overflow",
      `Column "${col.name}" length ${value.length} exceeds VARCHAR limit ${col.charMaxLength}`,
    );
  }
}

function isCidr(value: string): boolean {
  const slash = value.lastIndexOf("/");
  if (slash <= 0) return false;
  const addr = value.slice(0, slash);
  const bits = value.slice(slash + 1);
  if (!/^\d+$/.test(bits)) return false;
  const n = Number(bits);
  const ver = isIP(addr);
  if (ver === 4) {
    if (n < 0 || n > 32) return false;
    const parts = addr.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return false;
    const ip = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
    const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    return (ip & ~mask) === 0;
  }
  if (ver === 6) {
    if (n < 0 || n > 128) return false;
    return ipv6HostBitsClear(addr, n);
  }
  return false;
}

function ipv6HostBitsClear(addr: string, prefix: number): boolean {
  const words = ipv6Words(addr);
  if (!words) return false;
  for (let i = 0; i < 8; i++) {
    const start = i * 16;
    const end = start + 16;
    const word = words[i]!;
    if (prefix >= end) continue;
    if (prefix <= start) {
      if (word !== 0) return false;
      continue;
    }
    const hostBits = end - prefix;
    const mask = (0xffff << hostBits) & 0xffff;
    if ((word & ~mask) !== 0) return false;
  }
  return true;
}

function ipv6Words(addr: string): number[] | null {
  if (addr.includes(".")) return null;
  const sides = addr.split("::");
  if (sides.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const h of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  if (sides.length === 1) {
    const words = parse(sides[0]!);
    return words && words.length === 8 ? words : null;
  }
  const left = parse(sides[0]!);
  const right = parse(sides[1]!);
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function push(
  findings: Finding[],
  severity: FindingSeverity,
  table: string,
  column: string,
  row: number,
  rule: string,
  message: string,
): void {
  findings.push({ severity, table, column, row, rule, message });
}

/**
 * Compact grouping for human-readable output. The CLI prints the grouped
 * shape; the JSON payload still carries the raw list above.
 */
export interface FindingGroup {
  severity: FindingSeverity;
  table: string;
  column?: string;
  rule: string;
  count: number;
  sampleMessage: string;
  sampleRows: number[];
}

export function groupFindings(findings: Finding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const f of findings) {
    const key = `${f.severity}|${f.table}|${f.column ?? ""}|${f.rule}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (g.sampleRows.length < 3 && typeof f.row === "number") g.sampleRows.push(f.row);
    } else {
      groups.set(key, {
        severity: f.severity,
        table: f.table,
        column: f.column,
        rule: f.rule,
        count: 1,
        sampleMessage: f.message,
        sampleRows: typeof f.row === "number" ? [f.row] : [],
      });
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    if (a.table !== b.table) return a.table.localeCompare(b.table);
    return a.rule.localeCompare(b.rule);
  });
}
