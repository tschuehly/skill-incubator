# Foundations

This reference records the authorities and practical sources behind `write-for-humans`. Use it
to evaluate or change the skill's principles. The skill remains the source of truth for runtime
behavior.

## Plain-language standard

### ISO 24495-1:2023

[Plain language — Part 1: Governing principles and guidelines](https://www.iso.org/standard/78907.html)
is an international standard for developing plain-language documents. It applies to public and
technical writing. Inspired by that framework, this skill synthesizes four governing qualities:
relevant, findable, understandable, and usable. The public abstract confirms the standard's
scope but does not enumerate its principles.

The standard covers text-first documents. It does not replace accessibility guidance for
digital presentation or interaction.

## Cognitive accessibility

### W3C Cognitive and Learning Disabilities Accessibility Task Force

[Making Content Usable for People with Cognitive and Learning Disabilities](https://www.w3.org/TR/coga-usable/)
is a W3C Working Group Note for web content and applications. It informs these rules:

- use clear, literal language and short, focused blocks;
- make important content visually and structurally findable;
- separate instructions and keep the critical path short;
- state conditions, actions, and results explicitly;
- keep needed information near the task instead of relying on memory;
- limit distractions while retaining enough information to complete the task.

This is supplemental cognitive-accessibility guidance. Following it can improve accessibility,
but it is not required for Web Content Accessibility Guidelines conformance. This skill adopts
selected content principles as broader reader-effort heuristics rather than extending the Note's
authority to every form of prose.

[Cognitive Accessibility User Research](https://www.w3.org/TR/coga-user-research/)
is a preliminary 2015 First Public Working Draft. It reviews early evidence associating some
people with ADHD with working-memory, sequencing, focus, and rapid-response difficulties, and
suggests clarity, concise content, distraction-free presentation, simple consistent steps, and
robust error correction. It also says ADHD is heterogeneous and much technique evidence remains
anecdotal. This skill therefore applies these ideas as reader-effort heuristics, not as claims
about every reader with ADHD.

## Public-sector plain writing

### US Plain Writing Act of 2010

The [enacted law](https://www.govinfo.gov/content/pkg/PLAW-111publ274/pdf/PLAW-111publ274.pdf)
defines plain writing as clear, concise, well-organized writing appropriate to its subject and
intended audience. Its purpose is communication the public can understand and use.

The Act governs covered US federal communications. This skill uses its audience, organization,
understanding, and usability principles more broadly; it does not claim that the Act requires
all writing to be understood on the first reading.

## Workplace accommodation guidance

### Job Accommodation Network

JAN's [ADHD accommodation guidance](https://askjan.org/publications/Disability-Downloads.cfm?action=download&pubid=420955&pubtype=pdf)
and [Workplace Accommodation Toolkit](https://askjan.org/toolkit/index.cfm) provide practical
support for written instructions, checklists, reminders, structured tasks, and documented
accommodation decisions.

JAN provides workplace-accommodation guidance rather than a general writing standard. This
skill infers writing practices only where they reduce reader effort without assuming a diagnosis.

## Agent-output practice

### `i-have-adhd`

The community [`i-have-adhd` skill](https://github.com/ayghri/i-have-adhd/blob/main/skills/i-have-adhd/SKILL.md)
demonstrates action-first agent output, bounded numbered steps, concrete next actions, visible
progress, restored state across turns, separated tangents, matter-of-fact error reporting,
ranked short lists, and a pre-send deletion pass over preamble, recaps, closers, and sidebars.

These are practical patterns rather than standards, and this skill adopts them as concrete
rules: the deletion pass in step 3, the error-reporting, step-count, list-ranking, state-naming,
and tangent rules in step 2. Two adaptations keep the skill's own constraints: leading depends
on the text type (questions lead with answers, completed work with outcomes, instructions with
actions), and estimates appear only when evidence supports them, then in concrete units with
stated assumptions.
