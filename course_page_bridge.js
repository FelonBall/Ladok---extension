// 1) Inject page hook into the page context (inlined to work with Firefox CSP)
(function inject() {
  const s = document.createElement("script");
  s.textContent = `
(() => {
  const RX = /\\/student\\/proxy\\/resultat\\/internal\\/studentenskurser\\/egenkursinformation\\/student\\/[0-9a-f-]{36}\\/kursUID\\/[0-9a-f-]{36}/i;

  function shouldCapture(url) {
    try {
      const u = new URL(url, location.origin);
      return RX.test(u.pathname);
    } catch {
      return false;
    }
  }

  function extractKursUID(url) {
    const u = new URL(url, location.origin);
    const parts = u.pathname.split("/");
    const i = parts.indexOf("kursUID");
    return i >= 0 ? parts[i + 1] : null;
  }

  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await origFetch(...args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url && shouldCapture(url)) {
        const kursUID = extractKursUID(url);
        const clone = res.clone();
        const data = await clone.json();

        window.postMessage(
          {
            source: "ladokpp",
            kind: "egenkursinformation",
            url,
            kursUID,
            data
          },
          "*"
        );
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.warn("Ladok++ API format may have changed");
      }
    }

    return res;
  };
})();
  `;
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

// 2) Extractor (minidata)
function pickCourseVersion(payload) {
  const versions = payload?.Kursversioner ?? [];
  return versions.find(v => v.ArAktuellVersion) ?? versions[0] ?? null;
}

function mapResult(r) {
  if (!r) return null;
  return {
    grade: r.Betygsgradsobjekt?.Kod ?? null,
    examDate: r.Examinationsdatum ?? null,
    decisionDate: r.Beslutsdatum ?? null
  };
}

function extractMiniDataset(payload, kursUID) {
  const v = pickCourseVersion(payload);
  if (!v) return null;

  const course = v.VersionensKurs ?? {};
  const kt = payload.GallandeKurstillfalle ?? {};

  const courseResult = mapResult(course.ResultatPaUtbildning?.SenastAttesteradeResultat);

  const modules = (v.VersionensModuler ?? []).map(m => {
    const latest = mapResult(m.ResultatPaUtbildning?.SenastAttesteradeResultat);

    const attempts = [
      ...(m.ResultatPaUtbildning?.OvrigaResultat ?? []).map(mapResult),
      ...(latest ? [latest] : [])
    ]
      .filter(Boolean)
      .sort((a, b) => (a.examDate ?? "").localeCompare(b.examDate ?? ""));

    return {
      moduleCode: m.Kod ?? null,
      name: m.Utbildningsinstansbenamningar?.sv ?? m.Utbildningsinstansbenamningar?.en ?? "",
      credits: m.Omfattning?.parsedValue ?? null,
      latest,
      attempts
    };
  });

  return {
    kursUID,
    kurstillfalleUID: kt.Uid ?? v.GallandeKurstillfalleUID ?? null,
    start: kt.Startdatum ?? null,
    end: kt.Slutdatum ?? null,
    courseCode: course.Kod ?? null,
    courseName: course.Utbildningsinstansbenamningar?.sv ?? course.Utbildningsinstansbenamningar?.en ?? "",
    courseCredits: course.Omfattning?.parsedValue ?? null,
    courseResult,
    modules,
    lastSeenAt: new Date().toISOString()
  };
}

// 3) Listen for page hook messages and forward to background
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== "ladokpp" || msg.kind !== "egenkursinformation") return;

  // Never use / store msg.data.StudentUID etc — extractor ignores it.
  const mini = extractMiniDataset(msg.data, msg.kursUID);
  if (!mini?.kursUID) return;

  chrome.runtime.sendMessage({
    type: "LADOKPP_SAVE_COURSE",
    payload: mini
  });
});
