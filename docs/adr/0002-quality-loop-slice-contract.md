# quality-loop: Chapters are behavior-defined and feedback-bounded

A Chapter is one coherent behavior cluster, vertical where needed (schema → service → UI →
tests), and independently testable. Reviewability is feedback-driven: a Chapter that cannot
complete RED→GREEN coherently or cannot be understood by its reviewers is split.

The workflow has no universal line-count limit. A project or approved Run may configure an
explicit numeric budget with exclusions; otherwise reviewer judgment governs change size.
Criticality scales verification depth—mutation testing, reviewer effort, and security review—not
the permitted number of lines.
