/**
 * serializeValue / insertRows: Postgres array columns must reach `pg` as
 * JavaScript arrays, while json/jsonb values stay JSON strings.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import type { Column, Table } from "./introspect.js";
import { insertRows, serializeValue } from "./writer.js";

function col(name: string, udt: string, opts: Partial<Column> = {}): Column {
  return {
    name,
    dataType: udt,
    udtName: udt,
    isNullable: false,
    hasDefault: false,
    defaultExpr: null,
    charMaxLength: null,
    numericPrecision: null,
    numericScale: null,
    isGenerated: false,
    isIdentity: false,
    identityGeneration: null,
    ...opts,
  };
}

function tbl(name: string, columns: Column[], extra: Partial<Table> = {}): Table {
  return {
    schema: "public",
    name,
    columns,
    primaryKey: extra.primaryKey ?? ["id"],
    foreignKeys: extra.foreignKeys ?? [],
    uniqueColumns: extra.uniqueColumns ?? new Set<string>(),
  };
}

describe("serializeValue", () => {
  it("passes a JS integer array through for _int4", () => {
    expect(serializeValue([1, 2, 3], col("tags", "_int4"))).toEqual([1, 2, 3]);
  });

  it("keeps empty arrays and null elements", () => {
    expect(serializeValue([], col("tags", "_int4"))).toEqual([]);
    expect(serializeValue([1, null, 3], col("tags", "_int4"))).toEqual([1, null, 3]);
  });

  it("passes text arrays through so the pg driver can quote and escape", () => {
    const raw = ["plain", "has,comma", 'has"quote', "has\\slash", "has{brace}", "has space", ""];
    expect(serializeValue(raw, col("labels", "_text"))).toEqual(raw);
  });

  it("JSON.stringifies objects on jsonb columns, including a JSON array", () => {
    expect(serializeValue({ a: 1 }, col("meta", "jsonb"))).toBe('{"a":1}');
    expect(serializeValue([1, 2], col("meta", "jsonb"))).toBe("[1,2]");
  });

  it("JSON.stringifies objects inside a jsonb[] array, but keeps the outer JS array", () => {
    const colDef = col("blobs", "_jsonb", { typeCategory: "A", elementUdtName: "jsonb" });
    expect(serializeValue([{ a: 1 }, { b: 2 }], colDef)).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("turns undefined into null", () => {
    expect(serializeValue(undefined, col("tags", "_int4"))).toBeNull();
    expect(serializeValue(null, col("tags", "_int4"))).toBeNull();
  });
});

describe("insertRows", () => {
  it("binds a JS array for the invoices.tags integer[] column", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values: values ?? [] });
        return { rowCount: 1, rows: [{ id: 1 }] };
      },
    } as unknown as Client;

    const table = tbl(
      "invoices",
      [
        col("id", "int4", { isIdentity: true, identityGeneration: "ALWAYS" }),
        col("tags", "_int4", { typeCategory: "A", elementUdtName: "int4" }),
      ],
      { primaryKey: ["id"] },
    );

    await insertRows(client, table, ["tags"], [{ tags: [1, 2, 3] }]);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.values[0]).toEqual([1, 2, 3]);
    expect(Array.isArray(queries[0]!.values[0])).toBe(true);
    expect(queries[0]!.sql).toContain('insert into "public"."invoices"');
    expect(queries[0]!.sql).toContain('"tags"');
  });
});
