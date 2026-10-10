/* Drora product website — i18n + light interactions. No dependencies. */
(function () {
  "use strict";

  /* ------------------------------ i18n ------------------------------ */

  var I18N = window.DRORA_I18N;

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
    if (page === "docs") {
      var slug = document.body.getAttribute("data-doc");
      var ia = window.__DRORA_DOCS_IA;
      if (ia && slug !== null) {
        for (var g = 0; g < ia.length; g++) {
          for (var i = 0; i < ia[g].items.length; i++) {
            var item = ia[g].items[i];
            if (item.slug === slug) {
              if (slug === "") {
                // 欢迎页沿用完整描述标题
                var w = PAGE_TITLES.docs;
                return lang === "en" ? w.en : w.zh;
              }
              var name = lang === "en" ? I18N.en[item.key] || item.zh : item.zh;
              return name + (lang === "en" ? " | Drora Docs" : " | Drora 文档");
            }
          }
        }
      }
    }
    var titles = PAGE_TITLES[page] || PAGE_TITLES.home;
    return lang === "en" ? titles.en : titles.zh;
  }

  /* 注入式迁移页的 body 上没有 data-page（Next 布局持有静态 <title>）：
     此时不得回退到首页标题覆盖 <title>，语言切换只翻译正文；vanilla 形态的页面
     （body 带 data-page/data-doc）仍按 PAGE_TITLES/IA 切换标题。 */
  function setTitleForPage(lang) {
    if (document.body.getAttribute("data-page")) document.title = pageTitle(lang);
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
      setTitleForPage("en");
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
      setTitleForPage("zh");
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

    // 索引 = 文档 IA 本身（与侧栏同源，不会漂移）；EN 态用词典键名匹配
    var pages = [];
    var ia = window.__DRORA_DOCS_IA || [];
    ia.forEach(function (group) {
      group.items.forEach(function (item) {
        pages.push({ slug: item.slug, zh: item.zh, key: item.key });
      });
    });

    // 结果链接与侧栏 docs-nav 同一 data-base（Next 静态导出路由为 /Drora/docs/ 目录形态）；
    // 搜索入口只出现在 docs 页，docs-nav 与搜索按钮同页共存
    var docsNavEl = document.querySelector("docs-nav");
    var docsBase = docsNavEl ? docsNavEl.getAttribute("data-base") || "" : "";

    function renderResults(query) {
      var lang = currentLang();
      var q = query.trim().toLowerCase();
      var hits = pages.filter(function (pg) {
        var en = (I18N.en[pg.key] || "").toLowerCase();
        return !q || pg.zh.toLowerCase().indexOf(q) >= 0 || en.indexOf(q) >= 0;
      });
      list.innerHTML =
        hits
          .map(function (pg) {
            var name = lang === "en" ? I18N.en[pg.key] || pg.zh : pg.zh;
            return '<li><a href="' + (pg.slug ? docsBase + pg.slug + "/" : docsBase) + '">' + name + "</a></li>";
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

  /* 文档页右侧目录：从当前页 h2[id] 生成（多页 docs 每页不同）；少于 2 节隐藏整栏 */
  function buildDocsToc() {
    var toc = document.getElementById("docsToc");
    if (!toc) return;
    var list = document.getElementById("tocList");
    var heads = document.querySelectorAll(".docs-content h2[id]");
    if (!list || heads.length < 2) {
      toc.hidden = true;
      return;
    }
    list.innerHTML = Array.prototype.map
      .call(heads, function (h) {
        return '<a href="#' + h.id + '">' + h.textContent + "</a>";
      })
      .join("");
  }

  /* 文档页 scrollspy：视口上部区域命中的 h2 高亮目录项（侧栏 current 由 docs-nav 渲染） */
  function initDocsSpy() {
    var heads = document.querySelectorAll(".docs-content h2[id]");
    var links = document.querySelectorAll(".docs-toc a");
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
        // Tailwind preflight 的 [hidden]{display:none!important} 会压过 .open 类，
        // 打开时必须移除 hidden 属性本身
        if (open) nav.removeAttribute("hidden");
        else nav.setAttribute("hidden", "");
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
    buildDocsToc();
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
