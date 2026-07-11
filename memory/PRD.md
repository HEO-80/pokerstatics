# PokerPreflop Trainer - PRD

## Problem Statement
Aplicación web de entrenamiento de poker Texas Hold'em, enfocada en decisiones preflop, con simulación MTT (500 → 9 jugadores) y sistema de progreso/feedback.

## Architecture
- Stack: React + Tailwind + FastAPI + MongoDB
- Sin autenticación en MVP (localStorage para historial de manos)
- Escenarios preflop almacenados en MongoDB, subidos vía panel admin JSON
- Frontend gestiona simulación de torneo y feedback

## Core Requirements
1. Modo Torneo MTT (simulación 500 → 9 jugadores)
2. Fases: early (~100BB), mid (~40-60BB), bubble (~20BB), mesa final (~10-25BB)
3. Feedback inmediato con desglose de acciones (mixed strategy)
4. Dashboard de estadísticas (% acierto global, por posición, por fase, por acción)
5. Modo repaso de errores
6. Streak counter (racha)
7. Panel admin para subir JSON de rangos
8. Diseño moderno oscuro (no verde/dorado clásico)

## Correctness Rule (MVP)
- Cualquier acción con probabilidad > 0 en el JSON se considera correcta
- El feedback resalta la acción de mayor probabilidad como "principal"

## Implemented (Feb 2026)
- Backend endpoints: /api/scenarios (CRUD + bulk + random by phase), /api/scenarios/stats
- Frontend pages: Home, Train, Stats, Review, Admin
- Tournament simulation client-side
- localStorage hand history

## Backlog (P1)
- Autenticación (JWT o Google) + persistencia de progreso por usuario
- Modo Cash 9-max
- Feedback con IA (explicaciones ricas)
- Multi-language support
- Mobile optimization

## Backlog (P2)
- Multiplayer async
- Weakness insights automáticos con ML
- Exportar historial
