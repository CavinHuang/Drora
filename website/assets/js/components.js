/* Drora 产品站共享组件 —— 原生 custom elements（light DOM），零构建零依赖。
   DOM 层级直接复刻 zcode.z.ai 对应位置的渲染结构：
   - header：sticky + 底边框，桌面行三段 justify-between（品牌 / flex-1 左对齐主导航 / 右侧动作）
   - footer：容器内顶部 <hr> 分隔线 + 左右两栏（© 在左、链接组在右）
   - changelog 版本块：border-b 分隔容器 + meta 行（白色边框版本 pill / 日期 / 最新版下载下拉）+ Release 标题 + 分组 h2
   - 桌宠：sprite + 名字，图集背景由组件自行挂载
   组件只承载结构；视觉令牌全部在 style.css。必须先于 main.js 加载，
   这样 boot 时的 i18n 缓存能覆盖组件渲染出的 data-i18n 节点。 */
(function () {
  "use strict";

  var D_MARK =
    '<svg class="brand-mark" viewBox="0 0 1024 1024" aria-hidden="true">' +
    '<rect x="2" y="2" width="1020" height="1020" rx="210" fill="#0e0f11" stroke="#3e4045" stroke-width="4"/>' +
    '<path fill="#ffffff" d="M0 0H74C96.25 0 143 23.87 143 76C143 127.16 97.91 152 74 152H29L57 122C105.84 122 111 89.6 111 76C111 42.64 82.51 32 73 32H33V100C33 100.45 33.55 100.7 34.35 100.7H37L33.5 104L0 142V0Z" transform="translate(216 197.4) scale(4.14)"/>' +
    "</svg>";

  var GLOBE =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M3.5 12h17M12 3.3c-2.6 2.5-3.9 5.4-3.9 8.7s1.3 6.2 3.9 8.7c2.6-2.5 3.9-5.4 3.9-8.7s-1.3-6.2-3.9-8.7z" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    "</svg>";

  var GITHUB =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.72-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.85.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/>' +
    "</svg>";

  var NAV_LINKS = [
    { key: "nav.docs", zh: "文档", page: "docs", href: function (base) { return base + "docs/"; } },
    { key: "nav.changelog", zh: "更新日志", page: "changelog", href: function (base) { return base + "changelog/"; } },
    { key: "nav.security", zh: "提交漏洞", page: "security", href: function (base) { return base + "security/"; } },
    { key: "nav.community", zh: "社区", page: "community", href: function (base) { return base + "community/"; } },
  ];

  function renderNav(base, currentPage) {
    return NAV_LINKS.map(function (link) {
      var active = link.page && link.page === currentPage ? ' class="active"' : "";
      return '<a href="' + link.href(base) + '"' + active + ' data-i18n="' + link.key + '">' + link.zh + "</a>";
    }).join("");
  }

  /* ------------------------------ <site-header> ------------------------------ */

  class SiteHeader extends HTMLElement {
    connectedCallback() {
      if (this.dataset.rendered) return;
      this.dataset.rendered = "1";
      var page = this.getAttribute("data-page") || "home";
      var base = this.getAttribute("data-base") || "";
      this.innerHTML =
        '<div class="header-inner">' +
        '  <a class="brand" href="' + (base || "./") + '" aria-label="Drora home">' + D_MARK + '<span class="brand-name">DRORA</span></a>' +
        '  <nav class="main-nav" aria-label="Main">' + renderNav(base, page) + "</nav>" +
        '  <div class="header-actions">' +
        '    <button class="pill-btn lang-btn" id="langBtn" type="button" aria-label="Switch language">' + GLOBE + '<span id="langLabel">EN</span></button>' +
        '    <a class="pill-btn github-btn" href="https://github.com/CavinHuang/Drora" target="_blank" rel="noopener">' + GITHUB + "<span>GitHub</span></a>" +
        '    <button class="menu-btn" id="menuBtn" type="button" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>' +
        "  </div>" +
        "</div>" +
        '<div class="mobile-nav" id="mobileNav" hidden>' + renderNav(base, page) + "</div>";
    }
  }

  /* ------------------------------ <site-footer> ------------------------------ */

  class SiteFooter extends HTMLElement {
    connectedCallback() {
      if (this.dataset.rendered) return;
      this.dataset.rendered = "1";
      var base = this.getAttribute("data-base") || "";
      this.innerHTML =
        '<div class="container"><hr class="footer-rule"/></div>' +
        '<div class="container footer-inner">' +
        '  <p>© 2026 <span data-i18n="footer.rights">Drora Contributors · 基于 ZCode 开源复刻</span>' +
        '    <a class="footer-gh" href="https://github.com/CavinHuang/Drora" target="_blank" rel="noopener">GitHub</a></p>' +
        '  <nav class="footer-links">' +
        '    <a href="' + base + 'terms/" data-i18n="footer.terms">服务条款</a>' +
        '    <a href="' + base + 'privacy/" data-i18n="footer.privacy">隐私政策</a>' +
        '    <a href="' + base + 'support/" data-i18n="footer.support">支持与反馈</a>' +
        "  </nav>" +
        "</div>";
    }
  }

  /* ------------------------------ <drora-pet> ------------------------------ */

  class DroraPet extends HTMLElement {
    connectedCallback() {
      if (this.dataset.rendered) return;
      this.dataset.rendered = "1";
      var atlas = this.getAttribute("atlas") || "";
      var name = this.getAttribute("name") || "";
      this.innerHTML = '<i class="pet-sprite"></i><figcaption>' + name + "</figcaption>";
      var sprite = this.querySelector(".pet-sprite");
      if (sprite && atlas) sprite.style.backgroundImage = "url('" + atlas + "')";
    }
  }

  /* ---------------------------- <release-block> ---------------------------- */

  class ReleaseBlock extends HTMLElement {
    connectedCallback() {
      if (this.dataset.rendered) return;
      this.dataset.rendered = "1";
      var version = this.getAttribute("version") || "";
      var dateKey = this.getAttribute("date-key") || "";
      var dateText = this.getAttribute("date-text") || "";
      var downloadTag = this.getAttribute("download") || "";

      var meta =
        '<div class="release-meta">' +
        '  <span class="release-pill">' + version + "</span>" +
        '  <span class="release-date" data-i18n="' + dateKey + '">' + dateText + "</span>";

      if (downloadTag) {
        // 资产名不带 v 前缀（Drora-0.0.8-win-x64.exe），tag 链接带 v 前缀（/tag/v0.0.8）
        var bare = downloadTag.replace(/^v/, "");
        meta +=
          '  <details class="release-dl">' +
          '    <summary class="release-dl-btn"><span data-i18n="ch.download">下载</span><span aria-hidden="true">⌄</span></summary>' +
          '    <div class="release-dl-menu">' +
          '      <a href="https://github.com/CavinHuang/Drora/releases/download/' + downloadTag + "/Drora-" + bare + '-win-x64.exe"><span data-i18n="dl.win64">Windows（64 位）</span><code>.exe</code></a>' +
          '      <a href="https://github.com/CavinHuang/Drora/releases/download/' + downloadTag + "/Drora-" + bare + '-win-arm64.exe"><span data-i18n="dl.winArm">Windows (ARM64)</span><code>.exe</code></a>' +
          '      <a href="https://github.com/CavinHuang/Drora/releases/download/' + downloadTag + "/Drora-" + bare + '-mac-arm64.dmg"><span data-i18n="dl.macArm">macOS（Apple 芯片）</span><code>.dmg</code></a>' +
          '      <a href="https://github.com/CavinHuang/Drora/releases/download/' + downloadTag + "/Drora-" + bare + '-mac-x64.dmg"><span data-i18n="dl.macIntel">macOS（Intel 芯片）</span><code>.dmg</code></a>' +
          '      <a href="https://github.com/CavinHuang/Drora/releases/tag/' + downloadTag + '"><span data-i18n="ch.allAssets">前往 Release 页</span><code>↗</code></a>' +
          "    </div>" +
          "  </details>";
      }
      meta += "</div>";

      // 页面作者写的分组（<h2>+<ul>）原样移入 release-body，与参考站结构一致
      var body = document.createElement("article");
      body.className = "release-body";
      while (this.firstChild) body.appendChild(this.firstChild);

      this.innerHTML = meta + '<h2 class="release-title">Release v' + version + "</h2>";
      this.appendChild(body);
    }
  }

  customElements.define("site-header", SiteHeader);
  customElements.define("site-footer", SiteFooter);
  customElements.define("drora-pet", DroraPet);
  customElements.define("release-block", ReleaseBlock);
})();
