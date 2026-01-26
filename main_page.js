(() => {
  const DEFAULTS = {
    levelExponent: 1.2,
    hideLabel: true,
    showXpToNext: true,
    epicMode: false,

    mountId: "studyquest-xp-widget",
    allowedPathRegex: /\/student\/app\/studentwebb\/min-utbildning\/alla\/?$/i,
  };

  // Performance and timing constants
  const DEBOUNCE_MS = 60;
  const PATH_WATCH_MS = 250;
  const TAB_THROTTLE_MS = 800;
  const SCAN_RESET_DELAY_MS = 1200;
  const INITIAL_SCHEDULE_TRIES = 40;
  const INITIAL_SCHEDULE_INTERVAL_MS = 500;

  const api = globalThis.chrome ?? globalThis.browser;

    // ---------- Ladok++ saved course-data ----------
  function runtimeSendMessage(msg) {
    // chrome.* uses callbacks; browser.* can be Promise. Support both.
    try {
      const p = api.runtime?.sendMessage?.(msg);
      if (p && typeof p.then === "function") return p;
    } catch {}
    return new Promise((resolve) => {
      try {
        api.runtime.sendMessage(msg, (res) => resolve(res));
      } catch {
        resolve(null);
      }
    });
  }

  async function ladokppGetAllCourseData() {
    const res = await runtimeSendMessage({ type: "LADOKPP_GET_COURSES" });
    return res?.courses ?? {};
  }

  function indexSavedByCourseCode(savedCoursesObj) {
    const map = new Map();
    for (const c of Object.values(savedCoursesObj || {})) {
      if (c?.courseCode) map.set(c.courseCode, c);
    }
    return map;
  }

  function isPassedGrade(code) {
    return ["G", "A", "B", "C", "D", "E"].includes(code);
  }

  function computeAggregateFromSaved(savedCoursesObj) {
    const courses = Object.values(savedCoursesObj || {});
    const courseCount = courses.length;

    let modulesTotal = 0;
    let modulesPassed = 0;

    for (const c of courses) {
      const mods = c?.modules || [];
      modulesTotal += mods.length;
      for (const m of mods) {
        const g = m?.latest?.grade;
        if (g && isPassedGrade(g)) modulesPassed += 1;
      }
    }

    return { courseCount, modulesTotal, modulesPassed };
  }

  async function ladokppScanUrls(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return;
    await runtimeSendMessage({ type: "LADOKPP_SCAN_URLS", urls });
  }

  function loadConfig() {
    return new Promise((resolve) => {
      try {
        api.storage.sync.get(DEFAULTS, (cfg) => resolve(cfg));
      } catch {
        resolve({ ...DEFAULTS });
      }
    });
  }

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function parseHpFromText(text) {
    const m = String(text).replace(/\s+/g, " ").match(/(\d+(?:[.,]\d+)?)\s*hp/i);
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

  // ---------------- Ladok hooks ----------------
  function getSummeringDl() {
    return document.querySelector("ladok-poang-summeringar dl.ladok-dl-2");
  }

  function getCompletedHpSpan() {
    const dl = getSummeringDl();
    const dd = dl?.querySelector("dd") || null;
    const span = dd?.querySelector("span") || null;
    return { dl, dd, span };
  }

  function readTotalHp() {
    const el = Array.from(document.querySelectorAll(".ladok-text-muted"))
      .find((e) => /\bhp\b/i.test(e.textContent || ""));
    if (!el) return { totalHp: null, totalHpEl: null };
    const totalHp = parseHpFromText(el.textContent || "");
    return { totalHp, totalHpEl: el };
  }

  // Return the actual clickable <a> element and its container <h2>
  function getProgramTitleAnchor() {
    // Your snippet: <h2 class="card-title ..."><a class="card-link" href="..."><span>Title</span></a></h2>
    const a =
      document.querySelector("h2.card-title a.card-link") ||
      document.querySelector("h2.card-title a");
    if (!a) return { a: null, h2: null };

    const h2 = a.closest("h2.card-title") || null;
    return { a, h2 };
  }

  // --------------- progression math -----------
  // Converts HP (credits) to XP and calculates level from XP using exponential curve.
  // The levelExponent controls curve shape:
  //   <1.2: steeper early game (levels come fast at start)
  //   1.2-2.0: smooth progression (recommended range)
  //   >2.0: back-loaded (hard to level early, speed up late)
  function makeProgression(totalHp, cfg) {
    const xpPerHp = 100;
    const levelCap = 100;
    const xpTotal = Math.round(totalHp * xpPerHp);

    function xpRequiredForLevel(level) {
      // Apply exponential curve: level 1 = 0 XP, level 100 = xpTotal XP
      const L = clamp(level, 1, levelCap);
      const t = (L - 1) / (levelCap - 1);
      return xpTotal * Math.pow(t, cfg.levelExponent);
    }

    function levelFromXp(xp) {
      const x = clamp(xp, 0, xpTotal);
      let lo = 1,
        hi = levelCap;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (xpRequiredForLevel(mid) <= x) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }

    return { xpPerHp, levelCap, xpTotal, xpRequiredForLevel, levelFromXp };
  }

  // ---------------- EPIC CSS -----------------
  function ensureLegendaryStyle(mountId) {
    const styleId = "studyquest-legendary-style";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes sq_glowPulse { 0%,100%{transform:scale(1);opacity:.95} 50%{transform:scale(1.03);opacity:1} }
      @keyframes sq_emberDrift { 0%{transform:translate3d(-8%,10%,0) scale(1);opacity:0} 12%{opacity:.55} 60%{opacity:.35} 100%{transform:translate3d(8%,-12%,0) scale(1.05);opacity:0} }
      @keyframes sq_shimmerSweep { 0%{transform:translateX(-140%) skewX(-18deg);opacity:0} 12%{opacity:.7} 60%{opacity:.25} 100%{transform:translateX(140%) skewX(-18deg);opacity:0} }
      @keyframes sq_runeSpin { 0%{transform:rotate(0deg);opacity:.55} 50%{opacity:.75} 100%{transform:rotate(360deg);opacity:.55} }

      #${mountId}.sq-legendary { position:relative; overflow:hidden; isolation:isolate; transform:translateZ(0); }
      #${mountId}.sq-legendary::before{
        content:""; position:absolute; inset:-40%;
        background:
          radial-gradient(circle at 20% 20%, rgba(255,236,170,.40), transparent 42%),
          radial-gradient(circle at 70% 30%, rgba(255,210,120,.32), transparent 45%),
          radial-gradient(circle at 50% 75%, rgba(255,255,255,.18), transparent 55%),
          radial-gradient(circle at 30% 80%, rgba(0,0,0,.10), transparent 55%);
        filter:blur(2px); opacity:.9; animation:sq_glowPulse 2.6s ease-in-out infinite;
        pointer-events:none; mix-blend-mode:overlay; z-index:0;
      }
      #${mountId}.sq-legendary::after{
        content:""; position:absolute; inset:0;
        background:
          radial-gradient(circle, rgba(255,220,120,.70) 1px, transparent 1.4px) 0 0/22px 22px,
          radial-gradient(circle, rgba(255,245,200,.55) 1px, transparent 1.4px) 10px 14px/28px 28px;
        opacity:.45; animation:sq_emberDrift 3.4s ease-in-out infinite;
        pointer-events:none; mix-blend-mode:screen; z-index:0;
      }
      #${mountId} .sq-layer{ position:relative; z-index:2; }

      #${mountId} .sq-titleLink {
        display: inline-block;
        color: inherit;
        text-decoration: none;
      }
      #${mountId} .sq-titleLink:hover {
        text-decoration: underline;
      }

      #${mountId} .sq-badge{ position:relative; isolation:isolate; }
      #${mountId} .sq-badge::before{
        content:""; position:absolute; inset:-8px; border-radius:999px;
        background: conic-gradient(from 0deg,
          rgba(255,255,255,0.00),
          rgba(255,245,200,0.95),
          rgba(255,255,255,0.00),
          rgba(255,210,120,0.85),
          rgba(255,255,255,0.00)
        );
        filter:blur(1.5px); opacity:.65; animation:sq_runeSpin 3.8s linear infinite; z-index:-1;
      }
      #${mountId} .sq-badge::after{
        content:""; position:absolute; inset:-18px; border-radius:999px;
        background: radial-gradient(circle, rgba(255,220,120,.28), transparent 60%);
        filter:blur(10px); opacity:.9; animation:sq_glowPulse 2.2s ease-in-out infinite; z-index:-2;
      }

      #${mountId} .sq-bar{ position:relative; overflow:hidden; }
      #${mountId} .sq-bar::before{
        content:""; position:absolute; inset:-18px; border-radius:999px;
        background:
          radial-gradient(circle at 20% 50%, rgba(255,245,200,.35), transparent 55%),
          radial-gradient(circle at 70% 45%, rgba(255,210,120,.25), transparent 55%);
        filter:blur(12px); opacity:.65; pointer-events:none; mix-blend-mode:screen;
      }
      #${mountId} .sq-shimmer{
        position:absolute; top:-35%; bottom:-35%; width:42%;
        background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.95), rgba(255,255,255,0));
        animation:sq_shimmerSweep 1.45s ease-in-out infinite;
        pointer-events:none; mix-blend-mode:overlay; filter:blur(.2px);
      }
      #${mountId} .sq-runes{
        position:absolute; inset:0;
        background:
          repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 12px),
          repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 14px);
        opacity:.35; pointer-events:none; mix-blend-mode:overlay;
      }
    `;
    document.head.appendChild(style);
  }

  function removeLegendaryStyle() {
    const style = document.getElementById("studyquest-legendary-style");
    if (style) style.remove();
  }

  // ---------------- render -----------------
  function renderWidget({ titleAnchor, completedHp, totalHp, extras }, cfg) {
    const accent = pickAccentColor();
    const epic = !!cfg.epicMode;
    if (epic) {
      ensureLegendaryStyle(cfg.mountId);
    } else {
      removeLegendaryStyle();
    }

    const prog = makeProgression(totalHp, cfg);
    const xp = completedHp * prog.xpPerHp;
    const level = prog.levelFromXp(xp);

    const xpThis = prog.xpRequiredForLevel(level);
    const xpNext = prog.xpRequiredForLevel(Math.min(100, level + 1));
    const into = xp - xpThis;
    const span = Math.max(1, xpNext - xpThis);
    const pct = clamp((into / span) * 100, 0, 100);

    const wrap = document.createElement("div");
    wrap.id = cfg.mountId;
    if (epic) wrap.classList.add("sq-legendary");

    wrap.style.display = "grid";
    wrap.style.gap = epic ? "14px" : "10px";
    wrap.style.width = "100%";
    wrap.style.padding = epic ? "max(16px, 3vw) max(16px, 4vw)" : "max(10px, 2vw) max(12px, 3vw)";
    wrap.style.borderRadius = epic ? "max(16px, 2vw)" : "max(12px, 1.5vw)";
    wrap.style.boxSizing = "border-box";
    wrap.style.border = `1px solid ${rgbToRgba(accent, 0.22)}`;
    wrap.style.background = epic
      ? `linear-gradient(180deg, rgba(255, 252, 245, 0.96), rgba(255,255,255,0.92))`
      : `linear-gradient(180deg, ${rgbToRgba(accent, 0.14)}, rgba(255,255,255,0.93))`;
    wrap.style.boxShadow = epic
      ? `0 22px 48px ${rgbToRgba(accent, 0.20)}, 0 0 0 1px rgba(255, 230, 150, 0.12) inset`
      : `0 10px 22px ${rgbToRgba(accent, 0.10)}`;
    wrap.style.fontFamily = "inherit";
    wrap.style.boxSizing = "border-box";

    const layer = document.createElement("div");
    layer.className = "sq-layer";
    layer.style.display = "grid";
    layer.style.gap = epic ? "14px" : "10px";

    // Top row
    const top = document.createElement("div");
    top.style.display = "flex";
    top.style.alignItems = "baseline";
    top.style.justifyContent = "space-between";
    top.style.gap = "14px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.minWidth = "0";

    // Put the clickable program <a> inside the module
    const label = document.createElement("div");
    label.style.fontSize = epic ? "28px" : "26px";
    label.style.letterSpacing = "0.01em";
    label.style.opacity = "0.92";
    if (epic) label.style.textShadow = "0 1px 0 rgba(255,255,255,0.65)";

    if (titleAnchor) {
      const aClone = titleAnchor.cloneNode(true);
      // Make sure it inherits and doesn't look off
      aClone.classList.add("sq-titleLink");
      aClone.style.color = "inherit";
      aClone.style.textDecoration = "none";
      aClone.style.fontWeight = "700";
      aClone.style.display = "inline-block";
      aClone.style.maxWidth = "100%";
      aClone.style.whiteSpace = "nowrap";
      aClone.style.overflow = "hidden";
      aClone.style.textOverflow = "ellipsis";
      label.appendChild(aClone);
    } else {
      label.textContent = "Min utbildning";
    }

    left.appendChild(label);

    const hpLine = document.createElement("div");
    hpLine.textContent = `${completedHp.toLocaleString("sv-SE")} / ${totalHp.toLocaleString("sv-SE")} hp`;
    hpLine.style.fontSize = epic ? "24px" : "20px";
    hpLine.style.fontWeight = epic ? "900" : "700";
    hpLine.style.whiteSpace = "nowrap";
    hpLine.style.overflow = "hidden";
    hpLine.style.textOverflow = "ellipsis";
    if (epic) hpLine.style.textShadow = "0 2px 12px rgba(255, 210, 120, 0.22)";
    left.appendChild(hpLine);

    const badge = document.createElement("div");
    badge.className = "sq-badge";
    badge.setAttribute("role", "status");
    badge.setAttribute("aria-label", `Level ${level} of 100`);
    badge.textContent = `LV ${level} / 100`;
    badge.style.fontSize = epic ? "22px" : "18px";
    badge.style.fontWeight = "950";
    badge.style.color = epic ? "rgba(10, 12, 18, 0.92)" : "white";
    badge.style.background = epic
      ? `linear-gradient(135deg, rgba(255,246,210,1), rgba(255,210,120,1), rgba(255,245,200,1))`
      : accent;
    badge.style.padding = epic ? "12px 18px" : "10px 14px";
    badge.style.borderRadius = "999px";
    badge.style.whiteSpace = "nowrap";
    badge.style.flex = "0 0 auto";
    badge.style.lineHeight = "1";
    badge.style.border = epic
      ? "1px solid rgba(120, 78, 20, 0.35)"
      : `1px solid ${rgbToRgba(accent, 0.15)}`;
    badge.style.boxShadow = epic
      ? "0 14px 30px rgba(255, 200, 110, 0.35), 0 2px 0 rgba(255,255,255,0.65) inset"
      : `0 10px 24px ${rgbToRgba(accent, 0.28)}`;

    top.appendChild(left);
    top.appendChild(badge);

    // Bar
    const barWrap = document.createElement("div");
    barWrap.className = "sq-bar";
    barWrap.setAttribute("role", "progressbar");
    barWrap.setAttribute("aria-valuenow", Math.round(pct));
    barWrap.setAttribute("aria-valuemin", "0");
    barWrap.setAttribute("aria-valuemax", "100");
    barWrap.setAttribute("aria-label", `Progress to level ${Math.min(100, level + 1)}: ${Math.round(pct)}%`);
    barWrap.style.height = epic ? "26px" : "18px";
    barWrap.style.background = epic
      ? "linear-gradient(180deg, rgba(30, 22, 12, 0.18), rgba(0,0,0,0.10))"
      : "rgba(0,0,0,0.10)";
    barWrap.style.borderRadius = "999px";
    barWrap.style.overflow = "hidden";
    barWrap.style.position = "relative";
    barWrap.style.boxShadow = epic
      ? "0 10px 22px rgba(0,0,0,0.10) inset, 0 0 0 1px rgba(255, 230, 150, 0.14) inset"
      : "0 0 0 1px rgba(0,0,0,0.06) inset";

    const bar = document.createElement("div");
    bar.style.height = "100%";
    bar.style.width = `${pct}%`;
    bar.style.background = epic
      ? `linear-gradient(90deg, rgba(255,225,145,1), rgba(255,190,90,1), rgba(255,245,200,1))`
      : accent;
    bar.style.borderRadius = "999px";
    bar.style.transition = "width 220ms ease";
    bar.style.boxShadow = epic ? "0 10px 26px rgba(255, 200, 110, 0.45)" : "none";
    barWrap.appendChild(bar);

    if (epic) {
      const runes = document.createElement("div");
      runes.className = "sq-runes";
      barWrap.appendChild(runes);

      const shimmer = document.createElement("div");
      shimmer.className = "sq-shimmer";
      barWrap.appendChild(shimmer);
    }

    // Footer
    if (cfg.showXpToNext) {
      const foot = document.createElement("div");
      foot.style.display = "flex";
      foot.style.justifyContent = "space-between";
      foot.style.alignItems = "center";
      foot.style.gap = "14px";
      foot.style.fontSize = epic ? "15px" : "13px";
      foot.style.opacity = "0.95";

      const l = document.createElement("div");
      l.textContent = `Mot lvl ${Math.min(100, level + 1)}`;

      const r = document.createElement("div");
      r.style.fontVariantNumeric = "tabular-nums";
      r.textContent = `${formatInt(into)} / ${formatInt(span)} XP`;

      foot.appendChild(l);
      foot.appendChild(r);

      layer.appendChild(top);
      layer.appendChild(barWrap);
      layer.appendChild(foot);
    } else {
      layer.appendChild(top);
      layer.appendChild(barWrap);
    }

    // ---- Ladok++ extras: scan coverage + modules progress + scan button ----
    if (extras) {
      const extra = document.createElement("div");
      extra.style.display = "flex";
      extra.style.justifyContent = "space-between";
      extra.style.alignItems = "center";
      extra.style.gap = "12px";
      extra.style.marginTop = epic ? "6px" : "4px";
      extra.style.fontSize = epic ? "14px" : "12px";
      extra.style.opacity = "0.92";

      const leftExtra = document.createElement("div");
      leftExtra.style.whiteSpace = "nowrap";
      leftExtra.style.overflow = "hidden";
      leftExtra.style.textOverflow = "ellipsis";

      const { savedCourseCount, modulesPassed, modulesTotal, listCourseCount } = extras;
      const coverage = (typeof listCourseCount === "number" && listCourseCount > 0)
        ? `${savedCourseCount}/${listCourseCount} kurser skannade`
        : `${savedCourseCount} kurser skannade`;

      const modLine = (typeof modulesTotal === "number" && modulesTotal > 0)
        ? ` • Moduler: ${modulesPassed}/${modulesTotal}`
        : "";

      leftExtra.textContent = coverage + modLine;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", extras.scanBusy ? "Scanning all courses" : "Scan all courses");
      btn.textContent = extras.scanBusy ? "Skannar…" : "Skanna alla";
      btn.disabled = !!extras.scanBusy;
      btn.style.border = `1px solid ${rgbToRgba(accent, 0.20)}`;
      btn.style.background = epic ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.85)";
      btn.style.color = "inherit";
      btn.style.borderRadius = "999px";
      btn.style.padding = epic ? "8px 12px" : "6px 10px";
      btn.style.fontWeight = "700";
      btn.style.cursor = btn.disabled ? "not-allowed" : "pointer";
      btn.style.whiteSpace = "nowrap";

      btn.addEventListener("click", () => {
        // delegate back to mountOrUpdate (it will attach handler via extras.onScanAll)
        extras.onScanAll?.();
      });

      extra.appendChild(leftExtra);
      extra.appendChild(btn);
      layer.appendChild(extra);
    }


    wrap.appendChild(layer);
    return wrap;
  }

  // --------------- teardown ----------------
  function teardown() {
    const { dl, dd, span } = getCompletedHpSpan();
    if (!dl) return;

    const w = dl.querySelector(`#${DEFAULTS.mountId}`);
    if (w) w.remove();

    const dt = dl.querySelector("dt");
    if (dt) dt.style.display = "";
    if (dd) {
      dd.style.display = "";
      dd.style.margin = "";
      dd.style.padding = "";
      dd.style.width = "";
    }
    if (span) span.style.display = "";

    // Restore original program title header (h2)
    const { h2 } = getProgramTitleAnchor();
    if (h2) h2.style.display = "";

    // Clean up observer to prevent memory leak
    if (hpObs) {
      hpObs.disconnect();
      hpObs = null;
    }
  }

  // --------------- mount/update ------------
  let hpObs = null;
  let scheduled = false;
  let currentPath = location.pathname;
  let lastKey = null;
  let pathWatcherInterval = null;

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      mountOrUpdate();
    }, DEBOUNCE_MS);
  }

  function attachHpObserver(span) {
    if (hpObs) return;
    hpObs = new MutationObserver(() => schedule());
    hpObs.observe(span, { characterData: true, childList: true, subtree: true });
  }

  async function mountOrUpdate() {
    if (!isAllowedRoute()) {
      teardown();
      return;
    }

    const cfg = await loadConfig();

    const { dl, dd, span } = getCompletedHpSpan();
    if (!dl || !dd || !span) return;

    const completedHp = parseHpFromText((span.textContent || "").trim());
    if (completedHp == null) return;

    const { totalHp, totalHpEl } = readTotalHp();
    if (!totalHp || totalHp <= 0) return;

    const { a: titleAnchor, h2: titleH2 } = getProgramTitleAnchor();

    // Hide original program title outside the module
    if (titleH2) titleH2.style.display = "none";

    // Hide the "300,0 hp" text outside the widget
    if (totalHpEl) totalHpEl.style.display = "none";

    // Hide Ladok label/value and mount widget
    if (cfg.hideLabel) {
      const dt = dl.querySelector("dt");
      if (dt) dt.style.display = "none";
    }
    span.style.display = "none";

    dd.style.display = "block";
    dd.style.margin = "0";
    dd.style.padding = "0";
    dd.style.width = "100%";

    attachHpObserver(span);

    // Dedupe key: rerender only if important page state changes
    // (not saved data, which will update separately via storage listener)
    const titleText = titleAnchor?.textContent?.trim() || "";
    const hpText = (span.textContent || "").trim();
    const key = `${titleText}||${totalHp}||${hpText}||${cfg.levelExponent}||${cfg.epicMode}||${cfg.showXpToNext}`;

    const savedCourses = await ladokppGetAllCourseData();
    const agg = computeAggregateFromSaved(savedCourses);


    const existing = dd.querySelector(`#${cfg.mountId}`);
    if (existing && key === lastKey) return;

    lastKey = key;

        // --- Ladok++: load saved per-course/module data ---

    // Try to discover course URLs from the current page list
    // (best effort: links that look like /min-utbildning/kurs/<uuid>)
    const courseUrlSet = new Set();
    for (const a of Array.from(document.querySelectorAll('a[href*="/min-utbildning/kurs/"]'))) {
      try {
        const href = a.getAttribute("href");
        if (!href) continue;
        const u = new URL(href, location.origin);
        if (u.pathname.includes("/student/app/studentwebb/min-utbildning/kurs/")) {
          courseUrlSet.add(u.toString());
        }
      } catch {}
    }
    const courseUrls = Array.from(courseUrlSet);

    // Count how many courses exist on the list page (rough proxy: number of unique course links)
    const listCourseCount = courseUrls.length || null;

    let scanBusy = false;
    const onScanAll = async () => {
      if (scanBusy) return;
      scanBusy = true;
      lastKey = null;       // force rerender so button text changes
      schedule();

      try {
        await ladokppScanUrls(courseUrls);
      } catch (err) {
        console.error("Ladok++ scan error:", err);
      } finally {
        // We'll mark not-busy after a short delay. Data will arrive async as tabs load.
        setTimeout(() => {
          scanBusy = false;
          lastKey = null;
          schedule();
        }, SCAN_RESET_DELAY_MS);
      }
    };

    const extras = {
      savedCourseCount: agg.courseCount,
      modulesTotal: agg.modulesTotal,
      modulesPassed: agg.modulesPassed,
      listCourseCount,
      scanBusy,
      onScanAll
    };

    const widget = renderWidget(
      { titleAnchor, completedHp, totalHp, extras },
      cfg
    );


    if (existing) existing.replaceWith(widget);
    else dd.appendChild(widget);
  }

  // --------------- SPA hooks ---------------
  function hookHistory() {
    const _push = history.pushState;
    const _replace = history.replaceState;

    history.pushState = function (...args) {
      const ret = _push.apply(this, args);
      lastKey = null;
      schedule();
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = _replace.apply(this, args);
      lastKey = null;
      schedule();
      return ret;
    };

    window.addEventListener("popstate", () => {
      lastKey = null;
      schedule();
    });
    window.addEventListener("hashchange", () => {
      lastKey = null;
      schedule();
    });
  }

  function startPathWatcher() {
    pathWatcherInterval = setInterval(() => {
      if (location.pathname !== currentPath) {
        currentPath = location.pathname;
        lastKey = null;
        schedule();
      }
    }, PATH_WATCH_MS);
  }

  function stopPathWatcher() {
    if (pathWatcherInterval) {
      clearInterval(pathWatcherInterval);
      pathWatcherInterval = null;
    }
  }

  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;

      // if settings changed or our saved courses changed, rerender
      if (area === "sync" || changes["ladokpp.courses"]) {
        lastKey = null;
        schedule();
      }
    });
  } catch { }

  let tries = 0;
  const initialInterval = setInterval(() => {
    schedule();
    tries++;
    if (tries > INITIAL_SCHEDULE_TRIES) clearInterval(initialInterval);
  }, INITIAL_SCHEDULE_INTERVAL_MS);

  hookHistory();
  startPathWatcher();
  schedule();
})();
