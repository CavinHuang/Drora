# Executable pet pipeline

Use argument arrays with the exact Python executable when launching from a tool;
the following examples show arguments, not a requirement for a POSIX shell.
Replace `SKILL_DIR` and `RUN` with absolute paths. Quote paths with spaces.
Run every command with `python -B` to keep bytecode out of the installed skill.

```text
python -B SKILL_DIR/scripts/prepare_pet_run.py --pet-name "Name" --pet-notes "character brief" --output-dir RUN
```

Optional `--reference <image>` is repeatable; `--style-preset` accepts `auto`,
`pixel`, `plush`, `clay`, `sticker`, `flat-vector`, `3d-toy`, `painterly`,
`brand-inspired`. Reuse the selected chroma key from `pet_request.json`'s
`chroma_key.hex`, rather than using a green key for a green character. Existing
nonempty runs require deliberate resume; do not pass `--force` blindly.

The manifest contains thirteen visual jobs: base, nine motion rows, four-cardinal
strip, and two look rows. Read each prompt/input/output and wait for its
dependencies before generation. Save the chosen output and actual completion
record only after row review. Reference guides define invisible layout only.

## Standard rows

Immediately extract/review each generated row with `--states <state>`. After all
rows pass, run the combined commands below. Preserve approved v1 animation rows
for an upgrade; regenerate only what is missing or fails review.

```text
python -B SKILL_DIR/scripts/extract_strip_frames.py --decoded-dir RUN/decoded --output-dir RUN/frames --states all --method auto
python -B SKILL_DIR/scripts/inspect_frames.py --frames-root RUN/frames --json-out RUN/qa/review.json --require-components
python -B SKILL_DIR/scripts/compose_atlas.py --frames-root RUN/frames --output RUN/final/standard.png --webp-output RUN/final/standard.webp
python -B SKILL_DIR/scripts/make_contact_sheet.py RUN/final/standard.webp --output RUN/qa/standard-contact.png
python -B SKILL_DIR/scripts/render_animation_previews.py --frames-root RUN/frames --output-dir RUN/qa/previews
```

Inspect every motion GIF; the generated strip and extracted frames must retain
the same identity and shared scale. `stable-slots` extraction is an explicit
correction for known stable source slots, with `inspect_frames.py
--allow-stable-slots`; it is not a way to hide clipped or merged poses.

## Directions and final image

Write the pet-specific look mechanics, generate/extract/review the cardinal
anchors, then create their approved strip. Check helper `--help` for the exact
input options before running a conditional repair or anchor extraction.

```text
python -B SKILL_DIR/scripts/extract_cardinal_anchors.py --help
python -B SKILL_DIR/scripts/compose_cardinal_anchor_strip.py --help
python -B SKILL_DIR/scripts/assemble_extended_atlas.py --base-atlas RUN/final/standard.webp --look-row-9 RUN/decoded/look-row-9.png --neutral-cell RUN/frames/idle/00.png --chroma-key KEY --registered-row-output RUN/qa/look-row-9-registered.png --registration-manifest-output RUN/qa/look-row-9-registration.json
```

Approve the registered row 9 semantics before generating row 10. Then:

```text
python -B SKILL_DIR/scripts/assemble_extended_atlas.py --base-atlas RUN/final/standard.webp --registered-row-9 RUN/qa/look-row-9-registered.png --row-9-registration RUN/qa/look-row-9-registration.json --look-row-10 RUN/decoded/look-row-10.png --neutral-cell RUN/frames/idle/00.png --chroma-key KEY --output RUN/final/extended.png --webp-output RUN/final/extended.webp
python -B SKILL_DIR/scripts/despill_chroma_edges.py RUN/final/extended.webp --output RUN/final/spritesheet.webp --json-out RUN/qa/despill-report.json --chroma-key KEY
python -B SKILL_DIR/scripts/validate_atlas.py RUN/final/spritesheet.webp --require-v2 --chroma-key KEY --json-out RUN/qa/atlas-validation.json
python -B SKILL_DIR/scripts/make_contact_sheet.py RUN/final/spritesheet.webp --output RUN/qa/contact-sheet.png
python -B SKILL_DIR/scripts/make_direction_qa_sheet.py RUN/final/spritesheet.webp --output RUN/qa/look-directions.png
python -B SKILL_DIR/scripts/measure_direction_continuity.py RUN/final/spritesheet.webp --json-out RUN/qa/look-continuity.json
```

The pack is exactly 1536×2288, 8×11 cells of 192×208. Standard row counts are
6,8,8,4,5,8,6,6,6. The upstream v2 assembler stores an additional neutral
reference at row 0, column 6 and the validator requires it; preserve that cell.
All other unused cells stay transparent. Look rows hold all sixteen
clockwise directions, north first. The intermediate v1 sheet cannot be published.
Inspect the final contact, ordered direction sheet, continuity report and motion
previews. Geometry checks do not approve the character or direction meaning.
Consult [qa-rubric.md](qa-rubric.md) for visual defect categories. In Drora,
independent blind helpers are optional additional evidence; actual visual review
and explicit direction verdicts are always required.

## Review and publish

Use SHA-256 of `final/spritesheet.webp` to bind the visual review to exact bytes.
Write `qa/direction-semantics.json` as:

```json
{"directions":{"000":{"verdict":"pass","expected":"north","observed":"head looks up","reason":"eyes and face point above the neutral pose"}}}
```

Include all sixteen keys: `000`, `022.5`, `045`, `067.5`, `090`, `112.5`, `135`,
`157.5`, `180`, `202.5`, `225`, `247.5`, `270`, `292.5`, `315`, `337.5`.
Each entry needs `verdict` (`pass`, `warning`, `fail`), `expected`, `observed`, and
`reason`. Wrong cardinal direction is a failure. Warnings need actual review.
Write `qa/visual-review.json` only after inspecting the final image and previews:

```json
{"atlas_sha256":"<actual SHA-256>","approved":true,"reviewer":"agent or user","warnings_reviewed":true,"notes":"Concrete identity, animation, direction and light/dark review observations"}
```

The publisher also requires `qa/review.json` and `qa/despill-report.json` with
`ok: true`, plus the contact, look-direction, continuity and motion artifacts.
Never write fictitious passing reports to unblock a failed processing step.

```text
python -B SKILL_DIR/scripts/publish_pet.py --run-dir RUN --pets-root "<exact Main-provided .drora/pets path>"
```

The helper reruns the original validator on the exact file, publishes a unique
folder and writes `published-pet.json` in the run. Repeating with unchanged bytes,
metadata and target reuses a verified receipt. New runs, failed QA and upgrades
never overwrite an existing pet. Keep previews/reports in the run; installed
packs need only `pet.json` and `spritesheet.webp`.
