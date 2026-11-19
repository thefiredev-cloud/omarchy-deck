-- Amazon watchlist for the deck Shop tab: the last 30 days of Amazon prices from the shoptrends database, read-only
-- (`sqlite3 -readonly -json`). Two kinds of rows:
--   item: one per (watch, Amazon listing) seen in 30 days, with its latest price, the price before it and 7 / 30 day figures,
--         plus the watch's own filters (min and max price, must and exclude words) so the deck applies them like shoptrends does
--   day:  one per (watch, listing, local day) with that day's lowest price, for the 30 day line
WITH now(t) AS (SELECT CAST(strftime('%s','now') AS INTEGER)),
a AS (
  SELECT o.watch_id AS w, o.listing_id AS l, o.ts AS ts, o.price AS p
  FROM obs o JOIN listing li ON li.id = o.listing_id, now
  WHERE li.site = 'amazon' AND o.price > 0 AND o.ts >= now.t - 30*86400
),
last AS (SELECT w, l, max(ts) AS ts FROM a GROUP BY w, l)
SELECT 'item' AS kind, wa.slug AS slug, wa.query AS query, last.l AS id, li.title AS title, li.url AS url,
  (SELECT p FROM a WHERE a.w = last.w AND a.l = last.l AND a.ts = last.ts LIMIT 1) AS price,
  last.ts AS seen,
  (SELECT p FROM a WHERE a.w = last.w AND a.l = last.l AND a.ts < last.ts ORDER BY a.ts DESC LIMIT 1) AS prev,
  (SELECT min(p) FROM a, now WHERE a.w = last.w AND a.l = last.l AND a.ts >= now.t - 7*86400) AS min7,
  (SELECT avg(p) FROM a, now WHERE a.w = last.w AND a.l = last.l AND a.ts >= now.t - 7*86400) AS avg7,
  (SELECT min(p) FROM a WHERE a.w = last.w AND a.l = last.l) AS min30,
  (SELECT max(p) FROM a WHERE a.w = last.w AND a.l = last.l) AS max30,
  NULL AS day, wa.min_price AS lo, wa.max_price AS hi, wa.must AS must, wa.exclude AS excl
FROM last JOIN listing li ON li.id = last.l JOIN watch wa ON wa.id = last.w
WHERE wa.active = 1
UNION ALL
SELECT 'day', wa.slug, NULL, a.l, NULL, NULL, min(a.p), NULL, NULL, NULL, NULL, NULL, NULL,
  date(a.ts, 'unixepoch', 'localtime'), NULL, NULL, NULL, NULL
FROM a JOIN watch wa ON wa.id = a.w
WHERE wa.active = 1
GROUP BY wa.slug, a.l, date(a.ts, 'unixepoch', 'localtime');
