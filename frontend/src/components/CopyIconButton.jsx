import { useCallback, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { copyText } from "@/lib/clipboard";

const COPIED_FEEDBACK_MS = 1500;

/**
 * Botón discreto de icono para copiar texto plano al portapapeles, usado en
 * las cabeceras de Actividad/Ayuda/Coach IA. `getText` se llama EN EL
 * MOMENTO del clic (no memoizado) para copiar siempre el estado más
 * reciente, no una foto congelada del render en que se montó el botón.
 */
export default function CopyIconButton({ getText, title, testId, disabled = false, className = "" }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef(null);

  const handleClick = useCallback(async () => {
    const ok = await copyText(getText());
    if (!ok) return;
    setCopied(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, [getText]);

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={handleClick}
      disabled={disabled}
      title={copied ? "Copiado" : title}
      aria-label={copied ? "Copiado" : title}
      className={`p-1 rounded-md bg-[#1a1f29] border border-[#2b3441] text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-[#1a1f29] disabled:hover:text-[#94A3B8] disabled:cursor-not-allowed ${className}`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}
