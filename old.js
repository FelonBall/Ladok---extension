// content.js — StudyQuest Ladok XP (MV3 content script)
// SPA-safe + stable updates (no constant re-render / no devtools flicker)
//
// Key behaviors:
// - Shows widget ONLY on /min-utbildning/alla (teardown on other filters without reload)
// - Updates ONLY when HP text changes, when route changes, or when options change
// - Epic mode + custom label (current epic is "strong", we'll switch it to Legendary Fantasy next)
//
// DOM hook (confirmed):
// <ladok-poang-summeringar>
//   <dl class="ladok-dl-2">
//     <dt>Summering resultat:</dt>
//     <dd><span>150,0 hp</span>...</dd>
//   </dl>
// </ladok-poang-summeringar>

(() => {
  const DEFAULTS = {
    totalHp: 300,
    xpPerHp: 100,
    xpTotal: 30000, // derived by default in options.js
    levelCap: 100,
    levelExponent: 1.85,

    hideLabel: true,
    showHpLine: true,
    showXpToNext: true,

    epicMode: true,
    customLabel: "StudyQuest",

    mountId: "studyquest-xp-widget",
    allowedPathRegex: /\/student\/app\/studentwebb\/min-utbildning\/alla\/?$/i,
  };

  // ---------------- storage ----------------
  function loadConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (cfg) => resolve(cfg));
      } catch {
        resolve({ ...DEFAULTS });
      }
    });
  }

  // --------------- helpers ----------------
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function xpRequiredForLevel(level, cfg) {
    const L = clamp(level, 1, cfg.levelCap);
    const t = (L - 1) / (cfg.levelCap - 1);
    return cfg.xpTotal * Math.pow(t, cfg.levelExponent);
  }

  function levelFromXp(xp, cfg) {
    const x = clamp(xp, 0, cfg.xpTotal);
    let lo = 1,
      hi = cfg.levelCap;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (xpRequiredForLevel(mid, cfg) <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function parseHpFromText(text) {
    const m = String(text)
      .replace(/\s+/g, " ")
      .match(/(\d+(?:[.,]\d+)?)\s*hp/i);
    if (!m) return null;
    const num = Number(m[1].replace(",", "."));
    return Number.isFinite(num) ? num : null;
  }

  function formatInt(n) {
    return Math.round(n).toLocaleString("sv-SE");
  }

  function isAllowedRoute() {
    return DEFAULTS.allowedPathRegex.test(location.pathname);
  }

  function rgbToRgba(rgb, alpha) {
    const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return `rgba(15, 23, 42, ${alpha})`;
    return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
  }

  function pickAccentColor() {
    const activeBtn =
      document.querySelector('button[aria-pressed="true"]') ||
      document.querySelector(".btn.active");
    if (activeBtn) {
      const bg = getComputedStyle(activeBtn).backgroundColor;
      if (bg && !/rgba?\(0,\s*0,\s*0,\s*0\)/.test(bg)) return bg;
    }
    return "rgb(15, 23, 42)";
  }

  // --------------- Ladok hook --------------
  function getSummeringDl() {
    return document.querySelector("ladok-poang-summeringar dl.ladok-dl-2");
  }

  function getNodesFromDl(dl) {
    const dt = dl?.querySelector("dt") || null;
    const dd = dl?.querySelector("dd") || null;
    const span = dd?.querySelector("span") || null;
    const hp = span ? parseHpFromText(span.textContent || "") : null;
    return { dt, dd, span, hp };
  }

  // --------------- epic CSS (LEGENDARY) ------
  function ensureEpicStyle(mountId) {
    const styleId = "studyquest-epic-style";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      /* ═══════════════════════════════════════════
         KEYFRAMES
         ═══════════════════════════════════════════ */

      @keyframes sq_aurora {
        0%   { filter: hue-rotate(0deg); transform: translate3d(-2%, -1%, 0) scale(1.02); }
        50%  { filter: hue-rotate(35deg); transform: translate3d(2%, 1%, 0) scale(1.06); }
        100% { filter: hue-rotate(0deg); transform: translate3d(-2%, -1%, 0) scale(1.02); }
      }

      @keyframes sq_pulse {
        0%,100% { transform: scale(1); opacity: .85; }
        50%     { transform: scale(1.08); opacity: 1; }
      }

      @keyframes sq_shimmer {
        0%   { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
        10%  { opacity: .7; }
        60%  { opacity: .3; }
        100% { transform: translateX(120%) skewX(-18deg); opacity: 0; }
      }

      @keyframes sq_float {
        0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0; }
        10% { opacity: 1; }
        90% { opacity: 1; }
        100% { transform: translateY(-60px) rotate(20deg); opacity: 0; }
      }

      @keyframes sq_borderFlow {
        0%   { background-position: 0% 50%; }
        50%  { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }

      @keyframes sq_rainbowShift {
        0%   { filter: hue-rotate(0deg); }
        100% { filter: hue-rotate(360deg); }
      }

      @keyframes sq_starTwinkle {
        0%, 100% { opacity: 0.3; transform: scale(0.8); }
        50% { opacity: 1; transform: scale(1.2); }
      }

      @keyframes sq_orbFloat {
        0%, 100% { transform: translate(0, 0) scale(1); }
        25% { transform: translate(10px, -15px) scale(1.1); }
        50% { transform: translate(-5px, -25px) scale(0.9); }
        75% { transform: translate(-15px, -10px) scale(1.05); }
      }

      @keyframes sq_badgePulse {
        0%, 100% { box-shadow: 0 0 20px currentColor, 0 0 40px currentColor, inset 0 0 15px rgba(255,255,255,0.3); }
        50% { box-shadow: 0 0 30px currentColor, 0 0 60px currentColor, 0 0 80px currentColor, inset 0 0 20px rgba(255,255,255,0.5); }
      }

      @keyframes sq_textGlow {
        0%, 100% { text-shadow: 0 0 10px currentColor, 0 0 20px currentColor; }
        50% { text-shadow: 0 0 20px currentColor, 0 0 40px currentColor, 0 0 60px currentColor; }
      }

      @keyframes sq_runeRotate {
        0% { transform: rotate(0deg); opacity: 0.15; }
        50% { opacity: 0.35; }
        100% { transform: rotate(360deg); opacity: 0.15; }
      }

      @keyframes sq_energyPulse {
        0%, 100% { filter: brightness(1); }
        50% { filter: brightness(1.2); }
      }

      /* ═══════════════════════════════════════════
         WIDGET CONTAINER
         ═══════════════════════════════════════════ */

      #${mountId}.sq-epic {
        position: relative;
        overflow: hidden;
        transform: translateZ(0);
        z-index: 1;
      }

      /* Animated gradient border - using box-shadow instead to stay contained */
      #${mountId}.sq-epic .sq-border-glow {
        position: absolute;
        inset: 0;
        border-radius: 18px;
        pointer-events: none;
        z-index: 100;
        box-shadow: 
          inset 0 0 0 2px rgba(255,107,107,0.5),
          inset 0 0 0 3px rgba(254,202,87,0.3),
          0 0 15px rgba(255,107,107,0.3),
          0 0 30px rgba(84,160,255,0.2);
        animation: sq_rainbowShift 8s linear infinite;
      }

      /* Inner card background */
      #${mountId}.sq-epic .sq-inner-bg {
        position: absolute;
        inset: 0;
        border-radius: 18px;
        background: inherit;
        z-index: -1;
      }

      /* Nebula/cosmic backdrop */
      #${mountId}.sq-epic::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 18px;
        background:
          radial-gradient(ellipse at 20% 20%, rgba(255,107,107,0.25), transparent 50%),
          radial-gradient(ellipse at 80% 20%, rgba(84,160,255,0.25), transparent 50%),
          radial-gradient(ellipse at 50% 80%, rgba(95,39,205,0.2), transparent 50%),
          radial-gradient(ellipse at 30% 60%, rgba(72,219,251,0.15), transparent 40%);
        mix-blend-mode: overlay;
        animation: sq_aurora 6s ease-in-out infinite;
        pointer-events: none;
        z-index: 0;
      }

      /* Decorative corner accents */
      #${mountId}.sq-epic .sq-runes {
        position: absolute;
        inset: 4px;
        border: 1px dashed rgba(255,255,255,0.12);
        border-radius: 14px;
        pointer-events: none;
        z-index: 0;
      }

      /* Floating particles container */
      #${mountId}.sq-epic .sq-particles {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
        z-index: 10;
        border-radius: 18px;
      }

      #${mountId}.sq-epic .sq-particle {
        position: absolute;
        width: 6px;
        height: 6px;
        background: radial-gradient(circle, rgba(255,255,255,0.9), rgba(255,200,100,0.6));
        border-radius: 50%;
        animation: sq_float 3s ease-out infinite;
        box-shadow: 0 0 6px rgba(255,200,100,0.8), 0 0 12px rgba(255,150,50,0.4);
      }

      /* Twinkling stars */
      #${mountId}.sq-epic .sq-star {
        position: absolute;
        width: 4px;
        height: 4px;
        background: white;
        clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
        animation: sq_starTwinkle 2s ease-in-out infinite;
        filter: drop-shadow(0 0 3px white);
      }

      /* Floating energy orbs */
      #${mountId}.sq-epic .sq-orb {
        position: absolute;
        width: 30px;
        height: 30px;
        background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4), rgba(84,160,255,0.2), transparent 70%);
        border-radius: 50%;
        animation: sq_orbFloat 8s ease-in-out infinite;
        pointer-events: none;
        filter: blur(1px);
      }

      /* ═══════════════════════════════════════════
         PROGRESS BAR
         ═══════════════════════════════════════════ */

      #${mountId} .sq-bar {
        position: relative;
        overflow: hidden;
        z-index: 2;
      }

      /* Bar inner fill with energy effect */
      #${mountId}.sq-epic .sq-bar-fill {
        animation: sq_energyPulse 2s ease-in-out infinite;
        transform-origin: left center;
      }

      /* Shimmer streak - more dramatic */
      #${mountId} .sq-shimmer {
        position: absolute;
        top: -50%;
        bottom: -50%;
        width: 60%;
        background: linear-gradient(90deg, 
          transparent, 
          rgba(255,255,255,0.4),
          rgba(255,255,255,0.9),
          rgba(255,255,255,0.4),
          transparent);
        animation: sq_shimmer 2s ease-in-out infinite;
        pointer-events: none;
        mix-blend-mode: overlay;
      }

      /* Bar underglow */
      #${mountId}.sq-epic .sq-bar-glow {
        position: absolute;
        inset: -4px;
        border-radius: 999px;
        background: linear-gradient(90deg, 
          rgba(255,107,107,0.35),
          rgba(254,202,87,0.35),
          rgba(72,219,251,0.35),
          rgba(84,160,255,0.35));
        filter: blur(6px);
        animation: sq_pulse 2s ease-in-out infinite;
        pointer-events: none;
        z-index: -1;
      }

      /* Energy crackle on bar edge */
      #${mountId}.sq-epic .sq-bar-edge {
        position: absolute;
        right: -2px;
        top: 50%;
        transform: translateY(-50%);
        width: 8px;
        height: 140%;
        background: radial-gradient(ellipse at center, rgba(255,255,255,0.9), transparent 70%);
        filter: blur(2px);
        animation: sq_pulse 1s ease-in-out infinite;
      }

      /* ═══════════════════════════════════════════
         LEVEL BADGE
         ═══════════════════════════════════════════ */

      #${mountId} .sq-badge {
        position: relative;
        isolation: isolate;
        overflow: visible !important;
      }

      /* Prismatic spinning ring */
      #${mountId}.sq-epic .sq-badge::before {
        content: "";
        position: absolute;
        inset: -8px;
        border-radius: 999px;
        background: conic-gradient(from 0deg,
          #ff6b6b, #feca57, #48dbfb, #ff9ff3, #54a0ff, #5f27cd, #ff6b6b);
        animation: sq_rainbowShift 4s linear infinite;
        filter: blur(4px);
        opacity: 0.75;
        z-index: -1;
      }

      /* Inner badge glow */
      #${mountId}.sq-epic .sq-badge::after {
        content: "";
        position: absolute;
        inset: -4px;
        border-radius: 999px;
        background: inherit;
        filter: blur(8px);
        opacity: 0.6;
        z-index: -1;
        animation: sq_pulse 2s ease-in-out infinite;
      }

      /* Badge text glow */
      #${mountId}.sq-epic .sq-badge-text {
        animation: sq_textGlow 2.5s ease-in-out infinite;
        position: relative;
        z-index: 1;
      }

      /* Crown icon for high levels */
      #${mountId}.sq-epic .sq-crown {
        position: absolute;
        top: -18px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 16px;
        filter: drop-shadow(0 0 4px gold) drop-shadow(0 0 8px rgba(255,200,50,0.6));
        animation: sq_pulse 2s ease-in-out infinite;
        z-index: 10;
      }

      /* ═══════════════════════════════════════════
         LABEL & TEXT
         ═══════════════════════════════════════════ */

      #${mountId}.sq-epic .sq-label {
        background: linear-gradient(90deg, #fff, #ffd700, #fff);
        background-size: 200% auto;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: sq_borderFlow 3s linear infinite;
        font-weight: 700 !important;
      }

      #${mountId}.sq-epic .sq-xp-text {
        text-shadow: 0 0 8px rgba(255,255,255,0.4);
      }
    `;
    document.head.appendChild(style);
  }

  // Helper to create floating particles
  function createEpicParticles(container) {
    const particlesWrap = document.createElement("div");
    particlesWrap.className = "sq-particles";

    // Floating sparkle particles
    for (let i = 0; i < 6; i++) {
      const p = document.createElement("div");
      p.className = "sq-particle";
      p.style.left = `${15 + Math.random() * 70}%`;
      p.style.bottom = `${Math.random() * 30}%`;
      p.style.animationDelay = `${Math.random() * 3}s`;
      p.style.animationDuration = `${2.5 + Math.random() * 2}s`;
      particlesWrap.appendChild(p);
    }

    // Twinkling stars
    for (let i = 0; i < 5; i++) {
      const s = document.createElement("div");
      s.className = "sq-star";
      s.style.left = `${10 + Math.random() * 80}%`;
      s.style.top = `${10 + Math.random() * 80}%`;
      s.style.animationDelay = `${Math.random() * 2}s`;
      s.style.transform = `scale(${0.6 + Math.random() * 0.8})`;
      particlesWrap.appendChild(s);
    }

    container.appendChild(particlesWrap);

    // Floating orbs
    const orb1 = document.createElement("div");
    orb1.className = "sq-orb";
    orb1.style.top = "10%";
    orb1.style.right = "15%";
    orb1.style.animationDelay = "0s";
    container.appendChild(orb1);

    const orb2 = document.createElement("div");
    orb2.className = "sq-orb";
    orb2.style.bottom = "20%";
    orb2.style.left = "10%";
    orb2.style.animationDelay = "-4s";
    orb2.style.opacity = "0.6";
    container.appendChild(orb2);

    // Rune circle
    const runes = document.createElement("div");
    runes.className = "sq-runes";
    container.appendChild(runes);

    // Animated border glow
    const borderGlow = document.createElement("div");
    borderGlow.className = "sq-border-glow";
    container.appendChild(borderGlow);

    // Inner background (to cover the border glow inside)
    const innerBg = document.createElement("div");
    innerBg.className = "sq-inner-bg";
    container.appendChild(innerBg);
  }


  // --------------- render ------------------
  function renderWidget(completedHp, cfg) {
    const accent = pickAccentColor();

    const derivedXpTotal = Math.round(cfg.totalHp * cfg.xpPerHp);
    if (!Number.isFinite(cfg.xpTotal) || cfg.xpTotal <= 0) cfg.xpTotal = derivedXpTotal;

    const xp = completedHp * cfg.xpPerHp;
    const level = levelFromXp(xp, cfg);

    const xpThis = xpRequiredForLevel(level, cfg);
    const xpNext = xpRequiredForLevel(Math.min(cfg.levelCap, level + 1), cfg);
    const into = xp - xpThis;
    const span = Math.max(1, xpNext - xpThis);
    const pct = clamp((into / span) * 100, 0, 100);

    // Epic sizing
    const padY = cfg.epicMode ? 18 : 14;
    const padX = cfg.epicMode ? 18 : 16;
    const radius = cfg.epicMode ? 18 : 14;
    const barH = cfg.epicMode ? 22 : 18;
    const badgeFont = cfg.epicMode ? 20 : 18;
    const badgePadY = cfg.epicMode ? 11 : 10;
    const badgePadX = cfg.epicMode ? 16 : 14;

    if (cfg.epicMode) ensureEpicStyle(cfg.mountId);

    const wrap = document.createElement("div");
    wrap.id = cfg.mountId;

    wrap.style.display = "grid";
    wrap.style.gap = cfg.epicMode ? "12px" : "10px";
    wrap.style.width = "100%";
    wrap.style.padding = `${padY}px ${padX}px`;
    wrap.style.borderRadius = `${radius}px`;
    wrap.style.border = `1px solid ${rgbToRgba(accent, 0.25)}`;
    wrap.style.background = `linear-gradient(180deg, ${rgbToRgba(accent, 0.14)}, rgba(255,255,255,0.93))`;
    wrap.style.boxShadow = cfg.epicMode
      ? `0 18px 36px ${rgbToRgba(accent, 0.18)}`
      : `0 10px 22px ${rgbToRgba(accent, 0.10)}`;
    wrap.style.fontFamily = "inherit";
    wrap.style.boxSizing = "border-box";
    wrap.style.position = "relative";
    wrap.style.overflow = "hidden";

    if (cfg.epicMode) {
      wrap.classList.add("sq-epic");
      createEpicParticles(wrap);
    }

    // Top row
    const top = document.createElement("div");
    top.style.position = "relative";
    top.style.zIndex = "5";
    top.style.display = "flex";
    top.style.alignItems = "baseline";
    top.style.justifyContent = "space-between";
    top.style.gap = "12px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.minWidth = "0";

    const label = document.createElement("div");
    label.textContent = (cfg.customLabel || "StudyQuest").trim();
    label.style.fontSize = cfg.epicMode ? "13px" : "12px";
    label.style.letterSpacing = "0.08em";
    label.style.textTransform = "uppercase";
    if (cfg.epicMode) {
      label.classList.add("sq-label");
    } else {
      label.style.opacity = "0.85";
    }

    left.appendChild(label);

    if (cfg.showHpLine) {
      const hpLine = document.createElement("div");
      hpLine.textContent = `${completedHp.toLocaleString("sv-SE")} / ${cfg.totalHp} hp`;
      hpLine.style.fontSize = cfg.epicMode ? "16px" : "14px";
      hpLine.style.fontWeight = "700";
      hpLine.style.whiteSpace = "nowrap";
      hpLine.style.overflow = "hidden";
      hpLine.style.textOverflow = "ellipsis";
      left.appendChild(hpLine);
    }

    const badge = document.createElement("div");
    badge.classList.add("sq-badge");
    badge.style.fontSize = `${badgeFont}px`;
    badge.style.fontWeight = "900";
    badge.style.color = "white";
    badge.style.background = cfg.epicMode
      ? `linear-gradient(135deg, ${accent}, rgba(255,255,255,0.55), ${accent})`
      : accent;
    badge.style.padding = `${badgePadY}px ${badgePadX}px`;
    badge.style.borderRadius = "999px";
    badge.style.boxShadow = cfg.epicMode
      ? `0 10px 24px ${rgbToRgba(accent, 0.35)}, 0 0 30px ${rgbToRgba(accent, 0.25)}`
      : `0 10px 24px ${rgbToRgba(accent, 0.28)}`;
    badge.style.whiteSpace = "nowrap";
    badge.style.flex = "0 0 auto";
    badge.style.lineHeight = "1";
    badge.style.position = "relative";

    // Badge text (wrapped for glow effect)
    const badgeText = document.createElement("span");
    badgeText.textContent = `LV ${level}`;
    if (cfg.epicMode) badgeText.classList.add("sq-badge-text");
    badge.appendChild(badgeText);

    // Crown for higher levels in epic mode
    if (cfg.epicMode && level >= Math.floor(cfg.levelCap * 0.5)) {
      const crown = document.createElement("span");
      crown.className = "sq-crown";
      crown.textContent = level >= Math.floor(cfg.levelCap * 0.8) ? "👑" : "✨";
      badge.appendChild(crown);
    }

    top.appendChild(left);
    top.appendChild(badge);

    // Bar
    const barWrap = document.createElement("div");
    barWrap.className = "sq-bar";
    barWrap.style.height = `${barH}px`;
    barWrap.style.background = cfg.epicMode ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.10)";
    barWrap.style.borderRadius = "999px";
    barWrap.style.overflow = "hidden";
    barWrap.style.position = "relative";
    barWrap.style.zIndex = "5";

    const bar = document.createElement("div");
    bar.style.height = "100%";
    bar.style.width = `${pct}%`;
    bar.style.background = cfg.epicMode
      ? `linear-gradient(90deg, ${accent}, ${rgbToRgba(accent, 0.8)}, ${accent})`
      : accent;
    bar.style.borderRadius = "999px";
    bar.style.transition = "width 220ms ease";
    bar.style.position = "relative";
    if (cfg.epicMode) bar.classList.add("sq-bar-fill");
    barWrap.appendChild(bar);

    if (cfg.epicMode) {
      const glow = document.createElement("div");
      glow.className = "sq-bar-glow";
      barWrap.appendChild(glow);

      const shimmer = document.createElement("div");
      shimmer.className = "sq-shimmer";
      barWrap.appendChild(shimmer);

      // Energy edge effect at bar tip
      if (pct > 5) {
        const edge = document.createElement("div");
        edge.className = "sq-bar-edge";
        bar.appendChild(edge);
      }
    }

    wrap.appendChild(top);
    wrap.appendChild(barWrap);

    if (cfg.showXpToNext) {
      const foot = document.createElement("div");
      foot.style.display = "flex";
      foot.style.justifyContent = "space-between";
      foot.style.alignItems = "center";
      foot.style.gap = "12px";
      foot.style.fontSize = cfg.epicMode ? "14px" : "13px";
      foot.style.opacity = "0.92";
      foot.style.position = "relative";
      foot.style.zIndex = "5";

      const l = document.createElement("div");
      l.textContent = `Mot LV ${Math.min(cfg.levelCap, level + 1)}`;
      if (cfg.epicMode) l.classList.add("sq-xp-text");

      const r = document.createElement("div");
      r.style.fontVariantNumeric = "tabular-nums";
      r.textContent = `${formatInt(into)} / ${formatInt(span)} XP`;
      if (cfg.epicMode) r.classList.add("sq-xp-text");

      foot.appendChild(l);
      foot.appendChild(r);
      wrap.appendChild(foot);
    }

    return wrap;
  }

  // --------------- teardown ----------------
  function teardown() {
    const dl = getSummeringDl();
    if (!dl) return;

    const { dt, dd, span } = getNodesFromDl(dl);

    const w = dl.querySelector(`#${DEFAULTS.mountId}`);
    if (w) w.remove();

    if (dt) dt.style.display = "";
    if (dd) {
      dd.style.display = "";
      dd.style.margin = "";
      dd.style.padding = "";
      dd.style.width = "";
    }
    if (span) span.style.display = "";
  }

  // --------------- mount/update (stable) ---
  let hpObs = null;
  let scheduled = false;
  let currentPath = location.pathname;

  let lastHpText = null;
  let lastAllowed = null;

  async function mountOrUpdate() {
    const allowed = isAllowedRoute();

    // If leaving allowed route, teardown once
    if (lastAllowed !== null && allowed !== lastAllowed && !allowed) {
      teardown();
      lastAllowed = allowed;
      return;
    }
    lastAllowed = allowed;

    if (!allowed) return;

    const cfg = await loadConfig();

    const dl = getSummeringDl();
    if (!dl) return;

    const { dt, dd, span, hp } = getNodesFromDl(dl);
    if (!dt || !dd || !span || hp == null) return;

    const hpText = (span.textContent || "").trim();

    // If HP didn't change, avoid replacing the widget (prevents devtools flicker)
    if (hpText && hpText === lastHpText) {
      if (cfg.hideLabel) dt.style.display = "none";
      span.style.display = "none";
      dd.style.display = "block";
      dd.style.width = "100%";
      attachHpObserver(span);
      return;
    }
    lastHpText = hpText;

    if (cfg.hideLabel) dt.style.display = "none";
    span.style.display = "none";

    dd.style.display = "block";
    dd.style.margin = "0";
    dd.style.padding = "0";
    dd.style.width = "100%";

    const existing = dd.querySelector(`#${cfg.mountId}`);
    const widget = renderWidget(hp, cfg);

    if (existing) existing.replaceWith(widget);
    else dd.appendChild(widget);

    attachHpObserver(span);
  }

  function attachHpObserver(span) {
    if (hpObs) return;
    hpObs = new MutationObserver(() => schedule());
    hpObs.observe(span, { characterData: true, childList: true, subtree: true });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      mountOrUpdate();
    }, 60);
  }

  // Detect SPA navigation
  function hookHistory() {
    const _push = history.pushState;
    const _replace = history.replaceState;

    history.pushState = function (...args) {
      const ret = _push.apply(this, args);
      schedule();
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = _replace.apply(this, args);
      schedule();
      return ret;
    };

    window.addEventListener("popstate", schedule);
    window.addEventListener("hashchange", schedule);
  }

  function startPathWatcher() {
    setInterval(() => {
      if (location.pathname !== currentPath) {
        currentPath = location.pathname;
        // force rerender when route changes
        lastHpText = null;
        schedule();
      }
    }, 250);
  }

  // Re-render when options change (no reload needed)
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      lastHpText = null;
      schedule();
    });
  } catch {}

  // Initial retry loop (Angular render delay)
  let tries = 0;
  const interval = setInterval(() => {
    schedule();
    tries++;
    if (tries > 40) clearInterval(interval);
  }, 500);

  hookHistory();
  startPathWatcher();
  schedule();
})();
