const { classificationPrompt, motivationPrompt } = require('./prompts');
const { getSettings, getMotivations } = require('./db');

const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const DEFAULT_MODEL = 'phi3.5';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// Per-request timeouts. A hung classifier must NEVER hang the pipeline; the
// user has already moved tabs by the time a 10s+ classification would matter.
// On timeout we fall through to the next tier (Gemini) or to fallback NEUTRAL.
//
// intervention.js treats source='fallback' as silent — a timeout therefore
// produces no popup, which is the correct behavior. Trust must survive a
// flaky local model.
const OLLAMA_TIMEOUT_MS = 8000;
const GEMINI_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Local model call ---
async function callOllama(prompt, { json = true } = {}) {
  const settings = getSettings();
  const body = {
    model: (settings && settings.ai_model) || DEFAULT_MODEL,
    prompt,
    stream: false,
    options: { temperature: json ? 0.1 : 0.7 }
  };
  if (json) body.format = 'json';

  const res = await fetchWithTimeout(
    OLLAMA_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    OLLAMA_TIMEOUT_MS
  );

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return data.response;
}

// --- Cloud fallback ---
async function callGemini(prompt, apiKey) {
  const res = await fetchWithTimeout(
    `${GEMINI_URL}?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      })
    },
    GEMINI_TIMEOUT_MS
  );

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Small models sometimes return the verdict in lowercase or with non-number
// confidence. Normalize so downstream gating works deterministically.
function normalizeClassification(obj) {
  if (obj && typeof obj === 'object' && typeof obj.verdict === 'string') {
    obj.verdict = obj.verdict.trim().toUpperCase();
    if (typeof obj.confidence !== 'number' || Number.isNaN(obj.confidence)) {
      obj.confidence = 0;
    }
    obj.confidence = Math.max(0, Math.min(1, obj.confidence));
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

  // High-confidence local → use directly.
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

  // No classifier available — NEUTRAL with confidence 0. intervention.js MUST
  // treat (source === 'fallback') as silent. No popup is fired from this path,
  // which is the entire point of FIX 1: a hung/missing classifier never
  // produces wrong popups.
  return {
    verdict: 'NEUTRAL',
    confidence: 0,
    reason: 'classifier unavailable',
    source: 'fallback'
  };
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
