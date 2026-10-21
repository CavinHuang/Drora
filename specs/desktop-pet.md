# Desktop pet

The current product and protocol contract is [Codex desktop pet compatibility](desktop-pet-codex-parity.md).
Verification and platform limits are tracked in [the coverage matrix](../docs/testing/desktop-pet-parity-coverage.md).

All pets, including Violet, Noir, Snow and Ginger, use standard Codex manifests,
1536×1872 v1 / 1536×2288 v2 atlases, and the same nine animation tracks.
The original per-character geometry, CSS playback and separate atlas adapters
have been removed. Saved built-in IDs remain valid.

Canonical built-in packs: `packages/desktop/assets/desktop-pets/`.
Rebuild with `pnpm --filter @drora/desktop pets:generate` using the pinned toolchain.
Original authored pose sources remain under `assets/desktop-pet/` and
`assets/desktop-pet-catgirls/` as generator inputs only.
