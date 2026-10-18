---
name: create-pet
description: Create, repair or upgrade Drora desktop pets from a character idea or reference image. Generate consistent animation artwork, assemble and validate a Codex-compatible v2 spritesheet, preview its motion and sixteen look directions, and publish it to the Drora pet library. Use for desktop pet creation or v1-to-v2 upgrades, rather than real-world pets or standalone illustrations.
---

# Create a Drora pet

Produce a loadable v2 pet, preserving the user's character, style, references and
upgrade source. Use the licensed hatch-pet processing helpers in this skill;
do not replace them with a dimension-only checker or procedural placeholder art.
The scripts process generated pixels; they do not generate a character.

## Prepare

- Resolve `SKILL_DIR` from this loaded skill's path. Verify the scripts and
  references listed in [pipeline.md](references/pipeline.md) are present.
- Find a Python interpreter that can `import PIL`. Use its exact executable path
  for every helper. Do not assume a Codex dependency loader, system `python3`,
  shell syntax, or package installer is available. If Pillow is missing, explain
  the dependency before starting generation; do not silently install software.
- Discover the current enabled image-generation/editing tools and skills. Prefer
  a dedicated image-generation skill if present; otherwise use an enabled tool
  with its actual schema. Never invent an API, tool name or credential. If none
  is available, report the missing capability and retain the request/run files.
- Use the exact local `pets` destination provided by the desktop creation draft.
  For a plain chat request, obtain the configured local Drora data directory
  rather than guessing from a remote HOME. A remote session that cannot access
  this destination must move the work to a local task. Never save into `.codex`.
- Create a separate run folder outside the library. Preserve source art and
  existing pets. Infer a short name/description from a clear concept; ask only
  when missing information would materially change the pet. For a bare brand
  request, research a few official visual cues with an available web tool, or
  ask for references. Do not invent brand facts or copy logos/text.

Keep progress visible: prepare the brief, establish the main look, generate the
motion/direction poses, then validate and publish. Mark steps complete when their
artifacts exist. A detailed user request can proceed without another interview.

## Generate and assemble

Read [pipeline.md](references/pipeline.md) for executable commands and the report
contract, and [animation-rows.md](references/animation-rows.md) for exact row
counts, timing and direction meanings. Use the prepared job manifest as the
dependency graph, not as evidence that a generation succeeded.

1. Run `prepare_pet_run.py` with the brief, references and explicit run directory.
   Read `pet_request.json` and `imagegen-jobs.json`. Generated prompts and layout
   guides are inputs for the real image tool. Job metadata's
   `enabled-image-generation-tool` is a capability label, not a callable tool.
2. Generate the canonical base first. Ground every later generation in that base
   and the identity-defining references. Copy each selected real output into its
   job's `output_path` before recording completion. Preserve generation sources.
3. Generate nine standard motion strips with distinct poses. `running` means
   focused task work; `running-left/right` mean directional drag movement.
   `jumping` must visibly rise; idle stays calm but has real microvariation.
   Mirror a rightward row only after reviewing that markings/props permit it;
   preserve frame order. No detached effects, ground shadows, labels or guides.
4. Extract connected poses using shared scale/baseline, inspect each row, compose
   the intermediate 8×9 atlas and inspect contact/motion previews. Do not slice
   an arbitrary generated strip into assumed equal slots or independently fit
   every pose. Reuse approved v1 rows when upgrading, after validating them.
5. Establish four cardinal anchors (north, right, down, left), then generate one
   coherent eight-pose look row 9. Register/review it before generating row 10;
   row 10 uses the approved cardinal anchors and row 9 as references. North is
   `000`; front/neutral is separate. Keep 22.5° steps and one shared transform.
6. Assemble v2, run chroma despill once, and validate the exact cleaned final
   WebP. Render final contact, motion, labeled direction and continuity previews.
   Inspect them at pet size against light/dark backgrounds. Repair a complete
   failed look row rather than splicing an unrelated generated cell into it.

Use another permitted visual reviewer when available; otherwise inspect the
rendered artifacts directly. Never fabricate another reviewer's approval. The
copied blind-review helpers can add independent evidence when isolated reviewers
are available; do not send the answer key to them. Record direction meaning,
identity, clipping, readable motion and accepted warnings. Deterministic checks
do not prove semantic correctness. If a repair repeatedly moves the same defect
between cells, change the extraction/anchor strategy before regenerating again.

## Publish

Create the hash-bound review records described in `pipeline.md` only after
actually inspecting the exact final atlas/previews. Run `publish_pet.py` with
the explicit run directory and desktop library root. It revalidates the image,
checks reports and approval hash, reserves a unique new folder, writes the image
and then `pet.json`, and emits an idempotent receipt. Do not write app settings
or bypass a failed publisher by manually copying a rejected atlas into `pets`.

Return the pet ID, manifest and image paths plus links to contact/motion previews.
Tell the user to refresh/select it in Settings > Desktop pet. Claim publication
only after the publisher succeeds; claim activation only after an actual app
selection is verified. Missing generation tools, failed visual QA or cancellation
must leave existing pets intact and useful run artifacts available for resuming.

The original helpers/references and license are documented in `provenance.json`.
Drora's invocation, destination and publishing rules in this skill supersede the
Codex-specific storage/tool guidance in copied reference material.
