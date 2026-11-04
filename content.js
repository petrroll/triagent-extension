// Adds a "Triagent" button with status to earendil-works/pi issue and PR pages.
// GitHub is a single-page app that re-renders its header, so the button is re-attached when the URL changes or
// the header replaces it.
(() => {
	const ITEM_PATH = /^\/earendil-works\/pi\/(?:issues|pull)\/(\d+)(?:\/|$)/;
	// Places in the header to put the button, tried in order; otherwise it floats at the bottom right.
	const ANCHORS = [
		'[data-component="PH_Actions"]', // new issues view (Primer PageHeader actions)
		'[data-testid="issue-header"] [data-component="PH_Actions"]',
		".gh-header-actions", // PRs and the classic issue view
	];
	const POLL_MS = 15_000; // while research runs

	let number = null;
	let button = null;
	let status = null;
	let pollTimer = null;

	function currentNumber() {
		return ITEM_PATH.exec(location.pathname)?.[1] ?? null;
	}

	function make() {
		const el = document.createElement("a");
		el.className = "triagent-btn";
		el.href = `https://triagent.pi.dev/issues/${number}`;
		el.target = "_blank";
		el.rel = "noopener";
		el.innerHTML = '<span class="triagent-dot"></span><span class="triagent-label">Triagent</span><span class="triagent-status"></span>';
		el.addEventListener("click", (event) => {
			// Let the background open it, so it works even where GitHub intercepts link clicks.
			if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
				event.preventDefault();
				chrome.runtime.sendMessage({ type: "open", number });
				// Coming back after logging in or deciding should show the new status.
				setTimeout(() => refresh(true), 1000);
			}
		});
		return el;
	}

	function place() {
		if (!number) return;
		if (!button) button = make();
		const anchor = ANCHORS.map((s) => document.querySelector(s)).find(Boolean);
		if (anchor) {
			if (button.parentElement !== anchor) anchor.prepend(button);
			button.classList.remove("triagent-floating");
		} else if (!button.isConnected || !button.classList.contains("triagent-floating")) {
			button.classList.add("triagent-floating");
			document.body.append(button);
		}
		render();
	}

	function render() {
		if (!button) return;
		const { text, tone, title } = describe(status);
		button.dataset.tone = tone;
		button.querySelector(".triagent-status").textContent = text;
		button.title = title;
	}

	function describe(s) {
		if (!s) return { text: "…", tone: "muted", title: "Loading triagent status…" };
		if (s.state === "logged-out") return { text: "log in", tone: "muted", title: "Log in to triagent to see its status" };
		if (s.state === "unknown") return { text: "not synced", tone: "muted", title: "Not in triagent's copy of the issues yet" };
		if (s.state === "error") return { text: "?", tone: "muted", title: `Could not reach triagent: ${s.error}` };
		const it = s.item;
		const r = it.research;
		const res = it.result;
		const lines = [];
		if (res) {
			lines.push(`${res.kind} · ${res.category} (${res.confidence}) · valid: ${res.valid} · reproduced: ${res.reproduced}`);
			lines.push(`Suggests ${res.suggestion}: ${res.reason}`);
			if (res.duplicates.length) lines.push(`Duplicate of ${res.duplicates.map((n) => `#${n}`).join(", ")}`);
			lines.push("", res.summary);
		}
		if (it.suggestedAction) lines.push("", `Suggested action: ${it.suggestedAction.replace(/_/g, " ")}`);
		if (it.fixPr) lines.push(`Fix PR: ${it.fixPr.url ?? `#${it.fixPr.number}`}`);
		else if (r?.fix === "ready") lines.push("Fix ready to open as PR");
		const title = lines.join("\n") || "Open in triagent";

		if (it.decision?.priority) {
			const by = it.decision.by ? ` by ${it.decision.by}` : "";
			return { text: `✓ ${it.decision.priority}`, tone: "done", title: `Decided ${it.decision.priority}${by}\n\n${title}` };
		}
		if (!r) return { text: "not researched", tone: "muted", title };
		if (r.status === "queued") return { text: "queued", tone: "busy", title };
		if (r.status === "running" || r.activity === "run") return { text: "researching…", tone: "busy", title };
		if (r.status === "failed" || r.status === "stopped")
			return { text: `research ${r.status}`, tone: "bad", title: r.error ? `${r.error}\n\n${title}` : title };
		if (!res) return { text: r.status, tone: "muted", title };
		if (r.activity === "answer") return { text: "answering chat…", tone: "busy", title };
		const extra = it.fixPr ? " · PR" : r.fix === "ready" ? " · fix" : "";
		return { text: `${res.suggestion} · ${res.category}${extra}`, tone: res.suggestion === "p0" ? "hot" : "ok", title };
	}

	async function refresh(fresh = false) {
		const asked = number;
		if (!asked) return;
		let s;
		try {
			s = await chrome.runtime.sendMessage({ type: "status", number: Number(asked), fresh });
		} catch {
			return; // extension reloaded; this content script is orphaned
		}
		if (asked !== number) return;
		status = s;
		render();
		clearTimeout(pollTimer);
		const r = s?.item?.research;
		if (r && (r.status === "queued" || r.status === "running" || r.activity)) {
			pollTimer = setTimeout(() => refresh(true), POLL_MS);
		}
	}

	function check() {
		const next = currentNumber();
		if (next !== number) {
			number = next;
			status = null;
			clearTimeout(pollTimer);
			if (button) button.remove();
			button = null;
			if (number) {
				place();
				refresh();
			}
		} else if (number && (!button?.isConnected || button.classList.contains("triagent-floating"))) {
			place(); // GitHub re-rendered the header, or it appeared after we floated
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
		if (document.visibilityState === "visible") refresh(true);
	});
	check();
})();
