// Triagent status on GitHub:
// - issue / PR page of earendil-works/pi: a "Triagent" button with status pills in the header;
// - any list of issues or PRs (repo issue/PR lists, github.com/issues, dashboards): status pills after each
//   earendil-works/pi title, which open the item in triagent.
// GitHub is a single-page app that re-renders freely, so everything is re-attached on DOM changes.
(() => {
	const BASE = "https://triagent.pi.dev";
	const ITEM_PAGE = /^\/earendil-works\/pi\/(?:issues|pull)\/(\d+)(?:\/|$)/;
	const ITEM_LINK = /^\/earendil-works\/pi\/(?:issues|pull)\/(\d+)\/?$/;
	const LINK_SELECTOR = 'a[href*="/earendil-works/pi/issues/"], a[href*="/earendil-works/pi/pull/"]';
	const ROW_SELECTOR = 'li, [role="listitem"], [role="row"], .js-issue-row, .Box-row';
	const HEADER_ANCHORS = ['[data-component="PH_Actions"]', ".gh-header-actions"];
	const POLL_MS = 20_000;
	const REFRESH_MS = 60_000;

	const ICON =
		'<svg class="tg-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 14.5 13H1.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5.2 9.6h5.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

	// ---------- what to show ----------

	const ACTIONS = {
		close_completed: { text: "fixed on main", tone: "success", title: "Research found it fixed on main: close as completed" },
		close_duplicate: { text: "duplicate", tone: "muted", title: "Research found an open duplicate: close as duplicate" },
		close_not_planned: { text: "not planned", tone: "muted", title: "Research suggests closing as not planned" },
		needs_info: { text: "needs info", tone: "attention", title: "Research needs details from the reporter" },
	};
	const PRIO_TONE = { p0: "danger", p1: "attention", none: "muted" };

	/** The pills for an item: [{ text, tone, title }]. */
	function pills(s) {
		if (!s) return [];
		const out = [];
		if (s.kind === "pr") {
			if (s.review === "queued" || s.review === "running") out.push({ text: "reviewing", tone: "busy" });
			else if (s.review === "failed" || s.review === "stopped") out.push({ text: `review ${s.review}`, tone: "danger" });
			else if (s.outcome) out.push({ text: s.outcome.replace(/_/g, " "), tone: "accent", title: "Review outcome" });
			else if (!s.review) out.push({ text: "not reviewed", tone: "muted" });
			if (s.newCommits) out.push({ text: `+${s.newCommits} commits`, tone: "accent", title: "Commits after the review" });
			if (s.unseenComments) out.push(unseenPill(s.unseenComments));
			return out;
		}
		if (s.decision) out.push({ text: `✓ ${s.decision}`, tone: "done", title: `Decided ${s.decision}${s.decidedBy ? ` by ${s.decidedBy}` : ""}` });
		if (s.research === "queued") out.push({ text: "queued", tone: "busy", title: "Research queued" });
		else if (s.research === "running" || s.activity === "run") out.push({ text: "researching", tone: "busy" });
		else if (s.activity === "answer") out.push({ text: "answering", tone: "busy", title: "The agent is answering a chat message" });
		else if (s.research === "failed" || s.research === "stopped")
			out.push({ text: `research ${s.research}`, tone: "danger", title: s.error || "" });
		else if (!s.research) out.push({ text: "not researched", tone: "muted" });
		if (s.suggestion && !s.decision) {
			out.push({
				text: `${s.suggestion}${s.lowConfidence ? "?" : ""}`,
				tone: PRIO_TONE[s.suggestion] ?? "muted",
				title: `Research suggests ${s.suggestion}${s.lowConfidence ? " (low confidence category)" : ""}${s.reason ? `: ${s.reason}` : ""}`,
			});
		}
		if (s.category) out.push({ text: s.category, tone: "neutral", title: "Category" });
		if (s.fix === "ready") out.push({ text: "fix ready", tone: "success", title: "Research made a fix: open the PR in triagent" });
		else if (s.fix === "pr") out.push({ text: "fix PR", tone: "done", title: s.fixPr ? `Fix PR #${s.fixPr.number}` : "A fix PR is open" });
		else if (s.fix === "wanted") out.push({ text: "fixing", tone: "busy", title: "A fix was requested" });
		const action = ACTIONS[s.suggestedAction];
		if (action) out.push(action);
		else if (s.onMain === "fixed") out.push(ACTIONS.close_completed);
		else if (s.duplicate) out.push({ text: "duplicate", tone: "muted", title: "Research found a duplicate" });
		if (s.unseenComments) out.push(unseenPill(s.unseenComments));
		if (s.unseenEdit) out.push({ text: "edited", tone: "accent", title: "Edited after research started" });
		return out;
	}

	const unseenPill = (n) => ({
		text: `${n} new`,
		tone: "accent",
		title: `${n} comment${n === 1 ? "" : "s"} by the reporter or a maintainer after research started`,
	});

	function tooltip(s, reply) {
		if (reply?.state === "logged-out") return "Log in to triagent to see its status";
		if (reply?.state === "error") return `Could not reach triagent: ${reply.error}`;
		if (!s) return reply?.state === "unknown" ? "Not in triagent's copy yet" : "Open in triagent";
		const lines = [];
		if (s.kindOf) {
			lines.push(
				[s.kindOf, s.valid && `valid: ${s.valid}`, s.reproduced && `reproduced: ${s.reproduced}`, s.effort && `effort: ${s.effort}`, s.impact && `impact: ${s.impact}`]
					.filter(Boolean)
					.join(" · "),
			);
		}
		if (s.summary) lines.push("", s.summary);
		if (s.reason) lines.push("", `Why ${s.suggestion}: ${s.reason}`);
		if (s.needsInfo) lines.push("", `Needs info: ${s.needsInfo}`);
		if (s.duplicates?.length) lines.push("", `Duplicate of ${s.duplicates.map((n) => `#${n}`).join(", ")}`);
		if (!lines.length) lines.push(...pills(s).map((p) => (p.title ? `${p.text}: ${p.title}` : p.text)));
		lines.push("", "Click to open in triagent");
		return lines.join("\n");
	}

	// ---------- rendering ----------

	function makeGroup(number, full) {
		const el = document.createElement("a");
		el.className = `tg-group${full ? " tg-full" : ""}`;
		el.dataset.tgNumber = String(number);
		el.href = `${BASE}/issues/${number}`;
		el.target = "_blank";
		el.rel = "noopener";
		el.addEventListener("click", (event) => {
			event.stopPropagation(); // rows are often clickable
			if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
				event.preventDefault();
				chrome.runtime.sendMessage({ type: "open", number });
			}
		});
		return el;
	}

	function fill(el, reply, s) {
		const full = el.classList.contains("tg-full");
		const list = pills(s);
		const loading = !reply;
		const brandText = full ? '<span class="tg-name">Triagent</span>' : "";
		const extra = loading ? "…" : reply.state === "logged-out" ? "log in" : reply.state === "error" ? "?" : "";
		const parts = [`<span class="tg-brand">${ICON}${brandText}${extra && full ? `<span class="tg-extra">${extra}</span>` : ""}</span>`];
		for (const p of list) parts.push(`<span class="tg-pill" data-tone="${p.tone}">${escape(p.text)}</span>`);
		const html = parts.join("");
		if (el.dataset.tgHtml !== html) {
			el.innerHTML = html;
			el.dataset.tgHtml = html;
		}
		el.title = tooltip(s, reply);
		el.classList.toggle("tg-quiet", !full && !list.length);
	}

	const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

	// ---------- state ----------

	let page = null; // number of the issue/PR page, or null on other pages
	let pageReply = null;
	let pageGroup = null;
	let listReply = null; // { state } of the last list request
	const listData = new Map(); // number -> summary | null
	const pending = new Set();
	let batchTimer = null;
	let pollTimer = null;

	const isBusy = (s) =>
		!!s && (s.research === "queued" || s.research === "running" || !!s.activity || s.fix === "wanted" || s.review === "queued" || s.review === "running");

	async function send(msg) {
		try {
			return await chrome.runtime.sendMessage(msg);
		} catch {
			return null; // extension reloaded: this script is orphaned
		}
	}

	// ---------- issue / PR page ----------

	function placePage() {
		if (!pageGroup) pageGroup = makeGroup(page, true);
		const anchor = HEADER_ANCHORS.map((s) => document.querySelector(s)).find(Boolean);
		if (anchor) {
			if (pageGroup.parentElement !== anchor) anchor.prepend(pageGroup);
			pageGroup.classList.remove("tg-floating");
		} else if (!pageGroup.isConnected) {
			pageGroup.classList.add("tg-floating");
			document.body.append(pageGroup);
		}
		fill(pageGroup, pageReply, pageReply?.item);
	}

	async function refreshPage(fresh) {
		const asked = page;
		const reply = await send({ type: "status", number: Number(asked), fresh });
		if (!reply || asked !== page) return;
		pageReply = reply;
		placePage();
		schedulePoll();
	}

	// ---------- lists ----------

	function titleLinks() {
		const found = [];
		const seenRows = new Set();
		for (const a of document.querySelectorAll(LINK_SELECTOR)) {
			if (a.closest(".tg-group")) continue;
			let url;
			try {
				url = new URL(a.href);
			} catch {
				continue;
			}
			const match = url.hostname === "github.com" && !url.hash && ITEM_LINK.exec(url.pathname);
			if (!match) continue;
			const text = a.textContent.trim();
			if (text.length < 3 || /#\d+$/.test(text) || /^\d+$/.test(text)) continue; // "#123", "owner/repo#123", counts
			const row = a.closest(ROW_SELECTOR);
			if (!row || seenRows.has(row)) continue;
			seenRows.add(row);
			found.push({ a, row, number: Number(match[1]) });
		}
		return found;
	}

	function scanList() {
		for (const { a, row, number } of titleLinks()) {
			let group = row.querySelector(`.tg-group[data-tg-number="${number}"]`);
			if (!group) {
				group = makeGroup(number, false);
				a.after(group);
			}
			if (listData.has(number) || (listReply && listReply.state !== "ok")) fill(group, listReply, listData.get(number));
			else {
				fill(group, null, null);
				pending.add(number);
			}
		}
		if (pending.size && !batchTimer) batchTimer = setTimeout(requestBatch, 150);
	}

	async function requestBatch(fresh = false) {
		batchTimer = null;
		const numbers = fresh ? [...new Set([...listData.keys(), ...pending])] : [...pending];
		pending.clear();
		if (!numbers.length) return;
		const reply = await send({ type: "statuses", numbers, fresh });
		if (!reply) return;
		listReply = reply;
		if (reply.state === "ok") for (const n of numbers) listData.set(n, reply.items[n] ?? null);
		for (const group of document.querySelectorAll(".tg-group:not(.tg-full)")) {
			const n = Number(group.dataset.tgNumber);
			fill(group, reply, listData.get(n));
		}
		schedulePoll();
	}

	// ---------- refresh ----------

	function schedulePoll() {
		clearTimeout(pollTimer);
		const busy = page ? isBusy(pageReply?.item) : [...listData.values()].some(isBusy);
		pollTimer = setTimeout(refreshAll, busy ? POLL_MS : REFRESH_MS);
	}

	function refreshAll() {
		if (document.visibilityState !== "visible") return schedulePoll();
		if (page) refreshPage(true);
		else if (listData.size) requestBatch(true);
	}

	function check() {
		const next = ITEM_PAGE.exec(location.pathname)?.[1] ?? null;
		if (next !== page) {
			page = next;
			pageReply = null;
			pageGroup?.remove();
			pageGroup = null;
			clearTimeout(pollTimer);
			if (page) {
				placePage();
				refreshPage(false);
			}
		}
		if (page) {
			if (!pageGroup?.isConnected || pageGroup.classList.contains("tg-floating")) placePage();
		} else {
			scanList();
		}
	}

	let scheduled = false;
	new MutationObserver(() => {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			check();
		});
	}).observe(document.documentElement, { childList: true, subtree: true });
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") refreshAll();
	});
	check();
})();
