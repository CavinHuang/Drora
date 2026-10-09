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

      "footer.rights": "Drora Contributors · Open-source remake of ZCode",
      "footer.github": "GitHub",
      "footer.releases": "Releases",
      "footer.issues": "Issues",
      "footer.upstream": "Upstream ZCode",
    },
  };

  /* zh strings are the document's own text; re-applying them restores defaults. */
  var zhNodes = null;

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
      document.title = "Drora | Open-source vibe coding powered by GLM-5.3";
    } else {
      cacheZh();
      zhNodes.forEach(function (n) {
        n.el.textContent = n.text;
      });
      document.title = "Drora | GLM-5.3 开源氛围编程工具";
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
      mac: "Drora-3.14.3-mac-arm64.dmg",
      win: "Drora-3.14.3-win-x64.exe",
      linux: "Drora-3.14.3-linux-x64.AppImage",
    };
    cta.href = "https://github.com/CavinHuang/Drora/releases/latest/download/" + assets[platform];
    if (lang === "en") {
      var keys = { mac: "hero.forMac", win: "hero.forWindows", linux: "hero.forLinux" };
      label.textContent = I18N.en[keys[platform]];
    } else {
      var names = { mac: "macOS", win: "Windows", linux: "Linux" };
      label.textContent = "适用于 " + names[platform];
    }
  }

  /* ------------------------------ pets ------------------------------ */

  function attachPets() {
    document.querySelectorAll(".pet").forEach(function (pet) {
      var sprite = pet.querySelector(".pet-sprite");
      var atlas = pet.getAttribute("data-atlas");
      if (sprite && atlas) sprite.style.backgroundImage = "url('" + atlas + "')";
    });
  }

  /* --------------------------- interactions --------------------------- */

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
    attachPets();
    initHeader();
    initReveal();

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
