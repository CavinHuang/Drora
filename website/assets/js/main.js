/* Drora product website — i18n + light interactions. No dependencies. */
(function () {
  "use strict";

  /* ------------------------------ i18n ------------------------------ */

  var I18N = {
    en: {
      "nav.docs": "Docs",
      "nav.changelog": "Changelog",
      "nav.issues": "Issues",
      "nav.community": "Community",

      "hero.pill": "Open-source release: now with GLM-5.3 & desktop pets",
      "hero.title": "Simple, Fast, Vibe-Ready!",
      "hero.subtitle":
        "Drora is the next-generation vibe coding tool: multi-agent collaboration for complex goals, a desktop pet by your side, and full control from anywhere.",
      "hero.cta": "Download Drora",
      "hero.forWindows": "For Windows",
      "hero.forMac": "For macOS",
      "hero.forLinux": "For Linux",
      "hero.allDownloads": "View all downloads",

      "mock.newTask": "New task",
      "mock.openWorkspace": "Open workspace",
      "mock.skills": "Skills",
      "mock.tasks": "Tasks",
      "mock.task1": "Build a smart Gomoku game with strategic moves",
      "mock.task2": "Refactor the start screen, merge state & animation",
      "mock.task3": "Add heuristic AI moves and win detection",
      "mock.task4": "Handle ko, forbidden moves and Connect-6 rules",
      "mock.task5": "Write a how-to-play guide",
      "mock.goalTitle": "Create a smart Gomoku game where players place strategic moves and judge accurately…",
      "mock.m1": "…responses, draws and long-connection edge cases.",
      "mock.ran": "Ran",
      "mock.m2a":
        "I found an avoidable dependency: the page was pulling web fonts. I'm removing it so the whole game runs fully locally — just open",
      "mock.m2b": "and no network is needed.",
      "mock.updated": "Updated",
      "mock.m3a": "Done in",
      "mock.m3b":
        "a standalone browser Gomoku game. It renders a 15x15 board, lets both players place stones, checks wins in four directions, highlights the winning line, tracks turn and move count, and supports restarting.",
      "mock.m4":
        "The AI doesn't place stones at random — it scores heuristically. It scans candidate points nearby, scores its own attacking shapes and the player's defensive shapes, and keeps intercept priority for one-step wins and open lines.",
      "mock.filesChanged": "3 files changed",
      "mock.expand": "Expand ⌄",
      "mock.gitTools": "Git tools",
      "mock.changes": "Changes",
      "mock.commit": "Commit",
      "mock.complete": "Complete",
      "mock.goalDesc": "Gomoku game: one match with heuristic AI for two players",
      "mock.p1": "Scaffold the 15x15 board and stone rendering",
      "mock.p2": "Win checks in four directions",
      "mock.p3": "Heuristic AI move scoring",
      "mock.p4": "Undo and restart",
      "mock.p5": "How-to-play panel",

      "editions.label": "100% free & open source",
      "editions.title": "One Drora, three shapes",
      "editions.subtitle": "Desktop, browser and terminal — one runtime, all free and open.",
      "editions.view": "View on GitHub",
      "editions.note": "Drora is open source under the upstream license — self-hosting and contributions welcome.",

      "ed.forever": "free forever",
      "ed.badge.recommended": "Recommended",
      "ed.badge.geek": "Geek's pick",
      "ed.desktop.name": "Desktop",
      "ed.desktop.desc": "The daily-driver battlefield for real work",
      "ed.desktop.f1": "Full desktop agent: sessions, tasks & long-running Goals",
      "ed.desktop.f2": "Session history, replay and checkpoints",
      "ed.desktop.f3": "Skills, slash commands and MCP plugin ecosystem",
      "ed.desktop.f4": "Three catgirl desktop pets by your side",
      "ed.web.name": "Browser & phone",
      "ed.web.desc": "Control your desktop agent from anywhere",
      "ed.web.f1": "Phone remote-control attaches to the desktop host, reusing the session runtime",
      "ed.web.f2": "Responsive layout for phones, tablets and desktops",
      "ed.web.f3": "Reconnect recovery with replayable event streams",
      "ed.web.f4": "Relay only authenticates, pairs and forwards — no business state stored",
      "ed.cli.name": "Terminal",
      "ed.cli.desc": "The agent runtime for scripts and automation",
      "ed.cli.f1": "Single-file drora-cli executable, offline deploy",
      "ed.cli.f2": "Shares the same agent runtime as the desktop app",
      "ed.cli.f3": "Hooks, output styles and headless mode",
      "ed.cli.f4": "stdio protocol, easy to integrate anywhere",

      "cap.label": "Capabilities",
      "cap.title": "Stay on the frontier",
      "cap.subtitle": "Whether it's untangling legacy systems or shipping realtime features, Drora keeps teams fast and steady.",
      "cap.goalCard": "Streaming Markdown renderer",
      "cap.goalItem1": "Create streaming markdown component",
      "cap.goalItem2": "Handle fenced code block edges",
      "cap.goal.title": "Long-running tasks",
      "cap.goal.desc": "Manage complex goals with Goal — continuous planning, execution and verification, step by steady step.",
      "cap.remote.title": "Remote control",
      "cap.remote.desc": "Wake the desktop Drora from your phone's browser. Tasks enter execution anytime; disconnects recover with replay.",
      "cap.remoteIn": "Run the tests and fix the failures",
      "cap.remoteOut1": "On it — connected to desktop Drora…",
      "cap.remoteOut2": "2 failures fixed, all green ✓",
      "cap.remoteInput": "Send a message…",
      "cap.pet.title": "Desktop pets",
      "cap.pet.desc":
        "Noir, Snow and Ginger reflect live task status and keep you company through every commit — hideable, draggable, never in the way.",

      "dl.title": "All downloads",
      "dl.subtitle": "Every platform installer Drora supports",
      "dl.macos": "MacOS",
      "dl.macArm": "macOS (Apple silicon)",
      "dl.macIntel": "macOS (Intel)",
      "dl.windows": "Windows",
      "dl.win64": "Windows (64-bit)",
      "dl.winArm": "Windows (ARM64)",
      "dl.linuxCli": "Agent CLI (x64)",
      "dl.singleFile": "single file",
      "dl.linuxHint": "Linux desktop installers are on the way; the CLI runs in a terminal.",
      "dl.cliNote":
        "Prefer the terminal? Single-file CLI builds for macOS and Windows (drora-darwin-arm64 / drora-windows-x64.exe) ship alongside:",
      "dl.cliNoteLink": "Get them from Releases ↗",

      "ch.title": "Release Notes & Updates",
      "ch.subtitle": "Release notes and desktop downloads for every Drora version.",
      "ch.date0927": "Released Sep 27, 2026",
      "ch.date0926": "Released Sep 26, 2026",
      "ch.date0925": "Released Sep 25, 2026",
      "ch.download": "Download",
      "ch.allAssets": "All assets on GitHub",
      "ch.group.features": "New",
      "ch.group.fixes": "Fixed",
      "ch.group.maintenance": "Maintenance",
      "ch.group.changes": "Changed",
      "ch.tail": "Thanks to everyone who tried Drora and shared feedback.",
      "ch.v8.f1":
        "In-app auto-update on macOS is now closed-loop: CI self-signing wired in, with recovery from failed installs.",
      "ch.v8.f2":
        "Fixed the production relay path for phone remote control: the WebSocket constructor now falls back to the ws package.",
      "ch.v8.f3": "Fixed workspace wallpapers bleeding through transparent skin panels.",
      "ch.v7.f1": "The skin center now ships several illustrated preset wallpapers.",
      "ch.v7.f2": "Polished skin sliders and preset selection states to match the design spec.",
      "ch.v6.f1":
        "Phone remote control now supports the relay cloud service: cross-network control alongside LAN direct connections.",
      "ch.v6.f2": "rpc-frame transparent bridge: the phone page can drive desktop tasks directly.",
      "ch.v6.f3":
        "CI packaging reliability: retry with backoff for packaging copy races, real-time monitoring disabled on Windows builds.",
      "ch.v5.f1": "Skin center launched: custom wallpapers, panel opacity and accent colors.",
      "ch.v5.f2": "Two-column remote-control overlay with a connection status card.",
      "ch.v5.f3": "Fixed pet bubble positioning: top-centered hover, width cap and better line wrapping.",
      "ch.v4.f1":
        "Phone remote control round two: six-state connection machine, auto-resume on app start, and the server stops when the window closes.",
      "ch.v3.f1": "macOS Computer Use aligned with upstream ZCode 3.14.3: bundled Helper with first-use trust onboarding.",
      "ch.v3.f2": "\"Start Plan\" now goes through the captcha check, fixing the 3007 auth failure.",
      "ch.v3.f3": "Pet bubble content and drag-layout channel.",
      "ch.v3.f4":
        "The Obsidian plugin dropped its MCP surface in favor of direct hooks (SessionStart / PermissionRequest / UserPromptSubmit).",
      "ch.v2.f1": "Aligned all official upstream ZCode 3.14.3 plugins (including the Computer Use 0.6.3 generation migration).",
      "ch.v2.f2": "Output style system (outputStyle) landed.",
      "ch.v2.f3": "Marketplace personal data alignment: built-in source and CDN icon index.",
      "ch.v2.f4": "Server remote closeout: share gating, disposal, snapshots and the workspaces UI.",
      "ch.v1.f1": "First public build: Windows / macOS desktop installers and a single-file Agent CLI.",
      "ch.v1.f2": "Phone remote pairing protocol and server foundation.",

      "doc.group.start": "Get started",
      "doc.group.features": "Core features",
      "doc.group.advanced": "Dive deeper",
      "doc.nav.intro": "What is Drora",
      "doc.nav.install": "Install",
      "doc.nav.model": "Connect a model",
      "doc.nav.desktop": "Desktop app",
      "doc.nav.remote": "Phone remote",
      "doc.nav.pets": "Desktop pets",
      "doc.nav.skin": "Skin center",
      "doc.nav.cli": "CLI",
      "doc.nav.build": "Build from source",
      "doc.nav.faq": "FAQ",
      "doc.h1": "Welcome to Drora",
      "doc.dot": ".",
      "doc.colon": ":",
      "doc.toc": "On this page",
      "doc.intro.lead1":
        "Drora is an open-source AI coding workbench: desktop app, browser UI and terminal agent share one runtime. It turns long context, long-running tasks and agentic coding into a dependable desktop experience covering planning, coding, review and iteration.",
      "doc.intro.lead2":
        "Drora is a community-maintained open-source remake of upstream ZCode with continuous catch-up. Scope, maintenance rules and licensing live in",
      "doc.install.h2": "Install",
      "doc.install.p1": "No need to build from source — grab the latest build from",
      "doc.install.th1": "File",
      "doc.install.th2": "What it is",
      "doc.file.win": "Drora-<version>-win-x64.exe",
      "doc.file.mac": "Drora-<version>-mac-arm64.dmg",
      "doc.install.td1": "Windows desktop installer (NSIS)",
      "doc.install.td2": "macOS desktop app",
      "doc.install.td3": "Single-file Agent CLI — must run in a terminal (double-clicking flashes and exits)",
      "doc.install.note1":
        "Installers are unsigned: on Windows choose \"More info → Run anyway\" at the SmartScreen prompt; on macOS allow it under System Settings → Privacy & Security, or run",
      "doc.install.p2": "All artifacts are built from source by GitHub Actions,",
      "doc.install.p2t": " provides checksums; the desktop app updates itself over the latest channel.",
      "doc.model.h2": "Connect a model",
      "doc.model.p1":
        "Drora is designed for the GLM model family. Sign in to a Z.ai account (GLM Coding Plan) or configure a model service in desktop Settings; the CLI authenticates via",
      "doc.model.p1t": " and you're ready to ask.",
      "doc.model.p2": "For self-hosting or private endpoints, point",
      "doc.model.p2m":
        " at a local provider config; service addresses and build config live in",
      "doc.model.p2and": " and",
      "doc.desktop.h2": "Desktop app",
      "doc.desktop.p1":
        "The desktop app is Drora's daily driver: tasks and Goals carry long-running work from planning to acceptance, while the agent's file edits, terminal runs and Git state stay in one task context — check progress and add instructions anytime.",
      "doc.desktop.li1": "Session history, replay and checkpoints: step back to any point in time.",
      "doc.desktop.li2": "Skills, slash commands and the MCP plugin ecosystem extend the agent.",
      "doc.desktop.li3": "Remote workspaces (SSH/WSL): develop against remote projects.",
      "doc.remote.h2": "Phone remote",
      "doc.remote.p1":
        "Once remote access is on, connect from your phone's browser by scanning a code or entering the address: the phone attaches to the existing desktop host and reuses the same session runtime — no extra agent. LAN connections go direct; across networks traffic is forwarded by the relay, which only authenticates, pairs and forwards — never storing task queues or business state.",
      "doc.remote.p2":
        "Disconnects recover automatically and past events replay; closing the window stops the server, so nothing lingers in the background.",
      "doc.pets.h2": "Desktop pets",
      "doc.pets.p1":
        "Noir, Snow and Ginger reflect live task status and keep you company through every commit. Pets are draggable, hideable and never block input — pick a character or turn them off in Settings.",
      "doc.skin.h2": "Skin center",
      "doc.skin.p1":
        "Several illustrated preset wallpapers ship built in, with custom panel opacity and accent colors so the workbench matches your taste; every preset is tuned against the design spec.",
      "doc.cli.h2": "CLI",
      "doc.cli.p1": "The",
      "doc.cli.p1t":
        " artifact is a single-file Agent CLI that must run in a terminal. It works standalone and shares the same runtime as the desktop app:",
      "doc.cli.p2": "Web mode listens locally and opens your browser by default; use",
      "doc.cli.p2t":
        " for LAN access — non-local addresses generate an access token automatically:",
      "doc.build.h2": "Build from source",
      "doc.build.p1": "Prepare Git, Node.js",
      "doc.build.p1m": " and pnpm",
      "doc.build.p1t": " (versions per",
      "doc.build.p1e": " in the repo), then run from the repository root:",
      "doc.build.p2": "Package desktop installers:",
      "doc.build.p3": "Repository layout, configuration keys (such as",
      "doc.build.p3t": " for the data directory) and full packaging docs live in the",
      "doc.faq.h2": "FAQ",
      "doc.faq.q1": "macOS says the app is damaged, or Windows SmartScreen blocks it?",
      "doc.faq.a1":
        "Community builds are unsigned: on Windows choose \"More info → Run anyway\"; on macOS allow it under System Settings → Privacy & Security, or run",
      "doc.faq.q2": "Is there a Linux desktop build?",
      "doc.faq.a2": "Not yet as a prebuilt installer. Linux users can start with the single-file CLI (",
      "doc.faq.a2t": ") or build the desktop app from source with",
      "doc.faq.a2e": "yourself.",
      "doc.faq.q3": "How do I update?",
      "doc.faq.a3":
        "The desktop app updates itself over the latest channel; you can also download any newer build from the Releases page and install over it.",
      "doc.faq.q4": "Where do I report problems?",
      "doc.faq.a4": "Feel free to open a",
      "doc.faq.a4m": " thread, or join the",
      "doc.faq.a4link": "community channels",
      "doc.faq.a4e": " linked in the README.",

      "footer.rights": "Drora Contributors · Open-source remake of ZCode",
      "footer.github": "GitHub",
      "footer.releases": "Releases",
      "footer.issues": "Issues",
      "footer.upstream": "Upstream ZCode",
    },
  };

  /* zh strings are the document's own text; re-applying them restores defaults. */
  var zhNodes = null;

  /* 每个页面的标题（切换语言时同步，避免子页沿用首页标题） */
  var PAGE_TITLES = {
    home: {
      zh: "Drora | GLM-5.3 开源氛围编程工具",
      en: "Drora | Open-source vibe coding powered by GLM-5.3",
    },
    changelog: { zh: "Drora 版本发布与更新", en: "Drora Release Notes" },
    docs: { zh: "Drora 文档 | 安装、连接模型与功能指南", en: "Drora Docs | Install, models & guides" },
  };

  function pageTitle(lang) {
    var page = document.body.getAttribute("data-page") || "home";
    var titles = PAGE_TITLES[page] || PAGE_TITLES.home;
    return lang === "en" ? titles.en : titles.zh;
  }

  function currentLang() {
    var saved = null;
    try {
      saved = localStorage.getItem("drora-website-lang");
    } catch {
      /* storage unavailable — default below */
    }
    if (saved === "en" || saved === "zh") return saved;
    return "zh";
  }

  function cacheZh() {
    if (zhNodes) return;
    zhNodes = [];
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      zhNodes.push({ el: nodes[i], text: nodes[i].textContent });
    }
  }

  function applyLang(lang) {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    if (lang === "en") {
      var dict = I18N.en;
      document.querySelectorAll("[data-i18n]").forEach(function (el) {
        var key = el.getAttribute("data-i18n");
        if (dict[key]) el.textContent = dict[key];
      });
      document.title = pageTitle("en");
    } else {
      cacheZh();
      zhNodes.forEach(function (n) {
        n.el.textContent = n.text;
      });
      document.title = pageTitle("zh");
    }
    var label = document.getElementById("langLabel");
    if (label) label.textContent = lang === "en" ? "中" : "EN";
    try {
      localStorage.setItem("drora-website-lang", lang);
    } catch {
      /* ignore */
    }
  }

  /* --------------------- platform-aware hero CTA --------------------- */

  function detectPlatform() {
    var ua = navigator.userAgent || "";
    if (/Mac|iPhone|iPad/i.test(ua)) return "mac";
    if (/Linux|Android|X11/i.test(ua) && !/Windows/i.test(ua)) return "linux";
    return "win";
  }

  function applyPlatform() {
    var lang = currentLang();
    var platform = detectPlatform();
    var cta = document.getElementById("ctaDownload");
    var label = document.getElementById("ctaPlatform");
    if (!cta || !label) return;
    var assets = {
      mac: "Drora-0.0.8-mac-arm64.dmg",
      win: "Drora-0.0.8-win-x64.exe",
      linux: "drora-linux-x64",
    };
    cta.href = "https://github.com/CavinHuang/Drora/releases/download/v0.0.8/" + assets[platform];
    if (lang === "en") {
      var keys = { mac: "hero.forMac", win: "hero.forWindows", linux: "hero.forLinux" };
      label.textContent = I18N.en[keys[platform]];
    } else {
      var names = { mac: "macOS", win: "Windows", linux: "Linux" };
      label.textContent = "适用于 " + names[platform];
    }
  }

  /* --------------------------- interactions --------------------------- */

  /* 文档页 scrollspy：视口上部区域命中的 h2 高亮侧栏与目录项 */
  function initDocsSpy() {
    var heads = document.querySelectorAll(".docs-content h2[id]");
    var links = document.querySelectorAll(".docs-toc a, .docs-nav-group a");
    if (!heads.length || !links.length || !("IntersectionObserver" in window)) return;
    var byId = {};
    links.forEach(function (a) {
      var id = (a.getAttribute("href") || "").slice(1);
      if (!id) return;
      (byId[id] = byId[id] || []).push(a);
    });
    function setActive(id) {
      links.forEach(function (a) {
        a.classList.remove("current");
      });
      (byId[id] || []).forEach(function (a) {
        a.classList.add("current");
      });
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: "-72px 0px -66% 0px" }
    );
    heads.forEach(function (h) {
      io.observe(h);
    });
    setActive(heads[0].id);
  }

  function initHeader() {
    var header = document.getElementById("siteHeader");
    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    var btn = document.getElementById("menuBtn");
    var nav = document.getElementById("mobileNav");
    if (btn && nav) {
      btn.addEventListener("click", function () {
        var open = nav.classList.toggle("open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      nav.addEventListener("click", function (event) {
        if (event.target.tagName === "A") {
          nav.classList.remove("open");
          btn.setAttribute("aria-expanded", "false");
        }
      });
    }
  }

  function initReveal() {
    var nodes = document.querySelectorAll(".reveal");
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      nodes.forEach(function (n) {
        n.classList.add("in");
      });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    nodes.forEach(function (n) {
      io.observe(n);
      // 首屏元素同步显示，不依赖 IO 回调时机，避免可感知的闪白窗口
      var rect = n.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) n.classList.add("in");
    });
  }

  /* ------------------------------ boot ------------------------------ */

  function boot() {
    cacheZh();
    applyLang(currentLang());
    applyPlatform();
    initHeader();
    initReveal();
    initDocsSpy();

    var langBtn = document.getElementById("langBtn");
    if (langBtn) {
      langBtn.addEventListener("click", function () {
        applyLang(currentLang() === "en" ? "zh" : "en");
        applyPlatform();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
