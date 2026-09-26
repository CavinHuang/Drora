# Violet cat movement poses

These 24 transparent PNGs are production sources for `../motion-manifest.json`. The seven expression masters in the parent directory supply the other poses. Generate the 32-cell atlas with `node scripts/generate-desktop-pet-art.mjs` from `packages/desktop`.

Each imagegen edit kept the same purple cat identity, palette, clean contour and transparent background. Prompts changed the body or facial pose for a single beat while retaining a centered, full-body view: breathing and ear twitch for idle; alternating paw movement and thought/rest for working; raised paws, forward lean and soft blink for attention; crouch, lift, apex and landing for completion; and startle, side glances, wince, droop, bow and recovery for error. The generator trims transparent padding, applies a common scale based on the original master and anchors feet at one baseline. The completion lift and apex have explicit vertical offsets in the manifest.

The half-blink master is deliberately reused once as the blink returns in the idle row. Other frames use distinct PNG sources. An early multi-pose contact sheet was rejected because its opaque background could not be used in the atlas. Early `idle-exhale` and `attention-lean` edits were replaced after 96px review because their apparent size and silhouette drifted.
