/**
 * Render mínimo de Markdown para respuestas de la IA (Gemini) — sin depender
 * de react-markdown: Gemini solo usa un subconjunto pequeño y predecible
 * (**negrita**, *cursiva*, `código`, `## títulos`, listas con "-"/"1."), así
 * que un parser línea a línea + un tokenizador inline por regex cubre el
 * caso real sin arrastrar la cadena remark/rehype/unified como dependencia
 * nueva. Se renderiza como elementos React normales (nunca
 * dangerouslySetInnerHTML) — el texto de la IA no es HTML de confianza, así
 * que ningún fragmento pasa nunca por un sink de HTML crudo.
 *
 * Usado por AiCoachPanel.jsx (coach v2 por mano) y SessionAiReview.jsx
 * (valoración v2 de la sesión completa) — único sitio que sabe interpretar
 * el Markdown de la IA, para no duplicar este parser en los dos paneles.
 */

// --- Inline: negrita/cursiva/código dentro de una línea ya extraída de un
// bloque (párrafo, ítem de lista, título) --------------------------------
const INLINE_REGEX = /\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|\*(.+?)\*|_(.+?)_/g;

function renderInline(text, keyPrefix) {
  const nodes = [];
  let lastIndex = 0;
  let match;
  let i = 0;
  INLINE_REGEX.lastIndex = 0;
  while ((match = INLINE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [, bold1, bold2, code, italic1, italic2] = match;
    if (bold1 !== undefined || bold2 !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i++}`} className="text-white font-bold">
          {bold1 ?? bold2}
        </strong>,
      );
    } else if (code !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}-c${i++}`}
          className="px-1 py-0.5 rounded bg-black/30 text-[#c4b5fd] text-[0.85em] font-mono-poker"
        >
          {code}
        </code>,
      );
    } else if (italic1 !== undefined || italic2 !== undefined) {
      nodes.push(
        <em key={`${keyPrefix}-i${i++}`} className="italic">
          {italic1 ?? italic2}
        </em>,
      );
    }
    lastIndex = INLINE_REGEX.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

// --- Bloques: agrupa líneas en párrafos / títulos / listas --------------
function parseBlocks(text) {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paraLines = null;
  let list = null; // { type: "ul" | "ol", items: string[] }

  const flushPara = () => {
    if (paraLines && paraLines.length) blocks.push({ type: "p", text: paraLines.join(" ").trim() });
    paraLines = null;
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushPara();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(ul[1].trim());
      continue;
    }
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ol[1].trim());
      continue;
    }
    flushList();
    if (!paraLines) paraLines = [];
    paraLines.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

const HEADING_CLASS = {
  1: "text-base font-display font-bold text-[#c4b5fd] mt-3 mb-1 first:mt-0",
  2: "text-base font-display font-bold text-[#c4b5fd] mt-3 mb-1 first:mt-0",
  3: "text-sm font-display font-bold text-[#c4b5fd] mt-2.5 mb-1 first:mt-0",
};

/** `text` es el string crudo devuelto por la IA (Gemini); `className` fija
 * color/tamaño base del cuerpo (lo decide cada panel, ver AiCoachPanel.jsx/
 * SessionAiReview.jsx) — títulos/negrita/código usan sus propios acentos
 * fijos para que resalten sobre ese cuerpo en cualquiera de los dos sitios. */
export default function AiMarkdown({ text, className }) {
  const blocks = parseBlocks(text);
  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const key = `block-${bi}`;
        if (block.type === "heading") {
          const cls = HEADING_CLASS[block.level] ?? HEADING_CLASS[3];
          return (
            <div key={key} className={cls}>
              {renderInline(block.text, key)}
            </div>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={key} className="list-disc pl-5 space-y-1 my-2 first:mt-0 last:mb-0">
              {block.items.map((item, ii) => (
                <li key={`${key}-${ii}`}>{renderInline(item, `${key}-${ii}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={key} className="list-decimal pl-5 space-y-1 my-2 first:mt-0 last:mb-0">
              {block.items.map((item, ii) => (
                <li key={`${key}-${ii}`}>{renderInline(item, `${key}-${ii}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={key} className="my-2 first:mt-0 last:mb-0">
            {renderInline(block.text, key)}
          </p>
        );
      })}
    </div>
  );
}
