'use strict';
/**
 * Adapts an Anthropic Messages request body to an external model.
 *
 * LiteLLM translates /v1/messages to OpenAI Chat Completions, but a few Anthropic
 * fields have no sensible equivalent there and can end in a 400:
 *   - thinking.budget_tokens -> reasoning_effort, which the backend may not support,
 *   - max_tokens larger than the model's actual output window,
 *   - betas / cache_control - Anthropic-only fields,
 *   - image/document blocks sent to a text-only model (`vision: false`).
 */

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'
]);

function stripCacheControl(node) {
  if (Array.isArray(node)) { node.forEach(stripCacheControl); return; }
  if (!node || typeof node !== 'object') return;
  delete node.cache_control;
  for (const value of Object.values(node)) stripCacheControl(value);
}

const MEDIA_BLOCKS = new Set(['image', 'document']);

/** Replaces image/document blocks (also inside tool results) with a text note. Returns the count. */
function replaceMedia(content, note) {
  if (!Array.isArray(content)) return 0;
  let count = 0;
  content.forEach((block, i) => {
    if (!block || typeof block !== 'object') return;
    if (MEDIA_BLOCKS.has(block.type)) {
      content[i] = { type: 'text', text: note };
      count += 1;
    } else if (block.type === 'tool_result') {
      count += replaceMedia(block.content, note);
    }
  });
  return count;
}

function appendSystem(body, text) {
  if (Array.isArray(body.system)) body.system.push({ type: 'text', text });
  else if (typeof body.system === 'string' && body.system) body.system = `${body.system}\n\n${text}`;
  else body.system = text;
}

/** Mutates `body`. Returns the list of changes for the log. */
function shapeForLitellm(body, model, router) {
  const applied = [];

  if (body.model !== model.id) {
    applied.push(`model ${body.model}->${model.id}`);
    body.model = model.id;
  }

  const cap = Number(model.maxOutputTokens);
  if (cap > 0 && typeof body.max_tokens === 'number' && body.max_tokens > cap) {
    applied.push(`max_tokens ${body.max_tokens}->${cap}`);
    body.max_tokens = cap;
  }

  if ('thinking' in body) {
    if (model.thinking === 'strip') { delete body.thinking; applied.push('thinking removed'); }
    else if (model.thinking === 'disabled') { body.thinking = { type: 'disabled' }; applied.push('thinking=disabled'); }
  }

  if (model.effort === 'strip') {
    if ('effort' in body) { delete body.effort; applied.push('effort removed'); }
    if ('reasoning_effort' in body) { delete body.reasoning_effort; applied.push('reasoning_effort removed'); }
  } else if (model.effort && model.effort !== 'keep') {
    body.reasoning_effort = model.effort;
    applied.push(`reasoning_effort=${model.effort}`);
  }

  if (router.strip_anthropic_betas && 'betas' in body) { delete body.betas; applied.push('betas removed'); }

  if (router.strip_cache_control) {
    stripCacheControl(body.system);
    stripCacheControl(body.messages);
    stripCacheControl(body.tools);
    applied.push('cache_control removed');
  }

  // Text-only model: the provider would reject image blocks, and the model should
  // know why it sees none, so it does not guess or keep opening image files.
  if (model.vision === false) {
    const note = `[image omitted: ${model.id} cannot see images or PDFs]`;
    let replaced = 0;
    for (const message of Array.isArray(body.messages) ? body.messages : []) {
      replaced += replaceMedia(message && message.content, note);
    }
    if (replaced) applied.push(`${replaced} image/document block(s) replaced`);
    appendSystem(body, `You are ${model.id}, a text-only model: you cannot view images or PDFs. ` +
      'Do not open image or PDF files with Read; work from text (source, SVG, OCR output, metadata) instead.');
    applied.push('text-only note added');
  }

  for (const field of model.dropFields) {
    if (field in body) { delete body[field]; applied.push(`${field} removed`); }
  }

  for (const [key, value] of Object.entries(model.extraBody)) {
    body[key] = value;
    applied.push(`${key}=${JSON.stringify(value)}`);
  }

  return applied;
}

/**
 * Headers for the upstream. The subscription token must never be sent to LiteLLM -
 * the LiteLLM key is sent instead.
 */
function headersForUpstream(incoming, target, router) {
  const out = {};
  for (const [key, value] of Object.entries(incoming)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'accept-encoding') continue;
    out[lower] = Array.isArray(value) ? value.join(', ') : value;
  }
  if (target === 'litellm') {
    delete out.authorization;
    delete out.cookie;
    delete out['anthropic-dangerous-direct-browser-access'];
    if (router.strip_anthropic_betas) delete out['anthropic-beta'];
    if (router.litellm_api_key) {
      out['x-api-key'] = router.litellm_api_key;
      out.authorization = `Bearer ${router.litellm_api_key}`;
    }
  }
  return out;
}

function authKind(headers) {
  const auth = headers.authorization || headers.Authorization;
  if (typeof auth === 'string' && /^bearer\s/i.test(auth)) return 'oauth';
  if (headers['x-api-key']) return 'apikey';
  return 'none';
}

module.exports = { shapeForLitellm, headersForUpstream, authKind, HOP_BY_HOP };
