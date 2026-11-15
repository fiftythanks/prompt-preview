import { Lexer } from "@oh-my-pi/pi-utils/marked";

interface Span { start: number; end: number; quote?: boolean }
interface Token { type: string; raw: string; tokens?: Token[]; items?: Token[]; header?: { tokens: Token[] }[]; rows?: { tokens: Token[] }[][] }

/** Map Markdown tokens back to the exact UTF-16 draft; uncertain blocks are protected. */
export function protectedText(draft: string): Span[] {
  let normalized = "";
  const boundaries = [0];
  for (let i = 0; i < draft.length; i++) {
    const ch = draft[i];
    if (ch === "\r") {
      if (draft[i + 1] === "\n") i++;
      normalized += "\n"; boundaries.push(i + 1);
    } else if (ch === "\t") {
      normalized += "    ";
      boundaries.push(i, i, i, i + 1);
    } else { normalized += ch; boundaries.push(i + 1); }
  }
  const spans: Span[] = [];
  const add = (start: number, end: number, quote = false) => spans.push({ start: boundaries[start], end: boundaries[end], quote });
  const walk = (token: Token, start: number, end: number) => {
    if (["code", "codespan", "html", "def"].includes(token.type)) { add(start, end); return; }
    if (token.type === "link" || token.type === "image") {
      const raw = normalized.slice(start, end);
      const marker = raw.lastIndexOf("](");
      if (marker < 0) { add(start, end); return; }
      add(start + marker + 1, end);
    }
    const groups: Token[][] = [];
    if (token.tokens) groups.push(token.tokens);
    if (token.items) groups.push(token.items);
    if (token.header) groups.push(...token.header.map(cell => cell.tokens));
    if (token.rows) for (const row of token.rows) groups.push(...row.map(cell => cell.tokens));
    let cursor = start;
    for (const group of groups) for (const child of group) {
      if (!child.raw) continue;
      const at = normalized.indexOf(child.raw, cursor);
      if (at < 0 || at + child.raw.length > end) {
        // Only ambiguous blocks containing protected syntax need blanket protection.
        if (/[`<>]|\]\(|(?:https?:\/\/)|(?:^|\s)[~/]|(?:^|\s)--[\w-]+/.test(normalized.slice(start, end))) add(start, end);
        return;
      }
      walk(child, at, at + child.raw.length);
      cursor = at + child.raw.length;
    }
  };
  let cursor = 0;
  for (const token of Lexer.lex(draft) as Token[]) {
    const at = normalized.indexOf(token.raw, cursor);
    if (at < 0 || /\S/.test(normalized.slice(cursor, at))) throw new Error("Cannot map Markdown tokens to the reviewed draft");
    walk(token, at, at + token.raw.length);
    cursor = at + token.raw.length;
  }
  if (/\S/.test(normalized.slice(cursor))) throw new Error("Cannot map Markdown tokens to the reviewed draft");

  // Bare machine-oriented text is not always recognised as Markdown.
  const lexical = /(?:https?:\/\/|www\.)[^\s<>]+|(?:^|(?<=\s))(?:\.{1,2}\/|~\/|\/)[^\s]+|\b[\w.-]+\/[\w./-]+|(?:^|(?<=\s))--?[\w][\w-]*|\b(?:[A-Za-z][\w]*_[\w]+|[a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z]+\d+[A-Za-z0-9]*)\b/gmu;
  for (const match of draft.matchAll(lexical)) spans.push({ start: match.index!, end: match.index! + match[0].length });
  // Apostrophes inside words are not opening or closing quotation marks.
  const quotes = /“[^”\n]*”|‘[^’\n]*’|"[^"\n]*"|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu;
  for (const match of draft.matchAll(quotes)) spans.push({ start: match.index!, end: match.index! + match[0].length, quote: true });
  return spans;
}

export function touchesProtected(spans: Span[], start: number, end: number, quoteDelimiter = false): boolean {
  return spans.some(span => {
    if (quoteDelimiter && span.quote && end === start + 1 && (start === span.start || end === span.end)) return false;
    return start === end ? start >= span.start && start <= span.end : start < span.end && end > span.start;
  });
}
