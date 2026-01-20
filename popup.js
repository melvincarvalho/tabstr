async function getTabs() {
  return await chrome.tabs.query({});
}

function formatTabs(tabs, showTitles, groupWindows) {
  if (groupWindows) {
    // Group tabs by window
    const windows = {};
    tabs.forEach(tab => {
      if (!windows[tab.windowId]) {
        windows[tab.windowId] = [];
      }
      windows[tab.windowId].push(tab);
    });

    const windowIds = Object.keys(windows).sort((a, b) => a - b);
    const lines = [];

    windowIds.forEach((windowId, index) => {
      lines.push(`=== Window ${index + 1} (${windows[windowId].length} tabs) ===`);
      windows[windowId].forEach(tab => {
        if (showTitles && tab.title) {
          lines.push(`${tab.title}`);
          lines.push(`  ${tab.url}`);
        } else {
          lines.push(tab.url);
        }
      });
      lines.push('');
    });

    return lines.join('\n').trim();
  } else {
    // Flat list
    return tabs.map(tab => {
      if (showTitles && tab.title) {
        return `${tab.title}\n  ${tab.url}`;
      }
      return tab.url;
    }).filter(Boolean).join('\n');
  }
}

async function displayTabs() {
  const tabs = await getTabs();
  const showTitles = document.getElementById('showTitles').checked;
  const groupWindows = document.getElementById('groupWindows').checked;

  const tabList = document.getElementById('tabList');
  const tabCount = document.getElementById('tabCount');

  const windowCount = new Set(tabs.map(t => t.windowId)).size;
  tabList.value = formatTabs(tabs, showTitles, groupWindows);
  tabCount.textContent = `${tabs.length} tab${tabs.length !== 1 ? 's' : ''} in ${windowCount} window${windowCount !== 1 ? 's' : ''}`;
}

function showStatus(message) {
  const status = document.getElementById('status');
  status.textContent = message;
  setTimeout(() => { status.textContent = ''; }, 2000);
}

// Save preferences
function savePrefs() {
  const prefs = {
    showTitles: document.getElementById('showTitles').checked,
    groupWindows: document.getElementById('groupWindows').checked
  };
  chrome.storage.local.set({ prefs });
}

// Load preferences
async function loadPrefs() {
  try {
    const result = await chrome.storage.local.get('prefs');
    if (result.prefs) {
      document.getElementById('showTitles').checked = result.prefs.showTitles || false;
      document.getElementById('groupWindows').checked = result.prefs.groupWindows || false;
    }
  } catch (e) {
    // Storage not available, use defaults
  }
}

document.getElementById('copyBtn').addEventListener('click', async () => {
  const tabList = document.getElementById('tabList');
  try {
    await navigator.clipboard.writeText(tabList.value);
    showStatus('Copied to clipboard!');
  } catch (err) {
    tabList.select();
    document.execCommand('copy');
    showStatus('Copied to clipboard!');
  }
});

document.getElementById('downloadBtn').addEventListener('click', async () => {
  const tabList = document.getElementById('tabList');
  const blob = new Blob([tabList.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().slice(0, 10);

  const a = document.createElement('a');
  a.href = url;
  a.download = `tabstr-${timestamp}.txt`;
  a.click();

  URL.revokeObjectURL(url);
  showStatus('Downloaded!');
});

document.getElementById('refreshBtn').addEventListener('click', displayTabs);

document.getElementById('showTitles').addEventListener('change', () => {
  savePrefs();
  displayTabs();
});

document.getElementById('groupWindows').addEventListener('change', () => {
  savePrefs();
  displayTabs();
});

// Initialize
loadPrefs().then(displayTabs);
