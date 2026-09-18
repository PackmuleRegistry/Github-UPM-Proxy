import type { Env } from "../types";

const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"host",
]);

/**
 * Reverse-proxies every other request (package metadata, tarballs, dist-tags, etc.)
 * straight through to the upstream GitHub npm registry. GitHub already implements the
 * standard npm registry protocol for these, so no transformation is needed - we just
 * swap in the server-side GitHub token so Unity clients don't need their own PAT.
 */
export async function handleProxy(env: Env, request: Request, url: URL): Promise<Response> {
	const upstreamUrl = new URL(env.UPSTREAM_REGISTRY);
	upstreamUrl.pathname = url.pathname;
	upstreamUrl.search = url.search;

	const headers = new Headers();
	for (const [key, value] of request.headers) {
		if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
			headers.set(key, value);
		}
	}
	headers.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);
	headers.set("User-Agent", "github-upm-proxy");

	const upstreamRequest = new Request(upstreamUrl.toString(), {
		method: request.method,
		headers,
		body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
		redirect: "follow",
	});

	return fetch(upstreamRequest);
}
