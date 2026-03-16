// ============================================================
//  Tab Group Organizer - Background Service Worker
// ============================================================

const GROUP_COLORS = [
  "blue", "red", "yellow", "green",
  "pink", "purple", "cyan", "orange"
];

const SPECIAL_SCHEMES = [
  "chrome://", "chrome-extension://", "edge://",
  "about:", "data:", "javascript:", "file://"
];

let isOrganizing    = false;
let debounceTimer   = null;
let activeMoveTimer = null;

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getMainDomain(url) {
  try {
    const { hostname } = new URL(url);
    const clean = hostname.replace(/^www\./, "");
    const parts = clean.split(".");
    const compoundTLDs = new Set([
      "co.uk", "co.in", "co.nz", "co.za", "co.jp",
      "com.au", "com.br", "com.mx", "com.ar", "com.tr",
      "org.uk", "net.au", "gov.uk", "ac.uk"
    ]);
    if (parts.length >= 3) {
      const lastTwo = parts.slice(-2).join(".");
      if (compoundTLDs.has(lastTwo)) return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  } catch { return null; }
}

function isSpecialUrl(url) {
  return !url || SPECIAL_SCHEMES.some(s => url.startsWith(s));
}

function colorForDomain(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

// â”€â”€ Core organizer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function organizeTabs() {
  if (isOrganizing) return;
  const { enabled = true } = await chrome.storage.sync.get("enabled");
  if (!enabled) return;

  isOrganizing = true;
  try {
    const windows = await chrome.windows.getAll({ populate: false });
    for (const win of windows) {
      if (win.type === "normal") await organizeWindow(win.id);
    }
  } catch (err) {
    console.error("[TabGroupOrganizer] organizeTabs:", err);
  } finally {
    isOrganizing = false;
  }
}

async function organizeWindow(windowId) {
  const {
    ungroupSingles  = false,
    excludedDomains = [],
    autoCollapse    = false
  } = await chrome.storage.sync.get([
    "ungroupSingles", "excludedDomains", "autoCollapse"
  ]);

  const allTabs = await chrome.tabs.query({ windowId });
  const tabs    = allTabs.filter(t => !t.pinned);

  const domainMap = new Map();
  const skipTabs  = [];

  for (const tab of tabs) {
    if (isSpecialUrl(tab.url)) { skipTabs.push(tab); continue; }
    const domain = getMainDomain(tab.url);
    if (!domain || excludedDomains.includes(domain)) { skipTabs.push(tab); continue; }
    if (!domainMap.has(domain)) domainMap.set(domain, []);
    domainMap.get(domain).push(tab);
  }

  if (ungroupSingles) {
    for (const [domain, domainTabs] of domainMap) {
      if (domainTabs.length === 1) {
        skipTabs.push(domainTabs[0]);
        domainMap.delete(domain);
      }
    }
  }

  const existingGroups = await chrome.tabGroups.query({ windowId });
  const titleToId = new Map();
  for (const g of existingGroups) {
    if (g.title && !titleToId.has(g.title.toLowerCase()))
      titleToId.set(g.title.toLowerCase(), g.id);
  }

  for (const [domain, domainTabs] of domainMap) {
    const tabIds = domainTabs.map(t => t.id);
    if (titleToId.has(domain)) {
      await chrome.tabs.group({ tabIds, groupId: titleToId.get(domain) });
    } else {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: domain.toUpperCase(),
        color: colorForDomain(domain)
      });
      titleToId.set(domain, groupId);
    }
  }

  for (const tab of skipTabs) {
    if (tab.groupId !== undefined && tab.groupId !== -1) {
      try { await chrome.tabs.ungroup([tab.id]); } catch { }
    }
  }

  await sortGroups(windowId);

  if (autoCollapse) await collapseAllExceptActive(windowId);
}

async function sortGroups(windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  if (groups.length < 2) return;

  const sorted = [...groups].sort((a, b) =>
    (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase())
  );

  const pinned = await chrome.tabs.query({ windowId, pinned: true });
  let pos = pinned.length;

  for (const group of sorted) {
    const groupTabs = (await chrome.tabs.query({ windowId, groupId: group.id }))
      .sort((a, b) => a.index - b.index);
    if (groupTabs.length === 0) continue;
    try {
      await chrome.tabs.move(groupTabs.map(t => t.id), { windowId, index: pos });
      pos += groupTabs.length;
    } catch (err) { console.warn("[TabGroupOrganizer] sort move:", err); }
  }
}

// â”€â”€ Feature: Auto Collapse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function collapseAllExceptActive(windowId) {
  const [activeTab]   = await chrome.tabs.query({ windowId, active: true });
  const activeGroupId = activeTab?.groupId ?? -1;
  const groups        = await chrome.tabGroups.query({ windowId });

  for (const group of groups) {
    const shouldCollapse = (group.id !== activeGroupId);
    if (group.collapsed !== shouldCollapse) {
      try { await chrome.tabGroups.update(group.id, { collapsed: shouldCollapse }); }
      catch { }
    }
  }
}

// â”€â”€ Feature: Collapse / Expand All â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function setAllGroupsCollapsed(windowId, collapse) {
  const groups = await chrome.tabGroups.query({ windowId });
  for (const group of groups) {
    try { await chrome.tabGroups.update(group.id, { collapsed: collapse }); }
    catch { }
  }
}

// â”€â”€ Feature: Move Active Group to End â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function moveGroupToEnd(windowId, groupId) {
  if (!groupId || groupId === -1) return;
  const groupTabs = (await chrome.tabs.query({ windowId, groupId }))
    .sort((a, b) => a.index - b.index);
  if (groupTabs.length === 0) return;
  try {
    await chrome.tabs.move(groupTabs.map(t => t.id), { windowId, index: -1 });
  } catch (err) { console.warn("[TabGroupOrganizer] moveGroupToEnd:", err); }
}

// â”€â”€ Tab event listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function scheduleOrganize(delayMs = 800) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(organizeTabs, delayMs);
}

chrome.tabs.onCreated.addListener(() => scheduleOrganize());
chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") scheduleOrganize();
});
chrome.tabs.onRemoved.addListener(() => scheduleOrganize());
chrome.tabs.onDetached.addListener(() => scheduleOrganize());
chrome.tabs.onAttached.addListener(() => scheduleOrganize());

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (activeMoveTimer) clearTimeout(activeMoveTimer);
  activeMoveTimer = setTimeout(async () => {
    try {
      const { moveActiveToEnd = false, autoCollapse = false } =
        await chrome.storage.sync.get(["moveActiveToEnd", "autoCollapse"]);
      const tab = await chrome.tabs.get(tabId);
      if (moveActiveToEnd && tab.groupId && tab.groupId !== -1) {
        await moveGroupToEnd(windowId, tab.groupId);
      }
      if (autoCollapse) await collapseAllExceptActive(windowId);
    } catch (err) { console.warn("[TabGroupOrganizer] onActivated:", err); }
  }, 300);
});

// â”€â”€ Message handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {
        case "organizeNow":
          await organizeTabs();
          sendResponse({ ok: true });
          break;
        case "collapseAll": {
          const wins = await chrome.windows.getAll({ populate: false });
          for (const win of wins.filter(w => w.type === "normal"))
            await setAllGroupsCollapsed(win.id, true);
          sendResponse({ ok: true });
          break;
        }
        case "expandAll": {
          const wins = await chrome.windows.getAll({ populate: false });
          for (const win of wins.filter(w => w.type === "normal"))
            await setAllGroupsCollapsed(win.id, false);
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown action" });
      }
    } catch (err) {
      console.error("[TabGroupOrganizer] message handler:", err);
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});