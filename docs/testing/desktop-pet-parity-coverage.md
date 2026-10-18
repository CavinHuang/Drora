# Desktop pet parity coverage

Contract: [Codex parity spec](../../specs/desktop-pet-codex-parity.md).

Accepted cases: manifest v1/v2, legacy defaults/precedence, PNG/WebP, import/export/
delete, invalid pack isolation, path/symlink confinement, timing and reduced motion,
16 look directions, hover/drag priority, native bounds/Alt snapping, badge gesture,
transparent input pass-through, context menu, tray navigation/dismiss/resurface,
source invalidation, configuration races, visibility and disposal, zh/en and themes.
Quick Chat, voice and orb-only throw physics are explicitly excluded by the user.
Session ownership and Web replay semantics stay unchanged.

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
`packages/desktop/.e2e-artifacts/pet-parity-1792235803673/`, including its JSON
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
