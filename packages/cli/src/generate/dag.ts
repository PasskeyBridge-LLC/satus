/**
 * Topological sort of tables by FK dependency.
 *
 * Kahn's algorithm. Self-references are ignored (a table that FKs into
 * itself can still be seeded — we'll just leave the self-FK NULL or skip).
 * Cross-schema FKs and FKs to tables outside the target set are also
 * ignored: we cannot generate those parents, so we assume they exist or
 * the column is nullable.
 *
 * v0.2: cycle breaking. When the strict topo sort fails, we look for
 * "soft" back-edges inside the residual graph — FK columns that are
 * nullable. Removing one of these breaks the cycle: at insert time the
 * child row is written with NULL in that column, and the runner runs an
 * UPDATE pass after every table is inserted to populate it from the now-
 * available parent pool. The whole sequence happens inside the run's
 * single transaction, so a failure rolls everything back.
 *
 * NOT NULL cycle edges remain unsupported in v0.2. The user has two
 * paths forward in that case: make the column nullable, or `exclude` one of
 * the cycle members. A DEFAULT or a DEFERRABLE constraint does not break
 * the cycle.
 * We surface the unresolved members so the message is actionable.
 */
import type { Table } from "./introspect.js";

export interface BrokenEdge {
  /** Child table whose FK column will be NULL'd at insert, then UPDATEd. */
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
}

export interface SortResult {
  order: Table[];
  /** Cycle members we could not break (no nullable back-edge found). */
  cycle: string[] | null;
  /** Edges removed to break soft cycles. The runner populates these post-insert. */
  brokenEdges: BrokenEdge[];
}

interface Edge {
  from: string; // parent (referenced) table
  to: string; // child (referencing) table
  column: string;
  refColumn: string;
  nullable: boolean;
}

function buildEdges(tables: Table[]): { byName: Map<string, Table>; edges: Edge[] } {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const edges: Edge[] = [];
  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      if (fk.refTable === t.name) continue;
      if (!byName.has(fk.refTable)) continue;
      const col = t.columns.find((c) => c.name === fk.column);
      edges.push({
        from: fk.refTable,
        to: t.name,
        column: fk.column,
        refColumn: fk.refColumn,
        nullable: col?.isNullable === true,
      });
    }
  }
  return { byName, edges };
}

function kahn(
  tables: Table[],
  edges: Edge[],
  byName: Map<string, Table>,
): { order: Table[]; unresolved: Set<string> } {
  const inDegree = new Map<string, number>();
  const out = new Map<string, Edge[]>();
  for (const t of tables) {
    inDegree.set(t.name, 0);
    out.set(t.name, []);
  }
  for (const e of edges) {
    out.get(e.from)!.push(e);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [n, d] of inDegree) if (d === 0) queue.push(n);
  queue.sort();
  const order: Table[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    order.push(byName.get(n)!);
    for (const e of out.get(n) ?? []) {
      const next = (inDegree.get(e.to) ?? 0) - 1;
      inDegree.set(e.to, next);
      if (next === 0) queue.push(e.to);
    }
  }
  const unresolved = new Set<string>();
  for (const t of tables) if (!order.some((o) => o.name === t.name)) unresolved.add(t.name);
  return { order, unresolved };
}

export function topoSort(tables: Table[]): SortResult {
  const { byName, edges } = buildEdges(tables);
  let workingEdges = edges;
  const brokenEdges: BrokenEdge[] = [];

  // Up to N rounds: each round either completes the sort or removes one
  // nullable back-edge from a remaining SCC and retries.
  const maxRounds = tables.length + 1;
  for (let round = 0; round < maxRounds; round++) {
    const { order, unresolved } = kahn(tables, workingEdges, byName);
    if (unresolved.size === 0) {
      return { order, cycle: null, brokenEdges };
    }
    // Find a nullable edge fully inside the unresolved set. Prefer
    // deterministic choice: alphabetical by "to.column".
    const candidates = workingEdges
      .filter((e) => unresolved.has(e.from) && unresolved.has(e.to) && e.nullable)
      .sort((a, b) => (a.to + "." + a.column).localeCompare(b.to + "." + b.column));
    if (candidates.length === 0) {
      // No way to break the cycle without violating NOT NULL.
      return {
        order,
        cycle: Array.from(unresolved).sort(),
        brokenEdges,
      };
    }
    const pick = candidates[0]!;
    brokenEdges.push({
      table: pick.to,
      column: pick.column,
      refTable: pick.from,
      refColumn: pick.refColumn,
    });
    workingEdges = workingEdges.filter((e) => e !== pick);
  }

  // Should be unreachable; if we get here, treat as cycle.
  const { order, unresolved } = kahn(tables, workingEdges, byName);
  return {
    order,
    cycle: unresolved.size > 0 ? Array.from(unresolved).sort() : null,
    brokenEdges,
  };
}
