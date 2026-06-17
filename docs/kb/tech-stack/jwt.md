# Session/token — Short-lived JWT access (~15m) + rotating refresh (httpOnly cookie)

**Chosen:** Short-lived JWT access (~15m) + rotating refresh (httpOnly cookie)  
**Alternatives:** Opaque server sessions, long JWT

Short access TTL realizes GAP-17 (near-session permission propagation); refresh in httpOnly cookie.
