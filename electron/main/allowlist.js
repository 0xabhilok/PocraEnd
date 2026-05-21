// Hardcoded rules: known productive domains per work type.
// If this returns true, skip the LLM call entirely.

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

// Desktop apps that are clearly work tools — never a distraction.
// Matched case-insensitively as a substring of the OS-reported app name.
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

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Returns: 'allow' | 'block' | 'unknown' (means: ask LLM)
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

  return 'unknown';
}

// Returns: 'allow' | 'unknown' for a desktop app ('unknown' means: ask the LLM).
function checkAppRules({ appName }) {
  if (!appName) return 'unknown';
  const name = appName.toLowerCase();
  if (PRODUCTIVE_APPS.some((a) => name.includes(a))) return 'allow';
  return 'unknown';
}

module.exports = { checkRules, checkAppRules, extractDomain };
