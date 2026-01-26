const DEFAULTS = {
  levelExponent: 1.2,
  hideLabel: true,
  showXpToNext: true,
  epicMode: true,
};

const api = globalThis.chrome ?? globalThis.browser;

function $(id) { return document.getElementById(id); }

function readForm() {
  const levelExponent = Number($("levelExponent").value);

  return {
    levelExponent: Number.isFinite(levelExponent) && levelExponent >= 1 ? levelExponent : DEFAULTS.levelExponent,
    hideLabel: $("hideLabel").checked,
    showXpToNext: $("showXpToNext").checked,
    epicMode: $("epicMode").checked,
  };
}

function writeForm(cfg) {
  $("levelExponent").value = cfg.levelExponent ?? DEFAULTS.levelExponent;
  $("hideLabel").checked = !!cfg.hideLabel;
  $("showXpToNext").checked = !!cfg.showXpToNext;
  $("epicMode").checked = !!cfg.epicMode;
}

function setStatus(msg) {
  $("status").textContent = msg;
  if (msg) setTimeout(() => ($("status").textContent = ""), 1500);
}

async function load() {
  await api.storage.sync.get(DEFAULTS, (cfg) => writeForm(cfg));
}

async function save() {
  const cfg = readForm();
  await api.storage.sync.set(cfg, () => setStatus("Sparat!"));
}

async function reset() {
  await api.storage.sync.set(DEFAULTS, () => {
    writeForm(DEFAULTS);
    setStatus("Återställt!");
  });
}

$("save").addEventListener("click", save);
$("reset").addEventListener("click", reset);

load();
