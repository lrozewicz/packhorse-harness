'use strict';
/** Logger: one line per request, to stdout (docker logs) and optionally to a file. */

const fs = require('node:fs');

function createLogger({ level = 'info', file = process.env.HARNESS_ROUTER_LOG || '' } = {}) {
  const write = (line) => {
    const entry = `${new Date().toISOString()} ${line}\n`;
    process.stdout.write(entry);
    if (file) {
      try { fs.appendFileSync(file, entry); } catch { /* logging must never crash the router */ }
    }
  };
  return {
    level,
    info: write,
    debug: (line) => { if (level === 'debug') write(`DEBUG ${line}`); },
    error: (line) => write(`ERROR ${line}`)
  };
}

module.exports = { createLogger };
