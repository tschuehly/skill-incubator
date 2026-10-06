# Writing — what every sentence on a Surface must do

Every sentence is about the subject. Write the finding, not the process: current facts, the
recommendation, and what the human must judge.

- **Open with what it's about, in plain words.** One or two everyday sentences state the subject,
  the current finding, and the decision the human owns; the material follows directly.
- **Less up front, nothing lost.** Each Region opens with one or two sentences the human can judge
  from. Details, receipts, exact conditions, and file names stay in the same Region behind a
  `<details>` or in a drill-down — never deleted to make the page shorter. Cut only repetition and
  sentences about the page itself. *Defect:* "far too much text" (variant C) and "is that really
  important?" on a receipts line (A) asked for less up front; a word budget instead made the
  2026-10-06 pipeline trial drop what each gate proves.
- **Every sentence stays true with the layout removed.** Read each sentence as plain text in a
  chat and keep only sentences about the subject. Carry the meaning in the material itself: label
  the box "Gate: lint", title the list "Unverified: paste, drag-and-drop", name the rule you mean. A
  sentence that only makes sense on this page — a legend, a reading direction, a pointer, a note
  about the page's status — is meta commentary; delete it. The lint's `PROSE` gate lists the
  sentences it suspects.
- **Show the source being judged.** Quote the passage, clause, rule, or diff hunk verbatim and
  anchor the Thread or Proposal to that quote, so the question sits on its evidence. Your analysis
  sits beside it, shorter than it.
- **Every reference opens.** Make each file, commit, issue, pull request, and URL a link — a commit
  or issue to its page on the forge, a local file to its path on the Surface server.
- **Each fact appears once.** Put a real gap — something missing, unproven, or not yet active — in
  one sentence on the one item where it changes the human's judgment.
- **Define before use.** Terms, symbols, and option names are explained before or beside the first
  control that needs them; a question, its recommendation, its alternatives, their consequences,
  and its controls form one visible unit. Write so the human can act without the session
  transcript or an unexplained label; that is an authoring outcome, not a separate reading pass.
  Apply the `write-for-humans` skill to all visible copy.
- **Write the page language natively.** Write German as German, not translated English, and set
  `<html lang>` to it so kernel and block labels match. *Defect:* German that "sounds odd" (variants
  A, B, 2026-10-06). The lint fails a German page under `lang="en"` and the reverse (`LANG`).
- **Each option carries its own reasons.** Write an option's for and against inside it, in
  `<atelier-decision>` and in the Proposal; nothing about an option sits in an element below the
  question. *Defect:* variant D put the options' table under the decision, so the answer and its
  reasons were apart. The lint warns on a table, list or `<details>` right after a decision
  (`DECISION_CONTEXT`).
