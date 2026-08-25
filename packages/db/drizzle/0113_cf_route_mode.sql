-- Cloudflare Tunnel routes: publication mode.
--
-- 'app'  → cloudflared forwards straight to localhost:<target_port> on the node
--          (bypasses OpenResty entirely: no analytics, no edge rate-limits).
-- 'edge' → cloudflared forwards to localhost:80 and OpenResty routes by Host
--          header to the app via a domain row flagged externalIngress (plain
--          HTTP vhost, no certbot — TLS terminated at Cloudflare). Full
--          site_logger analytics, rate-limiting and rules-engine apply.
--
-- domain_id links an 'edge' route to the OpenShip domain row it created, so
-- removing the route also removes the vhost cleanly.

ALTER TABLE "cf_tunnel_routes" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'app' NOT NULL;
ALTER TABLE "cf_tunnel_routes" ADD COLUMN IF NOT EXISTS "domain_id" text;
