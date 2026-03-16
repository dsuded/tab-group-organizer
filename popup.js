// ============================================================
//  Tab Group Organizer - Popup Script
// ============================================================

const $ = id => document.getElementById(id);

async function loadSettings() {
  const {
    enabled          = true,
    ungroupSingles   = false,
    autoCollapse     = false,
    moveActiveToEnd  = false,
    excludedDomains  = []
  } = await chrome.storage.sync.get([
    "enabled", "ungroupSingles", "autoCollapse",
    "moveActiveToEnd", "excludedDomains"
  ]);

  $("toggleEnabled").checked         = enabled;
  $("toggleUngroupSingles").checked  = ungroupSingles;
  $("toggleAutoCollapse").checked    = autoCollapse;
  $("toggleMoveActiveToEnd").checked = moveActiveToEnd;

  updateStatusBadge(enabled);
  renderExcludedList(excludedDomains);
  await refreshCollapseButton();
}

function updateStatusBadge(enabled) {
  const badge = $("statusBadge");
  badge.textContent = enabled ? "\u25CF Auto-grouping ON"  : "\u25CF Auto-grouping OFF";
  badge.className   = enabled ? "badge badge--on"          : "badge badge--off";
}

async function refreshCollapseButton() {
  const btn = $("btnCollapseToggle");
  try {
    const [tab]  = await chrome.tabs.query({ active: true, currentWindow: true });
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    if (groups.length === 0) {
      btn.textContent = "\u229F \u00a0Collapse All Groups";
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    const anyExpanded = groups.some(g => !g.collapsed);
    btn.textContent = anyExpanded
      ? "\u229F \u00a0Collapse All Groups"
      : "\u229E \u00a0Expand All Groups";
  } catch {
    btn.textContent = "\u229F \u00a0Collapse All Groups";
  }
}

function renderExcludedList(domains) {
  const list = $("excludedList");
  list.innerHTML = "";
  if (domains.length === 0) {
    const li = document.createElement("li");
    li.style.cssText = "color:#aeaeb2;font-size:11px;border:none;padding:2px 0;";
    li.textContent = "No excluded domains yet.";
    list.appendChild(li);
    return;
  }
  domains.forEach(domain => {
    const li   = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = domain;
    const btn  = document.createElement("button");
    btn.className   = "btn--danger";
    btn.textContent = "\u2715";
    btn.title       = "Remove " + domain;
    btn.addEventListener("click", () => removeDomain(domain));
    li.appendChild(span);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

async function addDomain() {
  const input  = $("domainInput");
  const domain = input.value.trim().toLowerCase().replace(/^www\./, "");
  if (!domain) return;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    input.style.borderColor = "#c00";
    setTimeout(() => { input.style.borderColor = ""; }, 1500);
    return;
  }
  const { excludedDomains = [] } = await chrome.storage.sync.get("excludedDomains");
  if (!excludedDomains.includes(domain)) {
    excludedDomains.push(domain);
    await chrome.storage.sync.set({ excludedDomains });
    renderExcludedList(excludedDomains);
  }
  input.value = "";
}

async function removeDomain(domain) {
  const { excludedDomains = [] } = await chrome.storage.sync.get("excludedDomains");
  const updated = excludedDomains.filter(d => d !== domain);
  await chrome.storage.sync.set({ excludedDomains: updated });
  renderExcludedList(updated);
}

function flashButton(btn, successText, originalText, ms = 1500) {
  btn.disabled    = true;
  btn.textContent = successText;
  btn.classList.add("btn--flash");
  setTimeout(() => {
    btn.classList.remove("btn--flash");
    btn.textContent = originalText;
    btn.disabled    = false;
  }, ms);
}

$("toggleEnabled").addEventListener("change", async e => {
  await chrome.storage.sync.set({ enabled: e.target.checked });
  updateStatusBadge(e.target.checked);
});

$("toggleAutoCollapse").addEventListener("change", async e => {
  await chrome.storage.sync.set({ autoCollapse: e.target.checked });
});

$("toggleMoveActiveToEnd").addEventListener("change", async e => {
  await chrome.storage.sync.set({ moveActiveToEnd: e.target.checked });
});

$("toggleUngroupSingles").addEventListener("change", async e => {
  await chrome.storage.sync.set({ ungroupSingles: e.target.checked });
});

$("btnOrganize").addEventListener("click", async () => {
  const btn = $("btnOrganize");
  btn.disabled    = true;
  btn.textContent = "\u27F3  Organizing\u2026";
  await chrome.runtime.sendMessage({ action: "organizeNow" });
  flashButton(btn, "\u2713  Done!", "\u27F3 \u00a0Organize Tabs Now");
  setTimeout(refreshCollapseButton, 900);
});

$("btnCollapseToggle").addEventListener("click", async () => {
  const btn = $("btnCollapseToggle");
  btn.disabled = true;
  try {
    const [tab]  = await chrome.tabs.query({ active: true, currentWindow: true });
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    const anyExpanded = groups.some(g => !g.collapsed);
    await chrome.runtime.sendMessage({ action: anyExpanded ? "collapseAll" : "expandAll" });
    btn.textContent = anyExpanded
      ? "\u229E \u00a0Expand All Groups"
      : "\u229F \u00a0Collapse All Groups";
  } catch (err) {
    console.warn("collapse toggle error", err);
  } finally {
    btn.disabled = false;
  }
});

$("btnAddDomain").addEventListener("click", addDomain);
$("domainInput").addEventListener("keydown", e => { if (e.key === "Enter") addDomain(); });

loadSettings();