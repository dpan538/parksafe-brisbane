// llm.js — builds prompt and reads Gemini summary via server endpoint.
// Primary path is /api/summarise (Vercel production or `vercel dev`).
// For simple local static serving (python http.server), we fall back to Flask on :5000.
const SUMMARISE_ENDPOINTS = ['/api/summarise'];
if (typeof window !== 'undefined' && window.location.protocol === 'http:') {
  SUMMARISE_ENDPOINTS.push('http://127.0.0.1:5000/api/summarise');
}

const QUOTA_HINT =
  'Risk summary unavailable: Gemini API quota or rate limit exceeded. ' +
  'Check your Google AI plan and billing (see ai.google.dev/gemini-api/docs/rate-limits). ' +
  'Free-tier limits reset on a schedule; you may need to enable billing or wait.';

function markdownBoldToHtml(s) {
  return String(s).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wrap risk-related phrases & route suburb names (plain text only, then returns safe HTML string). */
function keywordWrapPlain(text, zones, origin, dest) {
  let s = escapeHtml(text);
  const names = new Set();
  if (origin) names.add(String(origin).trim());
  if (dest) names.add(String(dest).trim());
  (zones || []).forEach((z) => {
    if (z && z.name) names.add(String(z.name).trim());
  });
  const sorted = [...names].filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi');
    s = s.replace(re, (m) => `<strong>${m}</strong>`);
  }
  const phrases = [
    /\b(high|medium|low)\s+risk\b/gi,
    /\bvehicle\s+theft\b/gi,
    /\bmonitored\s+parking\b/gi,
  ];
  for (const re of phrases) {
    s = s.replace(re, (m) => `<strong>${m}</strong>`);
  }
  return s;
}

/**
 * After markdown **…**, bold keywords only in text not already inside <strong>.
 */
function finalizeSummaryHtml(rawText, zones, origin, dest) {
  const html = markdownBoldToHtml(rawText);
  const div = document.createElement('div');
  div.innerHTML = html;

  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    let p = n.parentElement;
    let insideStrong = false;
    while (p) {
      if (p.tagName === 'STRONG') {
        insideStrong = true;
        break;
      }
      p = p.parentElement;
    }
    if (!insideStrong) textNodes.push(n);
  }

  for (const textNode of textNodes) {
    const plain = textNode.data;
    const wrapped = keywordWrapPlain(plain, zones, origin, dest);
    if (wrapped === escapeHtml(plain)) continue;
    const tpl = document.createElement('template');
    tpl.innerHTML = wrapped;
    textNode.parentNode.replaceChild(tpl.content, textNode);
  }

  return div.innerHTML;
}

function isQuotaOrRateLimit(text) {
  if (!text) return false;
  const s = String(text).toLowerCase();
  return (
    s.includes('429') ||
    s.includes('quota') ||
    s.includes('rate limit') ||
    s.includes('resource_exhausted')
  );
}

// Build a structured prompt from route data
// origin/dest: suburb name strings, zones: array from data.js
// Returns prompt string
function buildPrompt(origin, dest, zones) {
  const zoneLines = zones.map(z =>
    `- ${z.name}: risk score ${z.score}/100 (${z.rank}), peak period ${z.peak}`
  ).join('\n');

  return `You are a crime risk analyst for a vehicle theft awareness tool in Brisbane, Australia.
A user is planning to drive from ${origin} to ${dest}.

Their route passes through these suburbs with the following vehicle theft risk profiles:
${zoneLines}

Write exactly 2-3 sentences of plain-language summary for a general audience. Include:
- The overall route risk level (low / medium / high)
- The highest-risk area and a brief reason
- One practical recommendation (e.g. use monitored parking, avoid Friday night)

Do not use bullet points. Write in clear, calm, factual prose. Do not start with "I".`;
}

// Stream LLM risk summary into a DOM element
// origin/dest: strings, zones: array, targetEl: DOM element
// Returns nothing — updates DOM directly as stream arrives
export async function fetchRiskSummary(origin, dest, zones, targetEl) {
  const prompt = buildPrompt(origin, dest, zones);

  targetEl.textContent = 'Generating risk summary…';

  try {
    // Try serverless endpoint first, then local Flask fallback in http dev.
    let res = null;
    let lastErr = null;
    let usedEndpoint = '';
    for (const endpoint of SUMMARISE_ENDPOINTS) {
      try {
        console.log('[llm] POST summarise', endpoint, {
          promptLength: prompt.length,
          promptPreview: prompt.slice(0, 120) + (prompt.length > 120 ? '…' : ''),
        });
        const candidate = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        // Typical local static server returns 404 for /api/*; try fallback next.
        if (candidate.status === 404 && endpoint.startsWith('/api/')) {
          continue;
        }
        res = candidate;
        usedEndpoint = endpoint;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!res) throw lastErr || new Error('No summary endpoint available');

    console.log(
      '[llm] Summarise response:',
      usedEndpoint,
      res.status,
      res.statusText,
      'ok=',
      res.ok,
      'content-type=',
      res.headers.get('content-type')
    );

    if (!res.ok) {
      let detail = '';
      try {
        const errJson = await res.json();
        detail = errJson.error ? String(errJson.error) : JSON.stringify(errJson);
        console.error('[llm] Summarise error JSON:', errJson);
      } catch (e) {
        detail = await res.text().catch(() => '');
        console.error('[llm] Summarise error text:', detail, e);
      }
      if (res.status === 429 || isQuotaOrRateLimit(detail)) {
        console.warn('[llm] Quota / rate limit from backend:', res.status, detail);
        targetEl.textContent = QUOTA_HINT;
        return;
      }
      throw new Error(`Backend error ${res.status}: ${detail || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    targetEl.innerHTML = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      targetEl.innerHTML = markdownBoldToHtml(text);
    }

    console.log('[llm] Stream complete, length:', text.length);
    targetEl.innerHTML = finalizeSummaryHtml(text, zones, origin, dest);
  } catch (err) {
    console.error('[llm] fetchRiskSummary failed — full error:', err);
    if (err && typeof err === 'object' && 'stack' in err) {
      console.error('[llm] stack:', err.stack);
    }
    const msg =
      err && typeof err === 'object' && 'message' in err
        ? String(err.message)
        : String(err);
    if (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('Load failed')
    ) {
      targetEl.textContent =
        'Summary API not available. Start `vercel dev`, or run Flask backend on port 5000 for local static mode.';
    } else if (isQuotaOrRateLimit(msg)) {
      targetEl.textContent = QUOTA_HINT;
    } else {
      targetEl.textContent =
        `Risk summary unavailable: ${msg}`;
    }
  }
}
