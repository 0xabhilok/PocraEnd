// All prompts the LLM sees. Keep them here so you can tune them in one place.
//
// Bias note (changed): the previous version told the model "if uncertain →
// DISTRACTION". That stacked badly with the post-classifier reclassify rule
// and produced a ~triple-bias toward popups. The current version prefers
// NEUTRAL on uncertainty — silence over a wrong popup, per user policy.
// Real distractions still classify as DISTRACTION when the evidence is clear.

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
  a YouTube tutorial whose title is clearly ON the work topic.

"DISTRACTION" → clear entertainment, leisure, or unrelated content with strong
  evidence. Only choose this when the title/URL gives obvious signals.
  Examples:
    - Clear entertainment titles: "Full Movie", "Episode 5", "Trailer",
      "Highlights", "Try Not To Laugh", celebrity/gossip headlines
    - Social media feeds (Instagram, TikTok, Twitter/X home, Reddit r/funny)
    - Gaming streams, sports recaps, leisure music videos
    - Streaming services on a browse/watch page (Netflix, Prime, Hulu)
    - Shopping carts, deal browsing

"NEUTRAL" → support/utility activity, OR anything you are not confident about.
  PREFER NEUTRAL over a low-confidence DISTRACTION call. Silence is better
  than a wrong popup.
  Examples:
    - System utilities: File Explorer, Settings, Calculator, Snipping Tool,
      Task Manager, PDF viewer
    - Email, calendar, messaging, productivity tools (Notion, Linear, Trello,
      Asana, Jira, Figma, Miro)
    - Generic search results pages
    - Background music (Spotify, YouTube Music, SoundCloud)
    - Ambiguous YouTube titles without obvious entertainment markers
    - Anything where you would hesitate or guess

DECISION RULES (apply in this order):
1. Strong evidence of entertainment/leisure (per the examples above)? → DISTRACTION.
2. Clear utility or support activity? → NEUTRAL.
3. Directly contributes to the stated work? → RELEVANT.
4. Genuinely uncertain between two categories? → NEUTRAL.
   We prefer silence over a wrong popup.

Confidence reflects how sure you are. Use < 0.6 when guessing.
Use >= 0.7 ONLY when the verdict is well-evidenced from the title or URL.

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
