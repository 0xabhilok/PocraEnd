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

CATEGORIES — read carefully, the boundaries matter:

"RELEVANT" → directly contributes to the stated work/study goal.
  Examples: coding in VS Code on the project, reading docs for the work topic,
  a YouTube tutorial ON the work topic.

"DISTRACTION" → entertainment, leisure, or anything clearly unrelated to work.
  This is the DEFAULT for entertainment of any kind. Be DECISIVE here.
  Examples:
    - Movies, TV shows, streaming (any movie title, any "Watch Online", any
      streaming/video player page that isn't tutorial content)
    - Social media reels and scrolling (Instagram, TikTok, Twitter/X, Snapchat)
    - Gaming, sports highlights, celebrity news, gossip
    - Random YouTube entertainment, music videos for leisure
    - Anything with words like "Movie", "Full Movie", "Watch Online",
      "Episode", "Season", "Trailer", "Highlights" in the title — unless
      the user's stated work is film/video production

"NEUTRAL" → ONLY for support/utility activities that are neither work nor
  entertainment. Be STRICT — do not use NEUTRAL as an "I'm not sure" escape.
  Examples (and basically ONLY these kinds):
    - System utilities: File Explorer, Settings, Calculator, Snipping Tool,
      Task Manager, PDF viewer, clipboard tools, screenshot tools
    - Communication tools where intent is genuinely unclear: email, calendar,
      Slack, Discord, WhatsApp, Teams
    - Idle/loading screens, OS notifications

DECISION RULES (apply in this order):
1. Is it clearly entertainment, a movie, a video player, social scrolling, or
   leisure? → DISTRACTION. Do NOT choose NEUTRAL for these.
2. Is it a system utility or comms tool from the NEUTRAL examples above? → NEUTRAL.
3. Does it directly help the stated work? → RELEVANT.
4. Still genuinely uncertain between RELEVANT and DISTRACTION? → pick
   DISTRACTION (better to interrupt than to miss a real drift). Do NOT
   default to NEUTRAL just to avoid committing.

Set confidence honestly (0.0–1.0). High confidence (>= 0.7) for clear cases.

Respond ONLY in this JSON format, no other text:
{"verdict":"RELEVANT","confidence":0.0,"reason":"short reason"}
or
{"verdict":"NEUTRAL","confidence":0.0,"reason":"short reason"}
or
{"verdict":"DISTRACTION","confidence":0.0,"reason":"short reason"}`;
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
