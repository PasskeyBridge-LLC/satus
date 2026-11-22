/**
 * Type-mapping tests for array udt_names, the unmapped-type error, and
 * the types that must keep working (enums, domains, json/jsonb, citext).
 */
import { describe, it, expect } from "vitest";
import type { Column, Table } from "./introspect.js";
import {
  assertSupportedTypes,
  buildRowSchema,
  jsonTypeFor,
  UnsupportedTypeError,
} from "./schema.js";
import { createSimulatedProvider } from "./simulate.js";
import { validateTable } from "./validate.js";

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
    primaryKey: extra.primaryKey ?? [],
    foreignKeys: extra.foreignKeys ?? [],
    uniqueColumns: extra.uniqueColumns ?? new Set<string>(),
  };
}

/** The #100 / invoices repro: identity id plus a required integer[] column. */
function invoicesTable(extra: Column[] = []): Table {
  return tbl(
    "invoices",
    [
      col("id", "int4", { isIdentity: true, identityGeneration: "ALWAYS" }),
      ...extra,
      col("tags", "_int4", { typeCategory: "A", elementUdtName: "int4" }),
    ],
    { primaryKey: ["id"] },
  );
}

function rowProps(
  schema: ReturnType<typeof buildRowSchema>,
): Record<string, Record<string, unknown>> {
  const root = schema.jsonSchema.schema as Record<string, unknown>;
  const properties = root.properties as Record<string, unknown>;
  const rows = properties.rows as Record<string, unknown>;
  const items = rows.items as Record<string, unknown>;
  return items.properties as Record<string, Record<string, unknown>>;
}

describe("jsonTypeFor array udt_names", () => {
  const cases: Array<{ udt: string; element: string; type: string; extra?: Partial<Column> }> = [
    { udt: "_int4", element: "int4", type: "integer" },
    { udt: "_int8", element: "int8", type: "integer" },
    { udt: "_text", element: "text", type: "string" },
    { udt: "_uuid", element: "uuid", type: "string" },
    { udt: "_bool", element: "bool", type: "boolean" },
    { udt: "_numeric", element: "numeric", type: "number" },
  ];

  for (const c of cases) {
    it(`maps ${c.udt} to an array of ${c.type}`, () => {
      const node = jsonTypeFor(
        col("c", c.udt, { typeCategory: "A", elementUdtName: c.element, ...c.extra }),
      );
      expect(node).not.toBeNull();
      expect(node!.type).toBe("array");
      expect(node!.items?.type).toBe(c.type);
    });
  }

  it("maps _int4 by the leading underscore when catalog flags are omitted", () => {
    const node = jsonTypeFor(col("tags", "_int4"));
    expect(node?.type).toBe("array");
    expect(node?.items?.type).toBe("integer");
    expect(node?.items?.minimum).toBe(-2147483648);
    expect(node?.items?.maximum).toBe(2147483647);
  });

  it("keeps int2/int8 item ranges on the corresponding array types", () => {
    expect(jsonTypeFor(col("a", "_int2"))!.items).toMatchObject({
      type: "integer",
      minimum: -32768,
      maximum: 32767,
    });
    expect(jsonTypeFor(col("a", "_int8"))!.items).toMatchObject({
      type: "integer",
      minimum: -9007199254740991,
      maximum: 9007199254740991,
    });
  });

  it("maps _uuid items with the UUID pattern", () => {
    const items = jsonTypeFor(col("ids", "_uuid"))!.items!;
    expect(items.type).toBe("string");
    expect(items.pattern).toMatch(/\[0-9a-fA-F\]\{8\}/);
  });
});

describe("jsonTypeFor currently mapped scalars", () => {
  it("maps citext, json, and jsonb the same way as before", () => {
    expect(jsonTypeFor(col("email", "citext"))).toEqual({ type: "string" });
    expect(jsonTypeFor(col("meta", "json"))).toEqual({ type: "object" });
    expect(jsonTypeFor(col("meta", "jsonb"))).toEqual({ type: "object" });
  });

  it("maps a domain column reported as int4, and attaches domain CHECKs to the schema description", () => {
    const node = jsonTypeFor(
      col("total_cents", "int4", {
        domainName: "cents",
        domainChecks: ["CHECK (VALUE >= 0)"],
      }),
    );
    expect(node?.type).toBe("integer");
    const schema = buildRowSchema(
      invoicesTable([
        col("total_cents", "int4", {
          domainName: "cents",
          domainChecks: ["CHECK (VALUE >= 0)"],
        }),
      ]),
      1,
    );
    const prop = rowProps(schema).total_cents;
    expect(prop.type).toBe("integer");
    expect(String(prop.description)).toContain("CHECK (VALUE >= 0)");
    expect(String(prop.description)).toContain("cents");
  });

  it("maps an enum as a string and includes labels when present", () => {
    const node = jsonTypeFor(
      col("status", "invoice_status", { isEnum: true, enumLabels: ["draft", "open", "paid"] }),
    );
    expect(node).toEqual({ type: "string", enum: ["draft", "open", "paid"] });
  });

  it("maps an enum without labels as a plain string, so existing enum columns still plan", () => {
    expect(jsonTypeFor(col("status", "invoice_status", { isEnum: true }))).toEqual({
      type: "string",
    });
  });

  it("maps an array of enums as an array of strings", () => {
    const node = jsonTypeFor(
      col("flags", "_invoice_status", {
        typeCategory: "A",
        elementUdtName: "invoice_status",
        isEnum: true,
        enumLabels: ["draft", "open"],
      }),
    );
    expect(node?.type).toBe("array");
    expect(node?.items).toEqual({ type: "string", enum: ["draft", "open"] });
  });
});

describe("unsupported types fail before planning", () => {
  it("throws naming table.column and the udt_name for a scalar inet column", () => {
    const table = tbl("hosts", [col("addr", "inet")]);
    expect(() => buildRowSchema(table, 1)).toThrow(UnsupportedTypeError);
    try {
      assertSupportedTypes([table]);
      throw new Error("expected assertSupportedTypes to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedTypeError);
      const e = err as UnsupportedTypeError;
      expect(e.message).toContain("hosts.addr");
      expect(e.message).toContain("inet");
      expect(e.unsupported).toEqual([{ table: "hosts", column: "addr", udtName: "inet" }]);
    }
  });

  it("throws for an array of an unmapped element type", () => {
    const table = tbl("docs", [
      col("path", "_ltree", { typeCategory: "A", elementUdtName: "ltree" }),
    ]);
    expect(() => buildRowSchema(table, 1)).toThrow(UnsupportedTypeError);
    try {
      buildRowSchema(table, 1);
    } catch (err) {
      const e = err as UnsupportedTypeError;
      expect(e.message).toContain("docs.path");
      expect(e.message).toContain("_ltree");
    }
  });

  it("lists every unmapped column when more than one is present", () => {
    const table = tbl("hosts", [col("addr", "inet"), col("route", "cidr")]);
    try {
      assertSupportedTypes([table]);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as UnsupportedTypeError;
      expect(e.unsupported).toHaveLength(2);
      expect(e.message).toContain("hosts.addr (inet)");
      expect(e.message).toContain("hosts.route (cidr)");
    }
  });

  it("does not throw for identity, defaulted, or FK columns with an unmapped type", () => {
    const table = tbl(
      "hosts",
      [
        col("id", "int4", { isIdentity: true, identityGeneration: "ALWAYS" }),
        col("created_at", "timestamptz", { hasDefault: true, defaultExpr: "now()" }),
        col("net_id", "inet"),
        col("name", "text"),
      ],
      {
        primaryKey: ["id"],
        foreignKeys: [
          {
            column: "net_id",
            refSchema: "public",
            refTable: "nets",
            refColumn: "id",
            deferrable: false,
            initiallyDeferred: false,
          },
        ],
      },
    );
    expect(() => assertSupportedTypes([table])).not.toThrow();
    expect(buildRowSchema(table, 1).modelColumns.map((c) => c.name)).toEqual(["name"]);
  });
});

describe("invoices integer[] repro", () => {
  it("plans tags as an array of integers", () => {
    const schema = buildRowSchema(invoicesTable(), 3);
    expect(schema.modelColumns.map((c) => c.name)).toEqual(["tags"]);
    const props = rowProps(schema);
    expect(props.tags.type).toBe("array");
    expect((props.tags.items as { type: string }).type).toBe("integer");
  });

  it("the simulator emits integer arrays, and the validator accepts them", async () => {
    const table = invoicesTable();
    const schema = buildRowSchema(table, 3);
    const res = await createSimulatedProvider().generate<{ rows: Array<Record<string, unknown>> }>({
      system: "",
      user: "",
      jsonSchema: schema.jsonSchema,
    });
    expect(res.data.rows).toHaveLength(3);
    for (const row of res.data.rows) {
      expect(Array.isArray(row.tags)).toBe(true);
      expect(row.tags).not.toBe("tags_1");
      const tags = row.tags as unknown[];
      expect(tags.length).toBeGreaterThan(0);
      for (const t of tags) expect(typeof t).toBe("number");
    }
    const findings = validateTable(table, { rows: res.data.rows, pkPool: new Map() });
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});
