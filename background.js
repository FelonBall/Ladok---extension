const STORAGE_KEY = "ladokpp.courses"; // object: { [kursUID]: miniCourse }
const TAB_THROTTLE_MS = 800; // Delay between opening tabs to avoid hammering the server

async function getCourses() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  return r[STORAGE_KEY] ?? {};
}

async function setCourses(courses) {
  // Basic validation: ensure courses is an object
  if (typeof courses !== "object" || courses === null) {
    console.warn("Ladok++ setCourses: Invalid courses object");
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: courses });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "LADOKPP_SAVE_COURSE") {
      const courses = await getCourses();
      const c = msg.payload;

      // Upsert (keep latest)
      courses[c.kursUID] = c;
      await setCourses(courses);

      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "LADOKPP_GET_COURSES") {
      const courses = await getCourses();
      sendResponse({ ok: true, courses });
      return;
    }

    // Optional: open a list of URLs to trigger data collection
    if (msg?.type === "LADOKPP_SCAN_URLS") {
      const urls = Array.isArray(msg.urls) ? msg.urls : [];
      // throttle: open sequentially to avoid overwhelming the server
      for (const url of urls) {
        if (typeof url !== "string") continue;
        await chrome.tabs.create({ url, active: false });
        // Small delay to avoid hammering
        await new Promise(r => setTimeout(r, TAB_THROTTLE_MS));
      }
      sendResponse({ ok: true, opened: urls.length });
      return;
    }

    sendResponse({ ok: false, error: "unknown_message" });
  })();

  return true; // keep message channel open for async sendResponse
});
