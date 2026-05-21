const { classificationPrompt, motivationPrompt } = require('./prompts');
const { getSettings, getMotivations } = require('./db');

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'qwen2.5:0.5b';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// --- Local model call ---
async function callOllama(prompt, { json = true } = {}) {
  const body = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    options: { temperature: json ? 0.1 : 0.7 }
  };
  if (json) body.format = 'json';

  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return data.response;
}

// --- Cloud fallback ---
async function callGemini(prompt, apiKey) {
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    })
  });

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Small models sometimes return the verdict in the wrong case ("distraction").
// Normalize it so downstream strict equality checks don't silently miss.
function normalizeClassification(obj) {
  if (obj && typeof obj === 'object' && typeof obj.verdict === 'string') {
    obj.verdict = obj.verdict.trim().toUpperCase();
  }
  return obj;
}

// --- Classification ---
async function classifyDistraction(context) {
  const prompt = classificationPrompt(context);

  // 1. Try local model
  let localResult = null;
  try {
    const raw = await callOllama(prompt, { json: true });
    localResult = normalizeClassification(JSON.parse(raw));
  } catch (err) {
    console.error('[llm-router] Local model failed:', err.message);
  }

  // If local worked AND confidence is high enough, use it
  if (localResult && localResult.confidence >= 0.7) {
    return { ...localResult, source: 'local' };
  }

  // 2. Try Gemini if we have a key
  const settings = getSettings();
  if (settings.gemini_api_key) {
    try {
      const raw = await callGemini(prompt, settings.gemini_api_key);
      const result = normalizeClassification(JSON.parse(raw));
      return { ...result, source: 'gemini' };
    } catch (err) {
      console.error('[llm-router] Gemini failed:', err.message);
    }
  }

  // 3. Fall back to whatever local gave us.
  if (localResult) return { ...localResult, source: 'local' };

  // No classifier available — do NOT intervene. Flagging everything as a
  // distraction when Ollama is down would bury the user in popups.
  return { verdict: 'RELEVANT', confidence: 0, reason: 'classifier unavailable', source: 'fallback' };
}

// --- Motivation message ---
async function generateMotivation(context) {
  // If the user has custom motivations, pick one at random — no LLM needed.
  const customs = getMotivations();
  if (customs.length > 0) {
    return customs[Math.floor(Math.random() * customs.length)].text;
  }

  const prompt = motivationPrompt(context);

  // Local first
  try {
    const text = await callOllama(prompt, { json: false });
    if (text && text.trim().length > 0) return text.trim();
  } catch (err) {
    console.error('[llm-router] Motivation local failed:', err.message);
  }

  // Gemini fallback
  const settings = getSettings();
  if (settings.gemini_api_key) {
    try {
      const text = await callGemini(prompt, settings.gemini_api_key);
      if (text && text.trim().length > 0) return text.trim();
    } catch (err) {
      console.error('[llm-router] Motivation Gemini failed:', err.message);
    }
  }

  // Hardcoded fallback if nothing works
  const fallbacks = {
    dark_humor: "Oh look, productivity died. Want to revive it or no?",
    drill: "BACK TO WORK. NOW.",
    supportive: "Hey, you drifted. Want to come back?"
  };
  return fallbacks[context.personality] || fallbacks.supportive;
}

module.exports = { classifyDistraction, generateMotivation };
