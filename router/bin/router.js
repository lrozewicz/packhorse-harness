#!/usr/bin/env node
'use strict';
/** Router entry point: `node bin/router.js` (container: the `router` service). */

const net = require('node:net');

const { load } = require('../src/config');
const { createLogger } = require('../src/logger');
const { createServer } = require('../src/server');

// Happy Eyeballs: Node gives each address family 250 ms to connect, and the container
// usually has no IPv6 route, so the IPv4 attempt carries the whole budget. On a slow
// link the TCP handshake to api.anthropic.com takes longer than that and the request
// dies as ETIMEDOUT ("fetch failed") even though the network is fine - a retry storm
// in Claude Code. The fallback only has to be fast enough to matter when IPv6 hangs.
net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

const MODELS_FILE = process.env.HARNESS_MODELS_FILE || '/harness/models.yaml';

let config;
try {
  config = load(MODELS_FILE);
} catch (err) {
  console.error(`harness-router: ${err.message}`);
  process.exit(1);
}

const logger = createLogger({ level: config.router.log_level });
const { server } = createServer({ config, logger, reload: () => load(MODELS_FILE) });

process.on('uncaughtException', (err) => logger.error(`UNCAUGHT ${err && err.stack ? err.stack : err}`));
process.on('unhandledRejection', (err) => logger.error(`UNHANDLED ${err && err.stack ? err.stack : err}`));

server.on('error', (err) => {
  logger.error(`SERVER ${err.message}`);
  process.exit(1);
});

server.listen(config.router.port, config.router.host, () => {
  const ids = config.models.map((m) => m.id).join(', ') || '(no models)';
  logger.info(
    `START pid=${process.pid} http://${config.router.host}:${config.router.port} mode=${config.router.mode} ` +
    `| LiteLLM ${config.router.litellm_base_url} [${ids}] | Anthropic ${config.router.anthropic_base_url}`
  );
});

function shutdown(signal) {
  logger.info(`STOP pid=${process.pid} (${signal})`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
