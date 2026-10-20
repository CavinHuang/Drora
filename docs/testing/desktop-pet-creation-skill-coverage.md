# Desktop pet creation skill verification

Contract: [creation spec](../../specs/desktop-pet-creation-skill.md).
Skill: `apps/drora-cli/packages/bundled-skills/skills/create-pet/SKILL.md`.

## Executed on Windows, 2026-10-18

| Check                             | Result                                                                                                                                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python helper/publisher suite     | 22 passed: shared look registration, edge clipping, chroma decontamination, blind verdict consensus, v2 publication, collisions, repeat receipts, failed/stale QA, invalid atlas and source preservation                                                                                           |
| `desktopPetCreationSkill.test.ts` | 4 passed: actual Agent discovery/load, complete SEA closure/license hashes, thirteen-job preparation with layout guides, published output through production Sharp/library decoder                                                                                                                 |
| Actual Settings browser candidate | 2 passed: 390px/zh/light and 1100px/en/dark, creation and upgrade both request `$create-pet` with Main-provided target and upgrade source                                                                                                                                                          |
| `pnpm typecheck`                  | Passed                                                                                                                                                                                                                                                                                             |
| `pnpm lint`                       | 394 warnings, 0 errors                                                                                                                                                                                                                                                                             |
| Architecture changed-files check  | 0 violations; CLI/UI base modules are unmanaged by the policy                                                                                                                                                                                                                                      |
| CLI package-wide typecheck/lint   | Attempted; both fail before checking code because `apps/drora-cli` has no `turbo.json`/`turbo.jsonc`. No unrelated configuration was recreated                                                                                                                                                     |
| License notice regeneration       | Attempted twice; `pnpm -r ls --prod --json --depth Infinity` hits Windows `EMFILE`, including with workspace concurrency 1. The original Apache license is shipped in the skill and registered in `third-party/copied-components.json`; generated centralized inventory/notices were not refreshed |
| Skill-creator quick validator     | Attempted; bundled Python has Pillow but not PyYAML. The actual Agent parser successfully discovers/loads the skill instead                                                                                                                                                                        |

Native Python helper tests used the local workspace Python with Pillow 12.3.0.
Node integration tests used pinned Node 24.14.0 with `PYTHON` pointing to that
interpreter; no integration case was skipped. Without `PYTHON`, the two
Python-dependent Node cases explicitly skip and are not proof of publication.

Settings evidence: `%TEMP%/drora-pet-settings-1792317834884/`. The browser fixture
warms its module graph and waits for Vite requests to settle before navigation;
the initial cold-optimizer navigation timeout is not recorded as a pass.

## Replay

From the repository root, set `PYTHON` to an available interpreter with Pillow:

```text
python -B -m unittest discover -s apps/drora-cli/packages/bundled-skills/skills/create-pet/tests -v
node --import tsx --test packages/desktop/test/desktopPetCreationSkill.test.ts
node packages/ui/test/browser/manual-review/pending/desktop-pet-settings.test.mjs
```

Keep Python bytecode out of the shipped skill (use `-B` and
`PYTHONDONTWRITEBYTECODE=1` for child Python processes). Source and license hashes
are preserved byte-for-byte across checkouts through `.gitattributes`.

No paid image generation or live provider was invoked for this implementation.
Synthetic fixtures prove processing and loading only. Creating a real character
still requires an enabled image-generation/editing tool and Python/Pillow in the
Agent environment. Published packs are loadable; activation remains the existing
Settings refresh/select action. Physical mouse/platform parity is tracked in the
separate pet parity coverage, not claimed by these skill tests.
