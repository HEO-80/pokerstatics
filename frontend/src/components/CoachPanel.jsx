import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { fetchTableCoach } from "@/lib/api";
import { seatName } from "@/lib/table";
import { cardGlyph } from "@/lib/cardGlyphs";

/**
 * Coach v1: llama a GET /api/table/{hand_id}/coach (backend, poker_coach.py)
 * y narra los números que devuelve con PLANTILLAS fijas en español — nada de
 * IA, nada calculado aquí. Solo se pide/muestra cuando `active` (panel de
 * Ayuda abierto Y es turno del hero Y la mano no ha terminado, ver
 * HandTable.jsx) — así no molesta ni gasta cálculo de más cuando no aplica,
 * y se refresca solo cuando cambia la decisión real (nueva calle, nueva
 * apuesta, mano nueva).
 */

function CardText({ cards }) {
  return (
    <span className="inline-flex gap-1">
      {cards.map((c, i) => {
        const { rank, symbol, color } = cardGlyph(c);
        return (
          <span key={i} className="font-mono-poker font-bold" style={{ color }}>
            {rank}
            {symbol}
          </span>
        );
      })}
    </span>
  );
}

const STREET_WORD = { preflop: "preflop", flop: "en el flop", turn: "en el turn", river: "en el river" };

function positionWord(coach) {
  if (coach.is_button) return "en el botón";
  if (coach.is_sb) return "en la ciega pequeña";
  if (coach.is_bb) return "en la ciega grande";
  return "sin ciega";
}

/** 1) La situación en palabras. */
function situationText(coach, villainName) {
  const streetWord = STREET_WORD[coach.street] ?? coach.street;
  const toCallText =
    coach.to_call > 0
      ? `${villainName} te deja ${coach.to_call} para seguir.`
      : "No hay nada que pagar: puedes pasar gratis.";
  return `Estás ${positionWord(coach)}, ${streetWord}. El bote va por ${coach.pot_total}. ${toCallText}`;
}

/** 5) Una lectura que ata pot odds/equity/breakeven — sin imponer la jugada. */
function readingText(coach) {
  const eq = coach.equity_vs_villain_range;
  if (coach.to_call > 0) {
    if (!eq) return "No se pudo estimar tu equity para compararla con lo que pide el bote.";
    const diff = eq.equity_pct - coach.pot_odds.required_equity_pct;
    if (diff >= 8) {
      return (
        `Tu equity estimada (~${eq.equity_pct}%) supera con margen lo que pide el bote ` +
        `(${coach.pot_odds.required_equity_pct}%): pagar pinta +EV — aunque la equity es una ` +
        `estimación contra un rango aproximado, no un número exacto.`
      );
    }
    if (diff >= 0) {
      return (
        `Tu equity estimada (~${eq.equity_pct}%) supera por poco lo que pide el bote ` +
        `(${coach.pot_odds.required_equity_pct}%): es un spot marginal — pagar es defendible, ` +
        `pero no es un caso claro.`
      );
    }
    return (
      `Tu equity estimada (~${eq.equity_pct}%) queda por debajo de lo que pide el bote ` +
      `(${coach.pot_odds.required_equity_pct}%): según esta estimación, pagar pinta -EV — aunque ` +
      `el rango del rival es una aproximación, no lo tomes como una verdad absoluta.`
    );
  }
  if (eq) {
    return (
      `No hay nada que pagar, así que no hay pot odds que superar: con ~${eq.equity_pct}% de ` +
      `equity estimada, la decisión es más bien entre pasar o apostar tú por valor/farol.`
    );
  }
  return "No hay nada que pagar ahora mismo.";
}

export default function CoachPanel({ handId, active, players }) {
  const [coach, setCoach] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active || !handId) {
      setCoach(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTableCoach(handId)
      .then((data) => {
        if (!cancelled) setCoach(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.response?.data?.detail || "No se pudo calcular el análisis ahora mismo.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, handId]);

  if (!active) {
    return <div className="text-xs text-[#475569] leading-snug">Ábrelo en tu turno para ver el análisis.</div>;
  }
  if (loading && !coach) {
    return (
      <div className="text-xs text-[#475569] flex items-center gap-1.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculando…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-xs text-[#EF4444] flex items-start gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
      </div>
    );
  }
  if (!coach) return null;

  const villainName = coach.villain_seat != null ? seatName(players, coach.villain_seat) : "el rival";

  return (
    <div className="space-y-2.5 text-xs leading-snug">
      {/* 1) Situación */}
      <div className="text-[#94A3B8]">
        {situationText(coach, villainName)} Tus cartas: <CardText cards={coach.hero_cards} />
        {coach.board.length > 0 && (
          <>
            {" "}
            · Board <CardText cards={coach.board} />
          </>
        )}
      </div>

      {/* 2) Pot odds */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-0.5">Pot odds</div>
        <div className="text-white">
          {coach.to_call > 0
            ? `Para pagar necesitas ganar al menos ${coach.pot_odds.required_equity_pct}% (el bote te da ${coach.pot_odds.ratio}).`
            : "No hay nada que pagar ahora mismo."}
        </div>
      </div>

      {/* 3) Equity estimada */}
      {coach.equity_vs_villain_range && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-0.5">
            Tu equity (estimada) vs {villainName}
          </div>
          <div className="text-white">~{coach.equity_vs_villain_range.equity_pct}% contra su rango probable.</div>
          <div className="text-[#475569] mt-0.5">{coach.equity_estimation_note}</div>
          {coach.multiway && (
            <div className="text-[#F59E0B] mt-0.5">
              Hay más de un rival en la mano: esta equity aproxima como si fuera mano a mano solo contra{" "}
              {villainName} (el resto de rivales no entra en el cálculo).
            </div>
          )}
        </div>
      )}

      {/* 4) Breakeven de una subida estándar */}
      {coach.breakeven_standard_raise && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-0.5">
            Breakeven si subes
          </div>
          <div className="text-white">
            Si subes a {coach.breakeven_standard_raise.raise_to}, necesitas que {villainName} se retire al menos el{" "}
            {coach.breakeven_standard_raise.required_fold_pct}% de las veces para que sea rentable de inmediato.
          </div>
        </div>
      )}

      {/* 5) Lectura */}
      <div className="pt-1.5 border-t border-white/8">
        <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-0.5">Lectura</div>
        <div className="text-[#94A3B8]">{readingText(coach)}</div>
      </div>
    </div>
  );
}
