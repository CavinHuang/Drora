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

      "doc.group.more": "More",
      "doc.nav.tasks": "Tasks & Goal mode",
      "doc.nav.sessions": "Sessions & history",
      "doc.nav.remoteDev": "Remote development",
      "doc.nav.usage": "Usage stats",
      "doc.nav.skills": "Skills & slash commands",
      "doc.nav.subagents": "Subagents",
      "doc.nav.mcp": "MCP & plugins",
      "doc.nav.hooks": "Hooks",
      "doc.nav.automation": "Automation",
      "doc.copy": "Copy article",
      "doc.search.placeholder": "Search docs…",
      "doc.search.empty": "No matching sections",

      "doc.tasks.h2": "Tasks & Goal mode",
      "doc.tasks.p1":
        "The desktop app organizes daily work as tasks: each task has its own session, tool runs and Git context. For complex multi-step goals, use Goal to carry the long-range plan — the agent keeps planning, executing and verifying while the progress panel ticks along; check status or add instructions anytime.",
      "doc.tasks.li1": "File edits, terminal runs and Git state stay in one task context.",
      "doc.tasks.li2": "The Goal panel shows the objective, progress and token usage.",
      "doc.tasks.li3": "Queued instructions are admitted serially by the runtime — nothing gets lost.",
      "doc.sessions.h2": "Sessions & history",
      "doc.sessions.p1":
        "Every session keeps a full history: messages, tool calls and file edits can be replayed; checkpoints take you back to any point to start over. Interrupted sessions can be resumed right where they left off.",
      "doc.remoteDev.h2": "Remote development",
      "doc.remoteDev.p1":
        "Beyond local projects, Drora connects to remote workspaces (SSH/WSL): sessions execute in the remote environment, with file and terminal operations happening on that host. When self-hosting the web backend, point",
      "doc.remoteDev.p1t": "at your workspace path — see the repo",
      "doc.usage.h2": "Usage stats",
      "doc.usage.p1":
        "Built-in usage stats show token consumption, request counts and tool-call distribution per session, so you can track cost and load. Statistics are generated from local session records.",
      "doc.skills.h2": "Skills & slash commands",
      "doc.skills.p1":
        "Skills package reusable workflows as first-class citizens: invoke them in a session with",
      "doc.skills.p1t":
        "and parameters expand through templates. Slash commands (Command) are lighter-weight prompt shortcuts. Both can be customized in workspace or user directories.",
      "doc.subagents.h2": "Subagents",
      "doc.subagents.p1":
        "The main agent can delegate exploration, retrieval and research to subagents running in parallel, bringing only conclusions back into the main conversation — especially useful for locating things in large codebases, keeping the main context lean.",
      "doc.mcp.h2": "MCP & plugins",
      "doc.mcp.p1":
        "Connect external tool services over MCP (Model Context Protocol): once stdio/HTTP servers are configured for a workspace or globally, their tools join the agent's tool surface automatically. Plugins go further, bundling skills, commands, hooks and MCP config — browse and install them from the in-app marketplace.",
      "doc.hooks.h2": "Hooks",
      "doc.hooks.p1":
        "Inject custom scripts at key points of the session and tool lifecycle: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and more. Hooks can add context, validate or rewrite tool inputs, and take part in permission decisions; workspace hooks are trusted per workspace identity and declaration digest.",
      "doc.automation.h2": "Automation",
      "doc.automation.p1":
        "Scheduled tasks run prompts on a plan; idle-time tasks queue deferrable work and execute when compute is free. Runs and results are persisted and viewable in the app.",

      "com.drop.page": "Community home",
      "nf.text": "This page doesn't exist — it may have been moved or removed.",
      "nf.home": "Back to home",
      "nav.security": "Security",

      "sec.title": "Report a Vulnerability",
      "sec.subtitle": "Report security and privacy issues in Drora to help make the project safer.",
      "sec.report.h2": "How to report",
      "sec.report.p":
        "Drora is a community-maintained open-source project. Depending on sensitivity, please pick a channel:",
      "sec.report.private": "GitHub private vulnerability reporting (recommended): for sensitive issues, use",
      "sec.report.privateLink": "private security advisories",
      "sec.report.privateTail": " — visible to maintainers only.",
      "sec.report.public": "GitHub Issues: non-sensitive hardening ideas and configuration concerns can be discussed publicly in",
      "sec.report.publicTail": ".",
      "sec.report.note": "Please do not describe directly exploitable details or publish exploit code publicly before a fix has shipped.",
      "sec.scope.h2": "Scope",
      "sec.scope.p": "Research against the forms this repository actually ships:",
      "sec.scope.th1": "Form",
      "sec.scope.th2": "Notes",
      "sec.scope.td1": "Desktop app",
      "sec.scope.td2": "macOS / Windows installers (published via Releases)",
      "sec.scope.td3": "Single-file executable (drora-<os>-<arch>)",
      "sec.scope.td4": "Local and self-hosted deployments (dev:web or release packages)",
      "sec.scope.deps": "For third-party dependency issues, you are also welcome to notify the upstream projects.",
      "sec.flow.h2": "Process",
      "sec.flow.s1": "Report: include reproduction steps, impact assessment and environment versions.",
      "sec.flow.s2": "Triage: maintainers reproduce the issue and rate its severity.",
      "sec.flow.s3": "Fix & release: critical issues are fixed and shipped first.",
      "sec.flow.s4": "Disclose & credit: public disclosure after the fix ships, with credit to the reporter (with consent).",
      "sec.bounty.h2": "About rewards",
      "sec.bounty.p":
        "This is a community open-source project with no bug-bounty program. Valid security reports are the most direct help you can give, and we will credit them honestly in the disclosure.",
      "sec.advice.h2": "Safety advice for users",
      "sec.advice.p":
        "The agent can operate files, terminals and the network, really executing under your account. Limit the account and network permissions it runs with, back up before important operations, and read",

      "com.title": "Community",
      "com.subtitle": "Share tips, report problems and help build Drora.",
      "com.lead": "All the channels for reaching maintainers and other community members — pick whichever suits you.",
      "com.fs.name": "Feishu group",
      "com.fs.desc": "Best for Chinese users: talk directly with maintainers and follow the latest news.",
      "com.fs.link": "Join the Feishu group",
      "com.dc.desc": "The international channel — English mainly.",
      "com.dc.link": "Join Discord",
      "com.gh.desc": "Best for public Q&A, proposals and sharing experience — searchable by anyone.",
      "com.gh.link": "Open Discussions",
      "com.contrib.h2": "Contributing",
      "com.contrib.p": "Code and docs contributions are welcome. Recommended flow:",
      "com.contrib.s1": "Open an issue first to describe the problem or proposal, avoiding duplicated work.",
      "com.contrib.s2": "Fork the repo and branch off main.",
      "com.contrib.s3": "Follow AGENTS.md in the repo (spec-first, typecheck and lint).",
      "com.contrib.s4": "Open a pull request and pass continuous integration.",
      "com.coc.h2": "Community vibe",
      "com.coc.p":
        "Be kind and respectful: be patient with newcomers and discuss technical choices on the merits. A community is only valuable when everyone feels safe asking questions.",

      "tos.title": "Terms of Use",
      "tos.subtitle": "Drora is a community open-source project under Apache-2.0.",
      "tos.lead": "Drora is a community-maintained open-source project. Before using this repository's source or artifacts, please note the following.",
      "tos.license.h2": "License",
      "tos.license.p": "Source code and build artifacts of this repository are provided under",
      "tos.license.tail":
        " (Apache-2.0). Drora is a community remake of upstream ZCode and is not affiliated with Z.ai / ZCode; their names and marks belong to their respective owners.",
      "tos.scope.h2": "Scope & maintenance",
      "tos.scope.p": "Functional scope per form and maintenance rules are defined in",
      "tos.scope.tail":
        ". The project is maintained by the community in spare time — no promise of availability, response times or a release schedule.",
      "tos.risk.h2": "Execution & data risks",
      "tos.risk.p":
        "AI-generated content can be wrong or incomplete; file, terminal, Git and network operations really execute under your account. Verify before important operations and keep backups — see",
      "tos.risk.tail": "section 1 of",
      "tos.liability.h2": "Limitation of liability",
      "tos.liability.p":
        "Under Apache-2.0 the software is provided \"as is\", without warranties of any kind; you bear the consequences of use. See the license text for details.",

      "pri.title": "Privacy Notes",
      "pri.subtitle": "Drora is local-first — your data stays on your own devices.",
      "pri.lead": "Drora is local-first: sessions and configuration live on your own machine. Here is an honest description of storage and network behavior.",
      "pri.local.h2": "Local storage",
      "pri.local.p":
        "The app keeps sessions, settings, caches and task records in the local app-data directory; the CLI session database lives in",
      "pri.local.tail": "You can redirect the data location with the env var",
      "pri.local.tail2": " — see the configuration section of the README.",
      "pri.net.h2": "Network requests",
      "pri.net.p":
        "Model requests go to the model endpoints you configure (including their auth); with auto-update enabled the app contacts GitHub Releases to check versions; features like the plugin marketplace and help content reach their own services on demand. The full outbound-request matrix is defined in",
      "pri.net.tail": "section 2 of",
      "pri.creds.h2": "Credentials & feedback attachments",
      "pri.creds.p":
        "Credentials stay on your machine and are not written into commits or logs. Before attaching logs or files to an issue, please review them and strip tokens and keys.",
      "pri.site.h2": "About this website",
      "pri.site.p":
        "This site is a fully static page: no analytics, no tracking, no third-party scripts, no cookies.",

      "sup.title": "Support & Feedback",
      "sup.subtitle": "Problems or ideas? Any of these channels reaches the maintainers.",
      "sup.lead": "For bugs, feature ideas or usage questions, any of the following channels reaches the maintainers.",
      "sup.channel.h2": "Channels",
      "sup.channel.th1": "Channel",
      "sup.channel.th2": "Best for",
      "sup.channel.td1": "Bug reports and feature requests (trackable)",
      "sup.channel.td2": "Usage Q&A and proposals",
      "sup.channel.td3a": "Feishu group /",
      "sup.channel.td3": "Real-time chat and quick answers",
      "sup.include.h2": "What to include",
      "sup.include.li1": "Your Drora version and how you installed it;",
      "sup.include.li2": "Operating system and CPU architecture;",
      "sup.include.li3": "Reproduction steps plus expected vs actual behavior;",
      "sup.include.li4": "Relevant log snippets (strip tokens and keys first).",
      "sup.format.h2": "Issue title format",
      "sup.format.p": "Use \"[form] platform + one-line symptom\" so issues stay searchable, e.g.:",
      "sup.faq.h2": "Check the FAQ first",
      "sup.faq.p": "High-frequency questions (installer warnings, updates and more) are collected in",
      "sup.faq.link": "the docs FAQ section",

      "footer.terms": "Terms",
      "footer.privacy": "Privacy",
      "footer.support": "Support",
      "footer.rights": "Drora Contributors · Open-source remake of ZCode",
      "footer.github": "GitHub",
      "footer.releases": "Releases",
      "footer.issues": "Issues",
      "footer.upstream": "Upstream ZCode",
    },
  };

  /* zh strings are the document's own text; re-applying them restores defaults. */
  var zhNodes = null;
  var phNodes = null;

  /* 每个页面的标题（切换语言时同步，避免子页沿用首页标题） */
  var PAGE_TITLES = {
    home: {
      zh: "Drora | GLM-5.3 开源氛围编程工具",
      en: "Drora | Open-source vibe coding powered by GLM-5.3",
    },
    changelog: { zh: "Drora 版本发布与更新", en: "Drora Release Notes" },
    docs: { zh: "Drora 文档 | 安装、连接模型与功能指南", en: "Drora Docs | Install, models & guides" },
    security: { zh: "Drora 提交漏洞 | 安全问题报告渠道", en: "Drora Security | Report a Vulnerability" },
    community: { zh: "Drora 社区 | 飞书 · Discord · Discussions", en: "Drora Community | Feishu · Discord · Discussions" },
    terms: { zh: "Drora 使用条款 | 开源许可与声明", en: "Drora Terms | License & Notices" },
    privacy: { zh: "Drora 隐私说明 | 本地优先的数据与网络行为", en: "Drora Privacy | Local-first Data & Network" },
    support: { zh: "Drora 支持与反馈 | Issue 指南与社区渠道", en: "Drora Support | Feedback Guide & Channels" },
    notfound: { zh: "404 | Drora", en: "404 | Drora" },
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
    phNodes = [];
    var phs = document.querySelectorAll("[data-i18n-placeholder]");
    for (var j = 0; j < phs.length; j++) {
      phNodes.push({ el: phs[j], text: phs[j].getAttribute("placeholder") });
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
      document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
        var key = el.getAttribute("data-i18n-placeholder");
        if (dict[key]) el.setAttribute("placeholder", dict[key]);
      });
      document.title = pageTitle("en");
    } else {
      cacheZh();
      zhNodes.forEach(function (n) {
        n.el.textContent = n.text;
      });
      if (phNodes) {
        phNodes.forEach(function (n) {
          n.el.setAttribute("placeholder", n.text);
        });
      }
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

  /* --------------------- docs search（复刻参考站 docs 头部 ⌘K） --------------------- */

  function initDocsSearch() {
    var btn = document.getElementById("docSearchBtn");
    if (!btn) return;
    var overlay = document.createElement("div");
    overlay.className = "doc-search-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="doc-search-panel" role="dialog" aria-label="Search docs">' +
      '  <input id="docSearchInput" type="text" autocomplete="off" data-i18n-placeholder="doc.search.placeholder" />' +
      '  <ul id="docSearchResults"></ul>' +
      "</div>";
    document.body.appendChild(overlay);
    var input = overlay.querySelector("#docSearchInput");
    var list = overlay.querySelector("#docSearchResults");

    var sections = [];
    document.querySelectorAll(".docs-content h2[id]").forEach(function (h) {
      sections.push({ id: h.id, title: h.textContent });
    });

    function renderResults(query) {
      var q = query.trim().toLowerCase();
      var hits = sections.filter(function (s) {
        return !q || s.title.toLowerCase().indexOf(q) >= 0;
      });
      list.innerHTML =
        hits
          .map(function (s) {
            return '<li><a href="#' + s.id + '" data-target="' + s.id + '">' + s.title + "</a></li>";
          })
          .join("") || '<li class="ds-empty" data-i18n="doc.search.empty">没有匹配的章节</li>';
    }

    function open() {
      overlay.hidden = false;
      renderResults("");
      input.value = "";
      input.focus();
    }

    function close() {
      overlay.hidden = true;
    }

    btn.addEventListener("click", open);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    input.addEventListener("input", function () {
      renderResults(input.value);
    });
    list.addEventListener("click", function (e) {
      if (e.target.closest("a[data-target]")) close();
    });
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (overlay.hidden) open();
        else close();
      } else if (e.key === "Escape" && !overlay.hidden) {
        close();
      }
    });
  }

  /* --------------------- 复制全文（复刻参考站 docs 面包屑行按钮） --------------------- */

  function initCopyArticle() {
    var btn = document.getElementById("copyArticleBtn");
    var article = document.querySelector(".docs-content");
    if (!btn || !article) return;
    var label = btn.querySelector("[data-i18n]");
    btn.addEventListener("click", function () {
      var done = function () {
        if (!label) return;
        label.textContent = currentLang() === "en" ? "Copied!" : "已复制";
        setTimeout(function () {
          label.textContent = currentLang() === "en" ? "Copy article" : "复制全文";
        }, 1600);
      };
      function fallbackCopy() {
        var range = document.createRange();
        range.selectNodeContents(article);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        done();
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(article.innerText || "").then(done, fallbackCopy);
      } else {
        // 无 Clipboard API 时的回退：选中正文让用户手动复制
        var range = document.createRange();
        range.selectNodeContents(article);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        done();
      }
    });
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
    initDocsSearch();
    initCopyArticle();

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
