-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE evento_acesso_portaria
  ADD KEY IF NOT EXISTS ix_evento_acesso_portaria_terminal (terminal_acesso_id, ocorrido_em);
