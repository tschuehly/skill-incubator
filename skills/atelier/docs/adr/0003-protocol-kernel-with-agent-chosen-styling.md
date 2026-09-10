# Protocol kernel, agent-chosen styling

The seed shipped a fixed renderer that owned both protocol behavior and content layout, so
"customize the surface" meant editing 1280 lines of someone else's renderer. The kernel now ships
only identity, durable state, the event loop, and behavior as light-DOM custom elements; the agent
authors all content markup and picks its own CSS library per Surface.

## Consequences

- Kernel chrome (Threads, Attention markers, Cockpit, comment sheet) is self-styled under an
  `.atl-*` class scope and never relies on bare-tag styling, so it survives any content library and
  cannot be broken by a classless framework styling `<button>` globally.
- Content library is the Tailwind v4 browser build plus daisyUI 5 over CDN: utilities are always
  available and components are optional, so the agent can reach for either without a second
  vocabulary. Verified safe for runtime Region swapping — the browser build watches
  `document.documentElement` with a `MutationObserver` and rebuilds incrementally for inserted
  nodes.
- The browser build is documented as development-only and flashes unstyled content on first paint.
  Accepted: a Surface is a local tool, never deployed, and kernel chrome is immune because it
  carries its own styles.
- Compositions previously shipped as framework — nav, cockpit layout, card chrome — become copyable
  examples. A lazy invocation can therefore produce a plainer surface than the old seed did; that
  cost is accepted in exchange for the agent being able to author any layout without forking
  behavior.
