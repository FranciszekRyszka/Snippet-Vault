/* SnipVault site — a few progressive enhancements. Everything degrades
   gracefully: with JS off, the page is fully readable and all links work. */
(function () {
  "use strict";
  var root = document.documentElement;

  /* ---- Theme toggle (persisted) ---- */
  function currentTheme() {
    var attr = root.getAttribute("data-theme");
    if (attr) return attr;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  var toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  }

  /* ---- Nav: hairline border once scrolled ---- */
  var nav = document.getElementById("nav");
  function onScroll() {
    if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- Mobile menu ---- */
  var burger = document.getElementById("burger");
  var menu = document.getElementById("mobile-menu");
  if (burger && menu) {
    burger.addEventListener("click", function () {
      var open = menu.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", String(open));
    });
    menu.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        menu.classList.remove("is-open");
        burger.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---- Scroll reveal ---- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  /* ---- Detect OS: label the hero button + highlight the matching card ---- */
  var ua = navigator.userAgent || "";
  // Only Windows and macOS have desktop installers; Linux users get the default
  // CTA (which scrolls to the download section and its "on Linux?" note).
  var os = /Win/i.test(ua) ? "win" : /Mac/i.test(ua) ? "mac" : "";
  var labels = { win: "Download for Windows", mac: "Download for macOS" };
  var heroBtn = document.getElementById("hero-download");
  if (heroBtn && labels[os]) {
    heroBtn.textContent = labels[os];
    heroBtn.setAttribute("href", "https://github.com/FranciszekRyszka/Snippet-Vault/releases/latest");
  }
  var youCard = os ? document.getElementById("os-" + os) : null;
  if (youCard) youCard.classList.add("is-you");

  /* ---- Copy the install command ---- */
  var copyBtn = document.getElementById("copy-install");
  var cmd = document.getElementById("install-cmd");
  if (copyBtn && cmd && navigator.clipboard) {
    copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText(cmd.textContent.trim()).then(function () {
        var prev = copyBtn.textContent;
        copyBtn.textContent = "Copied ✓";
        setTimeout(function () { copyBtn.textContent = prev; }, 1600);
      }).catch(function () {});
    });
  }

  /* ---- Footer year ---- */
  var yr = document.getElementById("year");
  if (yr) yr.textContent = String(new Date().getFullYear());
})();
