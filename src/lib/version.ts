/**
 * Canonical version constants for the satus.sh marketing surface.
 *
 * Update these in one place when a new CLI release lands. The TopBar build
 * tag, the LeftRail "Document" block, the /cli reference header, the
 * /quickstart sample output, and any other version-bearing copy import from
 * here so the site cannot drift from the published npm package.
 *
 * Source of truth for the binary itself lives in
 * packages/cli/src/version.ts; keep these two in sync at release time.
 */

// Latest published version of @passkeybridge/satus on the npm registry.
export const SATUS_VERSION = "0.3.11";

// Display form used in build tags and status pills.
export const SATUS_VERSION_TAG = `v${SATUS_VERSION}`;

// Spec/wire-format identifier the LeftRail surfaces in its Document block.
// Bumps with the minor version line of the CLI.
export const SATUS_SPEC = "satus/0.3";

// ISO date of the most recent site-facing release. Surfaced in the LeftRail.
export const SATUS_RELEASED_AT = "2026-08-27";
