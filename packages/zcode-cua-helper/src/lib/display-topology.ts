export function displayTopologyFingerprint(displays) {
  return [...displays]
    .sort((left, right) => left.id - right.id)
    .map(
      ({ id, bounds, main, scale_factor }) =>
        `${id}:${bounds.join(",")}:${main ? 1 : 0}:${scale_factor}`,
    )
    .join("|");
}
