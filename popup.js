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

function showStatus(message, isError = false) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = isError ? 'error' : '';
  setTimeout(() => { status.textContent = ''; status.className = ''; }, 3000);
}

// Save preferences
function savePrefs() {
  const prefs = {
    showTitles: document.getElementById('showTitles').checked,
    groupWindows: document.getElementById('groupWindows').checked,
    storageUrl: document.getElementById('storageUrl').value
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
      document.getElementById('storageUrl').value = result.prefs.storageUrl || '';
    }
  } catch (e) {
    // Storage not available, use defaults
  }
}

// Get storage URL from WebID or direct storage URL
async function getStorageFromWebId(url) {
  // If it looks like a WebID (ends with /profile/card#me or similar), fetch and parse
  if (url.includes('/profile/card') || url.includes('#me')) {
    try {
      const profileUrl = url.split('#')[0];
      const response = await fetch(profileUrl, {
        headers: { 'Accept': 'text/turtle' },
        credentials: 'include'
      });
      const text = await response.text();
      // Look for pim:storage or space:storage in turtle
      const storageMatch = text.match(/<([^>]+)>\s+a\s+.*storage/i) ||
                          text.match(/pim:storage\s+<([^>]+)>/i) ||
                          text.match(/space:storage\s+<([^>]+)>/i);
      if (storageMatch) {
        return storageMatch[1];
      }
    } catch (e) {
      console.error('Failed to fetch WebID:', e);
    }
  }
  // Otherwise treat as direct storage URL
  return url.endsWith('/') ? url : url + '/';
}

// Save to Solid pod
async function saveToSolid() {
  const storageInput = document.getElementById('storageUrl').value.trim();

  if (!storageInput) {
    showStatus('Please enter your Solid storage URL', true);
    return;
  }

  const tabList = document.getElementById('tabList');
  const content = tabList.value;

  if (!content) {
    showStatus('No tabs to save', true);
    return;
  }

  try {
    showStatus('Saving to Solid...');

    const storage = await getStorageFromWebId(storageInput);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `tabs-${timestamp}.txt`;
    const folderPath = `${storage}private/tabstr/`;
    const fileUrl = `${folderPath}${filename}`;

    // First, try to create the folder (will fail silently if exists)
    try {
      await fetch(folderPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
        credentials: 'include',
        body: ''
      });
    } catch (e) {
      // Folder might already exist, continue
    }

    // Save the file
    const response = await fetch(fileUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      credentials: 'include',
      body: content
    });

    if (response.ok || response.status === 201) {
      showStatus(`Saved to ${filename}`);
      savePrefs();
    } else if (response.status === 401 || response.status === 403) {
      // Not logged in, redirect to storage root to trigger login
      showStatus('Redirecting to login...', true);
      chrome.tabs.create({ url: storage });
    } else {
      showStatus(`Error: ${response.status} ${response.statusText}`, true);
    }
  } catch (err) {
    showStatus(`Error: ${err.message}`, true);
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

document.getElementById('solidBtn').addEventListener('click', saveToSolid);

document.getElementById('showTitles').addEventListener('change', () => {
  savePrefs();
  displayTabs();
});

document.getElementById('groupWindows').addEventListener('change', () => {
  savePrefs();
  displayTabs();
});

document.getElementById('storageUrl').addEventListener('change', savePrefs);

// Initialize
loadPrefs().then(displayTabs);
