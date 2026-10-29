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
