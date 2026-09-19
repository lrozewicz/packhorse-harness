'use strict';
/**
 * Loads and normalizes models.yaml - the harness's single source of truth.
 * The returned object is ready to be used by both the router and the generator.
 */

const fs = require('node:fs');
const YAML = require('yaml');

const ROUTER_DEFAULTS = {
  host: '0.0.0.0',
  port: 8787,
  mode: 'hybrid', // hybrid | standalone
  anthropic_base_url: 'https://api.anthropic.com',
  litellm_base_url: 'http://litellm:4000',
  litellm_api_key: '',
  server_tools_to_anthropic: true,
  anthropic_fallback_model: 'claude-haiku-4-5-20251001',
  strip_anthropic_betas: true,
  strip_cache_control: false,
  log_level: 'info',
  standalone: {}
};

const MODEL_DEFAULTS = {
  api: 'openai',
  behaves_as: 'claude-sonnet-5',
  context_tokens: 200000,
  max_output_tokens: 32768,
  thinking: 'strip',
  effort: 'strip',
  extra_body: {},
  drop_fields: [],
  aliases: []
};

/** LiteLLM prefix for `api:` in models.yaml. Unknown values are passed through as-is. */
const API_PREFIX = {
  openai: 'openai',
  'openai-responses': 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
  vertex: 'vertex_ai',
  bedrock: 'bedrock'
};

class ConfigError extends Error {}

function readYaml(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read ${file}: ${err.message}`);
  }
  try {
    return YAML.parse(raw) || {};
  } catch (err) {
    throw new ConfigError(`${file} is not valid YAML: ${err.message}`);
  }
}

function bool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return !['0', 'false', 'no', ''].includes(String(value).toLowerCase());
}

function normalizeModel(raw, defaults, index) {
  const entry = { ...MODEL_DEFAULTS, ...defaults, ...raw };

  if (!entry.id || typeof entry.id !== 'string') {
    throw new ConfigError(`models[${index}]: missing "id" field (the model name as seen by Claude Code)`);
  }
  if (/haiku/i.test(entry.id)) {
    throw new ConfigError(
      `models[${index}] "${entry.id}": id must not contain "haiku" - Claude Code blocks auto mode for this name`
    );
  }

  const upstream = entry.upstream_model || entry.id;
  const custom = entry.litellm_params && typeof entry.litellm_params === 'object' ? entry.litellm_params : {};

  if (!entry.api_base && !custom.api_base && !custom.model) {
    throw new ConfigError(`models[${index}] "${entry.id}": missing "api_base" (or litellm_params.model)`);
  }

  const prefix = API_PREFIX[entry.api] || entry.api;
  const litellmParams = {
    model: `${prefix}/${upstream}`,
    ...(entry.api_base ? { api_base: entry.api_base } : {}),
    ...(entry.api_key_env ? { api_key: `os.environ/${entry.api_key_env}` } : {}),
    ...(entry.api === 'openai-responses' ? { mode: 'responses' } : {}),
    ...custom
  };

  return {
    id: entry.id,
    label: entry.label || entry.id,
    description: entry.description || '',
    behavesAs: entry.behaves_as,
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    match: entry.match || null,
    contextTokens: Number(entry.context_tokens) || MODEL_DEFAULTS.context_tokens,
    maxOutputTokens: Number(entry.max_output_tokens) || 0,
    thinking: entry.thinking,
    effort: entry.effort,
    extraBody: entry.extra_body && typeof entry.extra_body === 'object' ? entry.extra_body : {},
    dropFields: Array.isArray(entry.drop_fields) ? entry.drop_fields : [],
    apiKeyEnv: entry.api_key_env || null,
    litellmParams
  };
}

function load(file = process.env.HARNESS_MODELS_FILE || '/harness/models.yaml') {
  const doc = readYaml(file);
  const routerRaw = doc.router || {};
  const router = { ...ROUTER_DEFAULTS, ...routerRaw };

  // Environment variables override the file - compose is the source of addresses and secrets.
  if (process.env.HARNESS_MODE) router.mode = process.env.HARNESS_MODE;
  if (process.env.HARNESS_ROUTER_HOST) router.host = process.env.HARNESS_ROUTER_HOST;
  if (process.env.HARNESS_ROUTER_PORT) router.port = Number(process.env.HARNESS_ROUTER_PORT);
  if (process.env.ANTHROPIC_UPSTREAM_BASE_URL) router.anthropic_base_url = process.env.ANTHROPIC_UPSTREAM_BASE_URL;
  if (process.env.LITELLM_BASE_URL) router.litellm_base_url = process.env.LITELLM_BASE_URL;
  if (process.env.LITELLM_MASTER_KEY) router.litellm_api_key = process.env.LITELLM_MASTER_KEY;
  if (process.env.HARNESS_LOG_LEVEL) router.log_level = process.env.HARNESS_LOG_LEVEL;

  router.mode = router.mode === 'standalone' ? 'standalone' : 'hybrid';
  router.server_tools_to_anthropic = bool(router.server_tools_to_anthropic, true);
  router.strip_anthropic_betas = bool(router.strip_anthropic_betas, true);
  router.strip_cache_control = bool(router.strip_cache_control, false);
  router.anthropic_base_url = String(router.anthropic_base_url).replace(/\/+$/, '');
  router.litellm_base_url = String(router.litellm_base_url).replace(/\/+$/, '');
  router.standalone = router.standalone && typeof router.standalone === 'object' ? router.standalone : {};

  const defaults = doc.defaults && typeof doc.defaults === 'object' ? doc.defaults : {};
  const list = Array.isArray(doc.models) ? doc.models : [];
  const models = list.map((raw, i) => normalizeModel(raw, defaults, i));

  const byName = new Map();
  for (const model of models) {
    for (const name of [model.id, ...model.aliases]) {
      const key = name.toLowerCase();
      if (byName.has(key)) throw new ConfigError(`model "${name}" defined twice (id or alias)`);
      byName.set(key, model);
    }
  }

  if (router.mode === 'standalone') {
    for (const [slot, id] of Object.entries(router.standalone)) {
      if (id && !byName.has(String(id).toLowerCase())) {
        throw new ConfigError(`router.standalone.${slot} = "${id}" is not defined in models`);
      }
    }
    if (!models.length) throw new ConfigError('standalone mode requires at least one model in models');
  }

  return { file, router, models, byName, defaults };
}

module.exports = { load, ConfigError, MODEL_DEFAULTS, ROUTER_DEFAULTS };
