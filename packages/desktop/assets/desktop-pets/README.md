# Standard Codex built-in packs

Every character folder contains a standard `pet.json` and `spritesheet.webp`.
The v1 atlas is 1536×1872, 8 columns × 9 rows, 192×208 per cell. Required frame
counts: 6, 8, 8, 4, 5, 8, 6, 6, 6; other cells are transparent. There are no
character-specific runtime FPS, row mappings or dimensions.

Rebuild with the pinned Node/pnpm toolchain:

```sh
pnpm --filter @drora/desktop pets:generate
```

The generator mechanically repacks existing authored frames and embeds these
packs for portable installation. It preserves character proportions inside each
cell. Source pose mapping and migration rules are in
`specs/desktop-pet-codex-parity.md`. Original artwork does not contain 16 authored
look poses and accurately declares v1; imported v2 atlases retain their look rows.

Built-in IDs stay stable for existing settings. Export any built-in from settings
to obtain a normal pack that can be imported by a Codex-compatible loader.
