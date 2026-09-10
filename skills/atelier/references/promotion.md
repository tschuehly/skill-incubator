# From Atelier to a durable Studio

A copied Atelier is the default. Promote it only when durability would remove recurring work rather
than freeze an experiment.

## Evidence that favors promotion

- The same domain objects and relationships recur across sessions.
- Human actions have stable meanings and side effects.
- Discovery, rendering, or verification repeats enough that automation improves the work itself.
- Historical state is useful beyond one review record.
- A known owner will maintain the interface and its data migrations.

## Evidence that favors staying lightweight

- The task shape or vocabulary is still changing.
- Reuse is mostly visual rather than behavioral.
- The surface reads one generated artifact and emits ordinary feedback.
- Bespoke HTML remains faster than maintaining application state and compatibility.

## Promotion move

Keep the proven task presentation and interaction semantics. Replace copied data with a domain-owned
source, add only the recurring actions and checks, and give the Studio its own tests and lifecycle.
Do not turn Atelier itself into the Studio framework. Existing Studios and Video
Review Studio are references for durable domain tools, not mandatory templates.
