/**
 * Process exit codes — a public contract.
 *
 * These are documented at https://satus.sh/docs/how-it-works and in
 * packages/cli/README.md, and CI pipelines branch on them. Changing a value
 * here breaks somebody's `if [ $? -eq 11 ]`, so treat this file the way you
 * would treat a wire format: additive changes only.
 *
 * The named codes exist so a pipeline can tell "satus declined to act" from
 * "satus tried and failed" — the two need different responses, and a bare
 * `1` cannot distinguish them.
 */

/** Anything unclassified: bad config, connection refused, LLM or DB error. */
export const E_GENERAL = 1;

/** `--dry-run` completed but the relational validator reported errors. */
export const E_VALIDATION = 2;

/**
 * A foreign-key cycle exists in which no edge can be broken: every FK
 * column on the cycle is NOT NULL. Only a nullable FK column breaks a
 * cycle (see generate/dag.ts); a DEFAULT or a DEFERRABLE constraint does
 * not. satus will not guess which invariant to violate. Nothing was written.
 */
export const E_FK_CYCLE = 10;

/**
 * The safety guard refused: the target database already holds more than
 * ROW_LIMIT rows. Nothing was written. See generate/guard.ts.
 */
export const E_DB_NOT_EMPTY = 11;
