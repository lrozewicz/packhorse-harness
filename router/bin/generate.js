#!/usr/bin/env node
'use strict';
/** Generator entry point: run by the `harness-init` service and `./bin/harness regen`. */

const { load } = require('../src/config');
const { writeAll } = require('../src/generate');

const MODELS_FILE = process.env.HARNESS_MODELS_FILE || '/harness/models.yaml';
const OUT_DIR = process.env.HARNESS_OUT_DIR || '/harness/generated';
const BASE_CONFIG = process.env.HARNESS_LITELLM_BASE || '/harness/litellm/config.base.yaml';
const SETTINGS_BASE = process.env.HARNESS_SETTINGS_BASE || '/harness/claude/config/settings.json';

try {
  const config = load(MODELS_FILE);
  const written = writeAll(config, { outDir: OUT_DIR, basePath: BASE_CONFIG, settingsBase: SETTINGS_BASE });

  const missing = config.models
    .filter((m) => m.apiKeyEnv && !process.env[m.apiKeyEnv])
    .map((m) => `${m.id} -> ${m.apiKeyEnv}`);

  console.log(`harness-init: mode=${config.router.mode}, models=[${config.models.map((m) => m.id).join(', ') || '-'}]`);
  for (const file of written) console.log(`harness-init: wrote ${file}`);
  if (missing.length) {
    console.log(`harness-init: WARNING - variables missing from .env: ${missing.join(', ')}`);
  }
} catch (err) {
  console.error(`harness-init: ${err.message}`);
  process.exit(1);
}
