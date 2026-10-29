# CLI Persona domain

P0a pure validation, deterministic compilation and request-only projection. No IO, runtime permission,
repository, queue or model call lives here. This contract is local; wire schemas remain a later slice.

The caller owns the admitted turn and must freeze one compiled contribution for that turn. The
projection function never mutates canonical messages, never returns injected entries for persistence,
and gives the added system message no canonical source. Re-render from the canonical projection;
do not feed an already extended projection back into it or deduplicate by matching text.

Absence of a contribution returns the original projection object. Auxiliary callers omit it. Request
recording and budget callers must use the same optional value when the turn integration is added.
Diagnostics may contain actual contribution content; this is not an OS file-access isolation boundary.

Public entrypoints are contract.ts (types) and index.ts (pure functions). Runtime helper has one import
and delegates the optional overlay after its existing ToolSearch/provider/cache projection. No default
runtime or UI enablement is registered by this module.

Turn integration (P0a): `isPersonaEligibleMainRequest` is the closed-world entry qualification table;
the runtime freezes it synchronously at admission (no new await before the existing model/style
freeze). `PersonaCapturePort` is the only runtime seam — when no port is registered the feature is
off and the turn takes the original path. The caller captures at most once per admitted turn, before
the first eligible main request, and freezes the outcome for the whole live turn: retries, tool
continuations, output-token continuations and post-compact main requests of the same turn reuse the
frozen value and never re-capture. Cancellation propagates through the original AbortSignal path and
must not be converted into an omitted-and-continue. Omitted is final for the turn; late applied
results after an omission do not surface. Port faults degrade only the extension: the turn logs and
continues without a contribution; original session/provider/permission errors are untouched.
Auxiliary request assembly (compact, title, verifier, extraction) never passes a contribution.
The execution permission gate (E) and the production service are later slices.
