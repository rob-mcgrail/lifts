---
name: dependencies
description: Why a dependency install was blocked or flagged. This project routes npm/bundler/composer/python/cargo through the haunt-deps security proxy; use when an install unexpectedly fails, returns 403, prompts for credentials, or reports a package "could not be found in any version".
---

# haunt-deps dependency proxy

This project installs packages through haunt-deps (https://deps.haunt.digital) - a security proxy in
front of npm, RubyGems (bundler), Packagist (composer), PyPI (pip) and
crates.io (cargo). It filters registry METADATA only: it withholds releases newer
than a cooldown window and blocks/flags obscure low-download packages (possible
typo-squats). The package downloads themselves pass straight through to the
upstream registries.

## How it is wired (the install script wrote these, at user + repo scope)
- npm: .npmrc registry -> https://deps.haunt.digital/npm/
- bundler: .bundle/config mirror -> https://deps.haunt.digital/bundler
- composer: composer.json repository -> https://deps.haunt.digital/composer (packagist.org disabled)
- python: pip.conf index-url -> https://deps.haunt.digital/python/simple/ (+ requirements.txt --index-url)
- cargo: .cargo/config.toml source replacement -> sparse+https://deps.haunt.digital/cargo/

## When an install fails unexpectedly
A package can be withheld for too-few downloads (blocked) or for being newer than
the release-age cooldown. How that surfaces differs by client: npm and bundler
return HTTP 403; composer and python show it as "no matching version found" (not
an error). cargo reports a hard block as "no matching package named X found", and
a cooldown as "failed to select a version ... candidate versions found which
didn't match", listing the versions that survived - those are safe to pin.

Check whether one package would pass right now (this logs nothing):
    curl "https://deps.haunt.digital/agent/check?ecosystem=npm&name=PACKAGE&version=VERSION"
Returns JSON: decision (allow | flag | block | not_found), reason, downloads,
blockFloor, flagFloor. ecosystem is npm, bundler, composer, python or cargo;
version optional.

See the last 20 blocked/flagged packages as a table:
    curl "https://deps.haunt.digital/agent/recent"

For the FULL audit log (every blocked/flagged install, not just the last 20),
query /stats. This needs the admin API key, stored in 1Password at
op://Dev/haunt-deps/API_KEY:
    KEY=$(op read "op://Dev/haunt-deps/API_KEY")
    curl -H "Authorization: Bearer $KEY" "https://deps.haunt.digital/stats"            # ?action=blocked|flagged to filter

## Allowlisting a package
If a package is legitimately needed but blocked - or you can't wait out the
cooldown - allowlist it. An allowlisted package bypasses ALL policy (both the
release-age cooldown and the download floors), matched by BARE package name
across every ecosystem (npm/bundler/composer/python/cargo) - so "left-pad"
allowlists it everywhere, and you do not include a version.

Add one at runtime via the admin API (it persists in the proxy's SQLite and
survives restarts). Needs the admin key from 1Password (op://Dev/haunt-deps/API_KEY):
    KEY=$(op read "op://Dev/haunt-deps/API_KEY")
    curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"package":"PACKAGE","note":"why"}' "https://deps.haunt.digital/allowlist"
    curl -H "Authorization: Bearer $KEY" "https://deps.haunt.digital/allowlist"                          # list env base + db entries
    curl -X DELETE -H "Authorization: Bearer $KEY" "https://deps.haunt.digital/allowlist?name=PACKAGE"   # remove a db entry
Then confirm it passes: curl "https://deps.haunt.digital/agent/check?ecosystem=npm&name=PACKAGE" -> "allow".

These runtime entries EXPIRE - by default after the same 168h as the cooldown
(see allowlistTtlHours in https://deps.haunt.digital/health). The POST response tells you the expiry,
and the GET listing marks lapsed entries "expired": true. That is deliberate: an
allowlist entry is nearly always cut to get past the cooldown on one new release,
and by the time it lapses that release has aged out of the window on its own. If
a package genuinely needs a standing exemption (a real low-download false
positive), re-POST to renew, or pin it in the ALLOWLIST env base below, which
never expires.

There is also a static base in the ALLOWLIST env var (comma-separated bare names)
in /var/www/haunt-deps/shared/.env on the proxy host - use it to pin entries in
config. The effective allowlist is that env base merged with the API entries;
env-pinned names can't be removed via the API (edit shared/.env, then re-up:
cd /var/www/haunt-deps/current && docker compose up -d). If you have neither the
admin key nor host access, send the package name to whoever operates deps.haunt.digital.

Before allowlisting, check WHY it was withheld (the /agent/check reason above):
a cooldown block usually just needs you to wait, or pin an older version that is
already past the window - allowlisting exempts the package from every other check
too (including the download floors) for as long as the entry is in force, so
prefer it for genuine low-download false positives.
