import { rateLimit as expressRateLimit, ipKeyGenerator } from 'express-rate-limit';

const MINUTE = 60 * 1000;
// ip-address (used by ipKeyGenerator) is slow on long IPv6 zone identifiers; a real client address has none.
export const clientKey = (ip) => ipKeyGenerator(String(ip || '').split('%')[0].slice(0, 45));

const limiter = ({ limit, windowMs = MINUTE, perPath }) => expressRateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (perPath ? `${clientKey(req.ip)}:${req.path}` : clientKey(req.ip)),
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many requests. Try again shortly.' }
});

/** Per-visitor, per-path limit for an individual route; stacks on top of `baselineRateLimit`. */
export const rateLimit = (limit, windowMs = MINUTE) => limiter({ limit, windowMs, perPath: true });

/** Site-wide ceiling per visitor, mounted once in server.js ahead of every dynamic route. */
export const baselineRateLimit = limiter({ limit: Number(process.env.BASELINE_RATE_LIMIT) || 300 });
