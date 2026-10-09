# Product website (GitHub Pages)

## Product rules

- The Drora product website is a fully static single page under `website/`. It is physically isolated from restored upstream code and from all workspace packages: no package imports it, it imports no package, and it is excluded from workspace lint/format tooling. It ships plain HTML + CSS + vanilla JS with zero build step and zero runtime dependencies.
- The visual design intentionally follows the official ZCode marketing site (https://zcode.z.ai/): dark theme (`#161616` background, `rgba(255,255,255,0.1)` borders), Geist-style system font stack, and a five-section layout — fixed header, hero with a live DOM app-window mock, three-edition cards (mirroring the pricing card anatomy), three capability cards, download section, footer. Copy and branding are Drora's own and must follow `specs/drora-rename.md`; the site must never claim to be the official ZCode product.
- Brand assets come from `packages/desktop/assets/` (Drora D-mark path, app icon) and `packages/desktop/assets/desktop-pet-catgirls/` (noir 夜墨 / snow 雪铃 / ginger 杏桃 idle atlases, copied verbatim into `website/assets/`). The website must not modify the source assets; copies are refreshed by re-copying.
- The hero app-window mock is rendered as real DOM + CSS (no screenshots), so it stays crisp on all DPIs. It is decorative content: it must not fetch anything, and any text inside it is presentational, not documentation.
- Pet sprites animate with CSS `steps()` frame walks over the 4x2 atlas grid (320x640 per frame, 8 frames, 5 fps idle loop matching the manifest). `prefers-reduced-motion` freezes the pets at frame 0 and disables all reveal animations.
- The site is bilingual (Chinese default, English toggle). All user-facing strings live in the i18n dictionary in `website/assets/js/main.js`, keyed by `data-i18n` attributes; the choice persists in `localStorage`. The hero mock's decorative chat lines are translated too.
- Download links point at the fork's GitHub Releases using the `releases/latest/download/` pattern with the real artifact names produced by `.github/workflows/release.yml` (`Drora-<version>-<platform>-<arch>.<ext>`, platform in `win|mac|linux`, arch in `x64|arm64`). The version literal appears once per visible row and must be bumped together with `packages/desktop/package.json` releases; when an artifact for a row is missing, the row still renders (links are content-addressed, never guessed at runtime).
- The hero primary CTA detects the visitor platform (Windows/macOS/Linux) via user agent and relabels "适用于 <platform>"; detection failure falls back to Windows. No UA sniffing beyond this label.
- Deployment is the `Deploy website to GitHub Pages` workflow (`.github/workflows/deploy-website.yml`): it uploads `website/` as the Pages artifact on every push to `main` touching `website/**` or the workflow itself, plus manual `workflow_dispatch`. The repo needs Pages source = "GitHub Actions" (one-time setting). The site must work from a subpath (`https://<owner>.github.io/Drora/`), so all asset URLs are relative, never root-absolute.

## Ownership and event order

```text
push to main (website/**) -> Pages workflow -> upload-pages-artifact(website/)
  -> deploy-pages -> https://<owner>.github.io/Drora/
```

The website owns nothing at runtime: no storage beyond the language preference key, no network calls, no analytics. It is presentation-only, mirroring the app's rule that marketing surfaces never own product state.

## Acceptance scenarios

- Desktop 1440px: all five sections render in order; header stays fixed with blur; hero mock shows sidebar/chat/right panel like the reference site; the three pet sprites animate their idle loops.
- Mobile 390px: nav collapses behind a menu button; the hero mock hides the right panel and narrows the sidebar; cards stack single-column; download rows stay tappable.
- Language toggle switches every visible string without reload and persists across a reload.
- `prefers-reduced-motion: reduce`: no scroll-reveal transitions, pets frozen.
- All download anchors resolve to `https://github.com/CavinHuang/Drora/releases/...` URLs matching `release.yml` artifact names.
- Offline/file:// open: the page renders fully (no CDN/font/network dependencies).
