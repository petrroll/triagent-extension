// Fetches triagent status with the user's triagent session cookie. The service worker has a host permission
// for triagent.pi.dev, so CORS does not apply and Chrome treats the request as same-site (the SameSite=Lax
// session cookie is sent).
const BASE = "https://triagent.pi.dev";
const ITEM_PATH = /^\/earendil-works\/pi\/(?:issues|pull)\/(\d+)/;
const CACHE_MS = 30_000;
const cache = new Map(); // number -> { at, value }

const triagentUrl = (number) => (number ? `${BASE}/issues/${number}` : `${BASE}/`);

async function status(number, fresh) {
	const hit = cache.get(number);
	if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
	let value;
	try {
		const res = await fetch(`${BASE}/api/issue?number=${number}`, {
			credentials: "include",
			redirect: "manual",
			cache: "no-store",
		});
		if (res.status === 401 || res.type === "opaqueredirect") value = { state: "logged-out" };
		else if (res.status === 404) value = { state: "unknown" };
		else if (!res.ok) value = { state: "error", error: `HTTP ${res.status}` };
		else value = { state: "ok", item: summarize(await res.json()) };
	} catch (error) {
		value = { state: "error", error: String(error) };
	}
	cache.set(number, { at: Date.now(), value });
	return value;
}

/** Only what the badge shows: /api/issue also returns the body, comments, and report. */
function summarize(item) {
	const r = item.research;
	const result = r?.result;
	return {
		decision: item.decision && { priority: item.decision.priority, by: item.decision.by ?? null, at: item.decision.at },
		research: r && {
			status: r.status,
			error: r.error ?? null,
			activity: r.activity ?? null, // "run" | "answer" | null
			fix: r.fix?.kind ?? null,
		},
		result: result && {
			suggestion: result.suggestion,
			category: result.category,
			confidence: result.confidence,
			kind: result.kind,
			valid: result.valid,
			reproduced: result.reproduced,
			summary: result.summary,
			reason: result.reason,
			duplicates: (result.duplicates ?? []).filter((d) => d.kind === "duplicate").map((d) => d.number),
		},
		fixPr: item.fixPr ?? null,
		suggestedAction: item.suggestedAction ?? null,
		labels: item.labels ?? [],
	};
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
	if (msg?.type === "status") {
		status(msg.number, msg.fresh).then(reply);
		return true; // async reply
	}
	if (msg?.type === "open") {
		chrome.tabs.create({ url: triagentUrl(msg.number) });
	}
});

// Toolbar button / Alt+Shift+T: open the current issue (or triagent itself elsewhere).
chrome.action.onClicked.addListener((tab) => {
	let number = null;
	try {
		const url = new URL(tab.url ?? "");
		if (url.hostname === "github.com") number = ITEM_PATH.exec(url.pathname)?.[1] ?? null;
	} catch {}
	chrome.tabs.create({ url: triagentUrl(number), index: tab.index + 1 });
});
