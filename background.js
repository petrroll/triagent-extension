// Fetches triagent status with the user's triagent session cookie. The service worker has a host permission
// for triagent.pi.dev, so CORS does not apply and Chromium treats the request as same-site (the SameSite=Lax
// session cookie is sent).
//
// Lists (GitHub issue/PR lists) are served from triagent's own lists, /api/state?list=inbox|open|prs: three requests
// cover every open issue, every issue waiting for review, and every open PR. Anything else (closed issues) and the
// issue page itself use /api/issue?number=N.
const BASE = "https://triagent.pi.dev";
const ITEM_PATH = /^\/earendil-works\/pi\/(?:issues|pull)\/(\d+)/;
const LISTS = { inbox: "issue", open: "issue", prs: "pr" };
const INDEX_MS = 60_000;
const ITEM_MS = 5 * 60_000;
const MAX_LOOKUPS = 40; // per batch, for items not in any list

class LoggedOut extends Error {}

const triagentUrl = (number) => (number ? `${BASE}/issues/${number}` : `${BASE}/`);

async function getJson(path) {
	const res = await fetch(BASE + path, { credentials: "include", redirect: "manual", cache: "no-store" });
	if (res.status === 401 || res.type === "opaqueredirect") throw new LoggedOut();
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

// ---- the lists ----

let index = null; // { at, promise: Promise<Map<number, summary>> }

function getIndex(fresh) {
	if (!fresh && index && Date.now() - index.at < INDEX_MS) return index.promise;
	const promise = (async () => {
		const map = new Map();
		const replies = await Promise.allSettled(
			Object.keys(LISTS).map((list) => getJson(`/api/state?list=${list}`).then((body) => ({ list, body }))),
		);
		for (const reply of replies) {
			if (reply.status === "rejected") {
				if (reply.reason instanceof LoggedOut) throw reply.reason;
				continue; // e.g. a server without that list
			}
			const { list, body } = reply.value;
			for (const row of body?.rows ?? []) {
				map.set(row.number, LISTS[list] === "pr" ? fromPullRow(row, list) : fromIssueRow(row, list));
			}
		}
		return map;
	})();
	index = { at: Date.now(), promise };
	promise.catch(() => {
		if (index?.promise === promise) index = null;
	});
	return promise;
}

function fromIssueRow(row, list) {
	return {
		number: row.number,
		kind: "issue",
		list,
		research: row.research ?? null,
		activity: row.research === "queued" || row.research === "running" ? "run" : null,
		suggestion: row.suggestion ?? null,
		category: row.category || "",
		lowConfidence: !!row.lowConfidence,
		duplicate: !!row.duplicate,
		onMain: row.onMain ?? null,
		fix: row.fix ?? null,
		unseenComments: row.unseenComments ?? 0,
		unseenEdit: !!row.unseenEdit,
		suggestedAction: row.suggestedAction ?? null,
		decision: null, // rows do not carry it; the inbox only has undecided issues
	};
}

function fromPullRow(row, list) {
	return {
		number: row.number,
		kind: "pr",
		list,
		review: row.review ?? null,
		outcome: row.outcome ?? null,
		checks: row.checks ?? null,
		newCommits: row.newCommits ?? 0,
		unseenComments: row.unseenComments ?? 0,
		draft: !!row.draft,
	};
}

// ---- single items ----

const items = new Map(); // number -> { at, promise }

function getItem(number, fresh) {
	const hit = items.get(number);
	if (!fresh && hit && Date.now() - hit.at < ITEM_MS) return hit.promise;
	const promise = getJson(`/api/issue?number=${number}`).then((item) => item && fromItem(item));
	items.set(number, { at: Date.now(), promise });
	promise.catch(() => items.delete(number));
	return promise;
}

function fromItem(item) {
	const r = item.research;
	const result = r?.result;
	return {
		number: item.number,
		kind: "issue",
		list: null,
		open: item.open,
		research: r?.status ?? null,
		activity: r?.activity ?? null, // "run" | "answer" | null
		error: r?.error ?? null,
		suggestion: result?.suggestion ?? null,
		category: item.decision?.category || result?.category || "",
		lowConfidence: result?.confidence === "low",
		duplicate: !!result?.duplicates?.some((d) => d.kind === "duplicate"),
		duplicates: (result?.duplicates ?? []).filter((d) => d.kind === "duplicate").map((d) => d.number),
		onMain: result?.assessment?.onMain ?? null,
		fix: item.fixPr ? "pr" : (r?.fix?.kind ?? null),
		fixPr: item.fixPr ? { url: item.fixPr.url, number: item.fixPr.number } : null,
		unseenComments: (item.comments ?? []).filter((c) => c.unseen).length,
		unseenEdit: !!item.unseenEdit,
		suggestedAction: item.suggestedAction ?? null,
		decision: item.decision?.priority ?? null,
		decidedBy: item.decision?.by ?? null,
		kindOf: result?.kind ?? null,
		valid: result?.valid ?? null,
		reproduced: result?.reproduced ?? null,
		summary: result?.summary ?? "",
		reason: result?.reason ?? "",
		effort: result?.assessment?.effort ?? null,
		impact: result?.assessment?.impact ?? null,
		needsInfo: result?.assessment?.needsInfo ?? "",
	};
}

async function pool(values, size, work) {
	const queue = [...values];
	await Promise.all(
		Array.from({ length: Math.min(size, queue.length) }, async () => {
			while (queue.length) await work(queue.shift());
		}),
	);
}

function failure(error) {
	return error instanceof LoggedOut ? { state: "logged-out" } : { state: "error", error: String(error?.message ?? error) };
}

/** Statuses for a GitHub list page: from triagent's lists, then one by one for the rest. */
async function statuses(numbers, fresh) {
	try {
		const map = await getIndex(fresh);
		const out = {};
		const missing = [];
		for (const n of numbers) {
			if (map.has(n)) out[n] = map.get(n);
			else missing.push(n);
		}
		await pool(missing.slice(0, MAX_LOOKUPS), 4, async (n) => {
			try {
				out[n] = await getItem(n, false);
			} catch (error) {
				if (error instanceof LoggedOut) throw error;
				out[n] = null;
			}
		});
		return { state: "ok", items: out };
	} catch (error) {
		return failure(error);
	}
}

/** Status for the issue or PR page: the full item, or its PR row. */
async function status(number, fresh) {
	try {
		const item = await getItem(number, fresh);
		if (item) return { state: "ok", item };
		const row = (await getIndex(fresh)).get(number);
		return row ? { state: "ok", item: row } : { state: "unknown" };
	} catch (error) {
		return failure(error);
	}
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
	if (msg?.type === "statuses") {
		statuses(msg.numbers, msg.fresh).then(reply);
		return true;
	}
	if (msg?.type === "status") {
		status(msg.number, msg.fresh).then(reply);
		return true;
	}
	if (msg?.type === "open") {
		chrome.tabs.create({ url: triagentUrl(msg.number), active: msg.active !== false });
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
