# Skin center removal

## Decision

The optional skin center and its bundled wallpapers are withdrawn. Appearance returns to the existing light, dark and system theme choices. Workspace, sidebar, side pane and draft composer use their ordinary theme surfaces; no wallpaper, skin accent, image-color tint or panel-opacity control is applied.

## Ownership and boundary

Theme mode remains owned by the existing theme preference and continues to control the native title bar. Remove the skin UI, store field, local-window and same-origin synchronization, CSS projection, cross-package storage keys, image store and bundled assets. No replacement skin state or service is introduced. Previously saved `drora-skin-v1` and `drora-skin-v2` metadata and imported image bytes become inert local data; this removal does not migrate them into theme settings or send them to a server.

## Acceptance

1. Appearance shows only the pre-skin theme controls, with no skin center or wallpaper import.
2. Existing profiles with saved skin data render the same workspace colors and opacity as a fresh profile using the same theme mode.
3. Desktop and Web builds have no reference to skin assets or skin synchronization, and existing theme changes still work.
4. Removing the feature does not change task, workspace, Agent or remote-control behavior.
