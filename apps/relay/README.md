# Common Ground relay

The relay is an AGPL-3.0-only Cloudflare Worker with one SQLite-backed Durable Object per encrypted room. It forwards opaque binary frames, retains one bounded ciphertext snapshot for 24 hours, and uses hibernatable WebSockets.

It has no D1, R2, analytics, auth provider, paid monitoring, or overage integration. The beta is intended for Cloudflare's free plan; exhausted quotas fail closed. Set `ALLOWED_ORIGINS` to the exact deployed web origins before release.
