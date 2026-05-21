'use strict';

// Accuracy benchmark for PocraEnd's distraction classifier.
//
// Reproduces the real pipeline from intervention.js:
//   1. checkRules() decides allow/block for known domains (deterministic).
//   2. Anything 'unknown' goes to the Qwen model via Ollama.
//
// Run:  node test-accuracy.js
// The rules-layer cases run anywhere. The LLM cases need Ollama running
// with the qwen2.5:3b model; if Ollama is offline they are skipped.

const { checkRules, checkAppRules, extractDomain } = require('./electron/main/allowlist');
const { classificationPrompt } = require('./electron/main/prompts');

const OLLAMA = 'http://127.0.0.1:11434';
const MODEL = 'qwen2.5:3b';

// --- Labeled test set ---------------------------------------------------
// `expect` is the verdict a reasonable human would give.
const CASES = [
  // coding — handled by the rules layer
  { topic: 'React assignment', workType: 'coding', url: 'https://github.com/facebook/react', title: 'facebook/react', expect: 'RELEVANT' },
  { topic: 'React assignment', workType: 'coding', url: 'https://stackoverflow.com/questions/55', title: 'useEffect infinite loop', expect: 'RELEVANT' },
  { topic: 'React assignment', workType: 'coding', url: 'https://react.dev/learn/state', title: 'State - React', expect: 'RELEVANT' },
  { topic: 'React assignment', workType: 'coding', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', title: 'JavaScript | MDN', expect: 'RELEVANT' },
  { topic: 'React assignment', workType: 'coding', url: 'https://www.instagram.com/', title: 'Instagram', expect: 'DISTRACTION' },
  { topic: 'React assignment', workType: 'coding', url: 'https://twitter.com/home', title: 'Home / X', expect: 'DISTRACTION' },
  { topic: 'React assignment', workType: 'coding', url: 'https://www.reddit.com/r/reactjs', title: 'r/reactjs', expect: 'RELEVANT' },

  // coding — handled by the LLM
  { topic: 'React assignment', workType: 'coding', url: 'https://www.youtube.com/watch?v=a', title: 'React Hooks Full Course for Beginners', expect: 'RELEVANT' },
  { topic: 'React assignment', workType: 'coding', url: 'https://www.youtube.com/watch?v=b', title: 'Try Not To Laugh Challenge #47', expect: 'DISTRACTION' },
  { topic: 'React assignment', workType: 'coding', url: 'https://www.netflix.com/browse', title: 'Netflix', expect: 'DISTRACTION' },
  { topic: 'React assignment', workType: 'coding', url: 'https://chatgpt.com/', title: 'ChatGPT', expect: 'RELEVANT' },
  { topic: 'React assignment', workType: 'coding', url: 'https://medium.com/x', title: 'Understanding React reconciliation', expect: 'RELEVANT' },
  { topic: 'React assignment', workType: 'coding', url: 'https://www.amazon.com/', title: 'Amazon.com: Online Shopping', expect: 'DISTRACTION' },

  // studying — rules layer
  { topic: 'DBMS exam revision', workType: 'studying', url: 'https://en.wikipedia.org/wiki/Database_normalization', title: 'Database normalization', expect: 'RELEVANT' },
  { topic: 'DBMS exam revision', workType: 'studying', url: 'https://www.khanacademy.org/', title: 'Khan Academy', expect: 'RELEVANT' },
  { topic: 'DBMS exam revision', workType: 'studying', url: 'https://www.tiktok.com/', title: 'TikTok', expect: 'DISTRACTION' },

  // studying — LLM
  { topic: 'DBMS exam revision', workType: 'studying', url: 'https://www.youtube.com/watch?v=c', title: 'DBMS Normalization 1NF 2NF 3NF Explained', expect: 'RELEVANT' },
  { topic: 'DBMS exam revision', workType: 'studying', url: 'https://www.youtube.com/watch?v=d', title: 'Minecraft Speedrun World Record', expect: 'DISTRACTION' },
  { topic: 'DBMS exam revision', workType: 'studying', url: 'https://www.geeksforgeeks.org/dbms', title: 'DBMS Tutorial - GeeksforGeeks', expect: 'RELEVANT' },

  // writing — rules layer
  { topic: 'Essay on climate change', workType: 'writing', url: 'https://docs.google.com/document/d/1', title: 'Climate essay - Google Docs', expect: 'RELEVANT' },
  { topic: 'Essay on climate change', workType: 'writing', url: 'https://www.facebook.com/', title: 'Facebook', expect: 'DISTRACTION' },

  // writing — LLM
  { topic: 'Essay on climate change', workType: 'writing', url: 'https://www.youtube.com/watch?v=e', title: 'Climate Change: The Facts - Documentary', expect: 'RELEVANT' },

  // desktop apps (no url)
  { topic: 'Full stack project', workType: 'coding', appName: 'Claude', windowTitle: 'Claude', expect: 'RELEVANT' },
  { topic: 'React assignment', workType: 'coding', appName: 'Visual Studio Code', windowTitle: 'App.jsx - pocraend', expect: 'RELEVANT' },
  { topic: 'React assignment', workType: 'coding', appName: 'Windows Terminal', windowTitle: 'npm run dev', expect: 'RELEVANT' },
  { topic: 'React assignment', workType: 'coding', appName: 'Discord', windowTitle: '#general', expect: 'DISTRACTION' },
  { topic: 'React assignment', workType: 'coding', appName: 'Steam', windowTitle: 'Steam Store', expect: 'DISTRACTION' },
  { topic: 'DBMS exam revision', workType: 'studying', appName: 'Microsoft Word', windowTitle: 'DBMS-notes.docx', expect: 'RELEVANT' }
];

// --- Ollama call (mirrors llm-router.js) --------------------------------
async function callOllama(prompt) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.1 }
    })
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  return (await res.json()).response;
}

async function ollamaOnline() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${OLLAMA}/api/version`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function isRulesCase(c) {
  if (c.url) return checkRules({ url: c.url, workType: c.workType }) !== 'unknown';
  if (c.appName) return checkAppRules({ appName: c.appName }) === 'allow';
  return false;
}

async function predict(c) {
  if (c.url) {
    const v = checkRules({ url: c.url, workType: c.workType });
    if (v === 'allow') return { verdict: 'RELEVANT', via: 'rules' };
    if (v === 'block') return { verdict: 'DISTRACTION', via: 'rules' };
  } else if (c.appName) {
    if (checkAppRules({ appName: c.appName }) === 'allow') {
      return { verdict: 'RELEVANT', via: 'rules' };
    }
  }
  const prompt = classificationPrompt({
    topic: c.topic,
    workType: c.workType,
    title: c.title,
    url: c.url,
    appName: c.appName,
    windowTitle: c.windowTitle
  });
  const raw = await callOllama(prompt);
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { verdict: 'PARSE_ERROR', via: 'llm' };
  }
  return { verdict: String(obj.verdict || '').trim().toUpperCase(), via: 'llm' };
}

function label(c) {
  if (c.url) return `${extractDomain(c.url)} — ${c.title}`;
  return `[app] ${c.appName} — ${c.windowTitle}`;
}

(async () => {
  const online = await ollamaOnline();
  console.log('PocraEnd classifier accuracy benchmark');
  console.log('='.repeat(70));
  console.log(online
    ? 'Ollama: ONLINE — running full benchmark (rules + LLM).'
    : 'Ollama: OFFLINE — running rules-layer cases only.');
  console.log('');

  let total = 0, correct = 0, falsePos = 0, falseNeg = 0, skipped = 0;

  for (const c of CASES) {
    if (!isRulesCase(c) && !online) { skipped++; continue; }

    let pred;
    try {
      pred = await predict(c);
    } catch (err) {
      console.log(`ERR  ${label(c)}  (${err.message})`);
      continue;
    }

    total++;
    const ok = pred.verdict === c.expect;
    if (ok) correct++;
    else if (pred.verdict === 'DISTRACTION' && c.expect === 'RELEVANT') falsePos++;
    else if (pred.verdict === 'RELEVANT' && c.expect === 'DISTRACTION') falseNeg++;

    const mark = ok ? 'OK  ' : 'FAIL';
    console.log(`${mark} [${pred.via.padEnd(5)}] got ${pred.verdict.padEnd(11)} want ${c.expect.padEnd(11)} | ${label(c)}`);
  }

  console.log('');
  console.log('='.repeat(70));
  console.log(`Cases evaluated : ${total}${skipped ? `   (skipped ${skipped} LLM cases — Ollama offline)` : ''}`);
  if (total > 0) {
    console.log(`Accuracy        : ${correct}/${total}  (${((correct / total) * 100).toFixed(1)}%)`);
    console.log(`False positives : ${falsePos}   (real work wrongly flagged as a distraction — annoying)`);
    console.log(`False negatives : ${falseNeg}   (a real distraction missed — defeats the purpose)`);
  }
  if (!online) {
    console.log('');
    console.log('Run this again with Ollama running to benchmark the LLM cases too.');
  }
})();
