/* Drora 产品站文案数据表（EN 词典；zh 直接取自各页 DOM）。
   须在 main.js 之前加载：main.js 启动即读 window.DRORA_I18N。 */
/* eslint-disable max-lines -- 纯文案数据表，拆散会破坏按分区浏览（先例：packages/ui/src/Root.tsx） */
window.DRORA_I18N = {
    en: {
      "nav.docs": "Docs",
      "nav.changelog": "Changelog",
      "nav.issues": "Issues",
      "nav.community": "Community",

      "hero.pill": "v0.0.8 is out: desktop, phone and terminal — all three shapes",
      "hero.title": "Simple, Fast, Vibe-Ready!",
      "hero.subtitle":
        "Drora is the next-generation vibe coding tool: multi-agent collaboration for complex goals, a desktop pet by your side, and full control from anywhere.",
      "hero.cta": "Download Drora",
      "hero.forWindows": "For Windows",
      "hero.forMac": "For macOS",
      "hero.forLinux": "For Linux",
      "hero.allDownloads": "View all downloads",

      "mock.t8": "Polish the docs search highlighting and empty-state feedback",
      "mock.t9": "Align the home hero and downloads section structure",
      "mock.t10": "Fix the chat pane's bottom-snap logic on resize",
      "mock.t11": "Investigate right-panel state drift after session restore",
      "mock.t12": "Speed up terminal-pane repaints after drag-resize",
      "mock.t13": "Fix the sidebar collapse state not restoring after restart",
      "mock.t14": "Reorganize the settings page grouping to reduce clutter",
      "mock.t15": "Add recents and keyboard hints to the command palette",
      "mock.t16": "Wire up changelog generation and GitHub Release drafts",
      "mock.t17": "Add a failed-CI summary template with retry suggestions",
      "mock.t18": "Chain tag checks, version sync and release-note preview",
      "mock.t19": "Generate release announcement templates per bump type",
      "mock.t20": "Add idempotent retries and alert throttling for failed releases",
      "mock.user": "Noir",
      "mock.actEdit": "Edit",
      "mock.actCopy": "Copy",
      "mock.actBranch": "Branch run",
      "mock.duration": "Ran for 3m 1s",
      "mock.explore": "Explored",
      "mock.exploreRes": "1 search, 1 file",
      "mock.fail": "Failed",
      "mock.mIntro1":
        "I'll start by checking the current Gomoku project structure to see how far the board state, rendering and game flow already go, then wire in the AI and win detection.",
      "mock.mIntro2":
        "This repo looks empty, or nearly so. I'll keep checking the directory to decide whether to extend an existing app or start from scratch.",
      "mock.mIntro3":
        "There's no existing app, so I'll build a self-contained implementation from scratch. First I'll check for local project conventions, then add the browser Gomoku board, heuristic AI, turn handling and an explicit five-in-a-row win check.",
      "mock.m3pre":
        "The full UI and core logic are in place. I'm verifying that the JavaScript parses and re-checking the move-scoring logic for edge cases: first-move response, draws and long winning lines.",
      "mock.mVerify":
        "Verified: node --check app.js passes. I haven't run an interactive browser session, so the last step is to open index.html in a browser and play a round.",
      "mock.undo": "Undo",
      "mock.send": "Send",
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
      "mock.ran": "Ran",
      "mock.m2a":
        "I found an avoidable dependency: the page was pulling web fonts. I'm removing it so the whole game runs fully locally — just open",
      "mock.m2b": "and no network is needed.",
      "mock.updated": "Updated",
      "mock.m3a": "Done in",
      "mock.m3b": "a standalone browser Gomoku game. It renders a 15x15 board, lets the player place black stones, checks wins in four directions, highlights the winning line, tracks turn and move count, and supports restarting.",
      "mock.m4": "The AI doesn't place stones at random — it scores heuristically. It scans nearby candidate points, scores its own attacking shapes and the player's defensive shapes, adds a center-area preference, and plays the highest-scoring move. An optional \"AI focus zones\" overlay shows the candidates it weighed most.",
      "mock.filesChanged": "3 files changed",
      "mock.gitTools": "Git tools",
      "mock.changes": "Changes",
      "mock.commit": "Commit",
      "mock.complete": "Complete",
      "mock.goalDesc": "Gomoku vs AI — heuristic scoring drives the computer's moves",
      "mock.p1": "Initialize the board, stone rendering and the 15×15 grid",
      "mock.p2": "Player move interaction and win-detection logic",
      "mock.p3": "Heuristic AI scoring for automatic computer moves",
      "mock.p4": "Adapt board scaling and landscape/portrait layout for mobile",
      "mock.p5": "Add a rules guide, restart entry and empty-state onboarding",

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
      "ed.cli.f1": "Single-file Agent CLI, runs anywhere in your terminal",
      "ed.cli.f2": "Shares the same agent runtime as the desktop app",
      "ed.cli.f3": "Hooks, output styles and headless mode",
      "ed.cli.f4": "stdio protocol, easy to integrate anywhere",

      "cap.label": "Capabilities",
      "cap.title": "Long-running tasks, fully in your grasp",
      "cap.subtitle": "Goal tracking, phone remote control, desktop pets — every one genuinely ships in this open-source repo.",
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
      "dl.subtitle": "Every artifact in the v0.0.8 snapshot, built from source by GitHub Actions.",
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
      "doc.install.p2t": " provides checksums.",
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
      "doc.welcome.cap.h2": "Core capabilities",
      "doc.welcome.cap.tasks": " — carry long-range goals with progress ticking along.",
      "doc.welcome.cap.remote": " — your phone's browser drives the existing desktop host, with replayable recovery.",
      "doc.welcome.cap.remoteDev": " — develop against SSH/WSL remote workspaces.",
      "doc.welcome.cap.skills": "",
      "doc.welcome.cap.ext": " — extend the agent's tool surface as needed.",
      "doc.welcome.cap.auto": " — scheduled and idle-time tasks run on plan.",
      "doc.welcome.cap.pets": " — three catgirls reflect task status, draggable and hideable.",
      "doc.welcome.quick.h2": "Quick start",
      "doc.welcome.quick.p1": "Grab a desktop installer or the single-file CLI from",
      "doc.welcome.quick.p2": ", sign in to a model account and start your first task — see",
      "doc.welcome.quick.and": " and",
      "doc.welcome.comm.h2": "Join the community",
      "doc.welcome.comm.p1": "For questions and suggestions, head to the",
      "doc.welcome.comm.link": "community page",
      "doc.welcome.comm.p2": ": Feishu, Discord and GitHub Discussions all reach the maintainers; security issues go through",
      "doc.welcome.comm.sec": "the vulnerability reporting channel",
      "doc.install.sub.first": "First run & signature prompts",
      "doc.install.sub.verify": "Checksums & updates",
      "doc.install.sub.source": "Building from source",
      "doc.install.source": "Prefer building yourself? See",
      "doc.model.sub.login": "Sign-in & accounts",
      "doc.model.sub.self": "Self-hosting & private endpoints",
      "doc.cli.sub.web": "Web mode",
      "doc.build.sub.env": "Environment",
      "doc.build.sub.pkg": "Packaging",
      "doc.tasks.next": "For history and replay of a task, see",
      "doc.remote.next": "For developing on remote hosts, see",

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
      "mock.t1": "Build a smart Gomoku game where the player plays strategic moves and the winner is judged accurately.",
      "mock.t2": "Polish the opening hints, turn states and win messages",
      "mock.t3": "Wire in heuristic AI moves and the player-first flow",
      "mock.t4": "Adapt board scaling and landscape/portrait layout for mobile",
      "mock.t5": "Fix the chat pane's bottom-snap logic on resize",
      "mock.t6": "Investigate right-panel state drift after session restore",
      "mock.t7": "Speed up terminal-pane repaints after drag-resize",
      "mock.userMsg":
        "Create a smart Gomoku game where you play an AI that places strategic moves and judges wins accurately.",
      "mock.written": "Wrote",
      "mock.m3sep": ", ",
      "mock.m3and": " and ",
      "mock.inputPh": "Describe your next change…",
      "mock.addContext": "Add context",
      "mock.confirmEdit": "Confirm before edits",
      "mock.effort": "Max",
      "mock.terminal": "Terminal",
      "doc.install.lead":
        "No build needed — download the artifact for your platform and go. The whole flow takes about two minutes: download, install, connect a model on first launch.",
      "doc.install.sub.download": "Download",
      "doc.install.downloadNote":
        "Linux desktop installers are not provided yet — Linux users can start with the single-file CLI or build the desktop app from source.",
      "doc.install.sub.steps": "Install steps",
      "doc.install.step.mac": "macOS",
      "doc.install.stepMac":
        "Open the downloaded DMG, drag Drora into Applications, then launch it from Launchpad or the Applications folder.",
      "doc.install.step.win": "Windows",
      "doc.install.stepWin":
        "Run the downloaded .exe installer, follow the wizard, then launch from the Start menu or the desktop shortcut.",
      "doc.install.step.cli": "Agent CLI",
      "doc.install.stepCli":
        "A single-file executable: put it on your PATH or run it by path. It must be launched from a terminal — double-clicking flashes and exits. On first use, run",
      "doc.install.stepCliT": "to finish browser sign-in, then you can start asking.",
      "doc.install.update1":
        "The desktop app updates itself over the latest channel, and you can check manually via Help → Check for Updates; you can always download a newer build from Releases and install over the old one.",
      "doc.install.update2": "The single-file CLI does not update itself: download the new",
      "doc.install.update2t": " and replace the old file.",
      "doc.install.sub.proxy": "Network proxy",
      "doc.install.proxy1":
        "On a corporate network or behind a proxy, set the address under the HTTP proxy setting (e.g. http://127.0.0.1:7890) — outbound traffic from models, MCP, command tools and the app's rendering layer all goes through it.",
      "doc.install.proxyDirect":
        "Empty does not mean follow-the-system: with the field empty, traffic connects directly and system proxy environment variables are ignored — the usual reason the terminal has network but the app does not.",
      "doc.install.proxyTh1": "Setting",
      "doc.install.proxyTh2": "What it does",
      "doc.install.proxyTd1": "HTTP proxy",
      "doc.install.proxyTd1d": "e.g. http://127.0.0.1:7890; empty means direct connection",
      "doc.install.proxyTd2": "Bypass list",
      "doc.install.proxyTd2d": "Comma-separated hosts that connect directly without the proxy",
      "doc.install.proxyTd3": "Custom certificate",
      "doc.install.proxyTd3d":
        "Path to a PEM root certificate (for corporate HTTPS-inspection gateways); injected as NODE_EXTRA_CA_CERTS into models, MCP and command tools",
      "doc.install.proxyCli":
        "Proxy changes take effect after an app restart. On the CLI side, in the user config file ",
      "doc.install.proxyCliT": " set ",
      "doc.install.proxyCliM": ", ",
      "doc.install.proxyCliM2": ", and ",
      "doc.install.proxyCliE": " — same semantics.",
      "doc.install.sub.windows": "Windows-specific",
      "doc.install.windows":
        "In Settings you can enable \"hide to tray on close\": the close button then only hides the window into the system tray, and quitting from the tray menu fully exits the app. Windows only.",
      "doc.install.sub.trouble": "Troubleshooting",
      "doc.install.trouble.mac": "macOS says the app is damaged and can't be opened",
      "doc.install.troubleMac": "This is Gatekeeper quarantining an unsigned package, as expected. Run",
      "doc.install.troubleMacT": " to remove the quarantine, then open the app.",
      "doc.install.trouble.win": "Windows blocks install or launch",
      "doc.install.troubleWin":
        "Choose \"More info → Run anyway\" at the SmartScreen prompt. The packages are not code-signed, so prompts from security software are expected.",
      "doc.install.trouble.cli": "CLI reports permission denied",
      "doc.install.troubleCli": "Single files downloaded on macOS / Linux need the execute bit:",
      "doc.install.troubleCliT": " before running.",
      "doc.install.sub.more": "Learn more",
      "doc.sessions.lead":
        "Every session keeps a full history: messages, tool calls and file changes can be replayed, with checkpoints as a safety net. Spot a mistake in an earlier instruction? No need to start over — edit the sent message, or reset that turn along with its file changes. Files the agent changed can be undone at any time, and interrupted tasks resume from the task list.",
      "doc.sessions.sub.edit": "Edit a sent message",
      "doc.sessions.editEntry":
        "Hover over one of your own sent messages in the conversation: a quick-action area appears on the right, where the pencil icon is the edit entry alongside copy and other common actions.",
      "doc.sessions.editTrait1":
        "Editing only appears on user messages: you revise your own instruction, never the agent's reply itself.",
      "doc.sessions.editTrait2":
        "Once you send the revision, the agent rewinds and truncates that turn, then re-runs it with your new text; attachments from the original message are kept by default, no re-upload needed.",
      "doc.sessions.editTrait3":
        "Especially useful for long tasks: keep the model, workspace and context of the current task and fix only the key instruction — a wrong goal, path or constraint does not require creating a new task.",
      "doc.sessions.sub.resetFiles": "Reset along with files",
      "doc.sessions.resetFiles":
        "If the previous turn went beyond wording and the agent edited files under a wrong understanding, \"conversation + files reset\" does two things at once: restore the files changed in that turn, then resend with your revised message.",
      "doc.sessions.resetFilesLimit":
        "The entry is unavailable while a task is running, context is compacting, or an interaction is pending. If some files cannot be restored safely (say you edited one by hand in the meantime), you'll see \"files cannot be reset safely\" and can choose \"reset conversation only and send\".",
      "doc.sessions.sub.queue": "Edit queued messages",
      "doc.sessions.queue1":
        "While the agent is still replying, what you type next enters a queue and is sent in order. Spot a mistake before it goes out? Hover over the entry in the queue panel and click \"edit\": the whole message returns to the composer (removed from the queue) for you to revise and resend.",
      "doc.sessions.queue2":
        "One prerequisite: if the composer already holds a draft, send or clear it first before editing a queued message. If the queue pauses after an interrupt or an error, nothing is lost — click \"resume\" to continue sending in order.",
      "doc.sessions.sub.undo": "Undo files the agent changed",
      "doc.sessions.undo1":
        "The file-change summary under each reply has an \"undo\" button. Clicking it first opens a confirmation dialog listing which files can be safely undone, which cannot, and which will be ignored — only after you confirm are changes written. After undoing, the button becomes \"reapply\" so you can change it back.",
      "doc.sessions.undoAll":
        "One important rule: all or nothing. If even one file cannot be restored safely, nothing is written — you never end up half-reverted.",
      "doc.sessions.undoLimit":
        "Some changes cannot be undone here: file changes made by terminal commands are ignored outright — handle those with Git — and files with no checkpoint record, modified externally, or unreadable are classed as \"cannot be undone safely\".",
      "doc.sessions.sub.fork": "Fork a session",
      "doc.sessions.fork1":
        "Assistant messages carry a \"fork\" action: it copies the conversation from that point into a new task. A fork copies conversation content only — the original task's run state and workspace files are untouched — which suits retrying from a certain step in a different direction. Forking is available once the task has ended.",
      "doc.sessions.sub.scenarios": "When this helps",
      "doc.sessions.sc1": "Fix the wording: the previous instruction had a mistake, missed the goal, or was unclear.",
      "doc.sessions.sc2": "Add missing context: file paths, error logs, constraints and more.",
      "doc.sessions.sc3":
        "Change direction: switch the agent from \"analyze the problem\" to \"fix it directly\", or from \"implement it\" to \"propose a plan first\".",
      "doc.sessions.sc4":
        "Cut repetition: skip re-explaining the background and keep the task moving in the same context.",
      "doc.mcp.lead":
        "MCP (Model Context Protocol) brings external capabilities — file systems, databases, web search and more — into the agent: once a server is configured, its tools join the agent's tool surface automatically. Plugins bundle skills, commands, subagents, hooks and MCP servers into one extension package that installs with a click from the in-app marketplace.",
      "doc.mcp.sub.manage": "Manage MCP servers",
      "doc.mcp.manage1":
        "Find them under Settings → MCP servers. The list has two groups: configured servers you added by hand (editable, deletable, toggleable) and plugin MCP servers provided by enabled plugins, managed together with their plugin.",
      "doc.mcp.manage2":
        "Click \"new MCP server\" to create one: pick a scope first (user applies to all workspaces, workspace to the current project only), then fill in the name and type.",
      "doc.mcp.manageStdio":
        "Type stdio is a local command: fill in the command and arguments (e.g. command npx, arguments -y @modelcontextprotocol/server-memory), and pass credentials via environment variables when needed.",
      "doc.mcp.manageRemote":
        "Types HTTP / SSE are remote services: fill in the service URL, expanding request headers to add Authorization and the like when authentication is needed. The form also offers a timeout and a protocol version (auto / legacy); with JSON at hand, switch to full-config mode and paste it directly.",
      "doc.mcp.sub.files": "Config files & scopes",
      "doc.mcp.files1":
        "MCP configuration lives in local files, kept in sync with the settings panel. Within the same scope, both the Drora-native format and the .agents-compatible format work:",
      "doc.mcp.thScope": "Scope",
      "doc.mcp.thPath": "File path",
      "doc.mcp.thKey": "Config key",
      "doc.mcp.tdScopeUser": "User (all workspaces)",
      "doc.mcp.tdScopeWorkspace": "Workspace (current project only)",
      "doc.mcp.tdScopeUserAgents": "User · .agents-compatible",
      "doc.mcp.tdScopeWorkspaceAgents": "Workspace · .agents-compatible",
      "doc.mcp.filesNote":
        ".agents/mcp.json uses the industry-standard mcpServers structure, easy to share across tools. Disabling a server writes ",
      "doc.mcp.filesNoteT": " as ",
      "doc.mcp.filesNoteE": "; without the field a server counts as enabled.",
      "doc.mcp.filesWarn":
        "Workspace config is committed with the repo, so teammates get the same MCP setup by opening the project. An MCP config declares local commands to launch and network addresses to reach — before opening an unfamiliar repository, check the MCP config in its .drora/config.json first.",
      "doc.mcp.sub.import": "Import from other agents",
      "doc.mcp.import1":
        "The import entry on the Settings → MCP servers page scans other agent tools' MCP configs on this machine, including Claude Code, Codex CLI, OpenCode and generic .agents configs. Pick a scope (global or project), check the entries, and import in one click — results are written into Drora's own config files.",
      "doc.mcp.sub.oauth": "OAuth & credentials",
      "doc.mcp.oauth1":
        "Some HTTP / SSE remote services require browser authorization: click \"open authorization\" on the server's row in the list and complete the browser flow once. Plugin-provided MCP servers support this too — their row shows \"authorization required\".",
      "doc.mcp.oauth2":
        "Local stdio services have no authorization flow — credentials pass in through environment variables. An unfinished or timed-out authorization only marks that server as failed (prompting you to authorize again); it never blocks the session.",
      "doc.mcp.sub.plugins": "Plugin marketplace",
      "doc.mcp.plugins1":
        "A plugin bundles skills, commands, subagents, hooks and MCP servers into one extension package: enabling it registers everything together, disabling it stops it all at once. Find it in the in-app marketplace under Settings (a workspace must be open first).",
      "doc.mcp.plugins2":
        "The store splits into two segments, public and personal: public is the official drora-plugins-official marketplace (built-in plugins plus CDN-distributed ones); personal aggregates marketplace sources you registered yourself (GitHub repos, Git URLs, plain URLs, local directories), added, refreshed and removed in the sources panel.",
      "doc.mcp.plugins3":
        "The manage-installed view holds the per-plugin controls: enable / disable, check for updates, and uninstall.",
      "doc.mcp.pluginsWarn":
        "Plugins can carry hooks, MCP servers and skills — enabling one means trusting its contents. Verify the source before installing third-party plugins.",
      "doc.mcp.pluginsRemote":
        "For remote development, \"sync plugins\" and \"sync MCP\" copy your local user-level plugins and MCP config to an SSH remote workspace.",
      "doc.mcp.sub.usage": "Using them in sessions",
      "doc.mcp.usage1":
        "Enabled MCP servers connect automatically as sessions start, and their tools join the agent's tool surface for the model to call as needed; the list shows each server's connection status and available tool count.",
      "doc.mcp.usage2":
        "On connection failures, follow the status hints: invalid config — check the fields; unreachable — check network and proxy; protocol negotiation failure — switch the protocol version to legacy when editing the server.",
      "doc.faq.lead":
        "Answers to frequent questions about install & update, model connections, agent behavior and data migration.",
      "doc.faq.sub.install": "Install & update",
      "doc.faq.sub.model": "Models & connections",
      "doc.faq.q5": "My terminal already has a GLM environment set up — do I still configure it in the app?",
      "doc.faq.a5":
        "Yes. Model connections are made inside the app: on desktop, sign in to your Z.ai account in Settings or add a Base URL and API Key manually under model providers; on the CLI, run",
      "doc.faq.a5t":
        " to finish browser sign-in. Terminal environment variables and these entry points are independent — see",
      "doc.faq.q6": "An MCP server fails to connect — what now?",
      "doc.faq.a6":
        "Check the server's status and failure reason under Settings → MCP servers: invalid config — check the fields; unreachable — check network and proxy; protocol negotiation failure — switch the protocol version to legacy when editing; authorization required — open authorization again. See",
      "doc.faq.sub.agent": "Agent behavior",
      "doc.faq.q7": "Why does auto-compaction trigger before the context is full?",
      "doc.faq.a7":
        "Auto-compaction never waits for a full window: the trigger point is the context window minus the output reserve minus the safety buffer, leaving the model room to answer (reserve defaults to 32K, buffer to 13K); with nothing configured, the window is computed as 200K. Smaller windows trigger earlier — that's normal. You can edit each model's real context window under Settings → model providers; once it's accurate, compaction kicks in later.",
      "doc.faq.q8": "Sent a wrong instruction, or files got changed badly?",
      "doc.faq.a8":
        "No need to start over: hover a sent message and click \"edit\" to revise and resend; use \"conversation + files reset\" to roll files back; the file-change summary under each reply supports \"undo / reapply\". See",
      "doc.faq.sub.data": "Data & migration",
      "doc.faq.q9": "Switching computers — which config files do I copy?",
      "doc.faq.a9":
        "Copy these to the same locations on the new machine and you'll carry over nearly all of your configuration:",
      "doc.faq.thPath": "Path",
      "doc.faq.thWhat": "What it holds",
      "doc.faq.tdConfig": "Agent config: MCP servers, permission defaults, plugin & skill toggles, hooks and more",
      "doc.faq.tdAgents": "Global rules",
      "doc.faq.tdSkills": "User-level skills",
      "doc.faq.tdProject": "Project-level config — travels with the repo, no separate copy needed",
      "doc.faq.a9no":
        "Two files you should not copy: ~/.drora/v2/credentials.json (login credentials are stored encrypted — just sign in again on the new machine) and ~/.drora/v2/telemetry-state.json (holds a device identity, not meant to be shared across machines). Session data (~/.drora/cli/db/) can be moved if you need it.",
      "doc.faq.q10": "Where do I check the version number?",
      "doc.faq.a10":
        "On desktop, the current version is under the Help → About Drora menu, and Help → Check for Updates flags new releases; on the CLI, run",
      "doc.model.intro":
        "Drora supports several ways to connect a model: signing in to a Z.ai / BigModel account for Coding Plan on desktop is recommended; you can also connect common model services with an API key, or add a fully custom endpoint. All providers are managed under Settings → Model settings.",
      "doc.model.sub.plan": "Account sign-in (recommended)",
      "doc.model.plan.p1": "On desktop, choose to sign in with ",
      "doc.model.plan.or": " or ",
      "doc.model.plan.p1t":
        " on the welcome screen or under Settings → Model settings: the browser opens the authorization page, credentials are stored locally after approval, and the available model list refreshes automatically.",
      "doc.model.plan.p2": "From the CLI, ",
      "doc.model.plan.p2t": " runs the browser authorization; add ",
      "doc.model.plan.p2t2": " to open the authorization URL manually when no browser is available. ",
      "doc.model.plan.p2t3": " clears the saved sign-in credentials; in a session you can also use ",
      "doc.model.plan.and": " and ",
      "doc.model.sub.catalog": "Connect with an API key",
      "doc.model.catalog.p1":
        "Under Settings → Model settings → Add provider, pick a template from the provider catalog and paste your API key. The catalog covers common official and aggregated services:",
      "doc.model.th.provider": "Provider",
      "doc.model.th.desc": "Description",
      "doc.model.tp.zhipu": "Z.ai API / BigModel API",
      "doc.model.td.zhipu": "Zhipu open-platform endpoints — the API path besides Coding Plan",
      "doc.model.tp.first": "Anthropic / OpenAI / xAI",
      "doc.model.td.first": "First-party APIs",
      "doc.model.tp.openrouter": "OpenRouter",
      "doc.model.td.openrouter": "Aggregated access to many models",
      "doc.model.tp.cn": "Kimi / MiniMax / DeepSeek / Alibaba Cloud Model Studio / Xiaomi MiMo",
      "doc.model.td.cn": "China-based model services",
      "doc.model.tp.custom": "Custom endpoint",
      "doc.model.td.custom": "Any service speaking the API formats below",
      "doc.model.catalog.note": "The provider catalog ships with the client (repo ",
      "doc.model.catalog.notet": ", 20 templates today); you can also point it at a local config file — see ",
      "doc.model.sub.custom": "Custom model services",
      "doc.model.custom.p1":
        "For services outside the catalog, choose Custom endpoint and fill in a name, the API key, and these fields:",
      "doc.model.th.field": "Field",
      "doc.model.th.fielddesc": "Description",
      "doc.model.tf.baseurl": "Base URL",
      "doc.model.tfd.baseurl": "API address of the model service",
      "doc.model.tf.modelid": "Model ID",
      "doc.model.tfd.modelid": "Model name sent with requests; add as many models as you need",
      "doc.model.tf.format": "API format",
      "doc.model.tfd.format": "One of three: ",
      "doc.model.tfd.format2": ", ",
      "doc.model.tfd.format3": ", or ",
      "doc.model.custom.p2": "Each model can also configure its ",
      "doc.model.tf.ctx": "context window",
      "doc.model.custom.sep1": ", ",
      "doc.model.tf.maxout": "max output tokens",
      "doc.model.custom.sep2": ", ",
      "doc.model.custom.modalities":
        "input modalities (text / image / video / PDF), and optional reasoning levels. With smart defaults enabled, Drora matches recommended settings by model ID, base URL, and API format; fields you edit manually stop following updates while the rest keep syncing.",
      "doc.model.sub.params": "Model parameters and network",
      "doc.model.params.thought":
        "The thinking level control in the chat composer adjusts how much the model reasons before answering — higher is usually steadier but slower; the available levels come from the current model's reasoning-level configuration.",
      "doc.model.params.proxy":
        "Settings → HTTP proxy routes egress traffic for models, MCP, command tools, and the app rendering layer through one proxy without reading system environment variables; leave it empty to connect directly (the embedded browser follows the system proxy). Changes take effect after restarting the app.",
      "doc.model.sub.verify": "Verify and switch",
      "doc.model.verify.p1":
        "Every model configuration offers a test action that sends a fixed probe message to verify connectivity. In a session, switch models from the chat toolbar's Manage models or with ",
      "doc.model.verify.p1t": "; tokens actually consumed and call counts are shown in ",
      "doc.model.sub.env": "Related environment variables",
      "doc.model.th.env": "Variable",
      "doc.model.th.envdesc": "Description",
      "doc.model.td.envfile": "Path to a local provider config file; the built-in config is used when unset",
      "doc.model.env.p2": "For service addresses and build configuration examples, see the repo's ",
      "doc.model.env.and": " and ",
      "doc.remoteDev.intro":
        "Besides local projects, Drora can also put your workspace on a remote host, a WSL distro, a local container, or a running Drora server: once connected, file reads, terminal commands, Git operations, and the Agent all run in the target environment — the local window only renders and interacts.",
      "doc.remoteDev.sub.methods": "Connection types",
      "doc.remoteDev.methods.p1":
        "Pick Remote connection in the workspace sidebar, then choose a type and fill in its settings in the wizard:",
      "doc.remoteDev.th.kind": "Type",
      "doc.remoteDev.th.kinddesc": "Use case",
      "doc.remoteDev.tk.ssh": "SSH",
      "doc.remoteDev.td.ssh": "Work on a remote Linux host, keeping code and runtime on your dev machine",
      "doc.remoteDev.tk.wsl": "WSL",
      "doc.remoteDev.td.wsl": "Open a Linux workspace through a WSL distro on Windows",
      "doc.remoteDev.tk.docker": "Docker",
      "doc.remoteDev.td.docker": "Open a project inside a local container for a clean, disposable environment",
      "doc.remoteDev.tk.server": "Server",
      "doc.remoteDev.td.server": "Attach to a running Drora server and open its workspaces directly",
      "doc.remoteDev.sub.connect": "Connection steps",
      "doc.remoteDev.connect.p1":
        "The wizard runs type → settings → connect → pick directory; once connected, choose the directory to open in the current window.",
      "doc.remoteDev.connect.ssh": "SSH",
      "doc.remoteDev.connect.sshp1": "Enter the host, port, and username, then choose ",
      "doc.remoteDev.connect.pwd": "password",
      "doc.remoteDev.connect.or": " or ",
      "doc.remoteDev.connect.key": "private key",
      "doc.remoteDev.connect.sshp2":
        " (passphrase optional). If your local SSH config has aliases, pick one to auto-fill host, port, username, and key path.",
      "doc.remoteDev.connect.wsl": "WSL",
      "doc.remoteDev.connect.wslp1":
        "Installed WSL distros are detected automatically; after picking one you can specify the Linux user that runs commands (leave empty for the distro default). Opening a path like ",
      "doc.remoteDev.connect.wslp2": " suggests switching to a WSL remote connection.",
      "doc.remoteDev.connect.docker": "Docker",
      "doc.remoteDev.connect.dockerp1": "Pick a running local container, then a directory inside it.",
      "doc.remoteDev.sub.assets": "Remote asset preparation",
      "doc.remoteDev.assets.p1":
        "The first time you connect to an SSH environment, Drora prepares the Agent runtime assets on the target host. Two download modes are available:",
      "doc.remoteDev.th.mode": "Mode",
      "doc.remoteDev.th.modedesc": "Description",
      "doc.remoteDev.tm.local": "Download locally, then upload",
      "doc.remoteDev.tdm.local":
        "Downloaded on this machine and uploaded over SFTP; also reliable when the server has no outbound internet access",
      "doc.remoteDev.tm.remote": "Download on the remote server",
      "doc.remoteDev.tdm.remote":
        "Cuts upload waiting; requires the server to reach the Drora CDN and have download, extract, and checksum tools",
      "doc.remoteDev.sub.sync": "Sync to the remote environment",
      "doc.remoteDev.sync.p1":
        "Once connected, you can sync capabilities already configured locally from the settings — entries live under Skills, Plugins, and MCP. Provider configs and synced account credentials are also passed to the target environment automatically while the connection is alive, so there is no second sign-in on the remote side.",
      "doc.remoteDev.sub.web": "Self-hosted web service",
      "doc.remoteDev.web.p1":
        "The CLI distribution can expose a workspace as a browser-accessible web service for desktop-free remote development:",
      "doc.remoteDev.web.p2": "Web mode listens on ",
      "doc.remoteDev.web.p2t":
        " and opens a browser by default; on non-loopback addresses an access token is generated — use the tokenized link printed in the terminal, or set one with ",
      "doc.remoteDev.web.p2t2": " or disable auth with ",
      "doc.remoteDev.web.p2t3": ". For a self-hosted backend, ",
      "doc.remoteDev.web.p2t4": " selects the workspace path; when deploying the general web service directly, ",
      "doc.remoteDev.web.p2t5": " configures API/WebSocket authentication.",
      "doc.remoteDev.sub.notes": "Notes",
      "doc.remoteDev.notes.p1":
        "Sessions, files, and terminal commands all run in the target environment under the remote account, not your local user. Auth defaults vary by entry point and listen address — don't treat a dev server or a local core port as safe to expose. To continue desktop sessions on your phone, see ",
      "doc.skills.intro":
        "Skills package reusable working instructions as first-class assets so the Agent handles a given task the same way every time; slash commands are lightweight prompt shortcuts. Both can be customized in the workspace or your user directory.",
      "doc.skills.sub.skills": "Skills",
      "doc.skills.skills.p1": "A skill is a ",
      "doc.skills.skills.p1t":
        " in a directory: frontmatter declares the name and when to use it, and the body is instructions the model follows. In a session the model can invoke it on its own from the description, or you can use ",
      "doc.skills.skills.p1t2": " to force the next turn to load a specific skill:",
      "doc.skills.sub.anatomy": "SKILL.md anatomy",
      "doc.skills.th.fm": "Field",
      "doc.skills.th.fmdesc": "Description",
      "doc.skills.td.name":
        "Skill name used when invoking and looking up; falls back to the directory name when omitted",
      "doc.skills.td.desc": "One-line summary of what the skill does; the model uses it to decide applicability",
      "doc.skills.td.when": "Optional; adds trigger context so the model invokes it at the right time",
      "doc.skills.anatomy.note": "Skills with frontmatter must provide ",
      "doc.skills.anatomy.notet": " and ",
      "doc.skills.anatomy.notet2":
        "; missing or over-long descriptions are reported as scan diagnostics. The body is plain Markdown with no case requirements.",
      "doc.skills.sub.locations": "Where skills live",
      "doc.skills.th.scope": "Scope",
      "doc.skills.th.dir": "Directories",
      "doc.skills.ts.project": "Project",
      "doc.skills.td.agents": " and ",
      "doc.skills.ts.user": "User",
      "doc.skills.ts.plugin": "Plugin / built-in",
      "doc.skills.td.plugin":
        "Shipped with plugins (referenced as plugin:skill); built-in skills such as dynamic-workflows",
      "doc.skills.locations.p1":
        "Project scope scans more than the current directory: every level from the working directory up to the Git repository root is included, so monorepo sub-packages can carry their own skills. Within one directory ",
      "doc.skills.locations.p1t": " wins over ",
      "doc.skills.locations.p1t2": ", and both can coexist.",
      "doc.skills.sub.commands": "Built-in slash commands",
      "doc.skills.commands.p1": "Type ",
      "doc.skills.commands.p1t":
        " to see every available command; built-ins cover session, model, permission, and workflow management:",
      "doc.skills.th.cmd": "Command",
      "doc.skills.th.cmddesc": "Purpose",
      "doc.skills.cmd.help": "Show slash command help",
      "doc.skills.cmd.login": "Set up or clear the Coding Plan sign-in",
      "doc.skills.cmd.compact": "Compact the current conversation, with optional summary instructions",
      "doc.skills.cmd.init": "Create or update the workspace AGENTS.md",
      "doc.skills.cmd.expert": "Run or manage the expert workflow",
      "doc.skills.cmd.effort": "Show or switch the session reasoning effort",
      "doc.skills.cmd.dwf": "List, cancel, or resume dynamic workflow runs",
      "doc.skills.cmd.fork": "Fork a new session from a workspace checkpoint",
      "doc.skills.cmd.locale": "Show or switch the UI locale",
      "doc.skills.cmd.mcp": "Show or manage configured MCP servers",
      "doc.skills.cmd.plugins": "Open the plugin manager",
      "doc.skills.cmd.mode": "Show or switch the permission mode",
      "doc.skills.cmd.model": "Show or switch the current session model",
      "doc.skills.cmd.new": "Start a fresh session",
      "doc.skills.cmd.resume": "Resume a saved session",
      "doc.skills.cmd.rewind": "Inspect or restore workspace checkpoints",
      "doc.skills.cmd.skill": "List skills, or force the next prompt to load one",
      "doc.skills.cmd.goal": "Show, set, or manage the session goal",
      "doc.skills.cmd.workflow": "Design and launch a dynamic workflow for a task",
      "doc.skills.sub.custom": "Custom commands",
      "doc.skills.custom.p1": "Save frequently used prompts as a ",
      "doc.skills.custom.p1t": " file under project ",
      "doc.skills.custom.or": " or ",
      "doc.skills.custom.p1t2": " (user level: ",
      "doc.skills.custom.and": " and ",
      "doc.skills.custom.p1t3": "), then pick it after typing ",
      "doc.skills.custom.p1t4": ":",
      "doc.skills.th.fm2": "Field",
      "doc.skills.th.fm2desc": "Description",
      "doc.skills.tfd.desc": "What the command does; shown in the suggestion list",
      "doc.skills.tfd.hint": "Argument hint, e.g. [extra notes]",
      "doc.skills.tfd.skills": "Load the listed skills before the command body runs",
      "doc.skills.tfd.noninteractive":
        "Marks the command as interactive-only; flagged commands are excluded from the app's / command panel directory",
      "doc.skills.tfd.meta":
        "Recognized metadata fields, visible via drora commands inspect; runtime enforcement is not wired up yet",
      "doc.skills.custom.args": "The command body supports ",
      "doc.skills.custom.argsAll": " for all arguments and ",
      "doc.skills.custom.argsPos":
        "-style positional ones; arguments passed without a placeholder are appended to the end of the prompt. Dynamic shell expansion like ",
      "doc.skills.custom.argsShell": " is not supported yet and errors at expansion time.",
      "doc.skills.sub.manage": "Manage and inspect",
      "doc.skills.manage.p1": "Both commands accept ",
      "doc.skills.manage.p1t": " for structured output; to sync skills and commands to a remote environment, see ",
      "doc.goal.intro.a": "For complex work that will take many rounds, set a goal for the current session with",
      "doc.goal.intro.b":
        "Once set, the agent keeps working toward it: every round ends with an automatic verification, and if the goal isn't met it starts the next round on its own — finishing only once completion is confirmed. No more babysitting the agent step by step.",
      "doc.goal.li1":
        "Best for tasks that are easy to state but take many rounds: refactoring a module, clearing a batch of type errors, tuning a metric to a target value.",
      "doc.goal.li2":
        "The goal card in the summary panel shows status, token and time usage, and iteration count in real time.",
      "doc.goal.li3": "The todo list is grouped by iteration round, so you can see what each round accomplished.",
      "doc.goal.tip":
        "The more specific and verifiable the goal, the steadier the auto-continuation: name the files to change, the tests to pass, the metrics to hit.",
      "doc.goal.set.h": "Setting a goal",
      "doc.goal.set.p1.a": "Type",
      "doc.goal.set.p1.b":
        "plus one sentence in the session input to set a goal. A session has at most one goal at a time; bare",
      "doc.goal.set.p1.c": "shows the current goal at any time:",
      "doc.goal.set.p2.a": "A goal is at most 4000 characters. Setting one without",
      "doc.goal.set.p2.b":
        "asks for confirmation before overwriting an existing goal. In headless mode you can also set a goal for a single run:",
      "doc.goal.set.p3":
        "The goal card in the summary panel shows the objective and its status (active / paused / budget limited / complete), plus token and time usage and the number of iterations so far; todos are grouped as “Iteration N”, each item belonging to the round where it first appeared.",
      "doc.goal.verify.h": "Automatic verification every round",
      "doc.goal.verify.p1":
        "At the end of every round, the runtime runs an independent completion check that audits the actual state against the goal and produces a pass/fail verdict, a reason, and a suggested next action. On failure the result is injected into the next round; only on pass is the goal marked complete and wrapped up.",
      "doc.goal.verify.p2":
        "The check looks at real evidence — changed files, command output, test results. Unfinished todos are never judged complete, and the verdict belongs to the verifier: the model cannot declare completion by itself. Each verification appears in the timeline as a divider:",
      "doc.goal.verify.li1": "Verifying goal…",
      "doc.goal.verify.li2": "Goal not met — continuing",
      "doc.goal.verify.li3": "Goal complete — task finished",
      "doc.goal.intervene.h": "Stepping in mid-run",
      "doc.goal.intervene.p1":
        "You can pause, resume or clear a goal at any time: pausing keeps the context, and resuming continues from the current state. Automatic progression stops in only three situations:",
      "doc.goal.intervene.li1": "the completion check passes and the goal wraps up;",
      "doc.goal.intervene.li2": "you pause or clear it yourself;",
      "doc.goal.intervene.li3":
        "you interrupt a running round — the verification is cancelled and the goal waits for your next instruction.",
      "doc.goal.limits.h": "When a goal can't be set",
      "doc.goal.limits.li1":
        "Plan mode: planning conflicts with auto-continuation, so the goal is recorded but never auto-continued — switch to another mode before setting one.",
      "doc.goal.limits.li2": "While a task is running: wait for it to finish or stop it first, then set the goal.",
      "doc.goal.modes.h": "Pairing with permission modes",
      "doc.goal.modes.p1":
        "Goals and permission modes have separate jobs: the goal decides “when it's done”, the mode (build / edit / plan / yolo) decides “which actions need confirmation”. Long goals pair well with more autonomous modes so progress isn't interrupted; for goals touching critical changes, a stricter mode keeps every step confirmed.",
      "doc.goal.modes.p2": "For the full command and headless flag list, see",
      "doc.remote.intro":
        "Phone remote control temporarily opens the current desktop window to your phone: turn it on in the desktop app, then scan a QR code or open a link. The phone is only a control surface — it never syncs code or creates environments; your instructions still run on the desktop's existing host, without spawning another agent.",
      "doc.remote.scen.h": "When it's useful",
      "doc.remote.scen.li1": "Keep an eye on running tasks and their progress after leaving your desk.",
      "doc.remote.scen.li2":
        "Send follow-up instructions from your phone; inputs submitted while running are queued and admitted serially by the runtime — nothing gets lost.",
      "doc.remote.scen.li3":
        "Step out mid-way through a long task or goal: check progress anytime and pick up seamlessly when you're back.",
      "doc.remote.connect.h": "Connecting by QR code",
      "doc.remote.connect.p1":
        "Open “Phone remote control” from the desktop sidebar: the dialog shows a QR code and a link you can copy or refresh, with the connection state at a glance — waiting for phone, connecting, phone connected. Note that the phone connects to the whole desktop window: it sees the workspaces and tasks open in that window, not just a single workspace.",
      "doc.remote.connect.p2": "There are two transports:",
      "doc.remote.th.transport": "Transport",
      "doc.remote.th.tdesc": "Details",
      "doc.remote.td.lan": "LAN",
      "doc.remote.td.land":
        "Direct connection when the phone and computer share a LAN — no external service involved. The QR code is the pairing entry and can be refreshed with one click.",
      "doc.remote.td.relay": "Cloud relay",
      "doc.remote.td.relayd":
        "Across networks, traffic is forwarded through a relay so the phone doesn't need to share the computer's network. The relay only authenticates, pairs, keeps heartbeat and forwards — it stores no business state such as task queues. A self-hosted relay address can be configured in settings.",
      "doc.remote.phone.h": "What the phone can do",
      "doc.remote.phone.home": "Task home",
      "doc.remote.phone.home.p":
        "Lists the computer's workspaces and tasks grouped by workspace, with running states at a glance, and lets you start a new task in an existing workspace.",
      "doc.remote.phone.task": "Session view",
      "doc.remote.phone.task.p":
        "Opening a task shows its session: the conversation timeline and the agent's progress, with an input box to send follow-up instructions. While the phone operates a task, the desktop task list marks it as “being operated from a phone”.",
      "doc.remote.where.h": "Where commands actually run",
      "doc.remote.where.p1":
        "The phone creates no execution environment of its own. Where commands run depends on the workspace's connection type on the desktop:",
      "doc.remote.th.wstype": "Workspace type",
      "doc.remote.th.run": "Where code and commands run",
      "doc.remote.td.wlocal": "Local",
      "doc.remote.td.rlocal": "Your computer",
      "doc.remote.td.wssh": "SSH",
      "doc.remote.td.rssh": "The corresponding remote host",
      "doc.remote.td.wwsl": "WSL",
      "doc.remote.td.rwsl": "The corresponding WSL distro",
      "doc.remote.td.wdocker": "Docker",
      "doc.remote.td.rdocker": "The corresponding local container",
      "doc.remote.td.wserver": "Server",
      "doc.remote.td.rserver": "The corresponding Drora server",
      "doc.remote.safe.h": "Stopping and safety",
      "doc.remote.safe.p1":
        "The QR code and link are your pairing credentials — never forward them to untrusted parties; refresh the QR code to regenerate them if unsure. Closing the dialog does not stop remote control — press “Stop” when you're done.",
      "doc.remote.safe.note":
        "Quitting the desktop app or closing the window stops the remote-control service immediately — nothing lingers in the background. On the next launch the previous on-state can be restored automatically (not restored if you stopped it manually). Keep the desktop app running and online while remote control is on.",
      "doc.remote.faq.h": "FAQ",
      "doc.remote.faq.q1": "Can the phone create tasks or remote workspaces?",
      "doc.remote.faq.a1":
        "It can create new tasks in existing workspaces; but setting up a new remote connection (SSH / WSL / Docker / Server) requires the desktop connection wizard — the phone doesn't do that.",
      "doc.remote.faq.q2": "Can the phone open projects the desktop never opened?",
      "doc.remote.faq.a2":
        "No. The phone sees the workspaces and tasks already open or registered in the current desktop window — there is no free directory browsing.",
      "doc.hooks.intro":
        "Hooks run local commands automatically at specific event points — inject team conventions at session start, run safety checks before tool calls, append verification after the model stops. A hook is essentially a local subprocess protocol: the runtime writes the event as one line of JSON to the hook's stdin, and the hook answers via its exit code and stdout.",
      "doc.hooks.lifecycle.h": "Order and events",
      "doc.hooks.lifecycle.p1":
        "A session fires events in the order: session start → user prompt submitted → before tool use → permission request → after tool use → tool failure → model stop. Each event can carry multiple hooks, and hooks on the same event run in declaration order. There are 7 events:",
      "doc.hooks.th.event": "Event",
      "doc.hooks.th.matcher": "Matcher value",
      "doc.hooks.th.effect": "Effect",
      "doc.hooks.te.ss": "SessionStart",
      "doc.hooks.tm.ss": "Session source: startup / resume / clear / compact",
      "doc.hooks.tf.ss": "Add context when a session starts",
      "doc.hooks.te.ups": "UserPromptSubmit",
      "doc.hooks.tm.none": "— (not applicable)",
      "doc.hooks.tf.ups": "Add context, or block this model request",
      "doc.hooks.te.ptu": "PreToolUse",
      "doc.hooks.tm.tool": "Tool name (e.g. Bash)",
      "doc.hooks.tf.ptu": "Allow / ask / deny a tool call, or rewrite its input",
      "doc.hooks.te.pr": "PermissionRequest",
      "doc.hooks.tm.tool2": "Tool name",
      "doc.hooks.tf.pr": "Auto-allow or auto-deny a permission prompt",
      "doc.hooks.te.post": "PostToolUse",
      "doc.hooks.tm.tool3": "Tool name",
      "doc.hooks.tf.post": "Add context after a tool completes",
      "doc.hooks.te.postf": "PostToolUseFailure",
      "doc.hooks.tm.tool4": "Tool name",
      "doc.hooks.tf.postf": "Add context after a tool fails",
      "doc.hooks.te.stop": "Stop",
      "doc.hooks.tm.none2": "— (not applicable)",
      "doc.hooks.tf.stop": "Append context, or let the main model run another round",
      "doc.hooks.sources.h": "Configuration sources",
      "doc.hooks.src.th.source": "Source",
      "doc.hooks.src.th.where": "Location",
      "doc.hooks.src.th.trust": "Trust",
      "doc.hooks.src.ts.user": "User config",
      "doc.hooks.src.tw.user": "the hooks section of ~/.drora/cli/config.json",
      "doc.hooks.src.tt.user": "Your own config — takes effect directly",
      "doc.hooks.src.ts.proj": "Project config",
      "doc.hooks.src.tw.proj": "drora.json or .drora/config.json at the project root",
      "doc.hooks.src.tt.proj": "Trusted per workspace review — see safety below",
      "doc.hooks.src.ts.plugin": "Plugins",
      "doc.hooks.src.tw.plugin": "hooks/hooks.json inside the plugin directory",
      "doc.hooks.src.tt.plugin": "Installed and enabled together with the plugin",
      "doc.hooks.sources.note":
        "Hooks are off by default: both user and project configs need enabled: true in the hooks section to activate. Configuration changes take effect in new sessions and never disturb a session in progress.",
      "doc.hooks.start.h": "Quick start: your first hook",
      "doc.hooks.start.p1.a": "Add the following hooks section to your user config (",
      "doc.hooks.start.p1.b":
        "): before every Bash tool call, a guard script runs and decides whether to allow, escalate for confirmation, or deny:",
      "doc.hooks.start.p2":
        "The guard script reads the event JSON from stdin and prints one line of JSON to stdout to take part in the decision — for example, requiring manual confirmation for commands that touch the dist directory:",
      "doc.hooks.start.p3":
        "Open a new session and trigger a Bash call to verify: the guard's decision appears before the tool call, and denials with their reasons are recorded in the session.",
      "doc.hooks.exec.h": "Executors, timeouts and matchers",
      "doc.hooks.exec.p1": "Each hook picks one of two executor types:",
      "doc.hooks.exec.th.type": "type",
      "doc.hooks.exec.th.fields": "Key fields",
      "doc.hooks.exec.th.desc": "Description",
      "doc.hooks.exec.tt.proc": "process",
      "doc.hooks.exec.tf.proc": "command, args",
      "doc.hooks.exec.td.proc": "Runs as a child process directly, no shell parsing",
      "doc.hooks.exec.tt.cmd": "command",
      "doc.hooks.exec.tf.cmd": "command, async, shell, timeout / timeoutMs",
      "doc.hooks.exec.td.cmd": "Runs through a shell; runs in the background when async is true",
      "doc.hooks.exec.li1.a": "Timeouts: a hook gets 60 seconds by default (",
      "doc.hooks.exec.li1.b": "adjusts this globally); a hook's own",
      "doc.hooks.exec.li1.c": "wins, and a command hook's",
      "doc.hooks.exec.li1.d": "is measured in seconds. Timing out counts as a failure.",
      "doc.hooks.exec.li2.a": "Output cap: ",
      "doc.hooks.exec.li2.b": "defaults to 32 KiB; output beyond it is truncated.",
      "doc.hooks.exec.li3.a": "Background runs: a command hook with",
      "doc.hooks.exec.li3.b":
        "runs independently of the current round — its output never retroactively affects actions already taken.",
      "doc.hooks.exec.li4":
        "Matchers: omitting the matcher or using * matches everything; an a|b|c form matches exactly those values; anything else is treated as a regular expression.",
      "doc.hooks.stdin.h": "The stdin contract",
      "doc.hooks.stdin.p1":
        "The runtime writes one line of JSON to the hook's stdin. Every event carries the common session fields; tool events append tool fields, and Stop appends response fields. Common fields:",
      "doc.hooks.stdin.th.field": "Field",
      "doc.hooks.stdin.th.desc": "Description",
      "doc.hooks.stdin.f.session": "session_id",
      "doc.hooks.stdin.fd.session": "Session ID",
      "doc.hooks.stdin.f.event": "hook_event_name",
      "doc.hooks.stdin.fd.event": "Name of the fired event",
      "doc.hooks.stdin.f.mode": "permission_mode",
      "doc.hooks.stdin.fd.mode": "Current permission mode (build / edit / plan / yolo)",
      "doc.hooks.stdin.f.cwd": "cwd",
      "doc.hooks.stdin.fd.cwd": "Session working directory",
      "doc.hooks.stdin.f.trans": "transcript_path",
      "doc.hooks.stdin.fd.trans": "Path to a temp JSONL transcript of the session",
      "doc.hooks.stdin.f.tool": "tool_name / tool_input / tool_use_id",
      "doc.hooks.stdin.fd.tool": "Provided by tool events: tool name, input arguments and call ID",
      "doc.hooks.stdin.f.prompt": "prompt",
      "doc.hooks.stdin.fd.prompt": "Provided by UserPromptSubmit: the user's input",
      "doc.hooks.stdin.f.resp": "tool_response / last_assistant_message / stop_hook_active",
      "doc.hooks.stdin.fd.resp":
        "PostToolUse provides the tool result; Stop provides the final reply and whether a hook already continued the run",
      "doc.hooks.stdin.penv.a": "Environment: hook processes receive",
      "doc.hooks.stdin.penv.b": "and",
      "doc.hooks.stdin.penv.c": "(plugin hooks also get plugin root/ID variables); placeholders like",
      "doc.hooks.stdin.penv.d": "in command and args are expanded before the run.",
      "doc.hooks.output.h": "stdout, exit codes and common return values",
      "doc.hooks.output.p1":
        "With exit code 0, stdout is parsed as one line of JSON. Hooks that don't need a verdict can simply exit normally — non-JSON output is treated as diagnostics only. Common returns per event:",
      "doc.hooks.pre.h": "PreToolUse: deny or rewrite a tool call",
      "doc.hooks.pre.p1":
        "permissionDecision is allow, ask or deny; updatedInput replaces the tool input wholesale (the replacement is validated again):",
      "doc.hooks.perm.h": "PermissionRequest: auto-allow or auto-deny",
      "doc.hooks.perm.p1":
        "decision.behavior is allow or deny; allow can carry permissionUpdates to add rules to the permission config:",
      "doc.hooks.prompt.h": "UserPromptSubmit: add context or block the request",
      "doc.hooks.prompt.p1":
        "additionalContext is injected into this request; continue set to false blocks the input before the model call:",
      "doc.hooks.stop.h": "Stop: keep the main model going",
      "doc.hooks.stop.p1":
        "Set decision to block with a reason and the main model continues for another wrap-up round; at most 3 consecutive continuations, to prevent infinite loops:",
      "doc.hooks.exit.h": "Exit codes",
      "doc.hooks.exit.th.code": "Exit code",
      "doc.hooks.exit.th.meaning": "Meaning",
      "doc.hooks.exit.tc.zero": "0",
      "doc.hooks.exit.tm.zero": "Success: stdout is parsed as one line of JSON return value",
      "doc.hooks.exit.tc.two": "2",
      "doc.hooks.exit.tm.two":
        "Blocking: stderr (stdout as fallback) becomes the block reason — equivalent to a denial",
      "doc.hooks.exit.tc.other": "Other non-zero",
      "doc.hooks.exit.tm.other": "The hook itself failed (recoverable); the current action is unchanged",
      "doc.hooks.trust.h": "Safety boundary and trust review",
      "doc.hooks.trust.p1":
        "A hook is an arbitrary local command running outside any sandbox — only enable configurations you have reviewed. Project-level hooks record trust per workspace identity and declaration digest (SHA-256): the first sighting requires your confirmation in a review, and any change to the declaration triggers a fresh review. Run details (result, duration, block reason) are kept with the session, so you can see which hook blocked a request.",
      "doc.hooks.settings.h": "Managing hooks in Settings",
      "doc.hooks.settings.p1":
        "In the desktop app under “Settings → Hooks” you can create, edit, toggle and delete hooks — pick the event, the executor (process or shell command) and the matcher without hand-writing config. The same page also lists hooks from installed plugins and importable existing hook configurations.",
      "doc.hooks.next": "For the other way to extend the tool ecosystem, see",
      "doc.automation.sub.types": "Two kinds of automation",
      "doc.automation.types.p1":
        "Not every job needs to be started by hand: a daily change digest, a Friday release briefing, a batch of comment touch-ups — hand these to automation.",
      "doc.automation.types.th1": "Task type",
      "doc.automation.types.th2": "Trigger",
      "doc.automation.types.th3": "Cadence",
      "doc.automation.types.td1": "Scheduled task",
      "doc.automation.types.td2": "You set the time and repeat rule; it fires on schedule",
      "doc.automation.types.td3": "Runs repeatedly by plan, with an optional run cap or end date",
      "doc.automation.types.td4": "Idle-time task",
      "doc.automation.types.td5": "No timetable — it joins a global queue on submission",
      "doc.automation.types.td6": "Executes when compute is free, and runs once",
      "doc.automation.types.p2": "Both are managed in the in-app Automation area, split into",
      "doc.automation.types.p3": "and",
      "doc.automation.types.p4":
        "tabs; opening it never disturbs the session list on the left, and you can return to your original session at any time.",
      "doc.automation.sub.scheduled": "Create a scheduled task",
      "doc.automation.scheduled.p1": "There are three ways — they do the same thing, pick whichever feels natural.",
      "doc.automation.scheduled.h3.form": "Create with the form",
      "doc.automation.scheduled.form.p1": "Click Create scheduled task and fill in four things:",
      "doc.automation.scheduled.form.th1": "Field",
      "doc.automation.scheduled.form.th2": "Description",
      "doc.automation.scheduled.form.td1": "Title",
      "doc.automation.scheduled.form.td2": "Identifies the task in lists and history",
      "doc.automation.scheduled.form.td3": "Schedule",
      "doc.automation.scheduled.form.td4": "When it runs and how often — see Scheduling rules below",
      "doc.automation.scheduled.form.td5": "Instructions",
      "doc.automation.scheduled.form.td6":
        "Sent to the agent on every trigger; state clearly what to do and what to produce",
      "doc.automation.scheduled.form.td7": "Project / permission / model / reasoning",
      "doc.automation.scheduled.form.td8": "The toolbar under the instructions box — see Task configuration below",
      "doc.automation.scheduled.h3.chat": "Create from a session",
      "doc.automation.scheduled.chat.p1":
        "Click the arrow next to the create button and choose Create in session — the input box is pre-filled with a sample you can edit into your own request, for example:",
      "doc.automation.scheduled.chat.p2":
        "Tasks created this way bind to the current session: every later trigger delivers results back to the same session instead of opening a new one. After creation a task card appears in the session; click Go to scheduled task to jump to its details.",
      "doc.automation.scheduled.h3.template": "Create from a template",
      "doc.automation.scheduled.template.p1":
        "The automation home offers ready-made templates for both scheduled and idle-time tasks — click one to pre-fill the full instructions, tweak, and go.",
      "doc.automation.sub.schedule": "Scheduling rules",
      "doc.automation.schedule.p1":
        "Pick a frequency in the schedule field: hourly / daily / weekdays / weekly / monthly / custom. Choosing Custom opens the repeat dialog for finer rhythms:",
      "doc.automation.schedule.th1": "Dimension",
      "doc.automation.schedule.th2": "Options",
      "doc.automation.schedule.td1": "Repeat unit",
      "doc.automation.schedule.td2": "Minute, hour, day, week, month, year",
      "doc.automation.schedule.td3": "Interval",
      "doc.automation.schedule.td4": "Run once every N units, e.g. every 2 hours, every 3 days (1–200)",
      "doc.automation.schedule.td5": "Specific points",
      "doc.automation.schedule.td6": "Weekday, day of month, month, plus exact hour and minute",
      "doc.automation.schedule.td7": "By date or by weekday",
      "doc.automation.schedule.td8": "For monthly repeats: on the 15th, or on the third Monday",
      "doc.automation.schedule.p2":
        "When creating from a session you can also let the agent work from a 5-field cron expression (local timezone):",
      "doc.automation.schedule.h3.stop": "When does it stop",
      "doc.automation.schedule.stop.p1":
        "Scheduled tasks repeat forever by default. Two ways to stop automatically: set an end date in the custom repeat dialog — the task then moves to Completed; or set a max run count and turn off Repeat so it stops after a fixed number of runs.",
      "doc.automation.schedule.note1":
        "All times use your computer's local timezone. The task card shows the next run time and the run count.",
      "doc.automation.sub.config": "Task configuration",
      "doc.automation.config.p1":
        "The toolbar under the instructions box decides what identity and capabilities the task runs with:",
      "doc.automation.config.li1":
        "Project: which project directory the task runs in. Only local projects currently open in the window can be selected, and it cannot be changed after creation.",
      "doc.automation.config.li2":
        "Permission: the same execution modes as a session, deciding whether the agent may edit files and run commands on its own; defaults to the project default.",
      "doc.automation.config.li3":
        "Model / reasoning: pick the model and thinking depth for execution; leave empty to follow the project default.",
      "doc.automation.config.p2":
        "Because scheduled tasks run while you are away, permissions deserve extra thought — grant them when the agent should edit code on its own; keep read-only if you just want an analysis report.",
      "doc.automation.sub.manage": "Manage and run",
      "doc.automation.manage.h3.run": "Run now",
      "doc.automation.manage.run.p1":
        "Run now in the task menu executes once immediately without disturbing the plan — next run time, run count and on/off state stay untouched. If the previous trigger is still running, clicking again will not queue a second run; the UI says the previous run is still in progress.",
      "doc.automation.manage.h3.status": "Pause, edit, delete",
      "doc.automation.manage.status.p1":
        "Tasks have four states: running, paused, completed, failed. A paused task is kept but stops firing and can be resumed any time; unsaved edits prompt for confirmation before leaving the editor.",
      "doc.automation.manage.h3.history": "Run history",
      "doc.automation.manage.history.p1":
        "The task detail page switches between Settings and History. History records every trigger: running, succeeded, failed, stopped, and those skipped because the computer was asleep. Records with a session link can jump straight to what happened.",
      "doc.automation.sub.limits": "Things to know",
      "doc.automation.limits.li1":
        "The computer must stay awake. Scheduled tasks run on your machine and will not fire while it sleeps or the app is closed. For overnight or lunch-break tasks, turn on Keep computer awake in the automation area — one global switch shared by scheduled and idle-time tasks.",
      "doc.automation.limits.li2":
        "20 tasks at most. The total is shared across all projects; paused, completed and failed tasks all count, and only deleting a task definition frees a slot. Creation is blocked at the limit — clean up unneeded tasks first.",
      "doc.automation.limits.li3":
        "Local projects only. New tasks can only target local projects open in the current window; remote workspaces are not supported.",
      "doc.automation.sub.idle": "Idle-time tasks",
      "doc.automation.idle.p1":
        "Idle-time tasks have no timetable and run once: submit and they join a global queue, executing during low-peak hours when compute is free. Codebase analyses, a batch of comment touch-ups, documentation sync checks — any work that can wait a few hours is a good fit.",
      "doc.automation.idle.h3.prereq": "Prerequisites",
      "doc.automation.idle.prereq.p1":
        "Idle-time tasks require signing in and connecting a Z.AI or BigModel Coding Plan (personal or team); Start Plan and pure API-key mode are not supported. When the conditions are not met the entry point says so directly.",
      "doc.automation.idle.h3.create": "Create an idle-time task",
      "doc.automation.idle.create.p1":
        "Switch to the Idle-time tasks tab and click Create idle-time task, or start from an idle-time template. The form asks for:",
      "doc.automation.idle.create.th1": "Field",
      "doc.automation.idle.create.th2": "Description",
      "doc.automation.idle.create.td1": "Title",
      "doc.automation.idle.create.td2": "Pick a name you can recognize at a glance",
      "doc.automation.idle.create.td3": "Instructions",
      "doc.automation.idle.create.td4":
        "The entire task. Execution is unattended, so be complete and self-sufficient: what to do, what the output looks like, how to verify it",
      "doc.automation.idle.create.td5": "Project",
      "doc.automation.idle.create.td6":
        "Only local projects open in the current window; cannot be changed after creation",
      "doc.automation.idle.create.td7": "Permission",
      "doc.automation.idle.create.td8":
        "Defaults to ask before changes. Confirmations pause the task until you respond; switch to full access to reduce failures",
      "doc.automation.idle.create.td9": "Model / reasoning",
      "doc.automation.idle.create.td10": "Choose the model and reasoning level for this run",
      "doc.automation.idle.note1":
        "Commit to Git before creating an idle-time task — unattended runs change files, and a commit lets you roll back cleanly if you dislike the result.",
      "doc.automation.idle.h3.queue": "Queueing and execution",
      "doc.automation.idle.queue.li1":
        "Visible queueing: tasks queue in submission order and the card shows your position; you can review the configuration while waiting and fix anything you missed.",
      "doc.automation.idle.queue.li2":
        "No need to be present: execution starts automatically when your turn comes; go do something else.",
      "doc.automation.idle.queue.li3":
        "Long tasks continue: a single execution has a time cap; when it is reached the task re-takes a ticket and resumes the same session instead of starting over. Tasks and state are persisted — an app restart loses nothing.",
      "doc.automation.idle.queue.li4":
        "No promised start time: the queue follows the overall low-peak window; the UI never estimates when it will start. Cancel if you no longer want to wait.",
      "doc.automation.idle.h3.manage": "States and actions",
      "doc.automation.idle.manage.p1":
        "Tasks have six states: queued, paused, running, completed, failed, cancelled. The card menu follows the state:",
      "doc.automation.idle.manage.th1": "Current state",
      "doc.automation.idle.manage.th2": "Available actions",
      "doc.automation.idle.manage.td1": "Queued",
      "doc.automation.idle.manage.td2": "Pause, delete",
      "doc.automation.idle.manage.td3": "Paused",
      "doc.automation.idle.manage.td4": "Resume, delete",
      "doc.automation.idle.manage.td5": "Running",
      "doc.automation.idle.manage.td6": "Cancel, delete",
      "doc.automation.idle.manage.p2":
        "Tasks paused too long are put back into the queue and may land further back; when the ticket has expired, Resume re-queues the task at the tail. Failed tasks do not retry automatically — review the instructions and configuration, then submit a new task.",
      "doc.automation.idle.h3.sidebar": "Sidebar and history",
      "doc.automation.idle.sidebar.p1":
        "Idle-time tasks that have started executing appear as a row in the Idle-time tasks group in the left sidebar with a moon marker; click it to open the session. The detail page's History holds at most one record — instructions, trigger time, status and duration — with a row menu to open the session or delete the record.",
      "doc.automation.idle.h3.subagents": "Subagents",
      "doc.automation.idle.subagents.p1":
        "Foreground subagents work normally during idle-time tasks; background subagents are not supported — background dispatch fails with a clear error, and custom subagents configured with background execution will fail in idle-time tasks. See Foreground and background execution on the subagents page.",
      "doc.automation.sub.related": "Related pages",
      "doc.automation.related.p1": "To learn about the subagents mentioned here, see",
      "doc.automation.related.p2": "; to check session and plan consumption, see",
      "doc.subagents.sub.how": "How it works",
      "doc.subagents.how.p1":
        "When the main agent decides a task needs its own context or parallel research, it launches a subagent through the Agent tool. The subagent works in its own context and summarizes the result back into the main conversation, helping the main agent push the task forward.",
      "doc.subagents.how.p2":
        "Every subagent is a reusable role with its own name, description, tool permissions and system prompt. Reference one directly with @ in the session input, or leave the choice to the main agent — it picks automatically based on the description.",
      "doc.subagents.sub.general": "Built-in: general-purpose",
      "doc.subagents.general.p1":
        "general-purpose is the default generalist subagent with full tool permissions, suited to tasks that need reading, modifying, running commands or end-to-end progress in their own context. Good fits include:",
      "doc.subagents.general.li1": "Implementing a small feature or fixing a well-defined bug on its own.",
      "doc.subagents.general.li2": "Organizing files and running verification in another context, then reporting back.",
      "doc.subagents.general.li3": "Splitting parallelizable docs, code or configuration work into separate streams.",
      "doc.subagents.general.p2":
        "If the task only needs read-only research, evidence gathering or call-chain mapping, prefer Explore below.",
      "doc.subagents.sub.explore": "Built-in: Explore",
      "doc.subagents.explore.p1":
        "Explore is a read-only search and codebase-research specialist for broad retrieval, call-chain mapping, code structure understanding and evidence gathering. It locates code; it does not review or modify it, and returns conclusions rather than file dumps. Search breadth can be set in the prompt — medium for moderate exploration, very thorough for multiple locations and naming conventions.",
      "doc.subagents.explore.p2": "You can ask for exploration up front in the prompt, for example:",
      "doc.subagents.sub.custom": "Custom subagents",
      "doc.subagents.custom.p1":
        "In Settings → Subagents you can view all available subagents (built-in, user and plugin groups), and create, edit, delete, enable or disable the user-level ones you create. Built-in and plugin subagents cannot have their prompts edited, but you can assign each a dedicated model and reasoning level.",
      "doc.subagents.custom.h3.form": "Create a subagent",
      "doc.subagents.custom.form.p1": "Click New and configure the reusable role in the form:",
      "doc.subagents.custom.form.th1": "Field",
      "doc.subagents.custom.form.th2": "Description",
      "doc.subagents.custom.form.td1": "Name",
      "doc.subagents.custom.form.td2":
        "The subagent's identifier, e.g. code-reviewer; cannot collide with built-in roles",
      "doc.subagents.custom.form.td3": "Color",
      "doc.subagents.custom.form.td4":
        "Distinguishes the subagent in lists and sessions; identification only, not a status",
      "doc.subagents.custom.form.td5": "Model",
      "doc.subagents.custom.form.td6":
        "Inherit default follows the main agent's current model, or pick a specific model",
      "doc.subagents.custom.form.td7": "Reasoning",
      "doc.subagents.custom.form.td8":
        "A dedicated reasoning level for this subagent, effective only with a specific model; ignored while inheriting",
      "doc.subagents.custom.form.td9": "Description",
      "doc.subagents.custom.form.td10":
        "A short blurb shown to the main agent — the more precise, the more likely it gets picked for the right task",
      "doc.subagents.custom.form.td11": "Allowed tools",
      "doc.subagents.custom.form.td12":
        "Controls the tool surface: inherit everything by default, or check tools one by one",
      "doc.subagents.custom.form.td13": "System prompt",
      "doc.subagents.custom.form.td14": "Describes the subagent's role, boundaries and rules",
      "doc.subagents.custom.form.td15": "Inject AGENTS.md",
      "doc.subagents.custom.form.td16":
        "On by default so the subagent reads the same project instructions as the main agent",
      "doc.subagents.custom.h3.file": "Definition files",
      "doc.subagents.custom.file.p1": "User-level definitions live in the",
      "doc.subagents.custom.file.p2": "folder of the app data directory; project-level ones go in the workspace's",
      "doc.subagents.custom.file.p3":
        "directory — Markdown with frontmatter where the body is the system prompt. Definitions load when the agent runtime starts, so changes apply to new sessions. A hand-edited example:",
      "doc.subagents.custom.file.p4": "Definition file field reference (camelCase, case-sensitive):",
      "doc.subagents.custom.fields.th1": "Field",
      "doc.subagents.custom.fields.th2": "Description",
      "doc.subagents.custom.fields.td1": "Required; a file missing them is ignored and produces a diagnostic",
      "doc.subagents.custom.fields.td2": "A specific model; inherit or empty follows the main agent's current model",
      "doc.subagents.custom.fields.td3":
        "Reasoning level. Effective only when a specific model is also configured, and must be a value that model supports",
      "doc.subagents.custom.fields.td4": "Color tag (preset colors)",
      "doc.subagents.custom.fields.td5":
        "Allowed / disallowed tool lists — boundaries described under Tools and MCP below",
      "doc.subagents.custom.fields.td6": "Maximum turns per invocation (positive integer)",
      "doc.subagents.custom.fields.td7":
        "Whether to inject AGENTS.md; on by default. Built-in Explore does not inject by default",
      "doc.subagents.custom.fields.td8":
        "Declares the MCP server names this subagent depends on; the call fails outright when a declared server is not connected",
      "doc.subagents.custom.fields.td9":
        "When true, the subagent runs in the background by default — see Foreground and background execution below",
      "doc.subagents.sub.tools": "Tools and MCP",
      "doc.subagents.tools.li1":
        "Full permissions by default (tools empty or *): inherits everything from the main session, including connected MCP tools.",
      "doc.subagents.tools.li2":
        "Custom tool list: only what you list. To keep individual MCP tools, write full names in the definition file, formatted",
      "doc.subagents.tools.li3": ", and you can also write",
      "doc.subagents.tools.li4": "for any connected MCP service.",
      "doc.subagents.tools.li5":
        "When a declared MCP server is not connected, the subagent call fails outright and names the missing server.",
      "doc.subagents.sub.background": "Foreground and background execution",
      "doc.subagents.background.li1":
        "Foreground: several launched together run in parallel and the main task waits for all of them. For research whose results are needed right away.",
      "doc.subagents.background.li2":
        "Background: the main task does not wait and can keep going, even finishing its turn; results return to the main conversation when done. For slow research that should not break the current train of thought.",
      "doc.subagents.background.p1":
        "Which one applies is decided by the request: the agent asks for background at call time, or the definition file sets background: true. Note idle-time tasks do not support background subagents — background dispatch fails with a clear error, and custom subagents configured with background execution fail inside idle-time tasks.",
      "doc.subagents.sub.limits": "Scope and limits",
      "doc.subagents.limits.li1":
        "User-level subagents are currently desktop-only; the web client cannot manage them in settings yet.",
      "doc.subagents.limits.li2":
        "Project-level definitions under .drora/agents/ are repository content; for safety their frontmatter cannot set an execution permission mode, preventing repo input from elevating the child runtime.",
      "doc.subagents.limits.li3":
        "Built-in roles cannot have their prompts edited, be deleted or disabled, and their names are reserved; you can still assign each a dedicated model and reasoning level in settings.",
      "doc.subagents.sub.related": "Related pages",
      "doc.subagents.related.p1": "To connect external tools for subagents, see",
      "doc.subagents.related.p2": "; to package reusable workflows as skills, see",
      "doc.usage.sub.app": "App usage",
      "doc.usage.app.p1":
        "App usage aggregates session records on this device — a good way to look back at how much you got done in Drora recently. You can see:",
      "doc.usage.app.li1": "Token usage (input / output / cache hit rate), session count, turns and tool calls.",
      "doc.usage.app.li2": "Current and longest usage streaks, longest single session and peak daily tokens.",
      "doc.usage.app.li3": "Your favorite model and its usage share.",
      "doc.usage.app.p2":
        "The charts cover a daily token trend (hover for each day's per-model breakdown), an activity heatmap and a model-usage donut; switch between all time / last 30 days / last 7 days in the top right to compare recent periods.",
      "doc.usage.sub.plan": "Coding Plan",
      "doc.usage.plan.p1":
        "The Coding Plan panel reads remote statistics from your connected Z.ai / BigModel Coding Plan — plan quotas, model consumption and tool-call activity:",
      "doc.usage.plan.li1": "Plan status and remaining progress, such as the 5-hour and weekly pools.",
      "doc.usage.plan.li2": "Token and credits consumption per model.",
      "doc.usage.plan.li3": "Call counts for MCP tools like web search and web reader.",
      "doc.usage.plan.p2":
        "Time ranges: today / last 7 days / last 30 days / custom (up to 30 days). The panel requires signing in and connecting the corresponding Coding Plan; it explains what is missing when you are signed out, have no plan, or use a bare API key.",
      "doc.usage.sub.reset": "Quota reset cards",
      "doc.usage.reset.p1":
        "When the 5-hour or weekly pool runs dry, you do not have to wait for the next cycle: the app shows available reset opportunities — click to reset the matching quota, which is restored immediately and marked Reset on the card.",
      "doc.usage.reset.li1": "Reset cards expire — use them before the deadline; expired ones are void.",
      "doc.usage.reset.li2":
        "Clicking reset opens a Resettable quotas panel listing each card's remaining validity; with several cards the earliest-acquired one is used first.",
      "doc.usage.reset.li3":
        "Reset opportunities are granted only to accounts signed in and connected to a Coding Plan; bare API-key setups never receive them.",
      "doc.usage.sub.related": "Related pages",
      "doc.usage.related.p1": "No model connected yet? Start with",
      "doc.usage.related.p2": "; to queue undemanding work for low-peak hours, see",
      "doc.group.help": "Help",
      "doc.nav.agent": "Drora Agent",
      "doc.nav.taskFiles": "Tasks & files",
      "doc.nav.memory": "Memory",
      "doc.nav.safety": "Operation confirmations",
      "doc.nav.ade": "Agent development environment",
      "doc.nav.shortcuts": "Keyboard shortcuts",
      "doc.agent.p1":
        "Drora Agent is the most direct entry point for new tasks. In one workbench you state the request, add context, reference files and invoke commands, then pick a model and an execution mode for the current task — carrying it from understanding to landed changes.",
      "doc.agent.p2":
        "The desktop app organizes daily work as tasks: each task keeps its own session, tool runs and Git context, and the composer, file references and execution mode all work against the current task. For complex multi-step goals, pair it with Goal mode to carry the long-range plan.",
      "doc.agent.entry.h2": "Workbench entry",
      "doc.agent.entry.p1": "Create a new task on desktop (",
      "doc.agent.entry.p2": ") and start talking to the agent. The composer placeholder reads:",
      "doc.agent.entry.quote": "Ask Drora anything, @ to add context, / for commands or capabilities",
      "doc.agent.entry.p3":
        " — state the goal first, then add material precisely with the trigger symbols, and the agent usually understands the task faster.",
      "doc.agent.entry.outside":
        "Just want to ask a question, run some quick math or draft text without touching a repository? You don't need to pick a folder first: choose \"Work outside a project\" on the start page and chat right away — these conversations land in the sidebar task list too. Note that finishing a conversation does not undo files the agent already wrote; clean them up yourself when needed.",
      "doc.agent.context.h2": "Adding context",
      "doc.agent.context.p1": "Type a trigger symbol in the composer to quickly add context to the current task:",
      "doc.agent.context.th1": "Entry",
      "doc.agent.context.th2": "Trigger",
      "doc.agent.context.th3": "What it does",
      "doc.agent.context.td1a": "Add attachment",
      "doc.agent.context.td1b":
        "Upload screenshots, documents, requirement files and more as context for the current task",
      "doc.agent.context.td2a": "Reference context",
      "doc.agent.context.td2b":
        "Reference files, folders, past sessions, whiteboards or plugins so the agent can pinpoint the relevant material",
      "doc.agent.context.td3a": "Link a session",
      "doc.agent.context.td3b": "Bring an existing task's conversation context into the current task",
      "doc.agent.context.td4a": "Invoke a command",
      "doc.agent.context.td4b": "Run saved commands to reuse fixed prompts or flows",
      "doc.agent.context.td5a": "Invoke a skill",
      "doc.agent.context.td5b":
        "Open the skill panel; the full-width ¥ / ￥ produced by some IMEs triggers the same panel",
      "doc.agent.instr.h2": "Project instruction files",
      "doc.agent.instr.p1":
        "To constrain the agent's behavior over time, add an AGENTS.md instruction file: the project's stack and directory notes, code style and the verification commands to run before committing, cautions around high-risk files and production config, and team collaboration conventions all belong there. Drora reads two sources when a task starts:",
      "doc.agent.instr.th1": "Source",
      "doc.agent.instr.th2": "Path",
      "doc.agent.instr.th3": "Notes",
      "doc.agent.instr.td1a": "User global instructions",
      "doc.agent.instr.td1b": "Personal preferences and collaboration habits that apply across projects",
      "doc.agent.instr.td2a": "Workspace instructions",
      "doc.agent.instr.td2b":
        "Engineering conventions specific to the current project, treated as the task's primary project source",
      "doc.agent.instr.p2":
        "When both exist they are concatenated — global instructions first, workspace instructions second; if neither exists, no project instructions are injected.",
      "doc.agent.memory.h2": "Project memory",
      "doc.agent.memory.p1": "AGENTS.md is maintained by hand, while ",
      "doc.agent.memory.p2":
        " accumulates on its own: the agent distills preferences, corrections and project constraints that are reusable across sessions and brings them into later conversations automatically. The standalone CLI enables it by default and the desktop app ships with it off — see ",
      "doc.agent.memory.link": "Memory",
      "doc.agent.modes.h2": "Execution modes",
      "doc.agent.modes.p1":
        "Execution modes control the confirmation strategy before the agent edits files or runs commands: confirm every step, plan first, or keep moving. The shared run configuration defaults to the build permission mode; when the standalone CLI runs a non-interactive task via --prompt and --mode is not set, it falls back to yolo. Interactive sessions, desktop sessions, resumed tasks and hosts can each use their own configured, saved or passed-in mode.",
      "doc.agent.modes.th1": "Mode",
      "doc.agent.modes.th2": "How it works",
      "doc.agent.modes.th3": "Best for",
      "doc.agent.modes.td1a": "Confirm before changes",
      "doc.agent.modes.td1b": "Asks for confirmation before every file edit — the default tier",
      "doc.agent.modes.td1c": "Critical code, production config and other high-risk changes",
      "doc.agent.modes.td2a": "Auto-edit",
      "doc.agent.modes.td2b": "Edits files automatically",
      "doc.agent.modes.td2c": "Everyday iteration with fewer edit confirmations",
      "doc.agent.modes.td3a": "Plan mode",
      "doc.agent.modes.td3b": "Drafts a plan before editing and starts implementing after you confirm",
      "doc.agent.modes.td3c": "Complex, multi-step requests where the approach should be aligned first",
      "doc.agent.modes.td4a": "Full access",
      "doc.agent.modes.td4b": "Minimizes confirmations and keeps executing",
      "doc.agent.modes.td4c": "Clear-cut, trusted-context tasks where speed matters",
      "doc.agent.modes.p2": "With the composer focused, press ",
      "doc.agent.modes.p3":
        " to cycle through modes, or pick one directly from the mode menu in the composer toolbar. For the full confirmation flow see ",
      "doc.agent.thought.h2": "Reasoning effort",
      "doc.agent.thought.p1":
        "Reasoning effort controls how deeply the model thinks before answering: higher is usually steadier but slower. Switch it from the reasoning-effort menu in the composer toolbar or with ",
      "doc.agent.thought.p2":
        " Available tiers depend on the model, from off up to maximum. The default tier suits most tasks; step down when you want faster responses.",
      "doc.agent.side.h2": "Side chats",
      "doc.agent.side.p1":
        "Want to ask \"what does this function do?\" while the main task is running, without derailing it? Side chats are built for exactly that: they open an independent conversation in the right-hand panel that runs in parallel with the main chat, neither disturbing the other.",
      "doc.agent.side.li1": "Type /side or /btw in the main composer to create and open a side chat.",
      "doc.agent.side.li2":
        "Select a passage in the main conversation and pick \"Ask in a side chat\" from the popover — the selection comes over as a quote.",
      "doc.agent.side.li3":
        "A side chat inherits the main session's history as context, so you can follow up directly; it is a fully capable conversation that can call tools and go through permission confirmations.",
      "doc.agent.side.li4":
        "The selection entry is unavailable while the main chat is waiting on a permission confirmation or a question; draft state and side chats themselves cannot open further side chats.",
      "doc.agent.side.p2":
        "Side chats are for quick follow-ups; for discussions you want to keep, starting a proper task works better.",
      "doc.agent.fork.h2": "Session forks",
      "doc.agent.fork.p1":
        "Want to try a different direction at some step without losing your progress? Hover over a completed assistant message and click \"Fork\" in the action row: Drora creates a new task starting from that message's checkpoint, marked \"derived from a conversation\" on the task row; the original task is kept intact and keeps running as before.",
      "doc.agent.fork.li1":
        "Forking is available only after the task has finished; in-progress or interrupted replies have no fork entry.",
      "doc.agent.fork.li2":
        "Forking fails when the fork-point checkpoint is missing; a fork creates a new session and does not change the original task.",
      "doc.agent.tips.h2": "Tips",
      "doc.agent.tips.li1":
        "State the goal first: say directly what to build, fix or analyze; for long multi-round tasks, set a verifiable goal with Goal mode.",
      "doc.agent.tips.li2":
        "Then add context: reference key files with @, or attach screenshots, documents and requirement material.",
      "doc.agent.tips.li3":
        "Work faster with commands and skills: fixed flows as / commands, reusable capabilities as $ skills.",
      "doc.agent.tips.li4":
        "Match the execution mode to the risk: auto-edit for routine changes; plan mode to align the approach before critical files or command execution.",
      "doc.agent.tips.li5":
        "Keep one task continuous: keep asking, adding constraints and reviewing changes in the same task instead of splitting the context.",
      "doc.taskfiles.p1":
        "As tasks pile up, the sidebar offers a few high-frequency management tools: task views organize the list by group, project or timeline; the command center reaches actions, tasks and files from one panel; and the workspace file tree lets you browse files, inspect changes and pull files into the conversation without leaving Drora.",
      "doc.taskfiles.views.h2": "Task views",
      "doc.taskfiles.views.p1":
        "The view menu at the top of the sidebar offers three ways to organize tasks, switchable at any time:",
      "doc.taskfiles.views.li1": "Groups: file tasks into custom groups, handy for organizing by theme or priority.",
      "doc.taskfiles.views.li2": "Projects: tasks follow their project, listed flat under each one.",
      "doc.taskfiles.views.li3":
        "Timeline: reverse-chronological order — the fastest way to find what you did recently.",
      "doc.taskfiles.views.p2":
        "Beside the view menu there are a few more everyday entries: sort order (by created or updated time), task search, and the archive — tasks that are no longer active can move into the archived list, where they can be restored or deleted at any time; deleting a task also cleans up its session snapshots and checkpoints.",
      "doc.taskfiles.groups.h2": "Task groups",
      "doc.taskfiles.groups.p1": "Switch to the group view to organize related tasks into custom groups:",
      "doc.taskfiles.groups.li1":
        "Create and name groups; click the color dot next to a group title to choose from seven colors (gray, red, orange, yellow, green, blue, purple).",
      "doc.taskfiles.groups.li2":
        "Rename a group at any time; right-click it and choose \"Ungroup and delete\" — only the group itself is removed, its tasks are kept and moved out of it.",
      "doc.taskfiles.groups.li3":
        "Drag tasks into the target group, or right-click a task for \"Move to group / Remove from group / Move to top\".",
      "doc.taskfiles.groups.li4":
        "Click a group title to collapse that group, or use the buttons at the top of the list to expand / collapse all.",
      "doc.taskfiles.cc.h2": "Command center",
      "doc.taskfiles.cc.p1": "Press ",
      "doc.taskfiles.cc.p2": " (or ",
      "doc.taskfiles.cc.p3":
        ") to open the command center and search actions, tasks or files from one panel: new conversation, open folder, switch theme, open settings and other common actions run right there — no menu hunting. Scope it by \"All / Actions / Tasks / Files\". For every shortcut see ",
      "doc.taskfiles.tree.h2": "Workspace file tree",
      "doc.taskfiles.tree.p1":
        "Switch to the current workspace's file tree from the \"Show file tree\" entry on the workspace card and browse files without leaving the task:",
      "doc.taskfiles.tree.li1": "Filter live by file name or path, with search ignore rules configurable in Settings.",
      "doc.taskfiles.tree.li2":
        "\"Show changed files only\" filters down to files with Git changes in one click — especially handy for code review or pre-commit checks.",
      "doc.taskfiles.tree.li3":
        "Click a file to open it in the preview pane; the right-click menu offers \"Add to chat\", \"Copy path\", \"Reveal in file explorer\" and more, and local HTML files can also \"Open in embedded browser\".",
      "doc.taskfiles.tree.li4":
        "Adding a file to the chat points the agent at it — combining \"show changed files only\" with \"add to chat\" quickly feeds the current change set to the agent for a self-review or a commit message.",
      "doc.taskfiles.tree.p2": "Attachments can also enter the composer by drag-and-drop or paste — see ",
      "doc.taskfiles.git.h2": "Git graph",
      "doc.taskfiles.git.p1":
        "Next to the branch switcher at the top of the workspace you can open the Git graph: a read-only picture of commit history with branches drawn side by side as lanes, making it obvious where a merge happened — ideal for tracing \"where did this branch split off\" or \"when did these two lines merge\". The header summarizes the commit count, lanes, merges and refs.",
      "doc.taskfiles.git.p2":
        "It is only for looking: branch switching lives in the same branch switcher, and if you have uncommitted changes Drora will ask you to commit first — you can also let it commit and continue switching automatically.",
      "doc.memory.p1":
        "Some things are only worth telling the agent once: your commit-message style, the package manager the project uses, the team's review conventions. Memory gives the agent a workspace-level long-term memory so this kind of information carries into later sessions, without repeating yourself at the start of every conversation.",
      "doc.memory.note1":
        "Defaults differ by form: the standalone CLI's default configuration enables memory, while the desktop app's settings default to off. When enabled it can analyze saved sessions, persist memories and reuse them in later tasks; the related extraction and curation can issue extra model requests.",
      "doc.memory.enable.h2": "Turning memory on",
      "doc.memory.enable.p1":
        "In the desktop app, open Settings → Memory and switch on \"Workspace memory\"; the standalone CLI enables it through its default configuration. Two things to know before you start:",
      "doc.memory.enable.li1":
        "Only new sessions are affected: changing the setting applies to new sessions and to sessions restored after an app restart, while conversations in progress keep their original setting.",
      "doc.memory.enable.li2":
        "It may increase token usage: once on, the system may issue extra model requests to extract and recall long-term memory — you can watch the spend in usage stats.",
      "doc.memory.what.h2": "What gets remembered",
      "doc.memory.what.p1": "Each memory is a small file about one thing, organized into four types:",
      "doc.memory.what.th1": "Type",
      "doc.memory.what.th2": "Covers",
      "doc.memory.what.th3": "Example",
      "doc.memory.what.td1a": "user",
      "doc.memory.what.td1b": "Who you are — role, expertise and preferences",
      "doc.memory.what.td1c": "\"Prefers pnpm and Conventional Commits\"",
      "doc.memory.what.td2a": "feedback",
      "doc.memory.what.td2b":
        "Corrections or confirmations about how the agent should work, with the reason and how to apply",
      "doc.memory.what.td2c": "\"Don't fix unrelated lint errors in passing\"",
      "doc.memory.what.td3a": "project",
      "doc.memory.what.td3b": "Goals, constraints and progress that cannot be derived from code or Git history",
      "doc.memory.what.td3c": "\"The site must stay compatible with Node 20\"",
      "doc.memory.what.td4a": "reference",
      "doc.memory.what.td4b": "Pointers to external resources you have provided",
      "doc.memory.what.td4c": "\"The design spec lives at a link on the team wiki\"",
      "doc.memory.what.p2":
        "Just as important is what memory deliberately does not save: information the repository already records (code structure, past fixes, Git history, AGENTS.md) and temporary information that only matters within the current conversation — the agent can always re-read those.",
      "doc.memory.mech.h2": "How it works",
      "doc.memory.mech.p1":
        "After a conversation turn finishes successfully, a background extraction subagent reviews the recent exchange: if it finds something worth keeping, it writes a small Markdown fact file and updates the MEMORY.md index; otherwise it saves nothing. The whole process happens after your turn ends and never slows the conversation itself.",
      "doc.memory.mech.p2":
        "In later sessions in the same workspace the MEMORY.md index loads into the agent's context automatically; the index has a size cap and gets truncated when memories pile up, so short entries work best. Memory is isolated per workspace: what is learned in one workspace does not carry into another.",
      "doc.memory.mech.p3":
        "You can also manage memory directly in the conversation: say \"remember, we release from the staging branch\" to save it immediately, or \"forget what was said about the release branch\" to delete the matching memory.",
      "doc.memory.storage.h2": "Where memories live",
      "doc.memory.storage.p1":
        "Memories are plain Markdown files on your machine, stored in directories keyed by workspace identity:",
      "doc.memory.storage.p2":
        "The memory feature itself never uploads these contents anywhere. Because they are plain files you can open, edit or delete them manually at any time; deleting a workspace's memory directory resets its memory completely. The desktop app also ships a viewer for saved workspace memories under Settings → Memory (local desktop only).",
      "doc.memory.limits.h2": "Limits and notes",
      "doc.memory.limits.li1":
        "Desktop defaults to off: enable it under Settings → Memory as your workflow needs; the standalone CLI defaults to on.",
      "doc.memory.limits.li2":
        "Memory and AGENTS.md are different things: AGENTS.md is hand-written and lives in the repository with your code; memory is distilled by the agent and stays on your machine only.",
      "doc.memory.limits.li3":
        "Memory stays local: it is independent of any MCP memory tools — enabling one does not affect the other.",
      "doc.memory.limits.li4":
        "Before copying logs, sharing conversations or backing up the data directory, check who will receive it so private project content does not leave your machine.",
      "doc.safety.p1":
        "Drora puts the agent's permission controls in the task UI: before allowing execution, you see exactly what the agent is about to do. For commands, file changes and similar operations the task shows the actual content, and execution continues only after you confirm.",
      "doc.safety.note1":
        "Whether each action is confirmed depends on tool declarations, permission rules and the run mode; the model tool approval is not a single app-wide permission switch, so you cannot assume terminal operations, plugin processes or update downloads go through the same approval flow. The shared run configuration defaults to the build permission mode; when the standalone CLI runs a non-interactive task via --prompt and --mode is not set, it falls back to yolo.",
      "doc.safety.modes.h2": "Permission modes",
      "doc.safety.modes.p1": "There are four execution modes; with the composer focused, press ",
      "doc.safety.modes.p2":
        " to cycle through them quickly, or pick one directly from the mode menu in the composer toolbar:",
      "doc.safety.modes.th1": "Mode",
      "doc.safety.modes.th2": "What it does",
      "doc.safety.modes.th3": "Best for",
      "doc.safety.modes.td1a": "Confirm before changes",
      "doc.safety.modes.td1b": "Confirms before every file change — the default tier",
      "doc.safety.modes.td1c": "Critical code, production config and other high-risk changes",
      "doc.safety.modes.td2a": "Auto-edit",
      "doc.safety.modes.td2b": "File edits run automatically",
      "doc.safety.modes.td2c": "Everyday iteration",
      "doc.safety.modes.td3a": "Plan mode",
      "doc.safety.modes.td3b": "Drafts a plan before editing and starts implementing after you confirm",
      "doc.safety.modes.td3c": "Refactors, migrations, long tasks",
      "doc.safety.modes.td4a": "Full access",
      "doc.safety.modes.td4b": "Executes as automatically as possible with fewer confirmations",
      "doc.safety.modes.td4c": "Tasks with trusted context where continuous execution is wanted",
      "doc.safety.flow.h2": "Workflow",
      "doc.safety.flow.li1":
        "Confirmation triggered: when the agent initiates an operation that needs authorization, the current task pauses so no new execution requests pile up.",
      "doc.safety.flow.li2":
        "Request shown: the UI presents the exact command, file change or tool call the agent plans to execute.",
      "doc.safety.flow.li3":
        "User decision: the agent continues only after approval; refusing aborts the operation. Choose with Tab / arrow keys and confirm with Enter.",
      "doc.safety.flow.li4":
        "Task sync: the permission request belongs to the current task; the sidebar task list also shows a \"waiting for confirmation\" badge — switch back to the task to handle it.",
      "doc.safety.decide.h2": "Decision options",
      "doc.safety.decide.th1": "Option",
      "doc.safety.decide.th2": "What it does",
      "doc.safety.decide.th3": "Suggested use",
      "doc.safety.decide.td1a": "Allow",
      "doc.safety.decide.td1b": "Authorizes only this one operation",
      "doc.safety.decide.td1c": "One-off tasks you are unsure about",
      "doc.safety.decide.td2a": "Always allow",
      "doc.safety.decide.td2b":
        "Authorizes this and later identical commands, identical file operations or identical permission requests without asking again",
      "doc.safety.decide.td2c": "Safe, trusted operations that run often, such as routine builds",
      "doc.safety.decide.td3a": "Deny",
      "doc.safety.decide.td3b": "Blocks the agent from performing the current operation",
      "doc.safety.decide.td3c": "The instruction, path or risk does not match expectations",
      "doc.safety.decide.td4a": "Always deny",
      "doc.safety.decide.td4b": "Also denies later identical permission requests outright",
      "doc.safety.decide.td4c": "A class of operations you clearly do not want the agent to run",
      "doc.safety.decide.p1":
        "Some scenarios offer finer-grained options — \"Always allow this command\" (identical commands no longer ask within the project), \"Always allow for this project\" and \"Allow for this session\" — pick as needed.",
      "doc.safety.timeout.h2": "Question timeout and auto-continue",
      "doc.safety.timeout.p1":
        "Besides permission confirmations, the agent sometimes asks you a multiple-choice question (\"option A or option B?\"). Such questions carry a 5-minute countdown by default; if nobody answers in time, the agent picks a direction on its own and continues, marked \"unanswered, continued automatically\" in the history.",
      "doc.safety.timeout.p2":
        "Any action from you — starting to choose, clicking the seconds or pressing \"stop timer\" — permanently stops the countdown, so take your time. If you do not want auto-continue, turn off \"Ask auto-continue\" in Settings and every question will wait for your answer; note the switch is not retroactive — questions raised while it was off never regain a timer.",
      "doc.safety.scen.h2": "Common scenarios",
      "doc.safety.scen.li1":
        "Running third-party scripts: the agent tries to run the project's Python, Shell or Node.js scripts.",
      "doc.safety.scen.li2": "Network requests: the agent needs to reach external APIs or download resources.",
      "doc.safety.scen.li3":
        "File changes: the agent creates, edits, deletes or renames files; the task result shows a change summary.",
      "doc.safety.scen.li4":
        "System-level commands: running commands that may modify system config, install dependencies or delete files.",
      "doc.safety.scen.p1":
        "Task snapshots, Git checkpoints and session recovery are no substitute for backups of all local files, databases and external services; stopping a session or cancelling a request also cannot undo file writes and external operations that already happened.",
      "doc.safety.tips.h2": "Tips",
      "doc.safety.tips.li1": "Before allowing execution, read the command, paths and file names carefully.",
      "doc.safety.tips.li2": "When unsure, prefer \"Allow\" over \"Always allow\".",
      "doc.safety.tips.li3":
        "\"Always allow\" and full access both reduce later confirmations — use them only when you trust the context.",
      "doc.safety.tips.li4": "For large changes prefer plan mode: align the approach first, then start implementing.",
      "doc.ade.p1":
        "Drora is more than an agent input box — it is an agent development environment (ADE) for real development work: manage tasks, organize conversations by project, enter remote development environments, preview files and run builds and tests in the terminal panel, all in one window.",
      "doc.ade.tasks.h2": "Workspace and task list",
      "doc.ade.tasks.p1":
        "The left sidebar shows the task list for the current workspace, with new task, search and view switching at the top. Task views support groups, projects and timeline, and non-grouped views can also sort by created or updated time. Each row shows the task title, relative time and status (running, waiting for confirmation and more); once a task produces changes it also shows the +/- change counts, so you can quickly see which tasks the agent changed the most.",
      "doc.ade.archive.h2": "Archived tasks",
      "doc.ade.archive.p1":
        "Tasks that are no longer active can be archived out of the main list. The archived list shows the same title, relative time, change stats and workspace per row, with restore and delete actions; once you are sure they are useless you can delete all archived tasks. Deleting a task cleans up its session snapshots and checkpoints too — restore first if you still need to look back.",
      "doc.ade.cc.h2": "Command center",
      "doc.ade.cc.p1": "Press ",
      "doc.ade.cc.p2": " (or ",
      "doc.ade.cc.p3":
        ") to open the command center and reach common actions and navigation from one panel. It covers actions, tasks and files in one search: new conversation, open folder, search files, open settings, switch theme, switch terminal and more run right there. For every shortcut see ",
      "doc.ade.remote.h2": "Remote development and remote access",
      "doc.ade.remote.p1":
        "On the \"Open workspace\" page you can pick a local folder or go remote: open a remote workspace over an SSH host, WSL (Windows Subsystem for Linux), a local Docker container or an already-running Drora Server, letting the agent read files, run commands and drive tasks in the real environment — the connection process and its log stay visible in the window.",
      "doc.ade.remote.p2":
        "For when you are away from the desk, phone remote control is the entry: your phone's browser attaches to the desktop's existing host, reusing the same session runtime, with replayable recovery after disconnects. See ",
      "doc.ade.remote.and": " and ",
      "doc.ade.preview.h2": "File and content previews",
      "doc.ade.preview.p1":
        "Clicking a file in the file tree opens it in the preview pane; besides code, several common formats render directly:",
      "doc.ade.preview.li1":
        "PDF: read-only viewing — handy for requirement docs and design drafts; no editing or annotation.",
      "doc.ade.preview.li2":
        "Mermaid diagrams: mermaid code blocks in replies render as diagrams, with a zoomable full-size view.",
      "doc.ade.preview.li3":
        "Images: Markdown images open in a preview, and consecutive images automatically form a browsable gallery.",
      "doc.ade.preview.li4":
        "Tables: Markdown tables carry a toolbar — copy as Markdown, download as CSV, or open a larger preview window; very wide tables can expand into a scrollable area.",
      "doc.ade.term.h2": "Terminal and search",
      "doc.ade.term.p1": "Press ",
      "doc.ade.term.p2":
        " to open the terminal panel and run builds, tests, services and log tailing in the same workspace, then hand the results back to the agent for analysis.",
      "doc.ade.term.p3":
        "Searching a large repository can be slow, and results depend on which find and grep your machine happens to have. With \"Settings → Enhanced Find and Grep\" on, new sessions use the enhanced search tools so behavior is consistent across machines; the current session keeps its existing setting, and Find stays unchanged on Windows.",
      "doc.keys.p1":
        "These are the most common, most worth remembering shortcuts in the Drora desktop app. In the tables the Windows / Linux column uses Ctrl and the macOS column uses Command; every shortcut can be viewed and changed under \"Settings → Keyboard shortcuts\".",
      "doc.keys.global.h2": "Global actions",
      "doc.keys.th.win": "Windows / Linux",
      "doc.keys.th.mac": "macOS",
      "doc.keys.th.desc": "Action",
      "doc.keys.global.r1": "Open command center",
      "doc.keys.global.r2": "Open settings",
      "doc.keys.global.r3": "Find in task",
      "doc.keys.global.r4": "Toggle the left sidebar",
      "doc.keys.global.r5": "Toggle the right pane",
      "doc.keys.global.r6": "Toggle the terminal panel",
      "doc.keys.global.r7": "Switch dark / light theme",
      "doc.keys.global.r8": "Switch coding / office mode",
      "doc.keys.global.r9": "Navigate back",
      "doc.keys.global.r10": "Navigate forward",
      "doc.keys.global.r11": "Switch to the previous task",
      "doc.keys.global.r12": "Switch to the next task",
      "doc.keys.global.r13": "Show / hide the onboarding",
      "doc.keys.composer.h2": "Composer and toolbar",
      "doc.keys.composer.r1": "Send message",
      "doc.keys.composer.r2": "New line in the composer",
      "doc.keys.composer.r3": "Open the model menu",
      "doc.keys.composer.r4": "Cycle execution mode (while the composer is focused)",
      "doc.keys.composer.r5": "Cycle reasoning effort",
      "doc.keys.composer.p1":
        "The model menu, execution mode and reasoning effort toolbar shortcuts use an explicit Ctrl modifier — the Ctrl key on macOS too. Inside the composer, the @, #, / and $ triggers open completion panels; pick candidates with the arrow keys and Enter.",
      "doc.keys.menu.h2": "Desktop menu",
      "doc.keys.menu.r1": "New task",
      "doc.keys.menu.r2": "Open workspace",
      "doc.keys.menu.r3": "Close the active context",
      "doc.keys.menu.r4": "Zoom in",
      "doc.keys.menu.r5": "Zoom out",
      "doc.keys.menu.r6": "Reset zoom",
      "doc.keys.custom.h2": "Custom shortcuts",
      "doc.keys.custom.p1":
        "Open \"Settings → Keyboard shortcuts\" to search commands, record new key combinations, clear bindings or reset everything to defaults. A binding is used for persistence, UI matching and the desktop menu accelerator alike; IME composition state and key-repeat are ignored automatically while recording.",
      "doc.keys.custom.p2": "For the full picture of execution modes and permission confirmations see ",
      "doc.keys.custom.and": " and ",
      "doc.welcome.cap.install": " — grab a desktop installer or the single-file CLI and handle first-run prompts.",
      "doc.welcome.cap.model": " — sign in to a GLM account or connect your own endpoints.",
      "doc.welcome.cap.agent":
        " — the main entry for new tasks: @, #, / and $ to add context, adjustable execution mode and reasoning effort.",
      "doc.welcome.cap.taskFiles":
        " — organize tasks by group, project or timeline and reference changed files from the file tree.",
      "doc.welcome.cap.memory":
        " — carry project memory across sessions (on by default in the CLI, off in the desktop app).",
      "doc.welcome.cap.sessions": " — replay history, rewind to checkpoints and resume interrupted tasks.",
      "doc.welcome.cap.usage": " — inspect token spend and tool-call distribution per session.",
      "doc.welcome.cap.safety": " — permission modes and per-action confirmations; see every step before it runs.",
      "doc.welcome.cap.ade": " — command center, file previews and a terminal panel in one workbench.",
      "doc.welcome.cap.subagents":
        " — delegate exploration and retrieval in parallel; only conclusions come back to the main chat.",
      "doc.welcome.cap.hooks": " — inject scripts at key points of the session and tool lifecycle.",
      "doc.welcome.cap.skin": " — built-in illustrated wallpapers with panel opacity and accent color options.",
      "doc.welcome.cap.cli": " — the single-file drora executable: TUI, web mode and scripted runs.",
      "doc.welcome.cap.build": " — source development and packaging starting from pnpm bootstrap.",
      "doc.welcome.cap.faq": " — installs, updates and troubleshooting answers.",
    },
};
