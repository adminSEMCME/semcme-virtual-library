const buckets = new Map();

export function rateLimit({ windowMs, max, keyPrefix }) {
  return (request, response, next) => {
    const key = `${keyPrefix}:${request.ip}`;
    const now = Date.now();
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      response.status(429).json({ error: "Too many requests. Please try again soon." });
      return;
    }

    next();
  };
}
