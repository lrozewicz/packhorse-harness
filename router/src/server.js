'use strict';
/**
 * Router server. Speaks the Anthropic Messages protocol (Claude Code knows nothing
 * about LiteLLM) and forwards traffic to one of two upstreams.
 *
 *   Claude Code --> router:8787 --+-- model from models.yaml -> LiteLLM --> provider
 *                                 +-- everything else --------> api.anthropic.com
 *
 * Traffic to Anthropic is forwarded byte for byte (including OAuth headers), so
 * the subscription works as usual. No dependencies other than `yaml` for config.
 */

const http = require('node:http');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const { decide } = require('./routing');
const { shapeForLitellm, headersForUpstream, authKind, HOP_BY_HOP } = require('./transform');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createServer({ config, logger, reload }) {
  const stats = { litellm: 0, anthropic: 0, errors: 0 };
  const startedAt = Date.now();

  function health() {
    return {
      ok: true,
      pid: process.pid,
      mode: config.router.mode,
      anthropicBaseUrl: config.router.anthropic_base_url,
      litellmBaseUrl: config.router.litellm_base_url,
      models: config.models.map((m) => ({
        id: m.id,
        label: m.label,
        via: m.litellmParams.model,
        apiBase: m.litellmParams.api_base || null,
        maxOutputTokens: m.maxOutputTokens,
        contextTokens: m.contextTokens
      })),
      standalone: config.router.mode === 'standalone' ? config.router.standalone : undefined,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      requests: { ...stats }
    };
  }

  function json(res, status, payload) {
    const data = JSON.stringify(payload, null, 2);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
    res.end(data);
  }

  async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url, 'http://router.local');

    // --- router's own diagnostic endpoints ----------------------------------
    if (url.pathname === '/healthz' || url.pathname === '/__router/health') {
      return json(res, 200, health());
    }
    if (url.pathname === '/__router/reload' && req.method === 'POST') {
      try {
        config = reload();
        logger.info(`RELOAD models.yaml: ${config.models.map((m) => m.id).join(', ') || '(no models)'}`);
        return json(res, 200, health());
      } catch (err) {
        logger.error(`RELOAD ${err.message}`);
        return json(res, 400, { ok: false, error: err.message });
      }
    }
    // Claude Code startup probe. In standalone mode there is no point in asking Anthropic.
    if (url.pathname === '/api/hello' && config.router.mode === 'standalone') {
      logger.debug('api/hello handled locally (standalone)');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(req.method === 'HEAD' ? undefined : '{}');
      return;
    }

    const rawBody = await readBody(req);
    const contentType = String(req.headers['content-type'] || '');
    let body = null;
    if (rawBody.length && contentType.includes('json')) {
      try { body = JSON.parse(rawBody.toString('utf8')); } catch { body = null; }
    }

    const requested = body && typeof body.model === 'string' ? body.model : null;
    const { target, model, rewriteModel, notes } = decide({ body, config });

    let outBody = rawBody;
    if (body) {
      if (target === 'litellm' && model) {
        const applied = shapeForLitellm(body, model, config.router);
        logger.debug(`litellm body: fields=[${Object.keys(body).join(',')}] changes=[${applied.join('; ')}]`);
        outBody = Buffer.from(JSON.stringify(body), 'utf8');
      } else if (rewriteModel) {
        body.model = rewriteModel;
        outBody = Buffer.from(JSON.stringify(body), 'utf8');
      }
    }

    const base = target === 'litellm' ? config.router.litellm_base_url : config.router.anthropic_base_url;
    const upstreamUrl = `${base}${url.pathname}${url.search}`;
    const headers = headersForUpstream(req.headers, target, config.router);
    if (outBody.length) headers['content-length'] = String(outBody.length);

    const label = target === 'litellm' ? `LITELLM(${model ? model.id : '-'})` : 'ANTHROPIC';
    const prefix = `${req.method} ${url.pathname} model=${requested || '-'}${notes.length ? ` ${notes.join(' ')}` : ''} -> ${label}`;

    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });

    try {
      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : outBody,
        signal: abort.signal,
        redirect: 'manual'
      });

      const outHeaders = {};
      upstream.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP.has(lower) || lower === 'content-encoding') return;
        outHeaders[lower] = value;
      });

      stats[target] += 1;
      logger.info(`${prefix} ${upstream.status} ${Date.now() - started}ms auth=${authKind(req.headers)}`);

      res.writeHead(upstream.status, outHeaders);
      if (!upstream.body || req.method === 'HEAD') { res.end(); return; }

      // pipeline rather than pipe: a client disconnecting mid-way through an SSE stream
      // should end with the connection cleaned up, not with an unhandled AbortError.
      try {
        await pipeline(Readable.fromWeb(upstream.body), res);
      } catch (err) {
        if (!abort.signal.aborted) logger.error(`${prefix} STREAM ${err.message}`);
        res.destroy();
      }
    } catch (err) {
      if (abort.signal.aborted) {
        logger.info(`${prefix} ABORT ${Date.now() - started}ms (client disconnected)`);
        return;
      }
      stats.errors += 1;
      logger.error(`${prefix} ${Date.now() - started}ms ${err.message}`);
      if (!res.headersSent) {
        json(res, 502, { type: 'error', error: { type: 'api_error', message: `harness-router: ${err.message}` } });
      } else {
        res.end();
      }
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      logger.error(`HANDLER ${err && err.stack ? err.stack : err}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('harness-router: internal error\n');
    });
  });

  // Long SSE streams must not be cut off by server timeouts.
  server.headersTimeout = 0;
  server.requestTimeout = 0;
  server.timeout = 0;
  server.keepAliveTimeout = 120000;

  return { server, health };
}

module.exports = { createServer };
