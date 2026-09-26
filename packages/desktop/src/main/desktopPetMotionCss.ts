import { desktopPetMotion } from "./desktopPetArtwork.js";

const displayCellSize = 96;
const columns = 8;

function position(column: number, row: number): string {
  return `${-column * displayCellSize}px ${-row * displayCellSize}px`;
}

/** Turn the generated atlas manifest into one CSS animation per presentation mode. */
export function desktopPetMotionCss(): string {
  return desktopPetMotion
    .map((track, row) => {
      const total = track.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
      const stops = [`0%{background-position:${position(0, row)}}`];
      let elapsed = 0;
      for (const [column, frame] of track.frames.entries()) {
        elapsed += frame.durationMs;
        const next =
          column + 1 < track.frames.length ? column + 1 : track.playback === "loop" ? 0 : column;
        stops.push(
          `${((elapsed / total) * 100).toFixed(4)}%{background-position:${position(next, row)}}`,
        );
      }
      const repeat = track.playback === "loop" ? "infinite" : "1 forwards";
      return `#pet[data-mode=${track.mode}] #pet-art{background-position:${position(track.stillFrame, row)};animation:pet-${track.mode} ${total}ms steps(1,end) ${repeat}}\n@keyframes pet-${track.mode}{${stops.join("")}}`;
    })
    .join("\n");
}

export const desktopPetBackgroundSize = `${columns * displayCellSize}px ${desktopPetMotion.length * displayCellSize}px`;
