# Desktop pet (first release)

## Product rules

- The first pet is a small purple cat-like character with transparent-background raster frames. Status is conveyed by complete pose sequences, per-frame timing and a separate small indicator. Keep artwork in a new Drora-owned desktop-pet asset directory, separate from restored upstream assets.
- The original seven illustrations are expression key poses, not a production animation pack. A single shared blink with static state portraits is too sparse: each visible mode needs its own action row with consistent silhouette, scale, baseline and character identity.
- The artwork generator derives a transparent WebP atlas and embedded data-URL module so the isolated pet document loads without a runtime file path or network request. Rows and durations are declared once in a Drora-owned animation manifest; the renderer must not hard-code a second frame table.
- `prefers-reduced-motion` freezes the representative pose declared for each row (the final happy pose for completion). State changes restart the corresponding action; presentation mode remains derived from task facts rather than owned by the animation player.

## Motion design

Codex's published [animation row contract](https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/references/animation-rows.md) uses an 8-column atlas, 6–8 frames for most named actions, and individual frame holds. Its [QA rubric](https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/references/qa-rubric.md) rejects obvious loop pops, baseline/scale jumps, and rows made from copies of one pose. Drora follows these motion principles for its five task modes, without copying Codex's atlas geometry or unrelated locomotion actions.

The production atlas now contains five action rows and 32 playback cells. Its seven original expression masters and 24 additional transparent poses provide 31 unique drawings; the idle blink deliberately reuses the half-closed pose on its return. `assets/desktop-pet/motion-manifest.json` owns pose order, individual frame holds, playback type and reduced-motion stills. The artwork generator normalizes pose scale and foot baseline before embedding the atlas in the isolated pet document.

| Drora mode | Action                           | Target frame cells | Playback                              |
| ---------- | -------------------------------- | -----------------: | ------------------------------------- |
| idle       | subtle breath, blink, settle     |                  7 | calm loop with a longer open-eye hold |
| working    | focused paw/ear movement         |                  6 | short, low-distraction loop           |
| attention  | expectant glance or raised paw   |                  6 | readable waiting loop                 |
| completed  | crouch, lift, apex, land, settle |                  5 | brief celebratory cue                 |
| error      | droop, look around, recover      |                  8 | brief readable failed cue             |

Every used atlas cell must contain a distinct or deliberately returning pose, preserve transparency and fit the cell. Review each row as a playing preview at 96px on light and dark backgrounds; count alone is not acceptance. Reject opaque backgrounds, frame-to-frame silhouette drift, unwanted changes in apparent size, and static rows padded with duplicate cells.

- Desktop only. A single small, movable pet window shows the selected workspace's live task state. Web and mobile have no pet window.
- The pet is a presentation of `sessions-index`, never an owner of task or interaction state. Priority: pending interaction, active work, recent terminal transition, idle. `prewarming`, `running`, or `hasBackgroundWork` means active work. A pending interaction is indicated by the session summary's interaction ID/count.
- Initial subscription establishes a baseline. Historical completed/failed tasks do not trigger a terminal animation. A later terminal transition may play briefly, then return to the live aggregate state. Pending interactions are reflected from the live session summary and its current counts.
- The pet is one app-level presentation sourced from the most recently focused main window. Each window publishes a bounded, validated presentation snapshot for its active workspace. Main selects the source and routes it; it does not accept task commands or persist a task index.
- Clicking the pet opens the represented task in the source window, using workspace identity/path, remote session ID and session ID. It never approves a permission or supplies a user answer. If the source or task is gone, clicking only opens the source window.
- The pet is enabled by an explicit desktop setting, default off for existing installations. The user can show/hide it in Settings. Position is device-local; when the saved display disappears, clamp to the primary display work area.
- The pet is an auxiliary window and is excluded from main-application window discovery, tray/window activation and settings broadcasts.
- The compact window must not obstruct most of the screen. Motion respects `prefers-reduced-motion`. It stays below CUA permission/operation safety overlays. Do not show task content, prompts, paths or secrets in the pet.

## Ownership and event order

```text
CLI/runtime task facts -> window Host sessions-index -> main Renderer projection
  -> validated IPC -> Main pet window presentation -> click IPC
  -> source main Renderer navigation
```

The CLI/runtime remains the task state owner. The main Renderer owns only a derived presentation and transition baseline. Main owns the native pet window, display position and last-focused source-window routing. A renderer reload clears its old presentation; a new sessions-index baseline restores it. Main rejects messages from the pet window and destroyed/non-main senders. No pet events enter `CommandInbox` or the mobile replayable delivery path.

## Acceptance cases

1. Enable the setting, start a task: one pet appears and displays active motion; stop the task: it returns to idle after the terminal cue.
2. Open with a previously completed task: no terminal cue plays.
3. Receive sequential pending interactions on the same task: the pet reflects the current pending count; clicking opens the correct task and does not answer either interaction.
4. Switch workspace/window while another task runs: the pet reflects the latest focused main window; stale messages from a prior source do not take over.
5. Reload the renderer or lose the runtime: no orphan running state remains. Fresh subscription recovers the live presentation.
6. With identical paths but different `workspaceIdentity`, click navigation selects the identity carried in the pet target.
7. Drag the pet, restart, and remove its display: position restores or clamps into a visible work area.
8. Disable the setting: the pet closes immediately. Web/mobile behavior and existing native task notifications remain unchanged.
9. At 96px, all five modes play their own row with the frame counts above. Pose order and individual frame holds read clearly without loop popping or baseline jumps; reduced-motion preference shows a stable representative pose for each mode.

## Upstream boundary

Keep pet projection, native window, rendering, artwork and tests in new files. Existing shell, preload, platform and settings files receive only the minimum registration hooks. Do not add pet logic to restored upstream sections or make restored files import the pet module. The feature is a deliberate Drora-only extension.
