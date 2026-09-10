(() => {
  const API_NAME = "contextualAnnotations";
  const ROOT_ID = "contextual-annotations-root";
  const STYLE_ID = "contextual-annotations-style";
  const VALID_PLACEMENTS = new Set(["top-right", "top-left", "edge-right", "edge-left"]);
  let findings = [];
  let anchors = new Map();
  let unresolved = [];
  let observer = null;
  let refreshTimer = null;
  let returnFocus = null;

  const existing = window[API_NAME];
  if (existing?.reset) existing.reset();

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{position:fixed;inset:0;z-index:2147483646;pointer-events:none;font:13px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #${ROOT_ID} *{box-sizing:border-box}
      .ca-target{outline:2px solid rgba(249,112,102,.72)!important;outline-offset:3px!important}
      .ca-bubble{position:fixed;width:30px;height:30px;display:grid;place-items:center;border-radius:999px;border:2px solid #fff;background:#f97066;color:#211512;box-shadow:0 5px 16px rgba(0,0,0,.30);font:800 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer;pointer-events:auto;transition:transform 140ms ease,box-shadow 140ms ease}
      .ca-bubble[data-status="changed"]{background:#78a9e6}
      .ca-bubble[data-status="resolved"]{background:#63c697}
      .ca-bubble:hover,.ca-bubble:focus-visible{transform:scale(1.13);box-shadow:0 8px 22px rgba(0,0,0,.4);outline:3px solid rgba(249,112,102,.28);outline-offset:2px}
      .ca-popover{display:none;position:fixed;width:min(360px,calc(100vw - 24px));max-height:min(70vh,620px);overflow:auto;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:#171311;color:#fff;box-shadow:0 20px 60px rgba(0,0,0,.42);padding:14px;pointer-events:auto}
      .ca-popover[data-open="true"]{display:block}
      .ca-close{position:absolute;right:10px;top:10px;width:28px;height:28px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:#2b2421;color:#fff;font-size:19px;line-height:1;cursor:pointer}
      .ca-meta{display:flex;align-items:center;gap:8px;padding-right:34px;color:#fda09a;font:800 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
      .ca-severity,.ca-status{padding:3px 7px;border-radius:999px;color:#211512;background:#f97066}
      .ca-status{background:#eee4df}.ca-status[data-status="changed"]{background:#78a9e6}.ca-status[data-status="resolved"]{background:#63c697}
      .ca-title{margin:9px 30px 6px 0;color:#fff;font-size:16px;line-height:1.25;font-weight:750}
      .ca-body,.ca-evidence{margin:0;color:rgba(255,255,255,.74);font-size:13px;line-height:1.5}
      .ca-evidence{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.88)}
      .ca-evidence strong{color:#8ee0b5}
      @media (prefers-reduced-motion:reduce){.ca-bubble{transition:none}}
    `;
    document.head.appendChild(style);
  }

  function root() {
    let node = document.getElementById(ROOT_ID);
    if (node) return node;
    node = document.createElement("div");
    node.id = ROOT_ID;
    node.setAttribute("aria-label", "Contextual review annotations");
    const popover = document.createElement("section");
    popover.className = "ca-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-modal", "false");
    popover.setAttribute("aria-label", "Review finding");
    node.appendChild(popover);
    document.body.appendChild(node);
    return node;
  }

  function visible(element) {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function contextFor(anchor) {
    if (!anchor.contextSelector) return document;
    const candidates = [...document.querySelectorAll(anchor.contextSelector)].filter(visible);
    if (!anchor.contextHeading) return candidates.at(-1) ?? null;
    return candidates.find((candidate) => {
      const heading = candidate.querySelector("h1,h2,h3");
      return heading?.textContent?.trim() === anchor.contextHeading;
    }) ?? null;
  }

  function resolveAnchor(finding) {
    try {
      const context = contextFor(finding.anchor);
      if (!context) return null;
      if (finding.anchor.selector === ":scope") return context === document ? document.documentElement : context;
      const matches = [...context.querySelectorAll(finding.anchor.selector)];
      return matches.find(visible) ?? matches.at(-1) ?? null;
    } catch {
      return null;
    }
  }

  function normalized(raw) {
    if (!Array.isArray(raw)) throw new Error("contextualAnnotations.mount expects an array");
    return raw.map((finding, index) => ({
      ...finding,
      number: finding.number ?? index + 1,
      status: finding.status ?? "open",
      anchor: { placement: "edge-right", ...finding.anchor }
    }));
  }

  function validate(raw) {
    const ids = new Set();
    raw.forEach((finding, index) => {
      if (!finding || typeof finding !== "object") throw new Error(`findings[${index}] must be an object`);
      for (const field of ["id", "severity", "title", "body"]) {
        if (typeof finding[field] !== "string" || !finding[field].trim()) {
          throw new Error(`findings[${index}].${field} must be a non-empty string`);
        }
      }
      if (ids.has(finding.id)) throw new Error(`duplicate finding id: ${finding.id}`);
      ids.add(finding.id);
      if (!finding.anchor || typeof finding.anchor.selector !== "string") {
        throw new Error(`findings[${index}].anchor.selector is required`);
      }
      if (!VALID_PLACEMENTS.has(finding.anchor.placement ?? "edge-right")) {
        throw new Error(`findings[${index}] has an invalid placement`);
      }
    });
  }

  function closePopover() {
    const popover = document.querySelector(`#${ROOT_ID} .ca-popover`);
    if (!popover) return;
    popover.dataset.open = "false";
    popover.replaceChildren();
    returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function textElement(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  }

  function openPopover(button, finding) {
    const popover = document.querySelector(`#${ROOT_ID} .ca-popover`);
    popover.replaceChildren();
    returnFocus = button;

    const close = textElement("button", "ca-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close annotation");
    close.addEventListener("click", closePopover);

    const meta = document.createElement("div");
    meta.className = "ca-meta";
    meta.append(
      textElement("span", "ca-id", `${finding.number} · ${finding.id}`),
      textElement("strong", "ca-severity", finding.severity),
      textElement("span", "ca-status", finding.status)
    );
    meta.querySelector(".ca-status").dataset.status = finding.status;

    popover.append(
      close,
      meta,
      textElement("h3", "ca-title", finding.title),
      textElement("p", "ca-body", finding.body)
    );
    if (finding.evidence) {
      const evidence = document.createElement("p");
      evidence.className = "ca-evidence";
      evidence.append(textElement("strong", "", "Evidence: "), document.createTextNode(finding.evidence));
      popover.appendChild(evidence);
    }

    popover.dataset.open = "true";
    positionPopover(button, popover);
    close.focus({ preventScroll: true });
  }

  function positionPopover(button, popover) {
    const rect = button.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(360, innerWidth - margin * 2);
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(margin, Math.min(innerWidth - width - margin, rect.left + rect.width / 2 - width / 2))}px`;
    const height = Math.min(popover.scrollHeight || 260, innerHeight * 0.7);
    const below = rect.bottom + 10;
    popover.style.top = `${below + height <= innerHeight - margin ? below : Math.max(margin, rect.top - height - 10)}px`;
  }

  function bubblePosition(rect, placement, stack) {
    const step = stack * 34;
    switch (placement) {
      case "top-left": return { left: rect.left + 8 + step, top: rect.top + 8 };
      case "top-right": return { left: rect.right - 38 - step, top: rect.top + 8 };
      case "edge-left": return { left: rect.left - 15, top: rect.top + 8 + step };
      default: return { left: rect.right - 15, top: rect.top + 8 + step };
    }
  }

  function positionBubbles() {
    const stacks = new Map();
    for (const [id, entry] of anchors) {
      const button = document.querySelector(`#${ROOT_ID} .ca-bubble[data-id="${CSS.escape(id)}"]`);
      if (!button || !entry.target.isConnected) continue;
      const rect = entry.target.getBoundingClientRect();
      const outside = rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth;
      button.hidden = outside;
      if (outside) continue;
      const targetStacks = stacks.get(entry.target) ?? new Map();
      stacks.set(entry.target, targetStacks);
      const stack = targetStacks.get(entry.finding.anchor.placement) ?? 0;
      targetStacks.set(entry.finding.anchor.placement, stack + 1);
      const point = bubblePosition(rect, entry.finding.anchor.placement, stack);
      button.style.left = `${Math.max(4, Math.min(innerWidth - 34, point.left))}px`;
      button.style.top = `${Math.max(4, Math.min(innerHeight - 34, point.top))}px`;
    }
  }

  function render() {
    observer?.disconnect();
    const overlay = root();
    overlay.querySelectorAll(".ca-bubble").forEach((element) => element.remove());
    document.querySelectorAll(".ca-target").forEach((element) => element.classList.remove("ca-target"));
    anchors = new Map();
    unresolved = [];

    for (const finding of findings) {
      const target = resolveAnchor(finding);
      if (!target) {
        unresolved.push(finding.id);
        continue;
      }
      target.classList.add("ca-target");
      const button = textElement("button", "ca-bubble", String(finding.number));
      button.type = "button";
      button.dataset.id = finding.id;
      button.dataset.status = finding.status;
      button.title = `${finding.id}: ${finding.title}`;
      button.setAttribute("aria-label", `Finding ${finding.number}: ${finding.title}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        openPopover(button, finding);
      });
      overlay.appendChild(button);
      anchors.set(finding.id, { finding, target });
    }

    positionBubbles();
    observer?.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(render, 50);
  }

  function mount(raw) {
    const next = normalized(raw);
    validate(next);
    reset();
    findings = next;
    addStyle();
    root();
    observer = new MutationObserver((records) => {
      const overlay = document.getElementById(ROOT_ID);
      if (records.some((record) => !overlay?.contains(record.target))) scheduleRefresh();
    });
    document.addEventListener("htmx:afterSwap", scheduleRefresh);
    addEventListener("scroll", positionBubbles, { passive: true });
    addEventListener("resize", positionBubbles);
    document.addEventListener("keydown", onKeydown);
    render();
    return report();
  }

  function onKeydown(event) {
    if (event.key === "Escape") closePopover();
  }

  function report() {
    return {
      total: findings.length,
      mounted: anchors.size,
      unresolved: [...unresolved],
      findings: findings.map(({ id, number, status }) => ({
        id,
        number,
        status,
        mounted: anchors.has(id)
      }))
    };
  }

  function reset() {
    clearTimeout(refreshTimer);
    observer?.disconnect();
    observer = null;
    document.removeEventListener("htmx:afterSwap", scheduleRefresh);
    removeEventListener("scroll", positionBubbles);
    removeEventListener("resize", positionBubbles);
    document.removeEventListener("keydown", onKeydown);
    document.querySelectorAll(".ca-target").forEach((element) => element.classList.remove("ca-target"));
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    findings = [];
    anchors = new Map();
    unresolved = [];
    returnFocus = null;
  }

  window[API_NAME] = { mount, refresh: render, report, reset };
  return { installed: true, api: API_NAME };
})();
