# ⊞ Tab Group Organizer

A Chrome and Microsoft Edge extension that automatically organizes your open tabs
by grouping them by domain, naming each group, and sorting them alphabetically —
keeping your browser tidy without any manual effort.

---

## Features

| Feature | Description |
|---|---|
| **Auto-grouping** | Tabs are grouped automatically by main domain (e.g. all `github.com` tabs together) |
| **Auto-naming** | Each group is named after its domain in ALL CAPS (e.g. `GITHUB.COM`) |
| **Alphabetical sorting** | Groups are always sorted A → Z across the tab bar |
| **Consistent colors** | Each domain always gets the same color, assigned automatically |
| **Auto-collapse** | Collapses all groups except the one you are currently using |
| **Collapse / Expand all** | One-click button to collapse or expand all groups at once |
| **Move active group to end** | When you switch to a tab, its group moves to the end of the tab bar |
| **Ungroup singles** | Optionally leave domains with only one open tab ungrouped |
| **Excluded domains** | Specify domains that should never be grouped |
| **Pinned tabs** | Pinned tabs are always left untouched |
| **Enable / Disable** | Toggle the entire extension on or off without uninstalling |

---

## Installation

### Step 1 — Clone the repository

    git clone https://github.com/your-username/tab-group-organizer.git

Or click **Code → Download ZIP** on GitHub and extract it.

---

### Step 2 — Generate the icons

1. Open `tab-group-organizer/icons/generate_icons.html` in Chrome or Edge
2. Right-click each image → **Save image as…** into the `icons/` folder using these exact filenames:
   - `icon16.png`
   - `icon32.png`
   - `icon48.png`
   - `icon128.png`

---

### Step 3 — Load the extension

**Chrome**

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `tab-group-organizer` folder

**Microsoft Edge**

1. Go to `edge://extensions`
2. Enable **Developer mode** (toggle in the left sidebar)
3. Click **Load unpacked**
4. Select the `tab-group-organizer` folder

> ⚠️ Keep the `tab-group-organizer` folder in its location after loading.
> Moving or deleting it will break the extension.

---

### Step 4 — Reload after any file changes

If you ever edit the extension files after loading:

1. Go to `chrome://extensions` or `edge://extensions`
2. Find **Tab Group Organizer**
3. Click the **↺ reload** icon

---

## Usage

Click the extension icon in your toolbar to open the settings popup.

| Control | Description |
|---|---|
| **Toggle (header)** | Enable or disable automatic tab grouping |
| **Organize Tabs Now** | Manually trigger grouping and sorting immediately |
| **Collapse / Expand All** | Collapse or expand all tab groups with one click |
| **Auto-collapse groups** | Automatically collapse inactive groups when switching tabs |
| **Move active group to end** | Move the active tab's group to the end of the tab bar on switch |
| **Leave single-tab domains ungrouped** | Skip grouping domains that only have one open tab |
| **Excluded Domains** | Add domains that should never be grouped (e.g. `localhost`) |

---

## File Structure

    tab-group-organizer/
    ├── manifest.json            Extension configuration
    ├── background.js            Core logic (grouping, sorting, collapsing)
    ├── popup.html               Popup UI layout
    ├── popup.css                Popup styles
    ├── popup.js                 Popup interaction logic
    └── icons/
        ├── generate_icons.html  Open in browser to generate PNG icons
        ├── icon16.png
        ├── icon32.png
        ├── icon48.png
        └── icon128.png

---

## Permissions

| Permission | Reason |
|---|---|
| `tabs` | Read tab URLs to determine domains and move tabs |
| `tabGroups` | Create, name, color, collapse and sort tab groups |
| `storage` | Save your settings across browser sessions |

> No data is collected, transmitted or stored outside your own browser.

---

## Troubleshooting

**Groups are not being created**
- Check the extension is enabled (green badge in the popup)
- Check the domain is not listed under Excluded Domains
- Reload the extension at `chrome://extensions` after any file changes

**Duplicate groups appearing**
- Click **Organize Tabs Now** to force a full re-organization
- Reload the extension if the issue persists

**PowerShell script blocked**
- Use `run_build.bat` instead of running `build.ps1` directly
- Or open PowerShell and run:

      powershell -ExecutionPolicy Bypass -File ".\build.ps1"

**Icons not showing**
- Make sure all four PNG files exist inside the `icons/` folder
- Reload the extension after adding the icons

---

## License

MIT — free to use, modify and distribute.

## Credits

Built by **Claude Sonnet** (Anthropic) — [claude.ai](https://claude.ai)

> 🤖 This extension was designed, coded and documented almost entirely by an AI.
> Prompted and directed by a human who had a good idea.
