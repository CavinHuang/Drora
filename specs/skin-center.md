# Skin center

## Scope and ownership

Drora offers a device-local skin preference in Appearance. The existing theme choice remains the sole owner of light, dark and system mode. A skin adds a palette preset, an optional user image, image positioning and workspace panel background opacity. It does not alter task, workspace or Agent state.

The UI store owns the accepted skin preference and broadcasts complete preference snapshots to other windows. Local storage holds only the small, versioned preference. A separate local image store holds one imported raster image per browser profile. No image bytes enter broadcasts, AppSettings, workspace settings, logs or remote sessions. A remote workspace displays the local device's skin.

## Product rules

- Presets: Default, Ocean, Forest and Plum. Default preserves the current visual design. Presets provide optional accent color and a subtle decorative background. Theme mode still controls light/dark semantic foundations and native title bar.
- The user may import PNG, JPEG or WebP up to 8 MiB. Validate MIME, signature and successful decode before saving. An image import commits the preference only after bytes are saved. Invalid or failed imports keep the previous skin.
- The chosen image is local to this device/browser profile. Clearing it restores the preset background. If its stored bytes are unavailable on restore, render the preset background and keep controls usable.
- Image fit is cover. Position is a percentage pair and starts at center. One opacity slider controls the workspace conversation, sidebar and side pane shell backgrounds, 80–100%, default 100%. Text, borders, cards, overlays, browser guest content and terminal canvas remain opaque/readable. The terminal outer frame may use panel opacity, but xterm keeps its own opaque theme.
- The wallpaper is painted within the workspace window frame, beneath workspace panels. It does not appear in settings, share pages, onboarding or the operating system desktop.
- Applying a preset or changing opacity is immediate. Reset returns to Default with 100% panel opacity and no image; it does not change light/dark theme mode.
- System theme changes keep the selected skin while reevaluating its light/dark palette.
- Windows, macOS and Linux retain their existing window frame and native title bar behavior. Mobile Web uses the same preference but may show an opaque panel for readability.

## Event order

```text
user action → validate preference or decode image → write image bytes if changed
            → UI store commit → persist versioned metadata → apply CSS projection
                              → broadcast metadata → other windows reread image
```

The UI store is the only owner of accepted skin metadata. Preview controls may hold local draft values, but do not create a second persisted truth. Image load uses a monotonically increasing request generation: a late read cannot replace a more recent skin. Removing an image revokes its object URL. Broadcast receivers validate metadata before applying it and do not rebroadcast.

## Failure semantics and migration

A missing or malformed preference falls back to Default. Unknown preset IDs and out-of-range opacity/position values normalize to supported values. Existing `drora-theme` values are unchanged. The new metadata key is versioned. Image store failures surface a user-facing error and preserve the previous accepted preference. Image bytes are not copied to or fetched from a remote Host.

## Acceptance scenarios

1. Fresh profile: original theme appearance, no image, opacity 100%.
2. Select each preset under Zai Light, Zai Dark and System; semantic text and status colors remain legible.
3. Import valid image, restart app and open another Desktop window: same background and settings are restored.
4. Invalid, oversized or undecodable image: clear error, no preference change.
5. Rapidly select two images: only the final selection is visible after asynchronous reads finish.
6. Move opacity slider: workspace panel background changes; text/buttons/terminal canvas and settings page do not fade.
7. Clear image and reset skin: preset background and defaults return; light/dark mode is retained.
8. Open a remote workspace and mobile Web: no remote asset request; local fallback works when image bytes are missing.
9. Windows, macOS and Linux desktop frames retain radius, drag regions and title bar behavior.
