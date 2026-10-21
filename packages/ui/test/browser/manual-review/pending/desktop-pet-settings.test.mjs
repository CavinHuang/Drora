import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import sharp from "sharp";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/desktop-pet-settings.fixture.tsx";
const artifacts = join(tmpdir(), `drora-pet-settings-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
const server = await createServer({
  root,
  configFile: false,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "desktop-pet-settings-fixture",
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith("/fixture?")) return next();
          response.setHeader("Content-Type", "text/html");
          response.end(
            await vite.transformIndexHtml(
              request.url,
              `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
            ),
          );
        });
      },
    },
  ],
  resolve: { alias: { "@": `${root}packages/ui/src` } },
  optimizeDeps: { entries: [entry.slice(1)] },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
// 首次优化依赖可能超过页面导航时限；等待真实模块准备完成，不以固定延时掩盖启动时序。
await server.warmupRequest(entry);
await server.waitForRequestsIdle();
const executablePath = [
  process.env.CHROME_EXECUTABLE_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((path) => path && existsSync(path));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const reports = [];
const previewImage = `data:image/png;base64,${(
  await sharp({ create: { width: 1536, height: 2288, channels: 4, background: "#0000" } })
    .composite([
      {
        input: Buffer.from(
          '<svg width="192" height="208" xmlns="http://www.w3.org/2000/svg"><ellipse cx="96" cy="112" rx="65" ry="70" fill="#72a8cb"/></svg>',
        ),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer()
).toString("base64")}`;
try {
  for (const [width, locale, theme] of [
    [390, "zh-CN", "light"],
    [1100, "en-US", "dark"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const requests = [];
    const catalog = {
      directoryPath: "C:/fixture/Drora/pets",
      pets: [
        {
          id: "custom:fixture",
          displayName: "Fixture custom",
          spriteVersionNumber: 2,
          description: null,
          updatedAt: 1,
        },
        {
          id: "custom:legacy",
          displayName: "Legacy custom",
          spriteVersionNumber: 1,
          description: null,
          updatedAt: 0,
        },
      ],
      errors: [],
    };
    await page.route("**/pet-library", async (route) => {
      const request = route.request().postDataJSON();
      requests.push(request);
      const result =
        request.action === "preview"
          ? {
              ...catalog,
              preview: {
                id: request.id,
                image: previewImage,
                columns: 8,
                rows: 11,
                width: 112,
                height: 122,
              },
            }
          : request.action === "prepare-upgrade"
            ? {
                ...catalog,
                upgrade: { id: request.id, directoryPath: "C:/fixture/Drora/avatars/legacy" },
              }
            : catalog;
      await route.fulfill({ json: result });
    });
    try {
      await page.goto(
        `${server.resolvedUrls.local[0]}fixture?${new URLSearchParams({ locale, theme })}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.getByTestId("desktop-pet-enabled").waitFor();
      await page.getByTestId("desktop-pet-export").click();
      assert.ok(requests.some((request) => request.action === "export" && request.id === "violet"));
      await page.getByTestId("desktop-pet-enabled").click();
      await page.getByTestId("desktop-pet-character").click();
      await page.getByRole("option", { name: "Fixture custom" }).click();
      let state = JSON.parse(await page.getByTestId("pet-settings-state").textContent());
      assert.equal(state.enabled, true);
      assert.equal(state.character, "custom:fixture");
      assert.equal(await page.getByTestId("desktop-pet-upgrade").count(), 0);
      await page.getByTestId("desktop-pet-preview").waitFor();
      await page.getByTestId("desktop-pet-size").focus();
      await page.keyboard.press("End");
      state = JSON.parse(await page.getByTestId("pet-settings-state").textContent());
      assert.equal(state.size, 224);
      await page.getByTestId("desktop-pet-refresh").click();
      await page.getByTestId("desktop-pet-create").click();
      assert.match(await page.getByTestId("pet-created-prompt").textContent(), /\$create-pet/);
      assert.match(await page.getByTestId("pet-created-prompt").textContent(), /1536×2288/);
      assert.match(
        await page.getByTestId("pet-created-prompt").textContent(),
        /C:\/fixture\/Drora\/pets/,
      );
      assert.ok(requests.some((request) => request.action === "refresh"));
      await page.getByTestId("desktop-pet-character").click();
      await page.getByRole("option", { name: "Legacy custom" }).click();
      await page.getByTestId("desktop-pet-upgrade").click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="pet-created-prompt"]')
          ?.textContent.includes("avatars/legacy"),
      );
      const upgradePrompt = await page.getByTestId("pet-created-prompt").textContent();
      assert.match(upgradePrompt, /\$create-pet/);
      assert.match(upgradePrompt, /1536×2288/);
      assert.match(upgradePrompt, /Never overwrite existing pets/);
      assert.ok(
        requests.some(
          (request) => request.action === "prepare-upgrade" && request.id === "custom:legacy",
        ),
      );
      const race = await page.evaluate(async () => {
        const { exercisePetPlayerDecodeRace } =
          await import("/packages/ui/test/browser/manual-review/pending/desktop-pet-player.fixture.ts");
        return exercisePetPlayerDecodeRace();
      });
      assert.deepEqual(race, {
        applied: true,
        obsolete: false,
        id: "custom:newer",
        interactive: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: join(artifacts, `${width}-${locale}-${theme}.png`),
        fullPage: true,
      });
      reports.push({ width, locale, theme, passed: true });
      console.log(`PASS pet settings ${width}/${locale}/${theme}`);
    } catch (error) {
      await page.screenshot({ path: join(artifacts, `${width}-failure.png`), fullPage: true });
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await writeFile(join(artifacts, "report.json"), JSON.stringify(reports, null, 2));
  await browser.close();
  await server.close();
  console.log(`Artifacts: ${artifacts}`);
}
