export function resolveChromedriverBuild(options: {
  chromiumVersion: string;
  platform: string;
}): Promise<string>;

export function prepareChromedriver(options: {
  cacheDir: string;
  electronVersion: string;
  platform: string;
}): Promise<{
  electronVersion: string;
  chromiumVersion: string;
  driverVersion: string;
  platform: string;
  executablePath: string;
}>;

export function cachedChromedriverPath(options: {
  cacheDir: string;
  electronVersion: string;
  platform: string;
}): Promise<string>;
