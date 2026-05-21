// Hardcoded rules: known productive domains per work type.
// If this returns true, skip the LLM call entirely.

const ALWAYS_ALLOWED_DOMAINS = new Set([
  'localhost',
  '127.0.0.1'
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
  'reddit.com',
  'snapchat.com',
  'pinterest.com',
  'discord.com',
  'twitch.tv'
]);

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

  // YouTube is intentionally NOT in the block list — needs LLM judgment.
  // Same for medium.com, dev.to, etc. — could be productive or not.
  if (KNOWN_DISTRACTIONS.has(domain)) return 'block';

  return 'unknown';
}

module.exports = { checkRules, extractDomain };
