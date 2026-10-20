let bootstrapModulePromise;
export const loadBootstrapModule = () => {
    bootstrapModulePromise ??= import("@drora/bootstrap");
    return bootstrapModulePromise;
};
