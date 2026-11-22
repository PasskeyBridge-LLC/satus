/**
 * Unit tests for validateTable. Focus on the rules a real dry-run would
 * commonly fire: NOT NULL, type mismatch, FK existence, length overflow,
 * unique duplication. The simulator (simulate.ts) is exercised
 * end-to-end via the runner; here we test the validator in isolation
 * with hand-built rows so failure modes are unambiguous.
 */
import { describe, it, expect } from "vitest";
import { validateTable, groupFindings } from "./validate.js";
import type { Table, Column } from "./introspect.js";

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
    primaryKey: extra.primaryKey ?? ["id"],
    columns,
    foreignKeys: extra.foreignKeys ?? [],
    uniqueColumns: extra.uniqueColumns ?? new Set<string>(),
  };
}

describe("validateTable", () => {
  it("flags NOT NULL violations and skips nullable nulls", () => {
    const table = tbl("users", [
      col("id", "int4"),
      col("email", "text"),
      col("nickname", "text", { isNullable: true }),
    ]);
    const findings = validateTable(table, {
      rows: [
        { id: 1, email: null, nickname: null },
        { id: 2, email: "a@b.test", nickname: "ok" },
      ],
      pkPool: new Map(),
    });
    const errors = findings.filter((f) => f.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ rule: "not_null", column: "email", row: 0 });
  });

  it("flags type mismatches and int overflow", () => {
    const table = tbl("events", [col("id", "int4"), col("count", "int2"), col("active", "bool")]);
    const findings = validateTable(table, {
      rows: [{ id: 1, count: 99_999, active: "yes" }],
      pkPool: new Map(),
    });
    const rules = findings.map((f) => f.rule).sort();
    expect(rules).toContain("int_overflow");
    expect(rules).toContain("type_mismatch");
  });

  it("flags varchar length overflow", () => {
    const table = tbl("posts", [col("id", "int4"), col("title", "varchar", { charMaxLength: 5 })]);
    const findings = validateTable(table, {
      rows: [{ id: 1, title: "too long for varchar(5)" }],
      pkPool: new Map(),
    });
    expect(findings.some((f) => f.rule === "length_overflow")).toBe(true);
  });

  it("flags missing FK parents and accepts injected ones", () => {
    const orgs = tbl("organizations", [col("id", "uuid")], { primaryKey: ["id"] });
    const users = tbl("users", [col("id", "uuid"), col("org_id", "uuid")], {
      foreignKeys: [
        {
          column: "org_id",
          refSchema: "public",
          refTable: "organizations",
          refColumn: "id",
          deferrable: false,
          initiallyDeferred: false,
        },
      ],
    });
    void orgs;
    const pkPool = new Map<string, Array<Record<string, unknown>>>([
      ["organizations", [{ id: "00000000-0000-4000-8000-000000000001" }]],
    ]);
    const findings = validateTable(users, {
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          org_id: "00000000-0000-4000-8000-000000000001",
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          org_id: "00000000-0000-4000-8000-deadbeefdead",
        },
      ],
      pkPool,
    });
    const fkErrors = findings.filter((f) => f.rule === "fk_missing_parent");
    expect(fkErrors).toHaveLength(1);
    expect(fkErrors[0]).toMatchObject({ row: 1, column: "org_id" });
  });

  it("flags single-column UNIQUE duplicates within a batch", () => {
    const table = tbl("users", [col("id", "int4"), col("email", "text")], {
      uniqueColumns: new Set(["email"]),
    });
    const findings = validateTable(table, {
      rows: [
        { id: 1, email: "a@b.test" },
        { id: 2, email: "a@b.test" },
      ],
      pkPool: new Map(),
    });
    const uniqErrors = findings.filter((f) => f.rule === "unique_duplicate");
    expect(uniqErrors).toHaveLength(1);
    expect(uniqErrors[0]?.row).toBe(1);
  });

  it("rejects malformed UUIDs", () => {
    const table = tbl("docs", [col("id", "uuid")]);
    const findings = validateTable(table, {
      rows: [{ id: "not-a-uuid" }],
      pkPool: new Map(),
    });
    expect(findings.some((f) => f.rule === "uuid_format")).toBe(true);
  });
});

describe("groupFindings", () => {
  it("compacts duplicate findings into a single group with sample rows", () => {
    const table = tbl("logs", [col("id", "int4"), col("payload", "text")]);
    const findings = validateTable(table, {
      rows: [
        { id: 1, payload: null },
        { id: 2, payload: null },
        { id: 3, payload: null },
        { id: 4, payload: null },
      ],
      pkPool: new Map(),
    });
    const groups = groupFindings(findings);
    const nullGroup = groups.find((g) => g.rule === "not_null");
    expect(nullGroup?.count).toBe(4);
    expect(nullGroup?.sampleRows).toEqual([0, 1, 2]);
  });
});

describe("validateTable array columns", () => {
  it("accepts an integer array and flags a string on an _int4 column", () => {
    const table = tbl("invoices", [col("id", "int4"), col("tags", "_int4")]);
    const ok = validateTable(table, {
      rows: [{ id: 1, tags: [1, 2, 3] }],
      pkPool: new Map(),
    });
    expect(ok.filter((f) => f.severity === "error")).toEqual([]);

    const bad = validateTable(table, {
      rows: [{ id: 1, tags: "tags_1" }],
      pkPool: new Map(),
    });
    expect(bad.some((f) => f.rule === "type_mismatch" && f.column === "tags")).toBe(true);
  });

  it("flags a non-integer element and allows null elements", () => {
    const table = tbl("invoices", [col("id", "int4"), col("tags", "_int4")]);
    const mixed = validateTable(table, {
      rows: [{ id: 1, tags: [1, null, "x"] }],
      pkPool: new Map(),
    });
    expect(mixed.some((f) => f.rule === "type_mismatch")).toBe(true);

    const withNull = validateTable(table, {
      rows: [{ id: 1, tags: [1, null, 3] }],
      pkPool: new Map(),
    });
    expect(withNull.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("validates uuid and bool array elements", () => {
    const table = tbl("t", [
      col("ids", "_uuid", { typeCategory: "A", elementUdtName: "uuid" }),
      col("flags", "_bool", { typeCategory: "A", elementUdtName: "bool" }),
    ]);
    const findings = validateTable(table, {
      rows: [
        {
          ids: ["00000000-0000-4000-8000-000000000001", "not-a-uuid"],
          flags: [true, false],
        },
      ],
      pkPool: new Map(),
    });
    expect(findings.some((f) => f.rule === "uuid_format" && f.column === "ids")).toBe(true);
    expect(findings.some((f) => f.column === "flags")).toBe(false);
  });
});

describe("validateTable unmapped types", () => {
  it("reports an unsupported_type error naming the udt_name", () => {
    const table = tbl("hosts", [col("addr", "inet")]);
    const findings = validateTable(table, {
      rows: [{ addr: "127.0.0.1" }],
      pkPool: new Map(),
    });
    expect(findings.some((f) => f.rule === "unsupported_type" && f.message.includes("inet"))).toBe(
      true,
    );
  });
});
