// Blog articles, from a small Markdown subset to React elements.
//
// Built as elements, never as an HTML string: an article is written by the
// admin or drafted by a model, and either way nothing in it reaches the
// page as markup. Anything outside the subset is shown as the text it is.
//
// Blocks: "## " and "### " headings (the page's own title is the h1, so a
// "# " heading is read as "## "), paragraphs, "- " and "1. " lists, "> "
// quotes, and a line holding only ![alt](url) as a figure.
// Inline: **bold**, *italic*, [text](url).
//
// Run: npm run test:mini-markdown

import type { ReactNode } from "react";
import { safeHref } from "./linkify";
import { isAllowedCoverUrl } from "./blogQuery";

type Block =
  | { kind: "h2" | "h3" | "p" | "quote"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "img"; alt: string; src: string };

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: heading[1].length === 3 ? "h3" : "h2", text: heading[2] });
      continue;
    }
    const img = IMAGE_LINE.exec(line);
    if (img) {
      flush();
      // Images obey the same rule as covers: royalty-free libraries or the
      // site's own photos. Any other address is left out, not shown.
      if (isAllowedCoverUrl(img[2])) blocks.push({ kind: "img", alt: img[1], src: img[2] });
      continue;
    }
    const isUl = (l: string) => /^[-*]\s+/.test(l);
    const isOl = (l: string) => /^\d+[.)]\s+/.test(l);
    if (isUl(line) || isOl(line)) {
      flush();
      const kind = isUl(line) ? "ul" : "ol";
      const items: string[] = [];
      while (i < lines.length && (kind === "ul" ? isUl(lines[i].trim()) : isOl(lines[i].trim()))) {
        items.push(lines[i].trim().replace(kind === "ul" ? /^[-*]\s+/ : /^\d+[.)]\s+/, ""));
        i++;
      }
      i--;
      blocks.push({ kind, items });
      continue;
    }
    if (line.startsWith(">")) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      i--;
      blocks.push({ kind: "quote", text: quote.join(" ") });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** **bold**, *italic* and [links](url), as elements. A link whose address
 * is not a safe web address is shown as its text alone. */
export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${n++}`;
    if (match[1] !== undefined) out.push(<strong key={key}>{match[1]}</strong>);
    else if (match[2] !== undefined) out.push(<em key={key}>{match[2]}</em>);
    else {
      const href = safeHref(match[4]);
      const internal = match[4].startsWith("/") && !match[4].startsWith("//");
      if (internal) out.push(<a key={key} href={match[4]}>{match[3]}</a>);
      else if (href) {
        out.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {match[3]}
          </a>
        );
      } else out.push(match[3]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MiniMarkdown({ source }: { source: string }) {
  return (
    <>
      {parseBlocks(source).map((block, i) => {
        const key = `b${i}`;
        switch (block.kind) {
          case "h2":
            return <h2 key={key} className="font-display blog-h2">{renderInline(block.text, key)}</h2>;
          case "h3":
            return <h3 key={key} className="font-display blog-h3">{renderInline(block.text, key)}</h3>;
          case "quote":
            return <blockquote key={key} className="blog-quote">{renderInline(block.text, key)}</blockquote>;
          case "ul":
            return (
              <ul key={key} className="blog-list">
                {block.items.map((item, j) => <li key={j}>{renderInline(item, `${key}-${j}`)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="blog-list">
                {block.items.map((item, j) => <li key={j}>{renderInline(item, `${key}-${j}`)}</li>)}
              </ol>
            );
          case "img":
            return (
              <figure key={key} className="blog-figure">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote royalty-free photo, sized by CSS */}
                <img src={block.src} alt={block.alt} loading="lazy" />
                {block.alt && <figcaption className="font-ui">{block.alt}</figcaption>}
              </figure>
            );
          default:
            return <p key={key}>{renderInline(block.text, key)}</p>;
        }
      })}
    </>
  );
}

/** Plain text of an article, for search descriptions and reading time. */
export function plainText(source: string): string {
  return parseBlocks(source)
    .map((b) => ("text" in b ? b.text : "items" in b ? b.items.join(" ") : ""))
    .join(" ")
    .replace(/\*\*([^*]+)\*\*|\*([^*]+)\*/g, "$1$2")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function readingMinutes(source: string): number {
  return Math.max(1, Math.round(plainText(source).split(" ").length / 220));
}
