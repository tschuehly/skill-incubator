# Finding contract

The overlay accepts either a JSON array or `{ "findings": [...] }`.

## Required fields

```json
{
  "id": "FLOW-02",
  "severity": "P1",
  "title": "Partial success is reported as failure",
  "body": "Saved state and notification outcome need separate feedback.",
  "anchor": {
    "selector": "[data-testid='fulfillment-notification-status']",
    "placement": "edge-right"
  }
}
```

- `id`: stable review identifier, unique in the file.
- `severity`: `P0`, `P1`, `P2`, or `P3`.
- `title`: short diagnosis.
- `body`: impact plus concrete direction.
- `anchor.selector`: CSS selector for the narrowest element containing the evidence.

## Optional fields

```json
{
  "number": 8,
  "status": "resolved",
  "evidence": "AdminFulfillmentTest: tracking save succeeds while email failure is shown separately.",
  "anchor": {
    "contextSelector": "#admin-dashboard-modal .modal-box",
    "contextHeading": "Tracking",
    "selector": "form[data-testid='tracking-form']",
    "placement": "top-right"
  }
}
```

- `number`: explicit display number; defaults to file order.
- `status`: `open`, `changed`, or `resolved`; defaults to `open`.
- `evidence`: after-state verification shown in the expanded bubble.
- `anchor.contextSelector`: limits lookup to a dynamic context such as the visible modal.
- `anchor.contextHeading`: selects the context whose first `h1`, `h2`, or `h3` exactly matches.
- `anchor.placement`: `top-right`, `top-left`, `edge-right`, or `edge-left`; defaults to
  `edge-right`.

When `contextSelector` is present, `selector` is resolved inside that context. Use `:scope` to anchor
to the context itself.

## Anchoring rules

1. Prefer stable semantic selectors over classes encoding presentation.
2. Anchor to the specific status, action, field, or section the finding describes.
3. Give every finding its own record even when several share an anchor; bubbles stack automatically.
4. Use context matching for swapped modals rather than positional selectors against the whole page.
5. Keep unresolved findings unresolved until the correct selector exists. A generic fallback makes the
   visual evidence misleading.
6. Finding text is review-authored data. The runtime inserts it with `textContent`; rendered page
   content is never copied into executable markup.

See [`example-findings.json`](example-findings.json) for open and resolved examples.
