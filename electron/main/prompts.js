// All prompts the LLM sees. Keep them here so you can tune them in one place.

function classificationPrompt({ topic, workType, title, url, appName, windowTitle }) {
  const isBrowser = !!url;
  const targetDescription = isBrowser
    ? `Browser tab — Title: "${title}" — URL: ${url}`
    : `Desktop app — Name: "${appName}" — Window: "${windowTitle}"`;

  return `You are a focus classifier. Decide if what the user just opened is RELEVANT, NEUTRAL, or a DISTRACTION relative to their stated work.

User's stated work: "${topic}"
Work type: ${workType}

They just opened:
${targetDescription}

Categories:
- "RELEVANT" → directly contributes to the stated work/study goal.
  Examples: coding in VS Code, reading docs for the work topic, editing the project file, a YouTube tutorial ON the work topic.

- "DISTRACTION" → clearly unrelated entertainment or social scrolling.
  Examples: Instagram reels, TikTok, random YouTube entertainment, gaming, movie streaming, sports highlights, celebrity news.

- "NEUTRAL" → support/utility activity, context-dependent, or unclear intent.
  Not directly productive, but not entertainment either. Don't roast these.
  Examples:
    * System / utility: File Explorer, Settings, Calculator, Snipping Tool, Task Manager, PDF viewer, clipboard tools
    * Communication: email, calendar, Slack, Discord, WhatsApp, Teams (could be work, could be chat — uncertain)
    * Generic browsing with unclear intent: bare google.com search, news pages opened by accident, undefined documentation
    * Short breaks: music player, downloads/builds finishing, brief app switching
    * Idle / loading screens

Tie-breakers:
- If unsure between RELEVANT and DISTRACTION → choose NEUTRAL.
- A YouTube tutorial on the work topic = RELEVANT. YouTube reels/music/entertainment = DISTRACTION. Background music while working = NEUTRAL.
- Social media (Instagram, Twitter, TikTok) = DISTRACTION unless their work literally involves that platform.
- Email/calendar/Slack = NEUTRAL by default (they might be working, might not).

Respond ONLY in this JSON format, no other text:
{"verdict":"RELEVANT","confidence":0.0,"reason":"short reason"}
or
{"verdict":"NEUTRAL","confidence":0.0,"reason":"short reason"}
or
{"verdict":"DISTRACTION","confidence":0.0,"reason":"short reason"}

Confidence is 0.0 to 1.0.`;
}

function motivationPrompt({ personality, topic, distraction, secondsOnDistraction }) {
  const personalityGuide = {
    dark_humor: `You roast the user with dark humor. Be witty, sarcastic, but never cruel. Reference their behavior specifically. 1-2 sentences max. No emoji.`,
    drill: `You are a drill sergeant. Be loud, direct, urgent. ALL CAPS allowed sparingly. 1-2 sentences max. No emoji.`,
    supportive: `You are a kind, supportive friend. Gentle but honest. No guilt-tripping. 1-2 sentences max. No emoji.`
  };

  const guide = personalityGuide[personality] || personalityGuide.supportive;

  return `${guide}

The user said they're working on: "${topic}"
They drifted to: "${distraction}"
They've been on it for ${secondsOnDistraction} seconds.

Write ONE short message (1-2 sentences max) to nudge them back. No quotes around your reply, no "here's a message" preamble. Just the message itself.`;
}

module.exports = { classificationPrompt, motivationPrompt };
