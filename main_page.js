(() => {
  const DEFAULTS = {
    levelExponent: 1.2,
    hideLabel: true,
    showXpToNext: true,
    epicMode: false,
    showStats: true,
    termBoundaryMode: "week",
    academicYearStartWeek: 36,
    includeSummerWeeks: true,
    dateBasis: "exam",

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

  function parseDateSafe(s) {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatHp(n) {
    const v = Math.round(n * 10) / 10;
    return v.toLocaleString("sv-SE", { maximumFractionDigits: 1 });
  }

  function parseCredits(val) {
    if (val == null) return null;
    if (typeof val === "number") return Number.isFinite(val) ? val : null;
    const n = Number(String(val).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function monthKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function termKey(d, cfg) {
    return getTermRange(d, cfg).label;
  }

  function getISOWeekInfo(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7; // Mon=1..Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const year = d.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return { year, week };
  }

  function isoWeekStartDate(year, week) {
    const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    const day = simple.getUTCDay() || 7;
    const diff = day <= 4 ? 1 - day : 8 - day;
    simple.setUTCDate(simple.getUTCDate() + diff);
    return new Date(simple.getUTCFullYear(), simple.getUTCMonth(), simple.getUTCDate());
  }

  function isoWeekEndDate(year, week) {
    const start = isoWeekStartDate(year, week);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return end;
  }

  function getTermRange(d, cfg) {
    const mode = cfg?.termBoundaryMode ?? DEFAULTS.termBoundaryMode;
    if (mode === "fixed") {
      // Date-based academic terms (fallback)
      const year = d.getFullYear();
      const htStartThis = new Date(year, 8, 1);
      const academicYear = d >= htStartThis ? year : year - 1;
      const htStart = new Date(academicYear, 8, 1);
      const htEnd = new Date(academicYear + 1, 0, 18);
      const vtStart = new Date(academicYear + 1, 0, 19);
      const vtEnd = new Date(academicYear + 1, 5, 7);
      const vtSummerEnd = new Date(academicYear + 1, 7, 31);
      const includeSummer = cfg?.includeSummerWeeks ?? DEFAULTS.includeSummerWeeks;

      if (d >= htStart && d <= htEnd) {
        return { label: `${academicYear} HT`, start: htStart, end: htEnd };
      }
      if (d >= vtStart && d <= (includeSummer ? vtSummerEnd : vtEnd)) {
        return { label: `${academicYear + 1} VT`, start: vtStart, end: includeSummer ? vtSummerEnd : vtEnd };
      }
      return { label: `${academicYear} HT`, start: htStart, end: htEnd };
    }

    // Week-based academic terms
    const startWeek = Math.min(53, Math.max(1, cfg?.academicYearStartWeek ?? DEFAULTS.academicYearStartWeek));
    const includeSummer = cfg?.includeSummerWeeks ?? DEFAULTS.includeSummerWeeks;
    const { year, week } = getISOWeekInfo(d);

    if (week >= startWeek || week <= 3) {
      const academicYear = week >= startWeek ? year : year - 1;
      return {
        label: `${academicYear} HT`,
        start: isoWeekStartDate(academicYear, startWeek),
        end: isoWeekEndDate(academicYear + 1, 3)
      };
    }

    const vtEndWeek = includeSummer
      ? Math.max(4, startWeek - 1)
      : Math.max(4, Math.min(23, startWeek - 1));

    if (!includeSummer && week > vtEndWeek && week < startWeek) {
      return {
        label: `${year} Sommar`,
        start: isoWeekStartDate(year, vtEndWeek + 1),
        end: isoWeekEndDate(year, startWeek - 1)
      };
    }

    return {
      label: `${year} VT`,
      start: isoWeekStartDate(year, 4),
      end: isoWeekEndDate(year, vtEndWeek)
    };
  }

  function pickResultDate(result, cfg) {
    if (!result) return null;
    const basis = cfg?.dateBasis ?? DEFAULTS.dateBasis;
    const exam = parseDateSafe(result.examDate);
    const decision = parseDateSafe(result.decisionDate);
    if (basis === "decision") return decision || exam;
    if (basis === "auto") return exam || decision;
    return exam || decision; // "exam" default
  }

  function toDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function daysInclusive(a, b) {
    const ms = 24 * 60 * 60 * 1000;
    return Math.floor((toDay(b) - toDay(a)) / ms) + 1;
  }

  function pickModuleDate(m, cfg) {
    const latest = m?.latest;
    const d1 = pickResultDate(latest, cfg);
    if (d1) return d1;
    const attempts = Array.isArray(m?.attempts) ? m.attempts : [];
    for (let i = attempts.length - 1; i >= 0; i -= 1) {
      const d = pickResultDate(attempts[i], cfg);
      if (d) return d;
    }
    return null;
  }

  function computeStatsFromSaved(savedCoursesObj, cfg) {
    const courses = Object.values(savedCoursesObj || {});
    const monthMap = new Map(); // key -> { credits, modules }
    const termMap = new Map(); // key -> { credits, modules, date }
    const now = new Date();
    const currentMonthKey = monthKey(now);
    const currentTerm = getTermRange(now, cfg);

    for (const c of courses) {
      const mods = c?.modules || [];
      let moduleCreditsSum = 0;
      let moduleCreditsCount = 0;
      for (const m of mods) {
        const latest = m?.latest;
        const g = latest?.grade;
        const credits = parseCredits(m?.creditsAwarded ?? m?.credits);
        if (!g || !isPassedGrade(g)) continue;
        if (!credits || !Number.isFinite(credits) || credits <= 0) continue;
        const d = pickModuleDate(m, cfg);
        if (!d) continue;
        moduleCreditsSum += credits;
        moduleCreditsCount += 1;

        const key = monthKey(d);
        const cur = monthMap.get(key) || { credits: 0, modules: 0, date: new Date(d.getFullYear(), d.getMonth(), 1) };
        cur.credits += credits;
        cur.modules += 1;
        monthMap.set(key, cur);

        const tKey = termKey(d, cfg);
        const tRange = getTermRange(d, cfg);
        const tDate = tRange.start;
        const tcur = termMap.get(tKey) || { credits: 0, modules: 0, date: tDate, label: tKey };
        tcur.credits += credits;
        tcur.modules += 1;
        termMap.set(tKey, tcur);
      }

      // If module credits are missing, fall back to course-level credits + course result date
      if (moduleCreditsSum === 0) {
        const cr = c?.courseResult;
        const g = cr?.grade;
        const credits = parseCredits(c?.courseCreditsAwarded ?? c?.courseCredits);
        if (g && isPassedGrade(g) && credits && Number.isFinite(credits) && credits > 0) {
          const d = pickResultDate(cr, cfg) || parseDateSafe(c?.end) || parseDateSafe(c?.start);
          if (d) {
            const key = monthKey(d);
            const cur = monthMap.get(key) || { credits: 0, modules: 0, date: new Date(d.getFullYear(), d.getMonth(), 1) };
            cur.credits += credits;
            monthMap.set(key, cur);

            const tKey = termKey(d, cfg);
            const tRange = getTermRange(d, cfg);
            const tDate = tRange.start;
            const tcur = termMap.get(tKey) || { credits: 0, modules: 0, date: tDate, label: tKey };
            tcur.credits += credits;
            termMap.set(tKey, tcur);
          }
        }
      }
    }

    const rows = Array.from(monthMap.values()).sort((a, b) => a.date - b.date);
    const termRows = Array.from(termMap.values()).sort((a, b) => a.date - b.date);
    let cumulative = 0;
    const series = rows.map((r) => {
      cumulative += r.credits;
      return {
        date: r.date,
        credits: r.credits,
        modules: r.modules,
        cumulative
      };
    });

    const monthSeries = rows.map((r) => ({
      date: r.date,
      credits: r.credits
    }));

    const termSeries = termRows.map((r) => ({
      date: r.date,
      credits: r.credits,
      modules: r.modules,
      label: r.label
    }));

    return {
      series,
      monthSeries,
      termSeries,
      hasData: courses.length > 0,
      currentMonthKey,
      currentTermLabel: currentTerm.label
    };
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

  function renderStatsPanel(stats, accent, epic) {
    const wrap = document.createElement("div");
    wrap.className = "sq-stats";

    const details = document.createElement("details");
    details.className = "sq-stats-details";
    details.open = false;

    const summary = document.createElement("summary");
    summary.textContent = "Statistik";
    summary.className = "sq-stats-summary";
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "sq-stats-body";

    const series = stats?.series || [];
    const termSeries = stats?.termSeries || [];
    if (series.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = stats?.hasData
        ? "Hittar ingen tidsstämplad HP ännu. Skanna fler kurser eller öppna kursresultat så att datum finns."
        : "Ingen statistik ännu — skanna kurser för att bygga upp data.";
      empty.className = "sq-stats-empty";
      body.appendChild(empty);
    } else {
      const lineWrap = document.createElement("div");
      lineWrap.className = "sq-section";
      const lineTitle = document.createElement("div");
      lineTitle.textContent = "Total HP över tid (kumulativt, baserat på godkända moment)";
      lineTitle.className = "sq-section-title";
      lineWrap.appendChild(lineTitle);

      const lineCanvas = document.createElement("canvas");
      lineCanvas.className = "sq-chart sq-chart--lg";
      lineWrap.appendChild(lineCanvas);

      const midWrap = document.createElement("div");
      midWrap.className = "sq-section";
      const midTitle = document.createElement("div");
      midTitle.textContent = "Per månad";
      midTitle.className = "sq-section-title";
      midWrap.appendChild(midTitle);

      const modWrap = document.createElement("div");
      modWrap.className = "sq-chart-wrap";
      const modCanvas = document.createElement("canvas");
      modCanvas.className = "sq-chart sq-chart--sm";
      modWrap.appendChild(modCanvas);

      const hpWrap = document.createElement("div");
      hpWrap.className = "sq-chart-wrap is-hidden";
      const hpCanvas = document.createElement("canvas");
      hpCanvas.className = "sq-chart sq-chart--sm";
      hpWrap.appendChild(hpCanvas);

      const midToggle = document.createElement("div");
      midToggle.className = "sq-toggle";

      const midBtnModules = document.createElement("button");
      midBtnModules.type = "button";
      midBtnModules.textContent = "Moduler";
      midBtnModules.className = "sq-toggle-btn is-active";

      const midBtnHp = document.createElement("button");
      midBtnHp.type = "button";
      midBtnHp.textContent = "HP";
      midBtnHp.className = "sq-toggle-btn";

      const setMidMode = (mode) => {
        const showModules = mode === "modules";
        modWrap.classList.toggle("is-hidden", !showModules);
        hpWrap.classList.toggle("is-hidden", showModules);
        midBtnModules.classList.toggle("is-active", showModules);
        midBtnHp.classList.toggle("is-active", !showModules);
        midBtnModules.setAttribute("aria-pressed", showModules ? "true" : "false");
        midBtnHp.setAttribute("aria-pressed", showModules ? "false" : "true");

        // Re-render after visibility change to ensure canvas size is measurable
        setTimeout(() => {
          if (showModules) {
            renderBarChart(modCanvas, series, accent, stats.currentMonthKey);
          } else {
            renderMonthHpChart(hpCanvas, stats.monthSeries || [], accent, stats.currentMonthKey);
          }
        }, 0);
      };

      midBtnModules.addEventListener("click", () => setMidMode("modules"));
      midBtnHp.addEventListener("click", () => setMidMode("hp"));
      setMidMode("modules");

      midToggle.appendChild(midBtnModules);
      midToggle.appendChild(midBtnHp);
      midWrap.appendChild(midToggle);
      midWrap.appendChild(modWrap);
      midWrap.appendChild(hpWrap);

      const termWrap = document.createElement("div");
      termWrap.className = "sq-section";
      const termTitle = document.createElement("div");
      termTitle.textContent = "HP per termin (summa)";
      termTitle.className = "sq-section-title";
      termWrap.appendChild(termTitle);

      const termCanvas = document.createElement("canvas");
      termCanvas.className = "sq-chart sq-chart--md";
      termWrap.appendChild(termCanvas);

      body.appendChild(lineWrap);
      body.appendChild(midWrap);
      body.appendChild(termWrap);

      // Render charts once added to DOM
      setTimeout(() => {
        const renderLine = () => renderLineChart(lineCanvas, series, accent, stats.currentMonthKey);
        const renderMods = () => renderBarChart(modCanvas, series, accent, stats.currentMonthKey);
        const renderTerm = () => renderTermChart(termCanvas, termSeries, accent, stats.currentTermLabel);
        const renderMonthHp = () => renderMonthHpChart(hpCanvas, stats.monthSeries || [], accent, stats.currentMonthKey);

        lineCanvas.__ladokppRender = renderLine;
        modCanvas.__ladokppRender = renderMods;
        termCanvas.__ladokppRender = renderTerm;
        hpCanvas.__ladokppRender = renderMonthHp;

        renderLine();
        renderMods();
        renderTerm();
        renderMonthHp();
        registerChartResizeHandler();
      }, 0);
    }

    details.appendChild(body);
    wrap.appendChild(details);
    return wrap;
  }

  function resizeCanvas(canvas, height) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = height;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    return { ctx, width: w, height: h };
  }

  function ensureTooltip(canvas) {
    if (canvas.__ladokppTooltip) return canvas.__ladokppTooltip;
    const tip = document.createElement("div");
    tip.className = "sq-tooltip";
    const parent = canvas.parentElement;
    if (parent) {
      parent.classList.add("sq-chart-host");
      parent.appendChild(tip);
    }
    canvas.__ladokppTooltip = tip;
    return tip;
  }

  function registerChartResizeHandler() {
    if (window.__ladokppResizeHandler) return;
    let raf = 0;
    const onResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const canvases = document.querySelectorAll("canvas");
        canvases.forEach((c) => {
          const render = c.__ladokppRender;
          if (typeof render === "function") render();
        });
      });
    };
    window.addEventListener("resize", onResize, { passive: true });
    window.__ladokppResizeHandler = onResize;
  }

  function setTooltip(tip, x, y, text) {
    if (!tip) return;
    tip.textContent = text;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.style.opacity = "1";
  }

  function hideTooltip(tip) {
    if (tip) tip.style.opacity = "0";
  }

  function fmtMonth(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function renderLineChart(canvas, series, accent, currentMonthKey) {
    const { ctx, width, height } = resizeCanvas(canvas, 160);
    ctx.clearRect(0, 0, width, height);

    const pad = { l: 36, r: 12, t: 12, b: 24 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    if (plotW <= 0 || plotH <= 0) return;

    const maxY = Math.max(1, ...series.map(s => s.cumulative));
    const gridLines = 4;
    ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridLines; i += 1) {
      const y = pad.t + (i / gridLines) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + plotW, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
    ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("0", pad.l - 6, pad.t + plotH);
    ctx.fillText(String(Math.round(maxY)), pad.l - 6, pad.t + 4);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("HP", pad.l + 2, pad.t + 2);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const points = [];
    series.forEach((s, i) => {
      const x = pad.l + (i / Math.max(1, series.length - 1)) * plotW;
      const y = pad.t + plotH - (s.cumulative / maxY) * plotH;
      points.push({ x, y, data: s });
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = accent;
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    if (currentMonthKey) {
      const idx = series.findIndex(s => fmtMonth(s.date) === currentMonthKey);
      if (idx >= 0) {
        const x = pad.l + (idx / Math.max(1, series.length - 1)) * plotW;
        ctx.strokeStyle = "rgba(15, 23, 42, 0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, pad.t);
        ctx.lineTo(x, pad.t + plotH);
        ctx.stroke();
      }
    }

    const last = series[series.length - 1];
    const first = series[0];
    const fmt = (d) => fmtMonth(d);
    ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
    ctx.font = "10px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(fmt(first.date), pad.l, pad.t + plotH + 6);
    ctx.textAlign = "right";
    ctx.fillText(fmt(last.date), pad.l + plotW, pad.t + plotH + 6);

    // Label last point value
    const lastPoint = points[points.length - 1];
    if (lastPoint) {
      ctx.fillStyle = accent;
      ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${formatHp(last.cumulative)} HP`, lastPoint.x + 6, lastPoint.y);
    }

    // Hover tooltip
    canvas.__ladokppLine = { points, pad, plotW, plotH };
    const tip = ensureTooltip(canvas);
    if (!canvas.__ladokppLineBound) {
      canvas.__ladokppLineBound = true;
      canvas.addEventListener("mousemove", (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const data = canvas.__ladokppLine;
        if (!data || !data.points?.length) return;
        let best = data.points[0];
        let bestDx = Math.abs(x - best.x);
        for (const p of data.points) {
          const dx = Math.abs(x - p.x);
          if (dx < bestDx) {
            best = p;
            bestDx = dx;
          }
        }
        const label = `${fmtMonth(best.data.date)} • ${formatHp(best.data.cumulative)} HP`;
        setTooltip(tip, best.x, best.y, label);
      });
      canvas.addEventListener("mouseleave", () => hideTooltip(tip));
    }
  }

  function renderBarChart(canvas, series, accent, currentMonthKey) {
    const { ctx, width, height } = resizeCanvas(canvas, 110);
    ctx.clearRect(0, 0, width, height);

    const pad = { l: 28, r: 10, t: 10, b: 20 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    if (plotW <= 0 || plotH <= 0) return;

    const maxY = Math.max(1, ...series.map(s => s.modules));
    const barCount = series.length;
    const barGap = 6;
    const barW = Math.max(6, (plotW - barGap * (barCount - 1)) / barCount);

    ctx.fillStyle = "rgba(15, 23, 42, 0.12)";
    ctx.fillRect(pad.l, pad.t + plotH, plotW, 1);

    const bars = [];
    series.forEach((s, i) => {
      const h = (s.modules / maxY) * plotH;
      const x = pad.l + i * (barW + barGap);
      const y = pad.t + plotH - h;
      bars.push({ x, y, w: barW, h, data: s });
      const isCurrent = currentMonthKey && fmtMonth(s.date) === currentMonthKey;
      ctx.fillStyle = isCurrent ? rgbToRgba(accent, 1) : rgbToRgba(accent, 0.7);
      ctx.fillRect(x, y, barW, h);
    });

    ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
    ctx.font = "10px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const first = series[0];
    const last = series[series.length - 1];
    const fmt = (d) => fmtMonth(d);
    ctx.fillText(fmt(first.date), pad.l, pad.t + plotH + 6);
    ctx.textAlign = "right";
    ctx.fillText(fmt(last.date), pad.l + plotW, pad.t + plotH + 6);

    // Hover tooltip
    canvas.__ladokppBars = { bars };
    const tip = ensureTooltip(canvas);
    if (!canvas.__ladokppBarsBound) {
      canvas.__ladokppBarsBound = true;
      canvas.addEventListener("mousemove", (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const data = canvas.__ladokppBars;
        if (!data || !data.bars?.length) return;
        const hit = data.bars.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
        if (!hit) return;
        const label = `${fmtMonth(hit.data.date)} • ${hit.data.modules} moduler`;
        setTooltip(tip, hit.x + hit.w / 2, hit.y, label);
      });
      canvas.addEventListener("mouseleave", () => hideTooltip(tip));
    }
  }

  function renderTermChart(canvas, series, accent, currentTermLabel) {
    const { ctx, width, height } = resizeCanvas(canvas, 120);
    ctx.clearRect(0, 0, width, height);

    const pad = { l: 34, r: 10, t: 10, b: 28 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    if (plotW <= 0 || plotH <= 0) return;
    if (!series || series.length === 0) return;

    const maxY = Math.max(1, ...series.map(s => s.credits));
    const barCount = series.length;
    const barGap = 8;
    const barW = Math.max(10, (plotW - barGap * (barCount - 1)) / barCount);

    ctx.fillStyle = "rgba(15, 23, 42, 0.12)";
    ctx.fillRect(pad.l, pad.t + plotH, plotW, 1);

    const bars = [];
    series.forEach((s, i) => {
      const h = (s.credits / maxY) * plotH;
      const x = pad.l + i * (barW + barGap);
      const y = pad.t + plotH - h;
      bars.push({ x, y, w: barW, h, data: s });
      const isCurrent = currentTermLabel && s.label === currentTermLabel;
      ctx.fillStyle = isCurrent ? rgbToRgba(accent, 1) : rgbToRgba(accent, 0.7);
      ctx.fillRect(x, y, barW, h);
    });

    ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
    ctx.font = "10px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const first = series[0];
    const last = series[series.length - 1];
    ctx.fillText(first.label || "", pad.l, pad.t + plotH + 6);
    ctx.textAlign = "right";
    ctx.fillText(last.label || "", pad.l + plotW, pad.t + plotH + 6);

    // Hover tooltip
    canvas.__ladokppTerm = { bars };
    const tip = ensureTooltip(canvas);
    if (!canvas.__ladokppTermBound) {
      canvas.__ladokppTermBound = true;
      canvas.addEventListener("mousemove", (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const data = canvas.__ladokppTerm;
        if (!data || !data.bars?.length) return;
        const hit = data.bars.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
        if (!hit) return;
        const label = `${hit.data.label} • ${formatHp(hit.data.credits)} HP`;
        setTooltip(tip, hit.x + hit.w / 2, hit.y, label);
      });
      canvas.addEventListener("mouseleave", () => hideTooltip(tip));
    }
  }

  function renderMonthHpChart(canvas, series, accent, currentMonthKey) {
    const { ctx, width, height } = resizeCanvas(canvas, 120);
    ctx.clearRect(0, 0, width, height);

    const pad = { l: 34, r: 10, t: 10, b: 28 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    if (plotW <= 0 || plotH <= 0) return;
    if (!series || series.length === 0) return;

    const maxY = Math.max(1, ...series.map(s => s.credits));
    const barCount = series.length;
    const barGap = 6;
    const barW = Math.max(8, (plotW - barGap * (barCount - 1)) / barCount);

    ctx.fillStyle = "rgba(15, 23, 42, 0.12)";
    ctx.fillRect(pad.l, pad.t + plotH, plotW, 1);

    const bars = [];
    series.forEach((s, i) => {
      const h = (s.credits / maxY) * plotH;
      const x = pad.l + i * (barW + barGap);
      const y = pad.t + plotH - h;
      bars.push({ x, y, w: barW, h, data: s });
      const isCurrent = currentMonthKey && fmtMonth(s.date) === currentMonthKey;
      ctx.fillStyle = isCurrent ? rgbToRgba(accent, 1) : rgbToRgba(accent, 0.7);
      ctx.fillRect(x, y, barW, h);
    });

    ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
    ctx.font = "10px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const first = series[0];
    const last = series[series.length - 1];
    ctx.fillText(fmtMonth(first.date), pad.l, pad.t + plotH + 6);
    ctx.textAlign = "right";
    ctx.fillText(fmtMonth(last.date), pad.l + plotW, pad.t + plotH + 6);

    canvas.__ladokppMonthHp = { bars };
    const tip = ensureTooltip(canvas);
    if (!canvas.__ladokppMonthHpBound) {
      canvas.__ladokppMonthHpBound = true;
      canvas.addEventListener("mousemove", (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const data = canvas.__ladokppMonthHp;
        if (!data || !data.bars?.length) return;
        const hit = data.bars.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
        if (!hit) return;
        const label = `${fmtMonth(hit.data.date)} • ${formatHp(hit.data.credits)} HP`;
        setTooltip(tip, hit.x + hit.w / 2, hit.y, label);
      });
      canvas.addEventListener("mouseleave", () => hideTooltip(tip));
    }
  }

  // ---------------- render -----------------
  function renderWidget({ titleAnchor, completedHp, totalHp, extras }, cfg) {
    const accent = pickAccentColor();
    const epic = !!cfg.epicMode;
    // styling handled by main.css

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
    wrap.className = `sq-widget ${epic ? "sq-legendary" : "sq-normal"}`;
    wrap.style.setProperty("--sq-accent", accent);
    wrap.style.setProperty("--sq-accent-10", rgbToRgba(accent, 0.10));
    wrap.style.setProperty("--sq-accent-12", rgbToRgba(accent, 0.12));
    wrap.style.setProperty("--sq-accent-14", rgbToRgba(accent, 0.14));
    wrap.style.setProperty("--sq-accent-15", rgbToRgba(accent, 0.15));
    wrap.style.setProperty("--sq-accent-18", rgbToRgba(accent, 0.18));
    wrap.style.setProperty("--sq-accent-20", rgbToRgba(accent, 0.20));
    wrap.style.setProperty("--sq-accent-22", rgbToRgba(accent, 0.22));
    wrap.style.setProperty("--sq-accent-28", rgbToRgba(accent, 0.28));

    const layer = document.createElement("div");
    layer.className = "sq-layer";

    // Top row
    const top = document.createElement("div");
    top.className = "sq-top";

    const left = document.createElement("div");
    left.className = "sq-left";

    // Put the clickable program <a> inside the module
    const label = document.createElement("div");
    label.className = "sq-label";

    if (titleAnchor) {
      const aClone = titleAnchor.cloneNode(true);
      // Make sure it inherits and doesn't look off
      aClone.classList.add("sq-titleLink");
      label.appendChild(aClone);
    } else {
      label.textContent = "Min utbildning";
    }

    left.appendChild(label);

    const hpLine = document.createElement("div");
    hpLine.textContent = `${completedHp.toLocaleString("sv-SE")} / ${totalHp.toLocaleString("sv-SE")} hp`;
    hpLine.className = "sq-hpLine";
    left.appendChild(hpLine);

    const badge = document.createElement("div");
    badge.className = "sq-badge";
    badge.setAttribute("role", "status");
    badge.setAttribute("aria-label", `Level ${level} of 100`);
    badge.textContent = `LV ${level} / 100`;
    badge.className = "sq-badge";

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
    barWrap.className = "sq-bar";

    const bar = document.createElement("div");
    bar.className = "sq-barFill";
    bar.style.width = `${pct}%`;
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
      foot.className = "sq-foot";

      const l = document.createElement("div");
      l.textContent = `Mot lvl ${Math.min(100, level + 1)}`;

      const r = document.createElement("div");
      r.className = "sq-foot-right";
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
    if (extras && cfg.showStats) {
      const extra = document.createElement("div");
      extra.className = "sq-extra";

      const leftExtra = document.createElement("div");
      leftExtra.className = "sq-extra-left";

      const { savedCourseCount, modulesPassed, modulesTotal, listCourseCount } = extras;
      const coverage = (typeof listCourseCount === "number" && listCourseCount > 0)
        ? `${savedCourseCount}/${listCourseCount} kurser skannade`
        : `${savedCourseCount} kurser skannade`;

      const modLine = (typeof modulesTotal === "number" && modulesTotal > 0)
        ? ` • Avklarade moduler (total): ${modulesPassed}/${modulesTotal}`
        : "";

      leftExtra.textContent = coverage + modLine;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", extras.scanBusy ? "Scanning all courses" : "Scan all courses");
      btn.textContent = extras.scanBusy ? "Skannar…" : "Skanna alla";
      btn.disabled = !!extras.scanBusy;
      btn.className = "sq-btn sq-btn--scan";

      btn.addEventListener("click", () => {
        // delegate back to mountOrUpdate (it will attach handler via extras.onScanAll)
        extras.onScanAll?.();
      });

      extra.appendChild(leftExtra);
      extra.appendChild(btn);
      layer.appendChild(extra);
    }

    if (extras?.stats && cfg.showStats) {
      const statsPanel = renderStatsPanel(extras.stats, accent, epic);
      layer.appendChild(statsPanel);
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
    const stats = computeStatsFromSaved(savedCourses, cfg);


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
      onScanAll,
      stats
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
