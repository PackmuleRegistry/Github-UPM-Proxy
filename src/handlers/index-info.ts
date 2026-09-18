import type { Env } from "../types";

/**
 * Serves a simple informational response for the worker's own root path, instead of
 * forwarding it upstream. GitHub's npm registry has no real content at "/" - it 301s to
 * github.com/features/packages, which itself redirects again to a marketing page - so
 * proxying "/" through verbatim just sends anyone who opens the worker URL in a browser
 * to an unrelated GitHub Actions/Packages doc page instead of anything useful.
 */
export function handleIndex(env: Env): Response {
	const scope = `@${env.GITHUB_ORG.toLowerCase()}`;

	const body = {
		name: "github-upm-proxy",
		status: "ok",
		description:
			"Cloudflare Worker exposing a GitHub Packages npm registry as a Unity UPM scoped registry.",
		org: env.GITHUB_ORG,
		scope,
		endpoints: {
			all: "/-/all",
			search: "/-/v1/search?text=<query>",
			packageMetadata: `/${scope}/<package-name>`,
		},
	};

	return new Response(JSON.stringify(body, null, 2), {
		headers: { "Content-Type": "application/json" },
	});
}
