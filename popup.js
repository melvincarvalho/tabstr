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

/**
 * Parse Turtle prefixes into a map
 * @param {string} turtle - Turtle document text
 * @returns {Object} - Map of prefix to full URI
 */
function parseTurtlePrefixes(turtle) {
  const prefixes = {};
  // Match @prefix or PREFIX declarations
  const prefixRegex = /(?:@prefix|PREFIX)\s+(\w*):\s*<([^>]+)>/gi;
  let match;
  while ((match = prefixRegex.exec(turtle)) !== null) {
    prefixes[match[1]] = match[2];
  }
  return prefixes;
}

/**
 * Expand a prefixed name to full URI
 * @param {string} prefixedName - e.g., "pim:storage"
 * @param {Object} prefixes - Prefix map
 * @returns {string|null} - Full URI or null
 */
function expandPrefixedName(prefixedName, prefixes) {
  const colonIndex = prefixedName.indexOf(':');
  if (colonIndex === -1) return null;
  const prefix = prefixedName.slice(0, colonIndex);
  const localName = prefixedName.slice(colonIndex + 1);
  if (prefixes[prefix]) {
    return prefixes[prefix] + localName;
  }
  return null;
}

/**
 * Find storage URL in Turtle document
 * @param {string} turtle - Turtle document text
 * @param {string} baseUrl - Base URL for resolving relative URIs
 * @returns {string|null} - Storage URL or null
 */
function findStorageInTurtle(turtle, baseUrl) {
  const prefixes = parseTurtlePrefixes(turtle);

  // Add common prefixes as fallbacks
  if (!prefixes['pim']) prefixes['pim'] = 'http://www.w3.org/ns/pim/space#';
  if (!prefixes['space']) prefixes['space'] = 'http://www.w3.org/ns/pim/space#';

  // Normalize whitespace for multiline statement matching
  const normalized = turtle.replace(/\s+/g, ' ');

  // Storage predicates to look for (full URIs)
  const storagePredicates = [
    'http://www.w3.org/ns/pim/space#storage',
    'http://www.w3.org/ns/solid/terms#storage'
  ];

  // Pattern 1: Full URI predicate with full URI object
  // e.g., <http://www.w3.org/ns/pim/space#storage> <https://pod.example/>
  for (const predicate of storagePredicates) {
    const fullUriPattern = new RegExp(`<${predicate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>\\s*<([^>]+)>`, 'i');
    const match = normalized.match(fullUriPattern);
    if (match) return match[1];
  }

  // Pattern 2: Prefixed predicate with full URI object
  // e.g., pim:storage <https://pod.example/>
  const prefixedPredicates = ['pim:storage', 'space:storage', 'solid:storage'];
  for (const pred of prefixedPredicates) {
    const prefixedPattern = new RegExp(`${pred}\\s*<([^>]+)>`, 'i');
    const match = normalized.match(prefixedPattern);
    if (match) return match[1];
  }

  // Pattern 3: Any predicate with prefixed object (less common)
  // e.g., pim:storage pod:storage
  for (const pred of prefixedPredicates) {
    const prefixedObjPattern = new RegExp(`${pred}\\s+(\\w+:\\w+)`, 'i');
    const match = normalized.match(prefixedObjPattern);
    if (match) {
      const expanded = expandPrefixedName(match[1], prefixes);
      if (expanded) return expanded;
    }
  }

  // Pattern 4: Relative URI (resolve against base)
  // e.g., pim:storage </> or pim:storage </>
  for (const pred of prefixedPredicates) {
    const relativePattern = new RegExp(`${pred}\\s*<(/[^>]*)>`, 'i');
    const match = normalized.match(relativePattern);
    if (match) {
      try {
        return new URL(match[1], baseUrl).href;
      } catch (e) {
        // Invalid URL, continue
      }
    }
  }

  return null;
}

// Get storage URL from WebID or direct storage URL
async function getStorageFromWebId(url) {
  // If it looks like a WebID (ends with /profile/card#me or similar), fetch and parse
  if (url.includes('/profile/card') || url.includes('#me') || url.includes('#i')) {
    try {
      const profileUrl = url.split('#')[0];
      const response = await fetch(profileUrl, {
        headers: { 'Accept': 'text/turtle' },
        credentials: 'include'
      });
      const text = await response.text();

      // Use robust Turtle parser
      const storage = findStorageInTurtle(text, profileUrl);
      if (storage) {
        return storage.endsWith('/') ? storage : storage + '/';
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
