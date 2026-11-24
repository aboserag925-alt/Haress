'use strict';

// Fixed-window limiter keyed by Telegram user id. Entries are pruned lazily.
function createUserRateLimiter(options) {
  const limit = options.limit;
  const windowMs = options.windowMs;
  const entries = new Map();

  return function consume(key, now) {
    now = now === undefined ? Date.now() : now;
    if (entries.size > 5000) {
      entries.forEach(function (entry, entryKey) {
        if (entry.resetAt <= now) entries.delete(entryKey);
      });
    }
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }
    if (entry.count >= limit) {
      const first = !entry.notified;
      entry.notified = true;
      return { allowed: false, first: first, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
    }
    entry.count += 1;
    return { allowed: true, first: false, retryAfterSeconds: 0 };
  };
}

module.exports = { createUserRateLimiter };
