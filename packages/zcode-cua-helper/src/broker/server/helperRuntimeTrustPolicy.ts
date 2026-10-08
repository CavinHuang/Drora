var COMPILED_LOCAL_DEVELOPMENT_RUNTIME =
  typeof __ZCODE_LOCAL_DEVELOPMENT_RUNTIME__ !== "undefined"
    ? __ZCODE_LOCAL_DEVELOPMENT_RUNTIME__
    : process.env.NODE_ENV !== "production";
export function isCuaLocalDevelopmentRuntime(
  env = process.env,
  compiledLocalDevelopmentRuntime = COMPILED_LOCAL_DEVELOPMENT_RUNTIME,
) {
  return (
    compiledLocalDevelopmentRuntime && env.ZCODE_RUNTIME_ENV?.trim().toLowerCase() !== "production"
  );
}
