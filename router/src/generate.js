'use strict';
/**
 * Generator: models.yaml -> files consumed by the other services.
 *
 *   generated/litellm.config.yaml   - LiteLLM config (config.base.yaml + model_list)
 *   generated/managed-settings.json - Claude Code managed settings (/model entries)
 *   generated/registry.json         - overview for `./bin/harness models`
 *
 * Secrets never end up in the output: the key is written as os.environ/<VARIABLE>
 * and LiteLLM reads it from its own environment.
 */

const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const HEADER = [
  '# GENERATED FILE - do not edit.',
  '# Source: models.yaml  |  generator: router/src/generate.js',
  '# Regenerate: ./bin/harness regen',
  ''
].join('\n');

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra === undefined ? base : extra;
  const out = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [key, value] of Object.entries(extra)) out[key] = deepMerge(out[key], value);
  return out;
}

function litellmConfig(config, basePath) {
  let base = {};
  if (basePath && fs.existsSync(basePath)) {
    base = YAML.parse(fs.readFileSync(basePath, 'utf8')) || {};
  }
  const model_list = config.models.map((model) => ({
    model_name: model.id,
    litellm_params: model.litellmParams,
    model_info: {
      max_input_tokens: model.contextTokens,
      max_output_tokens: model.maxOutputTokens || undefined,
      metadata: { harness_label: model.label }
    }
  }));
  return deepMerge(base, { model_list });
}

/**
 * Claude Code managed settings. `modelPicker` is only read from managed settings,
 * --settings/SDK and user settings - so we generate managed settings instead of
 * touching the user's settings.json (which holds the login).
 */
function managedSettings(config, basePath) {
  // Base (hooks, managedMcpServers, permissions) + whatever follows from models.yaml.
  let base = {};
  if (basePath && fs.existsSync(basePath)) {
    try {
      base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
      delete base._comment;
    } catch (err) {
      throw new Error(`${basePath} is not valid JSON: ${err.message}`);
    }
  }

  const options = config.models.map((model) => ({
    model: model.id,
    label: model.label,
    description: model.description || `LiteLLM -> ${model.litellmParams.model}`,
    behavesAs: model.behavesAs
  }));

  const settings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    modelPicker: { options, replaceBuiltInOptions: false }
  };

  // Claude Code assumes a 200k context window for unknown models; this variable
  // is only read for non-claude-* models, so it does not affect the subscription.
  const windows = config.models.map((m) => m.contextTokens).filter((n) => n > 0);
  if (windows.length) {
    settings.env = { CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(Math.min(...windows)) };
  }
  if (config.router.mode === 'standalone') {
    settings.modelPicker.replaceBuiltInOptions = true;
  }
  return deepMerge(base, settings);
}

function registry(config) {
  return {
    generatedAt: new Date().toISOString(),
    source: config.file,
    mode: config.router.mode,
    standalone: config.router.mode === 'standalone' ? config.router.standalone : null,
    litellmBaseUrl: config.router.litellm_base_url,
    anthropicBaseUrl: config.router.anthropic_base_url,
    models: config.models.map((m) => ({
      id: m.id,
      label: m.label,
      behavesAs: m.behavesAs,
      via: m.litellmParams.model,
      apiBase: m.litellmParams.api_base || null,
      apiKeyEnv: m.apiKeyEnv,
      contextTokens: m.contextTokens,
      maxOutputTokens: m.maxOutputTokens,
      thinking: m.thinking,
      effort: m.effort,
      aliases: m.aliases,
      extraBody: m.extraBody
    }))
  };
}

function writeAll(config, { outDir, basePath, settingsBase }) {
  fs.mkdirSync(outDir, { recursive: true });

  const files = [
    [path.join(outDir, 'litellm.config.yaml'), HEADER + YAML.stringify(litellmConfig(config, basePath))],
    [path.join(outDir, 'managed-settings.json'), `${JSON.stringify(managedSettings(config, settingsBase), null, 2)}\n`],
    [path.join(outDir, 'registry.json'), `${JSON.stringify(registry(config), null, 2)}\n`]
  ];

  for (const [file, content] of files) fs.writeFileSync(file, content, 'utf8');
  return files.map(([file]) => file);
}

module.exports = { writeAll, litellmConfig, managedSettings, registry };
