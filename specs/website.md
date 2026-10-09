# Product website (GitHub Pages)

## Product rules

- The Drora product website is a fully static multi-page site under `website/`: `index.html` (home), `changelog/index.html` (release notes) and `docs/index.html` (documentation). Pages share `assets/css/style.css` and `assets/js/main.js`; each page duplicates the header/footer markup because there is no build step. All cross-page links are relative (`changelog/`, `docs/`, `../`). The site is physically isolated from restored upstream code and from all workspace packages: no package imports it, it imports no package, and it is excluded from workspace lint/format tooling. It ships plain HTML + CSS + vanilla JS with zero build step and zero runtime dependencies.
- The visual design intentionally follows the official ZCode marketing site (https://zcode.z.ai/): dark theme (`#161616` background, `rgba(255,255,255,0.1)` borders), Geist-style system font stack, and a five-section home layout — fixed header, hero with a live DOM app-window mock, three-edition cards (mirroring the pricing card anatomy), three capability cards, download section, footer. Copy and branding are Drora's own and must follow `specs/drora-rename.md`; the site must never claim to be the official ZCode product.
- The changelog page replicates the reference site's release page layout: centered page title + subtitle, then one section per release — version pill, "发布于 <date>" line, a 下载 button linking to that release's GitHub tag page, an "Release vX.Y.Z" heading, feature/fix groups as heading + bullet list, separated by hairlines. Release content is curated from the fork's actual git history and release assets (never invented): each bullet must correspond to a real merged change or shipped artifact. New releases are added by hand as static sections; the page does not fetch anything.
- The docs page replicates the reference site's docs layout: three columns — sticky left sidebar with grouped anchor navigation, centered content column, sticky right "本页目录" (On this page) list with scrollspy highlighting. Docs content describes only capabilities that exist in this repository (installers and CLI artifacts from Releases, `pnpm bootstrap` / `pnpm dev:desktop` / `pnpm dev:web` development, `drora` TUI/`--web` modes, desktop pets, skin center, remote control, unsigned-build caveats from README.md). Commands and env keys must be copied from README.md, not paraphrased.
- Brand assets come from `packages/desktop/assets/` (Drora D-mark path, app icon) and `packages/desktop/assets/desktop-pet-catgirls/` (noir 夜墨 / snow 雪铃 / ginger 杏桃 idle atlases, copied verbatim into `website/assets/`). The website must not modify the source assets; copies are refreshed by re-copying.
- The hero app-window mock is rendered as real DOM + CSS (no screenshots), so it stays crisp on all DPIs. It is decorative content: it must not fetch anything, and any text inside it is presentational, not documentation.
- Pet sprites animate with CSS `steps()` frame walks over the 4x2 atlas grid (320x640 per frame, 8 frames, 5 fps idle loop matching the manifest). `prefers-reduced-motion` freezes the pets at frame 0 and disables all reveal animations.
- The site is bilingual (Chinese default, English toggle). All user-facing strings live in the i18n dictionary in `website/assets/js/main.js`, keyed by `data-i18n` attributes; the choice persists in `localStorage`. The hero mock's decorative chat lines are translated too.
- Download links point at the fork's GitHub Releases as fixed-tag snapshots (`https://github.com/CavinHuang/Drora/releases/download/v<X.Y.Z>/<artifact>`): release assets carry the version in their filename, so `releases/latest/download/` would break as soon as a newer release ships. The visible version literals across all pages form one snapshot that must be bumped together when a release ships. Links only use artifact names that actually exist in the target release (per README.md's download table): `Drora-<version>-win-{x64,arm64}.exe`, `Drora-<version>-mac-{arm64,x64}.dmg`, and the single-file CLI `drora-windows-x64.exe` / `drora-darwin-arm64` / `drora-linux-x64`. There are no Linux desktop installers; the site must not invent `.deb`/`.rpm`/`.AppImage` rows.
- The hero primary CTA detects the visitor platform (Windows/macOS/Linux) via user agent and relabels "适用于 <platform>"; detection failure falls back to Windows. No UA sniffing beyond this label.
- Deployment is the `Deploy website to GitHub Pages` workflow (`.github/workflows/deploy-website.yml`): it uploads `website/` as the Pages artifact on every push to `main` touching `website/**` or the workflow itself, plus manual `workflow_dispatch`. The repo needs Pages source = "GitHub Actions" (one-time setting). The site must work from a subpath (`https://<owner>.github.io/Drora/`), so all asset URLs are relative, never root-absolute.
- The GitHub repository About panel (description, homepage, topics) points at the deployed site: homepage = the Pages URL, description = one-line positioning ("开源 AI 编程工作台 · 复刻自 ZCode" family), topics = short lowercase keywords. The About panel is repo metadata, not site content; it may only claim what the repository actually ships.

## Ownership and event order

```text
push to main (website/**) -> Pages workflow -> upload-pages-artifact(website/)
  -> deploy-pages -> https://<owner>.github.io/Drora/
```

The website owns nothing at runtime: no storage beyond the language preference key, no network calls, no analytics. It is presentation-only, mirroring the app's rule that marketing surfaces never own product state.

## Acceptance scenarios

- Desktop 1440px: all five home sections render in order; header stays fixed with blur; hero mock shows sidebar/chat/right panel like the reference site; the three pet sprites animate their idle loops.
- Mobile 390px: nav collapses behind a menu button; the hero mock hides the right panel and narrows the sidebar; cards stack single-column; download rows stay tappable.
- Changelog page: every listed version links to its real GitHub tag page; feature/fix bullets match the fork's merged history; the layout mirrors the reference release page at 1440px and collapses to a single column on mobile.
- Docs page: left sidebar anchors scroll to their sections; the right "本页目录" scrollspy highlights the section in view; both sidebars collapse on mobile; every command/env key on the page appears verbatim in README.md.
- Language toggle switches every visible string without reload and persists across a reload — on every page.
- Header navigation highlights the current page (home/changelog/docs).
- `prefers-reduced-motion: reduce`: no scroll-reveal transitions, pets frozen.
- All download anchors resolve to `https://github.com/CavinHuang/Drora/releases/download/v<X.Y.Z>/...` URLs whose artifact names exist in that release.
- Offline/file:// open: every page renders fully (no CDN/font/network dependencies).
