# All crons page (every scheduled job on one list)

Read only. Page `schedules`, tab label **All crons**, right after **Crons**. The **Crons** tab (`/api/crons`) stays the Hermes lane view.

## Feed

`deck-feed-crons` (copy in `scripts/`, canonical in `~/ops/bin/`) writes `~/.meshvault/status/deck/schedules.json` every 5 minutes
(`deck-feed-crons.timer`, user unit, `deck-feed-crons.service`). The deck serves it at `GET /api/schedules` (keys `counts`, `groups`;
STALE after 600 s).

| group id | source | what is read |
|---|---|---|
| `hermes` ("Hermes jobs") | `~/.hermes/cron/jobs.json` on pc-desktop, default profile only, plus the default profile's `executions.db` (read only) | name, schedule, enabled, state, last/next run, last status, failure streak. A job is **running** only when `executions.db` has a `claimed`/`running` row whose owner pid is alive (pid and `/proc/<pid>/stat` start fingerprint match); the age is that row's `started_at`/`claimed_at`. If the table is unreadable the group carries a note and nothing is marked running or idle. No prompts, scripts, skills, delivery targets or error text. Quill's profile is never opened. `~/ops/state/hermes-cron-merge.json` (`{merged:[{old,new,at}]}`, optional) marks merged-away jobs as retired. |
| `pc-desktop-systemd`, `dell-systemd`, `spark-systemd`, `ascent-systemd` | `systemctl --user list-timers --all` plus `show` of each timer and its service, run as one python3 script (ssh, `BatchMode=yes`, read only) | timer name, schedule, next trigger, service state. **Running** needs a live `MainPID`/`ControlPID` while `activating`/`reloading`/`deactivating`, or `active` with a `MainPID`; a finished oneshot, a `RemainAfterExit` unit and an old timer fire are never running. `started` is the service's `InactiveExitTimestamp` (current invocation); `last` is the service's last inactive-enter time (end of the previous run), not the timer fire time. Missing metadata leaves `started` null (age unknown). |
| `mac-mini-launchd` | `~/Library/LaunchAgents`, `/Library/LaunchAgents`, `/Library/LaunchDaemons` plists with `StartInterval` or `StartCalendarInterval`; `launchctl list` and `launchctl print` | schedule, loaded state, run count, last exit code, log mtime as last run, running pid start from `ps etime`. Always-on services are counted in `always_on`, not listed. `StartInterval` next times are estimates (`approx_next`). |
| `github` | GraphQL scan of unarchived `viewer` repos for `.github/workflows/*.yml` with a `- cron:` line (cached 6 h), then REST status and last scheduled run per workflow (cached 15 min) | workflow name, crons (UTC), state, last scheduled run conclusion. Next run is computed from the cron. |

Job: `{id, name, host, kind, schedule, enabled, lifecycle, last, started, next, result, detail}` plus `approx_next`, `about`, `members` and `owner_wait` when set.
`lifecycle` is `active | paused | done`. `result` is one of `ok failed waiting running never paused skipped overdue unknown`. `started` is set only while `running`.
`overdue` (GitHub only) means the schedule stopped firing: no scheduled run for more than 3 intervals plus an hour. `failed` and `overdue` are the "needs a look" set.

**Owner waits.** Red means broken and an agent can fix it. A failure only Tanner can clear (an expired mail link, a Nest consent, a missing repo secret) is listed in
`~/ops/state/owner-waits.json` (`{items:[{job, host, reason, action, link?, mailbox?, until}]}`; `job` is the feed id such as `pc-desktop-systemd:nest-bridge`, `until` an
ISO date, which runs to the end of that local day, or an ISO time). A `failed` job that matches a live item becomes `waiting` with `detail` "Waiting on you: <reason>" and the
item as `owner_wait`. `counts.waiting` counts them and `counts.failing` never does. An expired item stops applying, so the job is red again; a job that recovers shows
`ok` whatever the file says. A missing file is quiet; an unreadable one is an `errors[]` entry and hides nothing. Remove an item once the owner step is done.

**Batches.** `~/ops/schedule-batches.json` (static: `{version, batches:[{timer, members:[{name, service}], retired:[{name, merged_into, at}]}]}`) and the runtime receipt
`~/ops/state/schedule-batches.json` (`{version, batches:{<timer>:{members:{<name>:{status, started_at, finished_at, exit}}}}}`, no commands or payloads) attach `members`
to the real batch timer row. A member with no receipt entry is `unknown`, never `ok`. A failed member makes the batch `failed` (a running batch stays `running` and still
counts as needing a look). Merged-away timers appear under the group's `retired` list, never in the active counts.

A source that fails is a group with `ok:false` and `error`, plus an `errors[]` entry. Its jobs are left out, never shown as zero. The group keeps `last_known`
(`{n, active, t}`) from the last feed that could read it, labelled with its age. `counts` is `scope: "observed"`: `total`, `active`, `history` (paused or finished),
`failing`, `waiting`, `running`, `running_age_unknown`, `member_failures`, `retired`, `unknown_sources`, `unknown_hosts`, `complete` (false while any source is down) and `by_group`.
A group over 200 jobs is cut by the deck's sanitiser; `n` carries the true count and the page says "showing X of n".

## Page

Search box, filter chips (**Active** default, Needs a look, Waits on you when any, Running, **History**, All observed, one per group), a summary line (active, need a look,
wait on you, running, next), a history line (paused or finished rows and retired timers, never counted active), a scope line (which sources were observed and which were not,
"not the full fleet" when one is down), then two columns of rows sorted: failing first, waiting on Tanner (amber, with "To clear: <action>"), running, soonest next run,
never run, paused. Each row: name, host, kind, schedule, last run with result and age (running rows show the
current start age, or "start time unknown"), next run, batch member summary, result pill. A failed row stays in Active even when its timer is stopped. History lists the
paused, finished and retired rows. A down source shows "could not be read. Unknown, not zero" with its last known count and age.

## Files

New: `static/schedules.js`, `scripts/deck-feed-crons`, `tests/deck_schedules_ui.test.js`, `tests/test_deck_feed_crons.py`, this file.
Registration only: `rust/src/sources.rs` (one `Def`, `FEEDS` 11 to 12, contract keys), `rust/src/main.rs` (embed and route `/schedules.js`),
`static/index.html` (one page div, one script tag), `static/deck.js` (one line in `deckPage`), `static/sw.js` (shell list; `V` unchanged).

## Deploy

`static/*` is embedded in the Rust binary: build (`cd rust && cargo build --release`), copy over `~/.local/bin/pixel-deck`, then
`systemctl --user restart pixel-deck` (shared service, owner or session `20-53-17`). The feed already runs without a restart.

## Tests

`node --test tests/deck_schedules_ui.test.js`, `python3 -m unittest tests.test_deck_feed_crons`, `cd rust && cargo test --release`.
