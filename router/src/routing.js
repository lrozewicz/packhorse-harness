'use strict';
/**
 * Routing decision: every request is sent to one of two targets.
 *
 *   litellm   -> a model defined in models.yaml (or all traffic in standalone mode)
 *   anthropic -> subscription: Opus/Sonnet/Fable/Haiku, OAuth, server tools
 */

// Tools executed on the Anthropic API side - an OpenAI-style backend cannot run them.
const SERVER_TOOL_PREFIXES = [
  'web_search', 'web_fetch', 'code_execution', 'computer',
  'text_editor', 'bash_2', 'memory', 'tool_search'
];

/** Claude slot for a model name - used only in standalone mode. */
function claudeSlot(model) {
  const name = String(model || '').toLowerCase();
  if (name.includes('haiku')) return 'haiku';
  if (name.includes('opus')) return 'opus';
  if (name.includes('sonnet')) return 'sonnet';
  if (name.includes('fable')) return 'fable';
  return 'default';
}

function serverToolsIn(body) {
  const tools = Array.isArray(body && body.tools) ? body.tools : [];
  return tools
    .map((tool) => (tool && typeof tool.type === 'string' ? tool.type : null))
    .filter((type) => type && SERVER_TOOL_PREFIXES.some((prefix) => type.startsWith(prefix)));
}

/**
 * @returns {{target:'litellm'|'anthropic', model:object|null, rewriteModel:string|null, notes:string[]}}
 */
function decide({ body, config }) {
  const { router, byName } = config;
  const requested = body && typeof body.model === 'string' ? body.model : null;
  const notes = [];
  const serverTools = body ? serverToolsIn(body) : [];

  if (serverTools.length) notes.push(`[${serverTools.join(',')}]`);

  let model = requested ? byName.get(requested.toLowerCase()) || null : null;

  // `match:` patterns from models.yaml - for names that cannot be listed explicitly.
  if (!model && requested) {
    model = config.models.find((m) => m.match && new RegExp(m.match, 'i').test(requested)) || null;
  }

  if (router.mode === 'standalone') {
    if (!model && requested) {
      const slot = claudeSlot(requested);
      const mapped = router.standalone[slot] || router.standalone.default;
      model = mapped ? byName.get(String(mapped).toLowerCase()) || null : null;
      if (model) notes.push(`slot:${slot}`);
    }
    if (serverTools.length) notes.push('no-anthropic-for-server-tools');
    if (model) return { target: 'litellm', model, rewriteModel: model.id, notes };
    return { target: 'anthropic', model: null, rewriteModel: null, notes };
  }

  // hybrid
  if (model && serverTools.length && router.server_tools_to_anthropic) {
    const fallback = /^claude-/i.test(requested) ? null : router.anthropic_fallback_model;
    if (fallback) notes.push(`-> ${fallback}`);
    return { target: 'anthropic', model: null, rewriteModel: fallback, notes };
  }

  if (model) return { target: 'litellm', model, rewriteModel: model.id, notes };
  return { target: 'anthropic', model: null, rewriteModel: null, notes };
}

module.exports = { decide, serverToolsIn, claudeSlot, SERVER_TOOL_PREFIXES };
