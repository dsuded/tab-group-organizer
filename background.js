// ============================================================
//  Tab Group Organizer — Background Service Worker
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

// ── Helpers ──────────────────────────────────────────────────

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

// ── Core organizer ───────────────────────────────────────────

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
    autoCollapse    = false,
    moveActiveToEnd = false
  } = await chrome.storage.sync.get([
    "ungroupSingles", "excludedDomains", "autoCollapse", "moveActiveToEnd"
  ]);

  // ── 1. Fetch tabs ─────────────────────────────────────────
  const allTabs = await chrome.tabs.query({ windowId });
  const tabs    = allTabs.filter(t => !t.pinned);

  // ── 2. Build domain map ───────────────────────────────────
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

  // ── 3. Snapshot existing groups ───────────────────────────
  const existingGroups = await chrome.tabGroups.query({ windowId });
  const titleToId = new Map();
  for (const g of existingGroups) {
    if (g.title && !titleToId.has(g.title.toLowerCase()))
      titleToId.set(g.title.toLowerCase(), g.id);
  }

  // ── 4. EXPAND all groups before touching any tabs ─────────
  // Moving tabs that belong to a collapsed group can silently
  // ungroup them. We expand everything here so all subsequent
  // operations (group, sort, move) are safe. autoCollapse at
  // the very end of this function restores the correct state.
  for (const g of existingGroups) {
    if (g.collapsed) {
      try { await chrome.tabGroups.update(g.id, { collapsed: false }); } catch {}
    }
  }

  // ── 5. Assign tabs to groups ──────────────────────────────
  for (const [domain, domainTabs] of domainMap) {
    const tabIds  = domainTabs.map(t => t.id);
    let   grouped = false;

    if (titleToId.has(domain)) {
      try {
        await chrome.tabs.group({ tabIds, groupId: titleToId.get(domain) });
        grouped = true;
      } catch {
        // Stale groupId (group was deleted) — create a fresh one below
        titleToId.delete(domain);
      }
    }

    if (!grouped) {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: domain.toUpperCase(),
        color: colorForDomain(domain)
      });
      titleToId.set(domain, groupId);
    }
  }

  // ── 6. Ungroup excluded / special tabs ────────────────────
  for (const tab of skipTabs) {
    if (tab.groupId !== undefined && tab.groupId !== -1) {
      // Skip tabs still loading — their URL may be transitional
      if (tab.status === "loading") continue;
      try { await chrome.tabs.ungroup([tab.id]); } catch {}
    }
  }

  // ── 7. Sort groups alphabetically ────────────────────────
  // All groups are expanded at this point so moves are safe.
  await sortGroups(windowId);

  // ── 8. Move active group to end (after sorting) ──────────
  // Runs AFTER sort so sort cannot undo the final position.
  if (moveActiveToEnd) {
    const [activeTab] = await chrome.tabs.query({ windowId, active: true });
    if (activeTab?.groupId && activeTab.groupId !== -1) {
      await moveGroupToEnd(windowId, activeTab.groupId);
    }
  }

  // ── 9. Collapse ───────────────────────────────────────────
  // This is the ONLY place collapse happens. Everything above
  // runs with groups expanded, so no move can ungroup a tab.
  if (autoCollapse) await collapseAllExceptActive(windowId);
}

// ── Sort ──────────────────────────────────────────────────────

async function sortGroups(windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  if (groups.length < 2) return;

  const sorted = [...groups].sort((a, b) =>
    (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase())
  );

  const pinned = await chrome.tabs.query({ windowId, pinned: true });
  let pos = pinned.length;

  for (const group of sorted) {
    const groupTabs = await chrome.tabs.query({ windowId, groupId: group.id });
    if (groupTabs.length === 0) continue;
    try {
      await chrome.tabGroups.move(group.id, { index: pos });
      pos += groupTabs.length;
    } catch (err) { console.warn("[TabGroupOrganizer] sortGroups:", err); }
  }
}

// ── Move group to end ─────────────────────────────────────────

async function moveGroupToEnd(windowId, groupId) {
  if (!groupId || groupId === -1) return;
  try {
    await chrome.tabGroups.move(groupId, { index: -1 });
  } catch (err) { console.warn("[TabGroupOrganizer] moveGroupToEnd:", err); }
}

// ── Collapse helpers ──────────────────────────────────────────

async function collapseAllExceptActive(windowId) {
  const [activeTab]   = await chrome.tabs.query({ windowId, active: true });
  const activeGroupId = activeTab?.groupId ?? -1;
  const groups        = await chrome.tabGroups.query({ windowId });
  for (const group of groups) {
    const shouldCollapse = (group.id !== activeGroupId);
    if (group.collapsed !== shouldCollapse) {
      try { await chrome.tabGroups.update(group.id, { collapsed: shouldCollapse }); }
      catch {}
    }
  }
}

async function setAllGroupsCollapsed(windowId, collapse) {
  const groups = await chrome.tabGroups.query({ windowId });
  for (const group of groups) {
    try { await chrome.tabGroups.update(group.id, { collapsed: collapse }); }
    catch {}
  }
}

// ── Debounce ──────────────────────────────────────────────────

function scheduleOrganize(delayMs = 800) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(organizeTabs, delayMs);
}

// ── Tab event listeners ───────────────────────────────────────

chrome.tabs.onCreated.addListener(() => scheduleOrganize());
chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") scheduleOrganize();
});
chrome.tabs.onRemoved.addListener(() => scheduleOrganize());
chrome.tabs.onDetached.addListener(() => scheduleOrganize());
chrome.tabs.onAttached.addListener(() => scheduleOrganize());

// ── onActivated ───────────────────────────────────────────────
// ★ KEY FIX: this handler no longer calls moveGroupToEnd directly.
//
// Previous design had two independent code paths both calling
// moveGroupToEnd — one inside organizeWindow and one here.
// They ran at different times and created race conditions where
// tabs were moved while their group was still in a collapsed state,
// causing Chrome to silently ungroup them.
//
// New design: a single pipeline in organizeWindow handles everything:
//   expand → group → sort → move to end → collapse
//
// When moveActiveToEnd is ON, onActivated simply triggers that
// pipeline via scheduleOrganize. When only autoCollapse is ON
// (no tab changes occurred), we update collapse state directly.

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (activeMoveTimer) clearTimeout(activeMoveTimer);

  activeMoveTimer = setTimeout(async () => {
    try {
      const { moveActiveToEnd = false, autoCollapse = false } =
        await chrome.storage.sync.get(["moveActiveToEnd", "autoCollapse"]);

      if (moveActiveToEnd) {
        // Route through the full organizeWindow pipeline.
        // This guarantees groups are expanded before any moves,
        // and moveGroupToEnd runs only after sortGroups completes.
        scheduleOrganize(300);
        return;
      }

      if (autoCollapse) {
        // moveActiveToEnd is off — no tab moves needed, just collapse.
        // Wait for any in-progress organize to finish first.
        let waited = 0;
        while (isOrganizing && waited < 2000) {
          await new Promise(r => setTimeout(r, 50));
          waited += 50;
        }
        await collapseAllExceptActive(windowId);
      }

    } catch (err) { console.warn("[TabGroupOrganizer] onActivated:", err); }
  }, 300);
});

// ── Message handler ───────────────────────────────────────────

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