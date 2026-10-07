# Violet cat artwork

Generated with the built-in imagegen tool. The transparent PNG files are the editable source poses. `motion-manifest.json` declares the five rows, their frame order, individual durations and playback. Run `node scripts/generate-desktop-pet-art.mjs` from `packages/desktop` to refresh the 8-column, 5-row WebP atlas and embedded runtime module. The atlas has 32 playback cells and 31 unique drawings; one idle half-blink pose intentionally appears twice.

The seven root PNGs are expression masters: open eye, half blink, closed blink, focused working, surprised attention, happy completion and concerned error. Their edits preserved the original silhouette, position, scale, color, shading and transparent alpha, with no prop or background. The edit prompts asked respectively for half-height eyes, curved closed eyes, narrowed focused eyes and straight mouth, wide attentive eyes and round mouth, joyful closed eyes and open smile, and worried brows and downturned mouth. Additional movement poses and their edit constraints are documented in `poses/README.md`.

```text
Use case: stylized-concept
Asset type: production desktop pet character master artwork for a 96 x 96 pixel floating Electron window
Primary request: create the first original Drora desktop pet, a tiny friendly purple cat-like creature. Keep the recognizable concept of a round plump lilac body with two short rounded triangular ears, two dark oval eyes, a tiny curved smile, soft pink cheek dots, and very small tucked paws. One character only.
Style/medium: polished clean 2D game sprite / vector-like digital illustration with crisp dark-purple contour, restrained soft shading, excellent silhouette at tiny size. Calm and charming, not overly decorative.
Composition/framing: centered front-facing full character, symmetrical, entire ears and feet visible, character occupies about 82% of square canvas, generous transparent breathing room, no cropped elements.
Color palette: lilac and medium violet with dark plum outline and subtle blush. Keep high contrast in both light and dark desktop themes.
Background: truly transparent alpha background, no scene, no opaque white matte, no floor, no cast shadow outside the character.
Constraints: a single standalone raster PNG asset with real transparency; no text, no logo, no watermark, no badge, no UI, no border, no additional props or characters. Facial details should remain legible when downscaled to 96 pixels.
```
