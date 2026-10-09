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

- Desktop only. A small movable pet window shows the selected workspace's live task state. Web and mobile have no pet window. Pressing and dragging the visible pet moves it; a short movement threshold preserves ordinary click-to-open. The native drag handle above the sprite remains an alternate way to move it.
- The pet is a presentation of `sessions-index`, never an owner of task or interaction state. Priority: pending interaction, active work, recent terminal transition, idle. `prewarming`, `running`, or `hasBackgroundWork` means active work. A pending interaction is indicated by the session summary's interaction ID/count.
- Initial subscription establishes a baseline. Historical completed/failed tasks do not trigger a terminal animation. A later terminal transition may play briefly, then return to the live aggregate state. Pending interactions are reflected from the live session summary and its current counts.
- The pet is one app-level presentation sourced from the most recently focused main window. Each window publishes a bounded, validated presentation snapshot for its active workspace. Main selects the source and routes it; it does not accept task commands or persist a task index.
- Clicking the pet opens the represented task in the source window, using workspace identity/path, remote session ID and session ID. It never approves a permission or supplies a user answer. If the source or task is gone, clicking only opens the source window.
- The pet is enabled by an explicit desktop setting, default off for existing installations. The user can show/hide it in Settings. Position is device-local; when the saved display disappears, clamp to the primary display work area.
- The pet is an auxiliary window and is excluded from main-application window discovery, tray/window activation and settings broadcasts.
- A separate, mouse-transparent companion bubble follows the pet while work, attention or a recent terminal cue is visible. It shows a localized state label and, where available, the selected task's existing bounded `lastAssistantPreview` from `sessions-index` (at most 120 characters); never route user prompts, pending interaction payloads or tool output into it. Text is assigned as text, never HTML. The bubble sits above the pet, horizontally centered on it; its visual width shrinks with content up to a 260px max (small type, bounded 4-line preview). It is clamped into the current display's work area and hides for idle or disabled state. It receives no pointer input; clicking the pet still opens the task. Because the preview can contain assistant-authored task content, the bubble exists only when the user has explicitly enabled the desktop pet.
- The compact pet and bubble must not obstruct most of the screen. Motion respects `prefers-reduced-motion`. Both stay below CUA permission/operation safety overlays.

## Ownership and event order

```text
CLI/runtime task facts -> window Host sessions-index -> main Renderer projection
  -> validated IPC -> Main pet/bubble presentation -> click IPC
  -> source main Renderer navigation

Pet pointer down/move/up -> pet preload -> validated pet-only IPC
  -> Main window position (screen DIP) -> device-local persistence
```

The CLI/runtime remains the task state owner. The main Renderer owns only a derived presentation and transition baseline. Main owns the native pet/bubble windows, display position and last-focused source-window routing. A renderer reload clears its old presentation; a new sessions-index baseline restores it. Main accepts pointer drag commands only from the current pet webContents and rejects task presentations from the pet/bubble or destroyed/non-main senders. Drag end clamps the pet into the current display work area; native move events and programmatic drag updates share one delayed position write. No pet events enter `CommandInbox` or the mobile replayable delivery path.

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
10. Press and drag the visible sprite across a display (including mixed-scale or multi-display layouts): the native window follows the pointer, then saves a visible position. A short click still opens the selected task and does not start a drag. The top handle remains draggable.
11. During active work, the bubble shows the state and bounded assistant preview; for a pending interaction it prominently says that user action is needed. Completion/error cues update it, and returning to idle hides it. The bubble follows the pet without intercepting clicks or clipping at display edges; switching source windows cannot leave stale text behind.
12. A task presentation published while the pet or bubble document is still loading appears as soon as that document is ready, even when no second sessions-index update arrives.

## Upstream boundary

Keep pet projection, native window, rendering, artwork and tests in new files. Existing shell, preload, platform and settings files receive only the minimum registration hooks. Do not add pet logic to restored upstream sections or make restored files import the pet module. The feature is a deliberate Drora-only extension.

## Catgirl characters (second release)

三只猫娘角色（夜墨 noir / 雪铃 snow / 杏桃 ginger）以可选角色并入同一宠物窗口与设置面：

- 资产来源为 codex worktree 的 v5 全套动画（每角色 11 动作 × 8 帧，320×640 透明帧、4×2 精灵图）。入库物 = `assets/desktop-pet-catgirls/`（33 张 WEBP atlas + 轻量 manifest.json）；QA/预览/提示词留在产出侧不入仓。
- `scripts/generate-desktop-pet-catgirl-art.mjs` 按角色合成单张 8 列图集（96×192 显示格）并生成 `desktopPetCatgirlArtwork.ts` 数据模块；运行链与 violet 管线同构（CSS steps 游标、data URL 内嵌、`prefers-reduced-motion` 冻结）。
- 任务态→动作映射沿用 TASK-STATES.md：idle/working/attention/error 直连，completed 播 happy 一遍（once）后停在末帧；blink/talk/wave/think/sleep/walk 为附加动作数据，待 v4 快照级解析器接入（本轮不接业务状态面）。
- `desktopPetCharacter` 设置键（violet|noir|snow|ginger，缺省 violet）；切换在主进程原位重建宠物窗口，窗口尺寸随角色（紫猫 112×128，猫娘 112×224）。设置页"宠物角色"选择器与 desktop 侧 id 列表对齐，UI 包不反向依赖 desktop。
