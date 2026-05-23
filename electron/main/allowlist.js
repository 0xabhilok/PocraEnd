// Hardcoded rules: known productive / neutral / distraction domains and apps.
// Verdicts:
//   'allow'       → directly productive, skip LLM, no popup
//   'neutral'     → support/utility activity, skip LLM, no popup, no drift logged
//   'block'       → known distraction, fire popup (skip LLM)
//   'unknown'     → let the LLM decide
//
// "Neutral" means: not clearly productive, not clearly distracting. Examples:
// system utilities, file management, calculators, settings — things that
// support work but aren't direct output, and shouldn't be roasted.

// Always allowed regardless of work type: local dev servers and AI assistants.
const ALWAYS_ALLOWED_DOMAINS = new Set([
  'localhost',
  '127.0.0.1',
  'claude.ai',
  'chatgpt.com',
  'chat.openai.com',
  'gemini.google.com',
  'perplexity.ai'
]);

const PER_WORKTYPE_ALLOWED = {
  coding: [
    'github.com',
    'gitlab.com',
    'stackoverflow.com',
    'stackexchange.com',
    'developer.mozilla.org',
    'docs.python.org',
    'react.dev',
    'reactjs.org',
    'nodejs.org',
    'npmjs.com',
    'tailwindcss.com',
    'vitejs.dev',
    'electronjs.org',
    'ollama.com',
    'huggingface.co'
  ],
  studying: [
    'wikipedia.org',
    'khanacademy.org',
    'coursera.org',
    'edx.org',
    'scholar.google.com'
  ],
  writing: [
    'docs.google.com',
    'notion.so',
    'grammarly.com'
  ],
  research: [
    'wikipedia.org',
    'scholar.google.com',
    'arxiv.org',
    'nature.com'
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
  'twitch.tv'
]);

// Neutral domains — support work or unclear intent. Never trigger a popup,
// but also not counted as "productive". Email, calendar, news, generic search.
const NEUTRAL_DOMAINS = new Set([
  'mail.google.com',
  'gmail.com',
  'outlook.com',
  'outlook.office.com',
  'calendar.google.com',
  'drive.google.com',
  'dropbox.com',
  'onedrive.live.com',
  'google.com',                 // bare google.com search — intent unclear
  'bing.com',
  'duckduckgo.com'
]);

// Desktop apps that are clearly work tools — directly productive.
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

// Desktop apps that are support / utility / system tools — neutral.
// They help the user work but aren't direct output, so we don't roast them.
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
  // Communication (could be productive but generally neutral)
  'slack',
  'discord',
  'microsoft teams',
  'teams',
  'zoom',
  'whatsapp',
  'telegram',
  'outlook',
  'thunderbird',
  // Audio / background
  'spotify',
  'music',
  'groove music'
];

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Returns: 'allow' | 'neutral' | 'block' | 'unknown' (means: ask LLM)
function checkRules({ url, workType }) {
  const domain = extractDomain(url);
  if (!domain) return 'unknown';

  if (ALWAYS_ALLOWED_DOMAINS.has(domain)) return 'allow';

  const wtList = PER_WORKTYPE_ALLOWED[workType] || [];
  if (wtList.some((d) => domain === d || domain.endsWith('.' + d))) {
    return 'allow';
  }

  // YouTube, reddit and discord are intentionally NOT hard-blocked — a subreddit
  // or dev server can be on-topic, so the LLM judges them with context.
  if (KNOWN_DISTRACTIONS.has(domain)) return 'block';

  // Email, calendar, generic search → neutral, no popup, no roast.
  if (NEUTRAL_DOMAINS.has(domain)) return 'neutral';

  return 'unknown';
}

// Returns: 'allow' | 'neutral' | 'unknown' for a desktop app.
function checkAppRules({ appName }) {
  if (!appName) return 'unknown';
  const name = appName.toLowerCase();
  if (PRODUCTIVE_APPS.some((a) => name.includes(a))) return 'allow';
  if (NEUTRAL_APPS.some((a) => name.includes(a))) return 'neutral';
  return 'unknown';
}

module.exports = { checkRules, checkAppRules, extractDomain };
