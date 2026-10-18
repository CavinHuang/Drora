# Desktop pet parity coverage

Contract: [Codex parity spec](../../specs/desktop-pet-codex-parity.md).

Accepted cases: manifest v1/v2, legacy defaults/precedence, PNG/WebP, import/export/
delete, invalid pack isolation, path/symlink confinement, timing and reduced motion,
16 look directions, hover/drag priority, native bounds/Alt snapping, badge gesture,
transparent input pass-through, context menu, tray navigation/dismiss/resurface,
source invalidation, configuration races, visibility and disposal, zh/en and themes.
Quick Chat, voice and orb-only throw physics are explicitly excluded by the user.
Session ownership and Web replay semantics stay unchanged.

Hover acceptance (2026-10-18): for both custom v1 and v2, explicitly assert
enter/animated row 4, exit to each of the five task modes, task updates while
hovered, re-entry, badge exclusion, reduced-motion jump, and left/right drag
priority followed by hover restoration. The native candidate drives the actual
preload through its injected global-cursor port; this does not substitute for
physical OS-pointer acceptance. The current `@oai/sky` initialization still fails
with `Module not found`, so physical mouse and multi-monitor checks remain open.
When installed Codex reference packs are supplied, each original atlas must also
enter the actual jump row on an opaque sprite point and return to waiting on
exit; retain a hover screenshot per original pack.

Executed 2026-10-18: standard run `pet-parity-1792314657885` passed 25 scenarios;
ASAR run `pet-parity-1792314749044` passed 26, including hover entry/exit for all
nine original Codex v2 atlases. Each original has a `codex-hover-<name>.png` in
that run's artifact directory. The six added v1/v2 cases cover all five task
modes, animated jumps, changing silhouettes, task updates while hovered, badge
exclusion, both drag directions, re-entry/release restoration and reduced motion.
No production behavior change was needed; these tests exercise the existing
player and native pointer port. Final `pnpm typecheck`, desktop `typecheck:e2e`
and architecture checks passed; `pnpm lint` reported 394 warnings and 0 errors.

Full-format migration acceptance: all four saved built-in IDs resolve standard
Codex v1 manifests and 1536×1872 atlases, use the exact shared nine animation
tracks and 192/208 aspect ratio; custom v1/v2 switching uses the same resolver.
Built-in export → custom import retains image bytes and version. Invalid custom
fallback also uses a standard pack. Verify occupied/unused atlas cells and the
absence of legacy runtime character/animation imports. Native candidate switches
through every built-in, then custom v1/v2, and checks rows and dimensions.

| Evidence           | Entry                                                                            | Scope                                                                                          |
| ------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Unit               | `packages/desktop/test/desktopPetCodexAnimation.test.ts`                         | Exact constants, poses, threshold, cancel, six anchors                                         |
| Unit               | `packages/desktop/test/desktopPetLibrary.test.ts`                                | Actual files/images, defaults, copy/export/restart/remove, malformed/traversal                 |
| Unit               | `packages/ui/test/desktopPetProjection.test.ts`                                  | Session facts, identity, previews, priority and terminal baseline                              |
| Native candidate   | `packages/desktop/test/e2e/pets/manual-review/pending/codex-pet-parity.test.mjs` | Isolated Electron, real preloads, windows and validated IPC; projected synthetic session facts |
| Manual native      | same isolated harness with OS pointer                                            | Not executed: Windows automation runtime unavailable; no physical pointer proof                |
| Settings candidate | `packages/ui/test/browser/manual-review/pending/desktop-pet-settings.test.mjs`   | Actual component, selection, resize, refresh and creation draft; 390/zh/light and 1100/en/dark |

`packages/ui/test/desktopPetPublication.test.ts` additionally covers background
workspace leases, per-window isolation, target deduplication and stale releases.

Run the candidate with `pnpm --filter @drora/desktop test:pet-parity`.
The candidate is pending human review and is not admitted to the normal WDIO or
Docker presets. It uses no model/network responses and changes only its temporary
test root. Provider replay fixtures are inapplicable. CDP pointer scenarios use an
injected cursor port because CDP does not move the OS cursor; OS-pointer checks
must be reported separately. Linux/macOS native behavior needs platform runners.

The Windows Computer Use skill's `@oai/sky` package was unavailable in this session,
so physical OS-pointer and multi-monitor drag are not recorded as passed. Native
candidate cursor scenarios are explicitly the injected-cursor checks above.

## Executed verification (2026-10-17, Windows)

| Check                                                                    | Result                                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                         | Passed, including the new desktop main/preload pet project                               |
| `pnpm lint`                                                              | Passed with 394 repository warnings, 0 errors                                            |
| `pnpm architecture:check --changed`                                      | Passed, 0 violations                                                                     |
| Nine pet Node test files                                                 | 32 tests passed under the pinned Node 24.14.0                                            |
| Isolated Electron candidate                                              | 19 standard scenarios; 20 passed in ASAR mode with nine original Codex v2 packs          |
| Settings browser candidate                                               | Both 390/zh/light and 1100/en/dark passed, including v1 upgrade and stale decode failure |
| `pnpm --filter @drora/desktop typecheck:e2e`                             | Passed                                                                                   |
| Five existing sessions-index / Root regression files                     | 21 tests passed                                                                          |
| Scoped `oxfmt --check`, `git diff --check`, website locale script syntax | Passed                                                                                   |

The final native run is retained under
`packages/desktop/.e2e-artifacts/pet-parity-1792245810548/`, including its JSON
report and distinct light/dark tray screenshots. The settings run report and
screenshots are in the temporary `drora-pet-settings-1792235814456` directory.
Screenshots were inspected for responsive layout and both tray themes.
Playwright's renderer color-scheme override is explicitly set in the theme test;
this verifies the actual tray CSS, not OS theme-change propagation.

The Electron harness uses real production windows, preloads and IPC with isolated
synthetic session projections. It does not prove end-to-end provider behavior in
an installed Drora build. Physical cursor/multi-monitor checks and macOS/Linux
native checks remain unexecuted. E2E candidates remain pending human review.

The continuation adds full PNG/WebP decode rejection (including correctly sized
but truncated headers), owned legacy-path upgrade admission, keyboard/primary
badge activation, and a delayed failed decode after a newer successful image.
Geometry tests cover greatest-overlap monitor selection, a mixed-scale screen-DIP
layout and display removal; these are simulated layout inputs, not physical
multi-monitor evidence. Production library decoding and filesystem tests now use the same full async Sharp decoder. The native candidate rejects corrupt packs and renders actual Codex WebP atlases. Electron nativeImage was replaced after it rejected valid WebP buffers.

All four built-in packs now use the same Codex v1 manifests, geometry and tracks; the old runtime artwork/character adapters and generators have been removed. Their existing authored poses were repacked, so they accurately remain v1; 16-direction looks require a compatible v2 sheet. Create pet opens an
unsent task draft with the atlas contract and target folder. Creation and upgrade
now explicitly invoke Drora's bundled `create-pet`, which includes the licensed
hatch-pet processing helpers and a guarded publisher. An enabled image tool and
Python/Pillow are still required. See [skill verification](desktop-pet-creation-skill-coverage.md).

## Full-format migration evidence

The final workspace reran all 32 Node tests, typecheck and lint successfully.
The four built-in manifests and atlases reproduce byte-for-byte (8/8 files).
ASAR rerun `pet-parity-1792245810548` passed all 20 scenarios again with the nine
original Codex v2 atlases, using the restored dependency environment.

- The nine original v2 WebP atlases were read from the installed Codex ASAR into a
  temporary reference directory, then imported into an isolated library. All nine
  decoded and resolved with their original version. These assets are not shipped.
- Native run `pet-parity-1792235533925` passed all 20 cases with those originals.
- ASAR run `pet-parity-1792235803673` passed the same 20 cases with production
  Sharp JS/native dependencies copied into a standalone ASAR fixture. The fixture
  uses the same target-selection policy as release packaging and retains a
  `packaged-runtime.json` dependency/unpack record. This proves the pet harness
  from an ASAR; a full Drora installer was not built in this session.
- Four built-ins pass manifest/image identity, every required/unused cell's alpha,
  all saved IDs, exact shared tracks, standard geometry and export/import round trips.
- Sharp packaging tests cover all six target platform selections and fail when a
  required target native package is absent; only Windows x64 was executed natively.

Optional original-asset / packaged replay (reference root contains pet folders):

```sh
pnpm --filter @drora/desktop test:pet-parity --packaged --codex-reference-root <reference-root>
```

`--packaged` uses the installed target Sharp closure and @electron/asar. Reference
inputs are copied only into isolated test directories. Standard replay needs no
Codex installation and retains its synthetic v1/v2 fixtures.

## Production application assembly

`pnpm --filter @drora/desktop build:no-runtime-assets` passed for the complete
desktop Main, host, scheduler, preloads and renderer, including the mobile-web
build prerequisite. Existing chunk-size warnings do not fail the build.

The pending candidate `production-pet.test.mjs` launches that actual production
Main with isolated settings, Electron data and a copied pet pack. Its bootstrap
blocks protocol registration and Windows registry installation; the pet
extension, windows, preload and IPC remain the production implementations. It verifies:

- A persisted custom selection loads through the production extension/preload.
- The actual main-window IPC lists the custom pack and previews all four built-ins.
- Settings IPC switches to a standard built-in and resizes the native window.
- Disabling destroys the pet; re-enabling recreates the selected custom pet.

The original Codex v2 `bsod` atlas passed all five checks in
`%TEMP%/drora-pet-production-JX0fn1`, including a rendered screenshot and JSON
result. The standard replay copies the built-in Violet v1 pack into the custom
library, so it requires no Codex installation; it passed the same five checks in
`%TEMP%/drora-pet-production-53OZYB`. Run after the desktop build:

```sh
pnpm --filter @drora/desktop test:pet-production
pnpm --filter @drora/desktop test:pet-production --codex-reference-root <reference-root>
```

This checks the production pet assembly. The clean worktree has no prepared
Agent runtime, and the main chat's storage preparation reports
`unsupported_runtime`; chat readiness and a full installer are not claimed by
this check. It complements the standalone pet ASAR replay above.
