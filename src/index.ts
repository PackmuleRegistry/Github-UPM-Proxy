import type { Env } from "./types";
import { handleAll } from "./handlers/all";
import { handleSearch } from "./handlers/search";
import { handleProxy } from "./handlers/proxy";
import { warmCache } from "./cache";

function isAuthorized(request: Request, env: Env): boolean {
	if (!env.PROXY_AUTH_TOKEN) return true;

	const header = request.headers.get("Authorization") ?? "";
	const [scheme, token] = header.split(" ");
	return scheme === "Bearer" && token === env.PROXY_AUTH_TOKEN;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (!env.GITHUB_TOKEN) {
			return new Response("Worker misconfigured: GITHUB_TOKEN secret is not set.", { status: 500 });
		}

		if (!isAuthorized(request, env)) {
			return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
		}

		const url = new URL(request.url);

		try {
			if (url.pathname === "/-/all") {
				return await handleAll(env, ctx);
			}

			if (url.pathname === "/-/v1/search") {
				return await handleSearch(env, ctx, url);
			}

			return await handleProxy(env, request, url);
		} catch (err) {
			console.error("Unhandled error", err);
			return new Response(`Upstream error: ${(err as Error).message}`, { status: 502 });
		}
	},

	/**
	 * Proactively refreshes the package-list cache on a schedule (see [triggers] in
	 * wrangler.toml), so user-facing requests almost always hit a warm KV cache instead
	 * of triggering a live GitHub fetch.
	 */
	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		if (!env.GITHUB_TOKEN) {
			console.error("Skipping scheduled cache refresh: GITHUB_TOKEN is not set.");
			return;
		}
		ctx.waitUntil(warmCache(env));
	},
} satisfies ExportedHandler<Env>;
