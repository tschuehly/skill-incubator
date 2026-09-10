# One Region replaces Card and Section

Atelier addressed content through two fixed levels — Card (`item`) and Section (`regionKey`) —
which forced every surface into a two-level shape even when the content had one level or three.
We collapsed both into a single recursive **Region**: the document tree is the hierarchy, a Region
Key is the path of local keys from the root, and the wire address of every Thread, Proposal and
Update is one `region` field.

## Consequences

- The old `item` / `sectionKey` / `decisionId` address fields collapse to `region`. Existing
  `.review/*.json` stores do not load in the new kernel; surfaces that need them keep their own
  vendored copy of the old server.
- Identity is positional, so moving or renaming a Region produces a different Region. A Thread whose
  Region disappears is **archived and visible**, never silently deleted, because losing human review
  input is the worst failure this system has.
- Grouping, navigation and rollup are derived from the DOM tree rather than declared, so the kernel
  no longer needs a content model of its own.
