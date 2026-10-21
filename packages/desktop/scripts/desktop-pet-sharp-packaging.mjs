/** Main's pet decoder needs Sharp even when computer-use plugins are disabled. */
export function createDesktopPetSharpPackaging(targetPlatformKey, optionalDependencies) {
  const nativeNames = Object.keys(optionalDependencies).filter((name) =>
    name.startsWith("@img/sharp-"),
  );
  const required = [`@img/sharp-${targetPlatformKey}`];
  if (!targetPlatformKey.startsWith("win32-"))
    required.push(`@img/sharp-libvips-${targetPlatformKey}`);
  for (const name of required) {
    if (!nativeNames.includes(name))
      throw new Error(`Sharp does not provide target package ${name}`);
  }
  const accepts = (name) => !name.startsWith("@img/sharp-") || required.includes(name);
  return {
    prunePatterns: nativeNames
      .filter((name) => !accepts(name))
      .map((name) => `!node_modules/${name}/**`),
    unpackPatterns: required.map((name) => `node_modules/${name}/**`),
    filterRuntimeModules(entries) {
      const selected = entries.filter((entry) => accepts(entry.moduleName));
      // 跨平台安装会同时存在多套 @img 包；只保留目标闭包，并在缺少实际 native 时提前阻止出包。
      for (const name of ["sharp", ...required]) {
        if (!selected.some((entry) => entry.moduleName === name && entry.sourceModulePath))
          throw new Error(`Pet decoder runtime is missing ${name}`);
      }
      return selected;
    },
  };
}
