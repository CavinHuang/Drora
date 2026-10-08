export function createElectronDisplayTopology(source) {
  const topology = () => {
    const displays = source.getAllDisplays();
    const primaryId = source.getPrimaryDisplay().id;
    return {
      displays: [
        ...displays.filter((display) => display.id === primaryId),
        ...displays.filter((display) => display.id !== primaryId),
      ],
      primaryId,
    };
  };
  return { topology };
}
