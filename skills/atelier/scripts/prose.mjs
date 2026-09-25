// Prose gate — finds sentences about the Surface itself instead of its subject.
//
// Each rule names one family of self-description. The families are deliberately narrow: a zero
// count means no known pattern matched, not that the page is free of meta commentary.
export const RULES = [
  ['self-reference', /\bthis (page|surface|view|section|atelier)\b/i],
  ['structure-announcement', /^(each|every) (claims?|questions?|sections?|decisions?|cards?|regions?|proposals?|threads?|parts?|entry|entries|items?|fix|fixes) (carries|carry|has|have|shows?|holds?|lists?|ends?|comes?|sits?|gets?|contains?)\b/i],
  ['structure-announcement', /^for (each|every) (claim|question|section|decision|fix|card|part|item)\b/i],
  ['structure-announcement', /^(one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d+) (open )?(questions?|decisions?|claims?|gaps?|sections?|proposals?|items?)\b[^.]{0,60}\b(first|open|below|above|follow|stand|await|remain)\b/i],
  ['reading-order', /\b(most|least) (dangerous|important|urgent|risky|critical) first\b|\bin order of (risk|danger|importance|urgency)\b/i],
  ['reading-order', /^(start|begin) (with|here|by)\b/i],
  ['legend', /\b(green|red|grey|gray|amber|yellow|blue|orange|purple|dashed|dotted|solid|bold|struck|highlighted|shaded)\b(\s+[\w-]+){0,2}\s+(box(es)?|hexagons?|nodes?|arrows?|lines?|edges?|circles?|rows?|cells?|borders?|badges?|text|dots?|shapes?|outlines?|chips?)\s+(are|is|mean|means|mark|marks|show|shows|indicate|indicates)\b/i],
  ['pointer', /\bsee (the )?(gaps?|steps?|sections?|questions?|stages?|claims?|below|above|margin|diagram|table|appendix)\b|\b(shown|listed|described|explained) (below|above)\b/i],
  ['commenting-instructions', /\bhow to (read|comment|use|review)\b|\b(select|highlight) (any |a |the )?(text|sentence|word|passage|line)\b|\b(open|start) a thread\b|\bin the (margin|drawer)\b|\balt\+click\b/i],
  ['page-status', /\bproposed,? not active\b|\bnone of the proposed\b|\b(is|are) shown as\b|\bnothing (here|shown) is (active|applied|live)\b/i],
];

export const REPAIR = 'State the subject\'s fact, risk, evidence, recommendation, or decision directly, and delete '
  + 'what describes this page: its organization, order, legend, pointers, status, or how to comment. Name the '
  + 'feature a status applies to. Put source text you quote in <q> or <blockquote>, and steps for an interface '
  + 'that is itself under review in an element marked data-subject-ui. Change no facts, links, controls, or Region keys.';

export const sentencesOf = (text) => text.replace(/\s+/g, ' ').trim()
  .split(/(?<=[.!?:])\s+(?=[A-Z0-9"“(])/).map(s => s.trim()).filter(s => /\w/.test(s));

// blocks: [{ region, text }] — each block's own prose. Returns one finding per offending sentence.
export function metaFindings(blocks){
  const findings = [], seen = new Set();
  for (const { region, text } of blocks) for (const sentence of sentencesOf(text)) {
    const hit = RULES.find(([, re]) => re.test(sentence));
    if (!hit || seen.has(region + sentence)) continue;
    seen.add(region + sentence);
    findings.push({ rule: hit[0], region, sentence });
  }
  return findings;
}
