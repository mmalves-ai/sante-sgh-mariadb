-- HOT, lote 7 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (07_chaves.sql).

-- L6-18 (1)
ALTER TABLE movimento_prontuario
  ADD COLUMN saida_setor_tramite_id BIGINT UNSIGNED NULL COMMENT 'Setor de trâmite de onde o prontuário saiu' AFTER destino_setor_funcional_id,
  ADD COLUMN destino_setor_tramite_id BIGINT UNSIGNED NULL COMMENT 'Setor de trâmite para onde o prontuário foi' AFTER saida_setor_tramite_id,
  ADD KEY ix_movimento_prontuario_saida_setor_tramite_id (saida_setor_tramite_id),
  ADD KEY ix_movimento_prontuario_destino_setor_tramite_id (destino_setor_tramite_id);
