// Hardcoded rules: known productive / neutral / distraction domains and apps.
// Verdicts:
//   'allow'        → directly productive, skip LLM, no popup
//   'neutral'      → support/utility activity, skip LLM, no popup, no drift logged
//   'soft-neutral' → tolerated up to a per-session budget; intervention.js tracks
//                    cumulative time and fires a single popup once the budget
//                    is exceeded. Used for chat apps where intent is unknowable
//                    from outside but extended use is suspicious.
//   'block'        → known distraction, fire popup (skip LLM)
//   'unknown'      → let the LLM decide

// ---------------------------------------------------------------------------
// Domain sets
// ---------------------------------------------------------------------------

// Always allowed regardless of work type: local dev servers and AI assistants.
const ALWAYS_ALLOWED_DOMAINS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'claude.ai',
  'claude.com',
  'chatgpt.com',
  'chat.openai.com',
  'gemini.google.com',
  'perplexity.ai',
  'copilot.microsoft.com',
  'poe.com',
  'you.com'
]);

// Productivity tools that apply to ANY work type.
// Mail, calendar, docs, task management, design tools — silent regardless of
// the user's stated topic. These are the tools real students/devs use across
// every kind of session, so locking them behind workType is wrong.
const UNIVERSAL_UTILITIES = new Set([
  // Cloud docs / storage
  'docs.google.com',
  'drive.google.com',
  'sheets.google.com',
  'slides.google.com',
  'forms.google.com',
  'meet.google.com',
  'dropbox.com',
  'onedrive.live.com',
  'box.com',
  'icloud.com',
  // Project management / task tracking
  'notion.so',
  'notion.site',
  'trello.com',
  'asana.com',
  'linear.app',
  'monday.com',
  'clickup.com',
  'atlassian.com',
  'atlassian.net',
  'jira.com',
  'confluence.com',
  'basecamp.com',
  'todoist.com',
  'airtable.com',
  // Design / whiteboard
  'figma.com',
  'miro.com',
  'excalidraw.com',
  'whimsical.com',
  'lucidchart.com',
  'canva.com',
  // Mail
  'mail.google.com',
  'gmail.com',
  'outlook.com',
  'outlook.office.com',
  'outlook.live.com',
  'mail.proton.me',
  'mail.yahoo.com',
  'fastmail.com',
  // Calendar
  'calendar.google.com',
  'calendar.proton.me',
  // Writing / spellcheck
  'grammarly.com',
  'overleaf.com'
]);

const PER_WORKTYPE_ALLOWED = {
  coding: [
    'github.com',
    'github.io',
    'gitlab.com',
    'bitbucket.org',
    'codeberg.org',
    'stackoverflow.com',
    'stackexchange.com',
    'serverfault.com',
    'superuser.com',
    'developer.mozilla.org',
    'docs.python.org',
    'pypi.org',
    'react.dev',
    'reactjs.org',
    'angular.io',
    'vuejs.org',
    'svelte.dev',
    'nodejs.org',
    'npmjs.com',
    'tailwindcss.com',
    'vitejs.dev',
    'electronjs.org',
    'ollama.com',
    'huggingface.co',
    'go.dev',
    'pkg.go.dev',
    'doc.rust-lang.org',
    'crates.io',
    'kotlinlang.org',
    'typescriptlang.org',
    'dev.to',
    'freecodecamp.org',
    'codepen.io',
    'jsfiddle.net',
    'codesandbox.io',
    'replit.com',
    'caniuse.com',
    'regex101.com',
    'regexr.com',
    'jest.io',
    'vitest.dev',
    'cypress.io',
    'docs.aws.amazon.com'
  ],
  studying: [
    'wikipedia.org',
    'wiktionary.org',
    'khanacademy.org',
    'coursera.org',
    'edx.org',
    'scholar.google.com',
    'brilliant.org',
    'ocw.mit.edu',
    'geeksforgeeks.org'
  ],
  writing: [
    'docs.google.com',
    'notion.so',
    'grammarly.com',
    'overleaf.com',
    'hemingwayapp.com'
  ],
  research: [
    'wikipedia.org',
    'scholar.google.com',
    'arxiv.org',
    'nature.com',
    'sciencedirect.com',
    'pubmed.ncbi.nlm.nih.gov',
    'jstor.org',
    'ssrn.com'
  ]
};

const KNOWN_DISTRACTIONS = new Set([
  'instagram.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'snapchat.com',
  'pinterest.com',
  'twitch.tv',
  'netflix.com',
  'primevideo.com',
  'hotstar.com',
  'disneyplus.com',
  'hulu.com',
  'hbomax.com',
  '9gag.com',
  'ifunny.co',
  'tmz.com',
  'buzzfeed.com'
]);

// Neutral domains — generic search (intent unclear) and background music/audio.
// Background audio is treated as neutral to match the existing desktop-Spotify
// behavior; same as having music play while you code.
const NEUTRAL_DOMAINS = new Set([
  // Generic search
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'kagi.com',
  // Music / streaming audio (background music is allowed during work)
  'open.spotify.com',
  'spotify.com',
  'music.youtube.com',
  'music.apple.com',
  'soundcloud.com',
  'pandora.com',
  'tidal.com',
  // Podcasts
  'pocketcasts.com',
  'overcast.fm'
]);

// Chat apps in the browser. Soft-neutral: tolerated up to a budget, then a
// single popup; resets and another budget window starts.
const CHAT_DOMAINS = new Set([
  'discord.com',
  'web.whatsapp.com',
  'whatsapp.com',
  'web.telegram.org',
  'telegram.org',
  'slack.com',
  'app.slack.com',
  'teams.microsoft.com',
  'teams.live.com',
  'web.skype.com'
]);

// ---------------------------------------------------------------------------
// Desktop app sets
// ---------------------------------------------------------------------------

const PRODUCTIVE_APPS = [
  'claude',
  'chatgpt',
  'visual studio code',
  'cursor',
  'intellij',
  'pycharm',
  'webstorm',
  'android studio',
  'sublime text',
  'notepad++',
  'windows terminal',
  'powershell',
  'command prompt',
  'git bash',
  'postman',
  'github desktop',
  'docker desktop'
];

// Pure utilities / system tools — neutral, no tracking.
const NEUTRAL_APPS = [
  // System utilities
  'snippingtool',
  'snipping tool',
  'screenshot',
  'task manager',
  'taskmgr',
  'system settings',
  'ms-settings',
  'settings',
  'control panel',
  'registry editor',
  'regedit',
  'eventvwr',
  'perfmon',
  'resmon',
  // File management
  'file explorer',
  'finder',
  // Quick utilities
  'notepad',
  'calculator',
  'calc',
  'paint',
  'clipboard',
  // PDF / document viewers
  'adobe acrobat',
  'acrobat reader',
  'sumatra',
  'preview',
  // Email clients (heavy clients are utilities; chat is separate)
  'outlook',
  'thunderbird',
  // Audio (background music is neutral, same as web)
  'spotify',
  'music',
  'groove music'
];

// Chat / conferencing apps — soft-neutral. Tracked cumulatively per session;
// silent until the per-session chat budget is exceeded (handled in intervention.js).
const CHAT_APPS = [
  'discord',
  'slack',
  'microsoft teams',
  'teams',
  'zoom',
  'whatsapp',
  'telegram',
  'signal',
  'skype'
];

// ---------------------------------------------------------------------------
// Domain extraction & matching helpers
// ---------------------------------------------------------------------------

// Canonicalize a URL's hostname so the same logical site resolves to one key
// regardless of mobile/www redirects. extractDomain is what whitelist checks,
// rule lookups, and (in intervention.js) normalizeKey all use.
function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^(www|m|mobile|mbasic|web)\./, '');
  } catch {
    return null;
  }
}

// Does `domain` exactly equal `d` or is it a subdomain of `d`?
function matchesDomain(domain, d) {
  return domain === d || domain.endsWith('.' + d);
}

// Check `set` for `domain` or any apex of `domain`.
// 'docs.google.com' against a set containing 'google.com' → true.
function setHasDomainOrApex(set, domain) {
  if (!domain) return false;
  if (set.has(domain)) return true;
  const parts = domain.split('.');
  // Try each progressively shorter suffix until we hit the TLD.
  for (let i = 1; i < parts.length - 1; i++) {
    if (set.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rule entry points
// ---------------------------------------------------------------------------

// Returns: 'allow' | 'neutral' | 'soft-neutral' | 'block' | 'unknown'
function checkRules({ url, workType }) {
  const domain = extractDomain(url);
  if (!domain) return 'unknown';

  // Order matters: always-allowed > universal utilities > per-work allow >
  // explicit blocks > neutral/music > soft-neutral chat > unknown.
  if (setHasDomainOrApex(ALWAYS_ALLOWED_DOMAINS, domain)) return 'allow';
  if (setHasDomainOrApex(UNIVERSAL_UTILITIES, domain)) return 'neutral';

  const wtList = PER_WORKTYPE_ALLOWED[workType] || [];
  if (wtList.some((d) => matchesDomain(domain, d))) return 'allow';

  if (setHasDomainOrApex(KNOWN_DISTRACTIONS, domain)) return 'block';
  if (setHasDomainOrApex(NEUTRAL_DOMAINS, domain)) return 'neutral';
  if (setHasDomainOrApex(CHAT_DOMAINS, domain)) return 'soft-neutral';

  return 'unknown';
}

// Returns: 'allow' | 'neutral' | 'soft-neutral' | 'unknown'
function checkAppRules({ appName }) {
  if (!appName) return 'unknown';
  const name = appName.toLowerCase();
  if (PRODUCTIVE_APPS.some((a) => name.includes(a))) return 'allow';
  if (NEUTRAL_APPS.some((a) => name.includes(a))) return 'neutral';
  if (CHAT_APPS.some((a) => name.includes(a))) return 'soft-neutral';
  return 'unknown';
}

function isChatApp(appName) {
  if (!appName) return false;
  const name = appName.toLowerCase();
  return CHAT_APPS.some((a) => name.includes(a));
}

module.exports = {
  checkRules,
  checkAppRules,
  extractDomain,
  isChatApp,
  // exported for tests
  setHasDomainOrApex,
  matchesDomain
};
