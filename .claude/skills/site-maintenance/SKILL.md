---
name: site-maintenance
description: How to use the `sites` CLI to query and operate on Haunt Digital's managed repos — the site registry, server health, maintenance skills, and run history. Use when the user asks about the site registry, picking a repo to work on, stale-patch or EOL status, server/host health, filtering across managed sites, or installing/running a maintenance skill.
---

# Site maintenance via the `sites` CLI

`sites` is the Haunt Digital site registry CLI. It talks to the registry server and lets you query every managed repo by stack, runtime, EOL, patch staleness, and other metadata — and it distributes the maintenance skills that do the actual work.

## When to use this skill

- The user asks "what repos use X" / "what's on node 16" / "find me a Rails 7 site"
- The user wants a worklist driven by metadata ("repos not patched in 180 days", "sites without local dev")
- The user wants the full metadata record for one site
- The user is picking the right candidate repo for a task
- The user wants a maintenance skill installed into a repo, or wants work recorded against a site
- The user asks about the servers themselves — "is anything down", "which box is that on", "what's on 90% disk", "has anything stopped reporting"

## Commands

```
sites list                                     # all sites
sites list --filter local_dev=true
sites list --filter stack=next,runtime~node-2  # comma = AND
sites list --filter "stale>180" --sort stale   # most-overdue first
sites list --json                              # parseable output
sites show <repo_name>                         # full record for one site
sites set <repo_name> <field>=<value> …        # update fields (e.g. last_patched=now)
sites add <repo_name> [<field>=<value> …]      # register a NEW site
sites rm <repo_name>                           # remove a site (archived/decommissioned)

sites contacts <repo_name>                     # incident contacts — who to call when it's down
sites contacts add <repo_name> name=… email=…  # add one (phone optional)
sites contacts set <repo_name> <id|email> …    # update one
sites contacts rm <repo_name> <id|email> --yes # remove one

sites servers <repo_name>                      # which boxes this site runs on
sites servers add <repo_name> <hostname> environment=production role="the API"
sites servers rm <repo_name> <id|hostname> --yes

sites hosts                                    # every server, worst first
sites hosts --status stale                     # boxes that have stopped reporting
sites host <hostname>                          # one host: every check it sent
sites hosts sweep                              # run the staleness check now

sites prs                                      # open PRs across the fleet
sites prs --into deploy-production             # what's waiting to ship
sites prs --from maintenance/                  # what patching left open
sites actions --production                     # what actually went live
sites actions --failed                         # broken builds and deploys
sites runtimes                                 # what runs live, and its EOL status
sites runtimes --tooling                       # ...plus build + deploy runtimes
sites cves                                     # open advisories in live server-side code
sites cves --tooling                           # ...plus asset pipelines + dev deps
sites cves refresh [<repo_name>]               # re-pull from GitHub now
                                               # each site shows days since WE first saw it
sites components <repo_name>                   # its runtimes/frameworks, with tiers
sites components set <repo_name> node-18 tier=build
sites depscope <repo_name>                     # per-site CVE scoping rules

sites skills                                   # the maintenance skill catalogue
sites skill <name>                             # print one skill's SKILL.md
sites skills install [<name> …]                # install into ./.claude/skills/

sites runs                                     # recent runs across the fleet
sites run <id>                                 # one run + its captured log
sites run start <task> <site>[,<site>...]      # open a run (one OR many sites)
sites run finish <id> [--site <repo>] [--exit N]  # close one site, or all of them
sites run rm <id> --yes                        # delete a run opened by mistake

sites config                                   # show / set the persistent config
sites version
```

### Filter syntax

- `field=value` — exact match, case-insensitive. Booleans are `true`/`false`.
- `field~regex` — case-insensitive regex.
- `stale>N` — `last_patched` older than N days (also matches sites with no `last_patched`).
- A bare word substring-matches `repo_name`.

Filter fields are aliased for ergonomics: `name`, `stack`, `runtime`, `hosting`, `host` (matches ANY server the site is on), `domain`, `secrets` (alias for `secrets_location`), `local_dev` (alias `localdev`), `has_tests` (alias `tests`), `branch`, `internal`, `under_proactive_sla` (alias `sla`). You can also filter on any raw record field (`repo_name`, `default_branch`, `stack_tags`, `stack_versions`, `runtime_versions`, `hosting_environment`, `domains`, …).

Combine filters with commas — every comma-separated filter must match (AND).

## Record shape (`sites show`)

| Field | Notes |
| --- | --- |
| `repo_name` | Matches the GitHub repo and the folder under `~/workspace/` |
| `repo_url` | `git@github.com:haunt-digital/<name>.git` |
| `default_branch` | Usually `main`; some legacy repos use `master` |
| `deploy_branches` | e.g. `["deploy-production", "deploy-staging"]` |
| `stack_tags` | Primary stack(s) — `rails`, `next`, `gatsby`, `silverstripe`, `php`, `node`, `bun`, `react-router`, `remix`, `turborepo`, `monorepo`. Multiple allowed (monorepos) |
| `stack_versions` | `next-14`, `rails-7.2`, `silverstripe-5`, … Multiple allowed (e.g. `rails-7.2` + `react-router-7`) |
| `runtime_versions` | `node-22`, `ruby-3.3`, `php-8.3`, `bun-1`. Major or major.minor only — never patch versions. Multiple allowed |
| `runtime_eol_dates` | **Derived**, not entered — resolved from a central catalog by name + version, and empty where a project publishes no EOL (Bun, Hono). Override a single component with `sites components set <repo> <name-version> eol_override=YYYY-MM-DD` |
| `local_dev` | `true` if the repo is set up for local Docker + 1Password dev (has a `setup.sh`) |
| `has_tests` | `true` if the repo has a working regression suite |
| `internal` | `true` for Haunt-internal projects (tooling/platform), not client sites |
| `under_proactive_sla` | `true` if the site is covered by a proactive maintenance SLA |
| `always_report` | `true` to send this site a client report even though it's internal or has no SLA. The exception to the reporting rule, not a second rule |
| `hosting_environment` | Free-form lowercase hosting tags — `digitalocean`, `aws`, `azure`, `cloudflare`, `vercel`, `netlify`, `heroku`, `on-prem`. Multiple allowed (app + CDN) |
| `domains` | Production domains serving the site, as bare hostnames — `["www.consumer.org.nz", "consumer.org.nz"]`. Production only (no staging/preview hosts) |
| `secrets_location` | Where the site's production secrets live — free-form lowercase tags: `aws`, `.env`, `vercel`, `netlify`, `1pass`, `ss-cloud`. Multiple allowed |
| `waf` | WAF in front of the site — `cloudflare`, `aws`, `vercel-base`, `vercel-paid`, `ss-cloud`, or `none` (= checked, none in place; empty = not recorded). Multiple allowed for layered setups |
| `hosts` | Where the site runs — `[{id, hostname, environment, role}]`, production first. The **blast-radius join**: given a sick host, it says which clients are on it. Rows, not a field: edited with `sites servers …` / `sites host … add`, never `sites set`. Empty for Vercel/Netlify sites, which is most of the fleet |
| `dns_status` | Who holds the site's DNS zone, and where — `unknown` (nobody has checked), `haunt-cf` (Haunt's Cloudflare), `haunt-r53` (Haunt's Route 53), `haunt-sh` (Haunt's SiteHost), `client` (checked, and the client or their other supplier holds it). Single value, not a list. `unknown` and `client` are **not** interchangeable: one means nobody looked, the other is a finding |
| `report_recipients` | Who the client report is emailed to — a list of addresses. Empty (the default) means the incident `contacts`. When set it **replaces** the contacts for reports rather than adding to them — it exists for the client whose on-call person isn't who reads the monthly account |
| `contacts` | Incident contacts, in call order — `[{id, name, email, phone}]`. Who to call when the site is down. Rows, not a field: edited with `sites contacts …`, never `sites set` |
| `runtime_versions` / `runtime_eol_dates` / `stack_versions` | A read-only **projection** of the site's components. Fine to read and filter on; use `sites components` to see (and change) which of them actually run in production |
| `notes` | Free-text operational notes (markdown subset, shown on the site's web page) |
| `last_patched` | ISO 8601 |
| `last_accessibility_review` | ISO 8601 |
| `last_security_review` | ISO 8601 — stamped by the `security-review` skill |
| `uptime_monitor` | Which Better Stack monitor covers this site, when its domains don't reveal it (an API host, an admin path). Id, URL or hostname; empty = match on domains |
| `github_repo` | The GitHub repository name, when it differs from `repo_name`. Empty means they match. Everything that asks GitHub about the site — Dependabot alerts, actions, PRs — uses this, so a site whose registry name has drifted from its repo looks clean and alert-free until it is set |

## Piping to jq

```
sites list --json | jq '.[] | select(.runtime_versions | contains(["node-16"])) | .repo_name'
sites list --json | jq '[.[] | select(.has_tests == false)] | length'
```

## Auth + host

Auth is a bearer token from `sites login` (magic-link flow via browser). The server URL is in `~/.haunt/sites/config.json`. Override one-off with `sites --host <url> <cmd>`; `sites login` with `--host` persists the URL.

```
sites config                          # show current config
sites config api_url <url>            # persist a new server URL
```

## Updating site metadata

```
sites set <repo_name> <field>=<value> [<field>=<value> ...]
```

Multiple field=value pairs in one call update them atomically (single audit row).

`runtime_versions`, `runtime_eol_dates` and `stack_versions` are still writable here, but they are a projection of the components rows — setting them re-derives components (preserving tiers you set by hand). To change *where* something runs, use `sites components set` (see Runtimes and CVEs below).

| Field | Example value |
| --- | --- |
| `last_patched` | `last_patched=now` (shorthand for current ISO) or an explicit ISO string |
| `last_accessibility_review` | same as above |
| `last_security_review` | same as above |
| `uptime_monitor` | `uptime_monitor=api.bbnz.haunt.digital/games`; empty clears |
| `github_repo` | `github_repo=haunt-platform`; empty clears (meaning it matches `repo_name`) |
| `local_dev` | `local_dev=true` (boolean: `true`/`false`) |
| `has_tests` | `has_tests=true` |
| `default_branch` | `default_branch=main` |
| `repo_url` | `repo_url=git@github.com:haunt-digital/<name>.git` |
| `deploy_branches` | comma-separated: `deploy_branches=deploy-production,deploy-staging`; empty value clears |
| `stack_tags` | `stack_tags=node,next` |
| `stack_versions` | `stack_versions=next-14` |
| `runtime_versions` | `runtime_versions=node-22` (major or major.minor only) |
| `runtime_eol_dates` | Still accepted, but you rarely want it: EOL resolves from the catalog. Supplying a date stores it as an override on that component. Prefer `sites components set <repo> php-8.3 eol_override=…` when the catalog is genuinely wrong |
| `hosting_environment` | comma-separated free-form tags: `hosting_environment=digitalocean,cloudflare`; empty value clears |
| `domains` | comma-separated bare hostnames: `domains=www.example.co.nz,example.co.nz`; empty value clears |
| `secrets_location` | comma-separated tags for where prod secrets live: `secrets_location=vercel,1pass`; empty value clears |
| `waf` | comma-separated: `waf=cloudflare` / `waf=vercel-paid` / `waf=none` (explicitly no WAF); empty value clears |
| `dns_status` | one of `unknown`, `haunt-cf`, `haunt-r53`, `haunt-sh`, `client`: `dns_status=haunt-cf`. Rejected if it isn't in the set — there is no empty/clear, use `dns_status=unknown` |
| `report_recipients` | comma-separated addresses: `report_recipients=jane@client.co.nz,ops@client.co.nz`; each must be an email address; empty value clears (back to the incident contacts) |
| `notes` | quoted free text: `notes="waiting on client approval for Node 22"`; empty value clears |

Examples:

```
sites set agri-zero last_patched=now
sites set agri-zero local_dev=true has_tests=true
sites set agri-zero stack_versions=next-16 runtime_versions=node-22
sites set agri-zero hosting_environment=digitalocean,cloudflare
sites set agri-zero notes="deploy needs the legacy build flag"
sites set agri-zero deploy_branches=
```

Every update is audited server-side with the user, timestamp, and a JSON diff of changed fields.

**Keep the registry current.** If you touched a site's infrastructure — set up local dev, added tests, patched it, changed a runtime or deploy branch — update the registry before you're done. Don't wait to be asked.

## Incident contacts

Who to call when a site is down. Zero or more per site, listed in the order you'd work down them. `name` and `email` are required; `phone` is optional.

```
sites contacts <repo_name>                                  # list, in call order
sites contacts <repo_name> --json
sites contacts add <repo_name> name="Jane Doe" email=jane@example.co.nz phone="+64 21 555 0100"
sites contacts add <repo_name> name="Ops rota" email=ops@example.co.nz
sites contacts set <repo_name> jane@example.co.nz phone="09 555 0100"   # by id or email
sites contacts rm  <repo_name> jane@example.co.nz --yes
```

Two things to know:

- **Contacts are rows, not registry fields.** `sites set <repo> contacts=…` does not exist and will be rejected. Use `sites contacts …`, one contact at a time, or edit the whole list in the browser at `/sites/<name>/edit`.
- They ride along on `sites show` and `sites list --json` as a `contacts` array, so "who do we call for X" is answerable from a read you were making anyway — no extra call.

Every add, update, and removal is audited against the site, so it shows up in that site's change history alongside its other edits.

## Hosts

The servers, not the sites. Every box in the ansible inventory POSTs its own health here every 15 minutes — disk, inodes, memory, load, failed systemd units, and whether a kernel update has been installed but never rebooted into. Hosts **self-register on their first beacon**, so there is nothing to add by hand; the only thing you maintain is which site runs where.

```
sites hosts                                     # the fleet, worst first
sites hosts --status crit                       # only what is failing a check
sites hosts --status stale                      # only what has stopped reporting
sites host sciencenz                            # one host, every check it sent
sites hosts sweep                               # run the staleness check now

sites servers <repo>                            # which boxes this site runs on
sites servers add <repo> web-prod environment=production role="the API"
sites host haunt-1 add site-a,site-b            # bulk, from the host side
sites list --filter host=web-prod               # everything on that box
```

Statuses are `ok`, `warn`, `crit` and `stale`:

| Status | Means |
| --- | --- |
| `ok` | Every check passed. |
| `warn` | Something wants attention but nothing is failing. Usually `reboot_required` — real, and true of nearly every box, because unattended-upgrades installs kernels and never reboots. |
| `crit` | A check is failing: a full disk, exhausted inodes, a dead systemd unit. |
| `stale` | **Nothing has arrived** for ~50 minutes (three missed intervals plus the beacon's random splay). |

**Read `stale` as a failure, not an absence.** A dead host sends nothing, and nothing looks exactly like healthy — that is the whole reason the sweep exists. When you see it, the box may be down, or the `haunt-healthcheck.timer` on it may have stopped; everything else shown for that host is the last thing it said, not what is true now.

Alerts go to security@ on state *transitions* only — worse than last reported, once on recovery, once on coming back from silence — never on state, because 96 beacons per host per day would otherwise be 96 identical emails. A host's first beacon never alerts.

If `sites hosts` reports that beacons aren't configured, or that no host has ever reported, that is **not** a clean fleet: it means nothing is arriving. The command says so rather than printing an empty list.

### Which sites are on which box

Many-to-many, because every shape occurs: many sites on one box, one site across a staging *and* a production box, and a monorepo only *partly* on a server (its API on a box, its frontend on Vercel). So a placement is a row with attributes, not a field — `sites set` can't touch it.

| Field | Notes |
| --- | --- |
| `hostname` | Matches the ansible inventory name. No foreign key: hosts self-register from their beacons, so a placement is routinely recorded before the box has ever reported — during a rollout that is the normal state. The site's own page marks such a hostname *not reporting yet*; nothing claims to know why, because a typo and a box the role hasn't reached are indistinguishable from here |
| `environment` | `production`, `staging` or `other` (default `production`). Closed set: it separates a client-facing outage from a staging one, which is a different phone call at a different hour |
| `role` | Free text for repos only *partly* on a server — "the API", "worker + cron". Empty means the whole site runs there |

```
sites servers <repo>                            # where a site runs
sites servers add <repo> <hostname> environment=staging role="worker + cron"
sites servers set <repo> <id|hostname> environment=production
sites servers rm  <repo> <id|hostname> --yes

sites host <hostname> add <repo>,<repo>         # the bulk direction
sites host <hostname> rm  <repo>
```

**Keep this current.** It is what turns "hauntbackup is critical" into "and these four clients are on it". Record it whenever you learn where a site actually runs — a deploy config, an SSH target, a Capistrano `server` line. A site with no placements is the honest answer for a Vercel/Netlify site, which is most of the fleet.

## Pull requests and Actions

```
sites prs                                       # open, plus closed in last 24h
sites prs --into deploy-production              # by TARGET branch
sites prs --from maintenance/patching           # by SOURCE branch
sites prs --closed 7d                           # a week of closed ones
sites actions --production                      # only what went to production
sites actions --failed --hours 24               # what broke today
sites actions --name deploy-production          # one workflow across all sites
```

The two sides of a PR filter independently — `--from` is the source branch, `--into` the target — which is usually the question ("what's waiting to go into deploy-production?").

**Actions folds deployments in with workflow runs**, because they answer the same question and different sites answer it differently: a Capistrano site through a workflow, a Vercel site through a deployment. The `target` column (production/staging/preview) is inferred from the workflow name, path, branch and environment together — GitHub's own environment field is often absent or stale, so it's a signal, not the answer.

Both are read-only views over a cache refreshed every 15 minutes; `sites prs refresh` / `sites actions refresh` re-pull on demand. As with CVEs, an empty list is only good news if the fetch succeeded — the command says so when it didn't.

## Runtimes and CVEs

Two views, one idea behind both: **only some of what a repo contains actually runs in production**, and that is what should drive attention.

```
sites runtimes                                  # server-side only — the default
sites runtimes --tooling                        # add build pipelines + deploy tooling
sites runtimes --status unsupported --external  # past EOL, client sites under SLA only
sites cves                                      # advisories in live server-side code
sites cves --severity critical
sites cves --tooling --site powerswitch
```

Both take the same flags — `--tooling`, `--external`, `--site`, `--json` — and so do their API endpoints (`/api/runtimes`, `/api/cves`) and the web tabs. The defaults are identical everywhere: **server-side only, all sites**.

### Tiers

Every runtime and framework a site has is a row carrying a tier:

| Tier | Means |
| --- | --- |
| `server` | Runs live, serving requests. An EOL or CVE here is a live risk. |
| `build` | Runs at build time only — its output ships, it doesn't. |
| `deploy` | CI / deploy tooling only (Capistrano's ruby, GitHub Actions). |

Tiers are inferred from the stack — a language is server-side exactly when the site's primary framework runs on it, so a SilverStripe site's `php` serves and its `node` builds themes — then editable per site:

```
sites components <repo_name>                             # what it runs, and how each is tiered
sites components set <repo_name> node-18 tier=build      # by id or name-version
sites components add <repo_name> bun-1 tier=server
sites components set <repo_name> php-8.3 eol_override=2028-06-30
```

**Components are rows, not registry fields.** `sites set <repo> runtime_versions=…` still works — it re-derives components and preserves any tier you set by hand — but the tier itself can only be changed with `sites components set`.

`runtime_versions`, `runtime_eol_dates` and `stack_versions` on the record are a read-only projection of these rows, so `sites list --filter runtime~node` and any `jq` over `.runtime_versions` keep working unchanged.

### When a CVE is classified wrongly

By default an alert inherits the tier of its ecosystem's language (npm → node, composer → php). That is right almost everywhere. Where it isn't — a monorepo holding both an SSR app and an asset pipeline — add a rule:

```
sites depscope add powerswitch "romeo/**" tier=server note="Next SSR frontend"
sites depscope powerswitch                               # rules in play, first match wins
sites depscope rm powerswitch "romeo/**" --yes
```

Patterns are repo-relative globs against the dependency manifest path: `*` stays inside a path segment, `**` crosses them. An explicit rule beats every *inference* below it — but not GitHub's own "development dependency" flag, which is checked first: a devDependency doesn't ship wherever it lives, so `romeo/** = server` brings in `next`, not its build-time `svgo` and `@babel/*` packages.

### How long we've had it

Every alert records when this registry **first saw it on that site**, and the day count rides along everywhere it is shown:

```
sites cves                                      # "Known" column + per-site ages
sites cves --json | jq '.stale_high_sites'      # highs open longer than the threshold
```

- `alerts[].age_days` — days since we first saw it **on that site**; `null` if never stamped.
- `oldest_age_days` on the advisory — the worst of its addresses, not the average.
- `stale_high_sites` / `stale_high_days` — the sites carrying a **high** past the threshold (5 days), which is exactly what draws the **amber dot** on the web Sites list. A **red** dot there means an open critical in live server-side code.

The clock is **ours, not GitHub's**: it measures how long the thing has sat in our queue, not how old the CVE is or when the alert was opened upstream. So when you report on a site, "we have known about this for 11 days" is the honest sentence — not "this vulnerability is 4 months old". An alert that gets fixed and later reappears starts a fresh clock, because it genuinely was closed in between.

### Accepted risk

A site flagged `risk_accepted=true` is one we've consciously stopped keeping current. It vanishes from BOTH default views — all of its runtimes and all of its advisories — so it can't drown the sites that are being maintained:

```
sites set <repo_name> risk_accepted=true
sites runtimes --accepted                       # include them again
sites cves --accepted
```

Not the same as `internal` — an accepted-risk site can be client-facing. The number being hidden is always reported, never silently dropped.

### Reading the output honestly

- An **empty CVE list is not automatically good news.** If the GitHub fetch failed or the token is unset, the CLI says so explicitly — take that at face value and report it rather than concluding the site is clean.
- **`unknown` EOL means uncatalogued**, not fine. It needs a human to look up the real date and either add it to the catalog or set an `eol_override`.
- CVEs are scoped to repos in this registry. An advisory on an org repo that isn't registered never appears.
- **Accepted-risk sites are excluded by default.** If you're asked "is everything clean", check with `--accepted` before answering yes.

## Maintenance skills

The maintenance playbooks are distributed as Claude skills. The server holds the canonical copy; the CLI installs them into a repo's `.claude/skills/` in the standard format, so they show up as `/patching`, `/add-tests`, and so on.

```
sites skills                                   # catalogue: name, description, candidates
sites skill patching                           # print the SKILL.md markdown
sites skill patching --json                    # metadata + content + file list

sites skills install patching add-tests        # the playbooks you intend to run here
sites skills install                           # no names = baseline only (site-maintenance)
sites skills install --global                  # into ~/.claude/skills/ instead
sites skills install patching --dir /path/to/repo/.claude/skills
```

Maintenance playbooks (the `task: true` skills — patching, add-tests, local-dev, accessibility-review, security-review, sentry-triage, resolve-a-ticket) are always installed by name, never automatically. `sites claude` (aliases: `sites pi`, `sites agent`) is the same thing as `sites skills install` with no arguments — installs the baseline into `./.claude/skills/`, and also runs `roadmap claude` if the roadmaps CLI is present.

Installing writes `<target>/<skill-name>/SKILL.md` plus any `references/` the skill ships with. Re-running overwrites, so it's the update path too.

### The catalogue

| Skill | What it does | Candidate sites | Stamps on success |
| --- | --- | --- | --- |
| `local-dev` | Set a repo up for local Docker + 1Password dev | `local_dev=false` | `local_dev=true` |
| `add-tests` | Add a Playwright/Vitest regression suite + `./tests.sh` + CI | `has_tests=false,local_dev=true` | `has_tests=true` |
| `patching` | Update dependencies, clear security alerts, EOL report | `local_dev=true,has_tests=true` | `last_patched=now` |
| `accessibility-review` | WCAG 2.1 AA audit, tiered review doc, safe fixes | `local_dev=true,has_tests=true` | `last_accessibility_review=now` |
| `security-review` | Audit auth, access control, injection, secrets, uploads and transport; report up to 10 findings ranked by seriousness. **Reports first — fixes nothing until told which** | `local_dev=true` | `last_security_review=now` |
| `sentry-triage` | Pull the site's Sentry issues, rank by user impact, fix what's confidently fixable on `support/sentry-errors`, PR. **Reads Sentry; never writes to it unless told** | `local_dev=true` | — |
| `resolve-a-ticket` | One support ticket end-to-end: branch → Productive task → PR → deploy branch | any | — |
| `site-maintenance` | This skill — the `sites` CLI itself | — | — |

Run `sites skills` for the live list; the table above can drift.

### Picking a candidate

The "candidate sites" column is the filter to feed `sites list`:

```
sites list --filter has_tests=false,local_dev=true          # ready for add-tests
sites list --filter local_dev=true,has_tests=true --sort stale   # most overdue for patching
```

## Doing the work

There is no dispatcher or batch runner — you drive the work yourself, in the target repo, and record it as a run.

```bash
cd ~/workspace/example-site
sites skills install patching            # if the skill isn't already there
```

Then follow the skill (invoke `/patching`, or just read `.claude/skills/patching/SKILL.md`). The skill tells you to open a run at the start and close it at the end:

```bash
sites run start patching example-site    # → prints a run id, e.g. 42
# … do the work per the skill …
sites run finish 42 --exit 0             # --exit 1 if you couldn't complete it
```

`run finish --exit 0` applies the skill's registry stamp (e.g. `last_patched=now`) and records the duration, so there's no separate `sites set` for that field. Pass `--no-apply` if you already stamped it yourself. `--exit 1` closes the run as failed and leaves the registry untouched.

Both `run start` and `run finish` require the site to be registered. For an unregistered repo, skip the run and either work without tracking or `sites add <repo_name>` first.

Working across several sites? Do them one at a time, or fan out subagents — one per repo, each with its own run. There's no server-side orchestration to coordinate with.

If a checkout has someone's uncommitted work, or is on a branch they're using, patch in a `git worktree` rather than stashing or resetting it. A worktree's stack needs its own `COMPOSE_PROJECT_NAME`, and a host-port override where it clashes with the main checkout's — never stop the other stack to free a port.

## Runs

```
sites runs                                  # last 50 runs
sites runs --site example-site --task patching --limit 10
sites run <id>                              # one run + its captured log
```

A run records: task, site, who triggered it, start/finish, exit code, duration, and the version (content hash) of the skill that drove it.

### Runs across several sites

A run can cover many sites. Patching eight Next apps for one shared advisory is one piece of work — read the advisory once, decide the bump once — and recording it as eight runs loses that.

```
sites run start patching agri-zero,beervana,medsac   # one run id, three sites
sites run finish 42 --site agri-zero --exit 0        # close one leg as you go
sites run finish 42 --exit 1 --site medsac           # legs can end differently
sites run finish 42 --exit 0                         # closes every site still open
```

Each site carries its own outcome and is stamped (e.g. `last_patched=now`) only when its own leg closes — a run still half-open must never claim the rest were done. The run itself finishes when its last site does, and takes the **worst** exit code of them: one failed site means someone has to go back to it.

## Client reports

One report per site per period, for sites under a proactive-maintenance SLA — that promise is what the report reports against. Internal sites are out for the same reason: no client is waiting to read one.

`risk_accepted` does **not** exclude a site here, unlike everywhere else. It hides a site from Runtimes and CVEs so an unmaintained one can't drown the maintained ones; a client paying for proactive maintenance is still owed the account, and what we're carrying and why is exactly what the report should say. A site flagged `always_report=true` overrides the rest, for where the rule is right and the site is the exception (our own site has no SLA with anybody and is internal, and we still hold it to the same monthly account).

```
sites reports                                   # this month, every eligible site
sites reports --period 2026-08                  # a specific month
sites reports --kind quarter                    # quarterly instead
sites reports generate [<repo_name>]            # generate/regenerate, all or one
```

Every row carries a preview link you can hand to a human. Three rules the status carries, which matter before you regenerate anything:

- **Regenerating returns an approved report to draft.** The approval was of the old figures.
- **A sent report is locked.** It can't be regenerated, un-approved or changed — what went to the client is what the record keeps saying.
- **Approving and sending are for humans, in the web UI.** There is no CLI or API for either. Sending is the Reports tab's **Send approved…** button: it lists every approved, unsent report for a period and who each goes to (`report_recipients`, else the incident contacts), then what won't go and why, and sends only on a second confirm. Re-running it sends only newly approved reports. If a user asks you to send reports, point them there — and if one would go to nobody, the fix is `sites set <repo> report_recipients=…` or `sites contacts add …`.

### Notes — the part only you can supply

Everything else in a report comes from data. These don't:

```
sites notes <repo_name>
sites notes add <repo_name> recommendation "Plan the SilverStripe 6 upgrade"
sites notes add <repo_name> extra_work "Rebuilt the search index after the outage"
sites notes add <repo_name> security "Vendor patch lands 12 Sep; mitigations in place"
sites notes set <repo_name> <id> "revised text"
sites notes rm  <repo_name> <id> --yes
```

| Kind | What it's for |
|---|---|
| `recommendation` | What we advise the client to do next |
| `security` | Why an outstanding advisory is acceptable or already in hand. Shown ONLY when the site isn't clear, where a bare count would otherwise alarm without saying what's being done |
| `extra_work` | Work done outside the maintenance schedule, worth telling them about |

Notes are **current state**, not period-scoped: write one when you learn the thing and whichever report generates next carries it. They keep appearing until removed. A report already generated holds a snapshot, so editing a note never rewrites what an earlier report said — regenerate if you want it picked up.

**If you have just finished patching a site, leaving a recommendation is the single most useful thing you can do here.** The data already says what was done; only you can say what should happen next.

## Contracts

The commercial layer: per-client contracts (one row per TERM — renewals chain terms together), their charge lines, coverage, and a status derived from dates at read time. Read-only from the CLI — creating, editing, and renewing happens in the web editor at `/contracts` (it carries the quote calculator and the controlled renewal flow).

```
sites contracts                          # current terms, one row per relationship
sites contracts --client consumer        # one client
sites contracts --status expiring        # draft|sent|active|ongoing|expiring|lapsed|declined|ended
sites contracts --all                    # include superseded (renewed-over) terms
sites contract 12                        # lines, sites, docs, renewal chain
sites contract 12 --json                 # the full record
```

Statuses are derived: a signed contract within 60 days of its end date shows `expiring`; past it, `lapsed`; `ongoing` is a signed discretionary arrangement. Live monthly totals are per-currency, never mixed.

Charge lines are **read-only** here and in the MCP — editing what a client is charged is a web-UI job (`/contracts/<id>`), deliberately, since it writes the commercial record. Reading them, mind two conventions:

- `amount_per_period` / `hours_per_period` are per **billing period**, not per month: a `quarterly` line holds its quarterly figure. Divide by 3 for a monthly number — `monthly_total` on a contract already does.
- A `discount` line always subtracts. Its stored `percent`/`amount` is a magnitude; the kind carries the sign.

## Browser dashboard

Logged-in users can browse the registry server root (e.g. `https://sites.haunt.digital/`) for a live sites table, contracts, **Runtimes** (EOL status, server-side by default), **CVEs** (open Dependabot advisories, grouped by advisory, each affected site showing how long we've known), the skill catalogue, recent runs, and the audit log. Rows in the sites table carry a **red** dot for an open critical in live server-side code and an **amber** one for a high open longer than 5 days.

## Universal rules when operating on a listed site

If you `cd` into `~/workspace/<repo_name>` to make changes after querying:

1. **Never mutate production data.** All Haunt sites share their PRODUCTION DatoCMS, Algolia, databases, S3, etc. Mocks only. Do not run seed scripts, sync tasks, or reindex operations.
2. **Docker-first commands, one 1Password prompt.** Never run `npm`, `yarn`, `bundle` or `composer` on the host. Start the stack **once** with `dcup -d` (`_compose up -d`, defined by the repo's `.shell-init.sh`) — the only step that goes through 1Password — then run everything with plain `docker compose exec web …`. Don't use `_compose run --rm` / `dcrw` per command: each one is a fresh `op run` and a fresh approval for the user. `docker compose down` when you're done.
3. **No AI attribution.** Do not add `Co-Authored-By` trailers or any mention of Claude/AI to commits or PRs.
