"""
Tests para poker_bot.py — decisiones de los bots sobre una Hand real de
poker_table.py. Todo determinista via seeds.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from poker_engine import make_card
from poker_table import Hand, PlayerState, deck_with_known_cards
from poker_bot import PROFILE_PARAMS, decide, play_hand_all_bots

PROFILE_CYCLE = ["nit", "tag", "lag", "station"]
POSTFLOP_ITERS = 80  # bajo para que el fuzz de 200 manos corra rápido en tests


def _make_players(n, stack=1000):
    return [PlayerState(seat=s, name=f"P{s}", stack=stack) for s in range(n)]


# ---------------------------------------------------------------------------
# a) Fuzz de legalidad: 200 manos completas bot-vs-bot, sin excepciones,
#    siempre con ganador, y fichas conservadas.
# ---------------------------------------------------------------------------
def test_fuzz_200_hands_no_illegal_actions_chips_conserved():
    for i in range(200):
        n = 2 + (i % 6)  # 2..7 jugadores
        stack = 400 + (i % 5) * 137
        players = _make_players(n, stack=stack)
        total_before = sum(p.stack for p in players)
        profiles = {p.seat: PROFILE_CYCLE[p.seat % len(PROFILE_CYCLE)] for p in players}
        button_seat = i % n

        hand = Hand(players, button_seat=button_seat, sb=10, bb=20, rng_seed=1000 + i)

        try:
            play_hand_all_bots(hand, seed=i, profiles=profiles, postflop_iters=POSTFLOP_ITERS)
        except Exception as exc:  # queremos capturar CUALQUIER fallo del fuzz, no solo HandError
            pytest.fail(f"Mano #{i} (n={n}, button={button_seat}) falló: {exc!r}")

        assert hand.is_complete, f"Mano #{i} no terminó"
        assert hand.winners_by_pot, f"Mano #{i} terminó sin ganador"
        total_after = sum(p.stack for p in hand.players.values())
        assert total_after == total_before, (
            f"Mano #{i}: fichas no conservadas ({total_before} -> {total_after})"
        )


# ---------------------------------------------------------------------------
# b) Un "nit" foldea manos basura (72o) preflop ante una subida.
# ---------------------------------------------------------------------------
def test_nit_folds_trash_hand_facing_a_raise():
    known = [
        make_card("9", "d"), make_card("7", "s"),   # 1ª vuelta: seat0, seat1
        make_card("4", "h"), make_card("2", "d"),   # 2ª vuelta: seat0, seat1
    ]
    deck = deck_with_known_cards(known)
    players = _make_players(2, stack=1000)
    hand = Hand(players, button_seat=0, sb=5, bb=10, deck=deck)

    assert hand.players[1].hole_cards == [make_card("7", "s"), make_card("2", "d")]

    # seat0 (botón/SB) abre fuerte; seat1 (BB, nuestro nit con 72o) debe foldear.
    hand.apply_action(0, "raise", to_amount=60)
    assert hand.current_seat == 1

    action, amount = decide(hand, 1, profile="nit", seed=7)
    assert action == "fold"
    assert amount is None
    assert "fold" in hand.legal_actions(1)


# ---------------------------------------------------------------------------
# c) Con AA, el bot nunca foldea preflop (ningún perfil), sea cual sea la subida.
# ---------------------------------------------------------------------------
def test_aa_never_folds_preflop_any_profile():
    known = [
        make_card("9", "d"), make_card("A", "s"),
        make_card("4", "h"), make_card("A", "h"),
    ]
    deck = deck_with_known_cards(known)
    players = _make_players(2, stack=1000)
    hand = Hand(players, button_seat=0, sb=5, bb=10, deck=deck)

    assert hand.players[1].hole_cards == [make_card("A", "s"), make_card("A", "h")]

    hand.apply_action(0, "raise", to_amount=80)  # subida considerable
    assert hand.current_seat == 1

    for profile in PROFILE_PARAMS:
        action, amount = decide(hand, 1, profile=profile, seed=hash(profile) % 10000)
        assert action != "fold", f"perfil {profile!r} foldeó AA preflop"
        assert action in ("call", "raise", "all_in")
        if action == "raise":
            legal = hand.legal_actions(1)
            assert legal["raise"]["min_to"] <= amount <= legal["raise"]["max_to"]


# ---------------------------------------------------------------------------
# d) Los importes de raise de decide() siempre caen dentro de legal_actions().
# ---------------------------------------------------------------------------
def test_raise_amounts_always_within_legal_bounds():
    checked_a_raise = False
    for seed in range(30):
        n = 2 + (seed % 4)
        stack = 300 + seed * 17
        players = _make_players(n, stack=stack)
        profiles = {p.seat: PROFILE_CYCLE[p.seat % len(PROFILE_CYCLE)] for p in players}
        hand = Hand(players, button_seat=seed % n, sb=5, bb=10, rng_seed=5000 + seed)

        steps = 0
        while not hand.is_complete and steps < 200:
            seat = hand.current_seat
            legal = hand.legal_actions(seat)
            action, amount = decide(
                hand, seat, profile=profiles[seat],
                seed=seed * 1000 + steps, postflop_iters=POSTFLOP_ITERS,
            )
            if action == "raise":
                checked_a_raise = True
                assert "raise" in legal, f"seed {seed}: raise devuelto pero no es legal"
                assert legal["raise"]["min_to"] <= amount <= legal["raise"]["max_to"], (
                    f"seed {seed}: raise {amount} fuera de "
                    f"[{legal['raise']['min_to']}, {legal['raise']['max_to']}]"
                )
            hand.apply_action(seat, action, to_amount=amount)
            steps += 1

        assert hand.is_complete, f"seed {seed}: la mano no terminó en {steps} pasos"

    # Nos aseguramos de que el bucle realmente ejercitó el camino de "raise"
    # al menos alguna vez en las 30 manos (si no, el assert de arriba no dice nada).
    assert checked_a_raise
