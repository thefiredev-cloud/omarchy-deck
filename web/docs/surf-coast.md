# Coast surf feed (Cabo San Lucas to the Columbia River)

Owner order 2026-11-14: water temperatures and buoys from the southern tip of Baja California to the northern tip of Oregon, aggregated and synthesized so the Surf page reads at a glance.

- Collector: `scripts/deck-feed-surf-coast` (package `scripts/surf_coast/`, Python stdlib only).
- Output: `~/.meshvault/status/house-feeds/surf-coast.json` (overview) and `surf-coast/<region>.json` (14 region files). `--out DIR` or `DECK_FEED_DIR` stages elsewhere; the first output line names the resolved directory.
- Routes: `GET /api/surf-coast` and `GET /api/surf-coast/region/<id>` (`rust/src/surf.rs`), owner only, guest refused. The server adds `age`, `stale` (older than 2x `refresh`) and `refresh`; it does not cut arrays at 200 rows like the generic feed cleaner.
- Schema for page and iOS lanes: `~/ops/state/deck-20261114/plan/SurfFeed.md`.
- The old 7-spot feed (`deck-feed-surf`, `surf.json`, `/api/surf`) is unchanged.

## Inventories (committed, static)

`spots.json` (246 spots in 14 regions, facing, CDIP MOP point, nearest tide station, satellite point, Open-Meteo cell, NWS zones), `regions.json`, `stations-ndbc.json` (109 stations in the box), `stations-coops.json` (CO-OPS prediction stations for CA, OR and the Mexican stations NOAA predicts). Built from the ResearchSurf lane (2026-11-15 probe). Region ids must match `REGIONS` in `rust/src/surf.rs`; a test checks it.

## Sources (keyless, public)

| Source | Use | Cadence |
|---|---|---|
| NOAA NDBC `latest_obs.txt` | Every station's newest reading in one request: waves, periods, direction, water temperature, wind | each 30-min run |
| NOAA NDBC `<id>.spec` | Swell and wind-wave split for buoys that report waves | 3 h, staggered (12 per run) |
| Scripps CDIP MOP forecast (THREDDS ASCII) | California nearshore model at 10 m depth, one point per break (144) | 6 h, staggered (14 per run) |
| Open-Meteo marine | Global wave model, swell parts, SST at 144 cells; the only model that covers Baja | 3 h |
| Open-Meteo marine at 46 buoys | Model at the buoys, for the regional bias | 6 h |
| Open-Meteo marine sea level | Model tide where no tide station is within 60 km (Baja Sur) | 24 h |
| Open-Meteo forecast | Hourly wind and gusts at 141 cells (0.1 degree) | 3 h |
| NOAA CO-OPS predictions | Highs and lows for 64 stations, 7 days from yesterday | daily, staggered (16 per run) |
| NWS api.weather.gov alerts | Active alerts for CA, OR and the PZ marine zones (contact User-Agent) | each run |
| NWS Surf Zone Forecasts (SGX, LOX, MTR, EKA, MFR, PQR) | Forecaster surf height by beach facing and rip current risk per zone | 3 h |
| SCCOOS piers via CeNCOOS ERDDAP | Surf-zone water temperature: Scripps, Newport, Santa Monica, Stearns Wharf | each run |
| NASA JPL MUR via CoastWatch ERDDAP | Satellite water temperature, one box per region | daily, separate `--tier sat` run |

Not used, by research verdict or terms: Surfline, Windy free tier, Windfinder, Buoyweather, Spitcast, Magicseaweed.

Responses are cached under `~/.cache/deck-data/surf_<source>/` (mode 700 dirs, 600 files) with conditional requests. Every host gets at most one request per second. A failed source keeps its last good body with that body's age; `sources[]` then says `stale` (older than twice its tier) or `unavailable`, and `errors[]` names it. The MUR server answered a single point in about 120 s on 2026-11-14, so the 30-minute run only reads its cache.

## Request budget (one day)

| Host | Requests per day |
|---|---|
| www.ndbc.noaa.gov | 48 latest + up to 52 x 8 spec = 280 to 464 |
| thredds.cdip.ucsd.edu | 144 x 4 = 576 |
| erddap.cencoos.org | 4 x 48 = 192 |
| api.weather.gov | alerts 2 x 48 + Surf Zone Forecasts 6 x 8 = 144 (an office past its expiry is asked hourly until it issues: at most 6 more per hour late) |
| api.tidesandcurrents.noaa.gov | 64 |
| coastwatch.pfeg.noaa.gov | 14 |
| NOAA, CDIP and CeNCOOS total | about 1,280 to 1,460 (research budget 1,800) |
| Open-Meteo | 53 HTTP; 2,488 weighted calls (marine 1,152, wind 1,128, buoys 184, sea level 24) = 24.9% of the 10,000 daily free cap |

Each run appends its per-host counts to `~/.cache/deck-data/surf_state/requests.jsonl`.

## Synthesis rules

All rules live in `scripts/surf_coast/synth.py` and are tested in `tests/test_surf_coast_synth.py`.

1. **Wave height now.** Up to 3 reporting buoys within 150 km, each weighted `exp(-km/40) x age x shadow`. Age factor is 1.0 up to 60 min, then linear to 0 at 180 min. Shadow is 0.5 for buoys behind the Channel Islands or on outer banks (46025, 46219, 46251, 46069, 46047). Beside the buoys: with the nearest buoy under 30 km, MOP 0.3 and Open-Meteo 0.3; 30 to 100 km, MOP 0.35 and Open-Meteo 0.4; no buoy within 100 km, MOP 0.6 and Open-Meteo 0.4, or Open-Meteo 1.0 alone. This weighted mean is the area's level; every part is kept in the region file (`parts.hs`).
1a. **Each break's own height (2026-11-15).** The same few buoys feed every break in a region, so the blend alone printed one number for a whole coast (Orange County 4.5 to 4.8 ft at all 26 spots while MOP read 1.0 ft at Newport Pier). Where a break has a MOP point, its height is `factor x MOP now`, with one factor per region: `median(blended height) / median(MOP height)` over the region's breaks that have both. This prints each break's MOP as its share of the region's level, not a depth calibration: scaling keeps the order and the ratios between breaks (Newport Pier stays a third of Salt Creek when MOP says so), and the median over those breaks is exactly the blended median (buoys, bias-corrected model, the same height convention), so the region line stays where the buoys put it. The factor needs at least 3 breaks and must sit between 0.5 and 4; otherwise model and buoys disagree too much and the region keeps the blend. A MOP forecast stands for now only when it was fetched at most 12 h ago (twice its 6 h tier, the age at which the source reads stale); an older or undated one is not used at all, and its age is carried (`parts.hs[].age_min` for the nearshore model, `parts.scale.mop_age_min`). `now.height_basis` is `spot` for a scaled break and `region` for a break that prints the area's blend (no MOP point, no fresh MOP value now, or no region factor), with a gap line saying so; its height and range stay filled. The region file keeps the factor and both inputs in `parts.scale`; `method.mop_scale` lists each region's factor. The rating and its word cut points are unchanged; they read the new height. The outlook (rule 11) starts from this height, so its first two days follow it; days 2 to 6 are the model as before.
1b. **Checks on a break's own height.** (1) A real sensor: a wave station reporting within 3 h, within 3 km of the shore (a pier gauge or a nearshore buoy; the inventory has no depths, so distance to shore stands in) and within 2 km of the break. When the scaled height and that sensor differ by more than 1 ft and more than 20% of the sensor, the scaled height is not printed: a sensor within 1 km is at the break and its own reading prints (`height_basis: "sensor"`; its height is already in the feed's convention, buoy Hs); a sensor 1 to 2 km off sends the break to the area's blend (`region`). Bounds from the 2026-11-15 pairs: within 2 km, 6 of 8 differed by 11% or less, then Del Mar 27% and Scripps Pier 37% (MOP puts Scripps Pier in the canyon's shadow at 1.3 ft, the pier gauge reads 4.6). Further than 2 km a sensor reads another stretch of coast: Black's Beach, 2.5 km across the Scripps canyon from the gauges, really is bigger. (2) The forecaster's band, from the break's own NWS zone and beach facing part: a scaled height over 1.5 x the top of the range (sets included) or under a fifth of its low end goes to the area's blend. Breaks without a forecaster line (Baja, uncertain zones) are not band-checked, and an area value outside the band is reported, not changed. `parts.scale` keeps `scaled_ft`, `used`, `why` (`sensor_disagrees`, `outside_forecaster_band`) and the `sensor` it was checked against.
1c. **Switch.** Break heights are on by default. `DECK_SURF_SPOT_HEIGHT=off` (also `0`, `false`, `no`) in the unit's environment turns them off without a code change: `systemctl --user edit deck-feed-surf-coast` and add `[Service]` `Environment=DECK_SURF_SPOT_HEIGHT=off`. The feed then prints every break at the area's blend with `height_basis: "region"`, and `method.spot_height` reads `off`.
2. **Global model correction.** Open-Meteo is never shown raw where it can be corrected. Each run pairs every reporting buoy within 60 km of the coast with the model at that buoy; 7 days of pairs are kept. A region's factor is `sum(observed) / sum(model)`, clamped 0.7 to 1.4, from at least 3 pairs. Without enough pairs it borrows the neighbour region's factor, then (US only) the whole US coast's. Baja Sur has no buoy within 1,000 km, so its model stays raw and the spot says so. A zero model value near the coast is a land-masked cell and is ignored.
3. **Range in feet.** Low is the spot's height now (rule 1a); high adds 3% per second of peak period above 8 s, at most x1.35.
4. **Period and direction.** Peak period from buoy DPD, MOP Tp and Open-Meteo swell period / 0.85 (it reads as a mean period), with the same weights. Direction is the weighted circular mean.
5. **Swell parts.** Primary swell and wind chop from the nearest buoy spectrum within 50 km and 4 h; otherwise from the model (bias-corrected). Secondary swell from the model.
6. **Wind.** Model wind at the spot, averaged with one observed station within 15 km and 90 min. Quality from `c = cos(wind_from - facing)`: onshore above 0.5, offshore below -0.5, else cross-shore. Words add calm (4 kt or less), light (10 kt or less), strong (over 15 kt).
7. **Tide.** CO-OPS highs and lows for the nearest prediction station within 60 km; else model sea level turns (wiggles under 0.3 ft and under 4 h apart are dropped). State is rising or falling, or high or low within 30 min of a turn. Heights between turns follow the cosine rule.
8. **Water temperature.** Median of buoy and shore station readings within 60 km (40 km for shore and tide stations, 6 h), piers within 40 km, the satellite cell nearest the spot's offshore point (land-masked cells skipped, 4 days), and the model. The spread is max minus min; `n` counts the readings.
9. **Rating 0 to 10.** Size 0 to 4 (0 at 1 ft, 4 from 5 to 10 ft, easing to 3 at 15 ft and 2 at 20 ft), period 0 to 2 (8 to 16 s), wind 0 to 3 (calm or offshore up to 15 kt 3; cross-shore 1.5 to 0.5; onshore 1 to 0), tide 0 to 1 (rising 1, else 0.5). Capped at 4 in onshore wind over 15 kt and at 1 under 1 ft. The reason line names size, period, direction, wind and tide. **Score to word** (fitted 2026-11-14 against the old 7-spot feed, the owner's daily reference, on the 42 points both feeds share: the 7 home spots now and the 35 outlook days): Flat under 1 ft, Poor under 5, Fair 5 to under 7.5, Good 7.5 to under 9.75, Great 9.75 and up. The old scale tops out at "good", so old "good" is the new Good and Great sits above it: Great needs a solid 5 ft swell, a 16 s period, calm or offshore wind and a good tide at once, so it stays rare (26 of 246 spots on a top swell night, under 1% of outlook half-days). On the same 42 points the fitted words agree with the old word on 22, read one step higher on 13 and lower on 7; the old mapping agreed on 2 and read higher on 40. Distributions on the same night: before Great 151, Good 62, Fair 30, Flat 3; after Great 26, Good 129, Fair 72, Poor 16, Flat 3.
10. **Confidence.** Model only: 0.3, up to 0.45 when two models agree (low). With a buoy: 0.5 + 0.3 x strongest buoy weight + 0.2 x agreement, where agreement is 1 minus the parts' range over their mean. High at 0.75, medium at 0.5.
11. **Forecast hours.** Model height (MOP 0.6 and corrected Open-Meteo 0.4) anchored to the spot's height now (rule 1a); the anchor fades with `exp(-hours/12)`. Days split into am (6 am to noon) and pm (noon to 6 pm) local time. Best window: the best 2 consecutive daylight hours (sunrise minus 30 min to sunset plus 30 min) left today, else tomorrow.
12. **Regions.** Rating is the median spot score; the range is the median low to median high; swell is the median primary swell; wind is the most common quality; water is the median of spot values with min and max; the tide is the station most of its spots use; best is the best window of any spot (today first).
13. **Nothing invented.** A spot without any wave source shows null numbers, "No wave reading here right now." and a gap line. Baja spots carry "No official surf alerts cover Mexico."
14. **Forecaster and rip risk.** Every period of each NWS Surf Zone Forecast is read with its end (day periods end 6 pm local, night periods 6 am; "X through Y" ends with Y; a surf line split by day, "4 to 7 feet today. 3 to 6 feet Sunday.", becomes one period per day). The spot takes the first period that has not ended at generation time: surf height (and sets), split by beach facing when the office splits it, the part whose facing is closest to its own, and that period's rip risk. `forecaster.period` names it, `end` and `end_label` say when it is over (the page hides it after `end`), `until` stays the product's own expiry. When every period has ended the keys are absent. A cached product past its expiry is asked for again after 1 h instead of 3 h. A region shows its most common zone and the most exposed part, and the highest rip risk of its zones. Keys are absent in Baja and where the text has no number. Zones the inventory marks uncertain are not used.
15. **Water confidence and upwelling.** No observed reading: 0.25 (model) or 0.4 (satellite and model within 2 °F). Otherwise 0.5 + 0.15 per observed reading (at most 2) + 0.2 x (1 - spread / 4 °F). Upwelling is readings more than 2 °C (3.6 °F) apart, flagged only from San Luis Obispo north.
16. **Day dots and buoy sparklines.** Each outlook day's confidence is its lead (days 0 to 1: 0.8, 2 to 4: 0.6, 5 to 6: 0.4) capped by the spot's own confidence now. `buoys[].hours_ft` is 24 hourly heights from the collector's own remembered readings (no extra requests), so it fills over the first day.

## Install (integration step)

1. `install -m 755 scripts/deck-feed-surf-coast ~/ops/bin/` and `rsync -a --delete scripts/surf_coast/ ~/ops/bin/surf_coast/`.
2. `install -m 644 scripts/systemd/deck-feed-surf-coast*.{service,timer} ~/.config/systemd/user/` then `systemctl --user daemon-reload`.
3. First satellite fill (about 30 min, slow server): `systemctl --user start deck-feed-surf-coast-sat.service`.
4. First live run: `systemctl --user start deck-feed-surf-coast.service`, then `journalctl --user -u deck-feed-surf-coast -n 3` shows `surf-coast: output ...` and the summary line.
5. `systemctl --user enable --now deck-feed-surf-coast.timer deck-feed-surf-coast-sat.timer`.
