import { rateLimit as expressRateLimit, ipKeyGenerator } from 'express-rate-limit';

const MINUTE = 60 * 1000;

const limiter = ({ limit, windowMs = MINUTE, perPath }) => expressRateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (perPath ? `${ipKeyGenerator(req.ip || '')}:${req.path}` : ipKeyGenerator(req.ip || '')),
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many requests. Try again shortly.' }
});

/** Per-visitor, per-path limit for an individual route; stacks on top of `baselineRateLimit`. */
export const rateLimit = (limit, windowMs = MINUTE) => limiter({ limit, windowMs, perPath: true });

/** Site-wide ceiling per visitor, mounted once in server.js ahead of every dynamic route. */
export const baselineRateLimit = limiter({ limit: Number(process.env.BASELINE_RATE_LIMIT) || 300 });
