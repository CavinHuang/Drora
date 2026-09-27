type ResolvedSkinTheme = "light" | "dark";

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function luminance(rgb: readonly number[]): number {
  const linear = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrast(first: readonly number[], second: readonly number[]): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function resolveCustomBrandColor(color: string, theme: ResolvedSkinTheme): string {
  const source = channels(color);
  const background = channels(theme === "dark" ? "#161616" : "#f8f8f8");
  if (contrast(source, background) >= 4.5) return color.toLowerCase();
  const target = theme === "dark" ? 255 : 0;
  let lower = 0;
  let upper = 1;
  let result = source;
  for (let step = 0; step < 20; step += 1) {
    const factor = (lower + upper) / 2;
    const candidate = source.map((value) => Math.round(value + (target - value) * factor)) as [
      number,
      number,
      number,
    ];
    if (contrast(candidate, background) >= 4.5) {
      upper = factor;
      result = candidate;
    } else {
      lower = factor;
    }
  }
  return toHex(result);
}
