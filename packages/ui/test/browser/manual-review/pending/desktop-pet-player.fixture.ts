import { createDesktopPetPlayer } from "../../../../../desktop/src/preload/desktopPetPlayer.js";
import { codexPetTracks } from "../../../../../desktop/src/shared/desktopPetAnimation.js";
import type { DesktopPetConfiguration } from "@drora/shared";

/** Delay one failed decode until the next real browser decode has succeeded. */
export async function exercisePetPlayerDecodeRace() {
  const OriginalImage = window.Image;
  let rejectOld: (error: Error) => void = () => {};
  let calls = 0;
  class OrderedImage extends OriginalImage {
    override decode(): Promise<void> {
      if (calls++ === 0)
        return new Promise((_resolve, reject) => {
          rejectOld = reject;
        });
      return super.decode();
    }
  }
  const art = document.createElement("div");
  const player = createDesktopPetPlayer(art, () => {});
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 11;
  canvas.getContext("2d")!.fillRect(0, 0, 8, 11);
  const configuration: DesktopPetConfiguration = {
    id: "custom:older",
    image: canvas.toDataURL(),
    columns: 8,
    rows: 11,
    width: 112,
    height: 122,
    badgeCorner: "top-end",
    spriteVersionNumber: 2,
    tracks: codexPetTracks(),
  };
  try {
    window.Image = OrderedImage;
    const older = player.configure(configuration);
    const applied = await player.configure({ ...configuration, id: "custom:newer" });
    rejectOld(new Error("Deliberately delayed decode failure"));
    const obsolete = await older;
    return { applied, obsolete, id: art.dataset.petId, interactive: player.hit({ x: 64, y: 70 }) };
  } finally {
    window.Image = OriginalImage;
    player.dispose();
  }
}
