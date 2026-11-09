// Light formatting for Aura's replies: paragraphs, bullet/numbered lists,
// **bold**, *italic* and `code`. Anything else is shown as plain text.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;

const renderInline = (text) =>
  text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });

const parse = (text) => {
  const blocks = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ type: "gap" });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const kind = bullet ? "ul" : numbered ? "ol" : null;
    if (kind) {
      const last = blocks[blocks.length - 1];
      const item = (bullet || numbered)[1];
      if (last?.type === kind) last.items.push(item);
      else blocks.push({ type: kind, items: [item] });
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (!heading && last?.type === "p") last.lines.push(line);
    else blocks.push(heading ? { type: "h", text: heading[1] } : { type: "p", lines: [line] });
  }
  return blocks.filter((b) => b.type !== "gap");
};

export function Markdown({ text }) {
  return (
    <div className="md">
      {parse(text).map((block, i) => {
        if (block.type === "ul" || block.type === "ol") {
          const List = block.type;
          return (
            <List key={i}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </List>
          );
        }
        if (block.type === "h") return <p key={i} className="md-heading">{renderInline(block.text)}</p>;
        return <p key={i}>{renderInline(block.lines.join(" "))}</p>;
      })}
    </div>
  );
}
