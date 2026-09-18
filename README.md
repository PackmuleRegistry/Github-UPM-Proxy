# Github-UPM-Proxy

A Cloudflare Worker that fronts a **GitHub Packages npm registry** so it can be used
directly as a **Unity Package Manager (UPM) scoped registry**.

GitHub's npm registry (`npm.pkg.github.com`) already implements everything UPM needs
for resolving and downloading packages (package metadata, dist-tags, tarballs). The one
thing it does **not** implement is the legacy CouchDB-era endpoints that Unity's editor
still calls:

- `GET /-/all` — full package listing (used by "Add package by name" / registry browsing)
- `GET /-/v1/search` — search-as-you-type in the Package Manager window

This worker transparently reverse-proxies everything else straight to GitHub, and
synthesizes those two endpoints on the fly from the GitHub REST API + registry.

## How it works

- `GET /` → the worker returns a small JSON status page describing itself (org, scope,
  available endpoints) instead of forwarding to GitHub. GitHub's registry has nothing
  useful at its own root - it 301s to `github.com/features/packages`, which redirects
  again to an unrelated marketing/doc page - so this avoids that dead end for anyone who
  opens the worker URL directly in a browser.
- `GET /-/all` and `GET /-/v1/search` → the worker calls
  `GET /orgs/{org}/packages?package_type=npm` on the GitHub REST API to enumerate every
  npm package owned by the configured org, fetches each package's packument from the
  upstream registry, and assembles the response shape Unity expects.
- Everything else (package metadata, `dist-tags`, tarball downloads, publish, etc.) is
  reverse-proxied byte-for-byte to `UPSTREAM_REGISTRY` (`https://npm.pkg.github.com` by
  default), with the server-side `GITHUB_TOKEN` injected as the `Authorization` header.
  Unity/npm clients never need their own GitHub PAT.

### Avoiding rate limits

Enumerating every package requires N+1 upstream requests (one list call, one packument
fetch per package), which can add up for large orgs and risks two real limits:

- **Cloudflare Workers subrequest cap** — 50 subrequests per invocation on the Free
  plan, 1000 on paid plans. Fetching is throttled to `FETCH_CONCURRENCY` (default 8)
  concurrent requests via a small worker pool, which also avoids...
- **GitHub secondary/abuse rate limiting** — triggered by bursts of concurrent
  requests, independent of the hourly quota (5000 req/hr for an authenticated PAT).

On top of that, the package list is cached in a **KV namespace** (`PACKUMENT_CACHE`)
with stale-while-revalidate semantics:

- A fresh cache hit is served immediately, no upstream calls.
- A stale hit is still served immediately, while a refresh is kicked off in the
  background (`ctx.waitUntil`) - so a request never blocks on a full re-fetch.
- Only a true cache miss (e.g. very first request after deploy) blocks on a live fetch.
- A **Cron Trigger** (`[triggers]` in `wrangler.toml`, every 5 minutes by default) keeps
  the cache warm proactively, so in steady state user requests essentially never trigger
  a live GitHub fetch at all.

If your org has a very large number of packages, lower `FETCH_CONCURRENCY` further
and/or raise `CACHE_TTL_SECONDS` and the cron interval.

## Configuration

Non-secret settings live in `wrangler.toml` under `[vars]`:

| Var | Default | Purpose |
| --- | --- | --- |
| `GITHUB_ORG` | `PackmuleRegistry` | GitHub org/user that owns the npm packages. Lowercased to build the npm scope (`@packmuleregistry`). |
| `UPSTREAM_REGISTRY` | `https://npm.pkg.github.com` | Upstream registry to proxy to. |
| `GITHUB_API_URL` | `https://api.github.com` | GitHub REST API base, for enumerating packages. |
| `CACHE_TTL_SECONDS` | `300` | How long a cached package list is considered fresh before a background refresh is triggered. |
| `FETCH_CONCURRENCY` | `8` | Max concurrent upstream requests when building the package list (subrequest/rate-limit guard). |

You'll also need a KV namespace bound as `PACKUMENT_CACHE` (see [Deploying](#deploying)
below for the exact commands).

Secrets (never committed, set with `wrangler secret put <NAME>`):

| Secret | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Yes | Classic PAT with `read:packages` scope (and org read access for private packages). Used for all upstream calls. |
| `PROXY_AUTH_TOKEN` | No | If set, callers must send `Authorization: Bearer <value>` to use this worker at all — a simple shared secret to keep the proxy from being open to the internet. |

## Local development

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
# edit .dev.vars and set GITHUB_TOKEN (and optionally PROXY_AUTH_TOKEN)
npm run dev
```

`wrangler dev` simulates the `PACKUMENT_CACHE` KV namespace locally, so no Cloudflare
account setup is required just to run the worker locally. You only need to create the
real KV namespace (see [Deploying](#deploying)) before `wrangler deploy`.

## Deploying

1. Create the KV namespace used for the package-list cache, then paste the returned
   `id` into the `[[kv_namespaces]]` block in `wrangler.toml` (replacing
   `REPLACE_WITH_KV_NAMESPACE_ID`):

   ```powershell
   npx wrangler kv namespace create PACKUMENT_CACHE
   ```

   This only needs to be done once per Cloudflare account/environment; re-deploys
   afterwards reuse the same namespace `id` already committed in `wrangler.toml`.

2. Install dependencies and set secrets:

   ```powershell
   npm install
   npx wrangler secret put GITHUB_TOKEN
   # optional:
   npx wrangler secret put PROXY_AUTH_TOKEN
   ```

3. Deploy:

   ```powershell
   npm run deploy
   ```

## Configuring Unity

In your Unity project's `Packages/manifest.json`, add a scoped registry pointing at the
deployed worker URL, scoped to your org:

```json
{
  "scopedRegistries": [
    {
      "name": "PackmuleRegistry",
      "url": "https://your-worker.your-subdomain.workers.dev",
      "scopes": ["com.packmuleregistry"]
    }
  ]
}
```

If you set `PROXY_AUTH_TOKEN`, add a matching entry to your global
`%USERPROFILE%\.upmconfig.toml` (Windows) / `~/.upmconfig.toml` so Unity sends the
bearer token:

```toml
[npmAuth."https://your-worker.your-subdomain.workers.dev"]
token = "<PROXY_AUTH_TOKEN value>"
alwaysAuth = true
```

Published package names must be scoped to your GitHub org in lowercase, e.g.
`@packmuleregistry/com.mycompany.mypackage`, matching how GitHub Packages names npm
packages published to that org.

## Type checking

```powershell
npm run typecheck
```
