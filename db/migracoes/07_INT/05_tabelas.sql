-- INT, lote 05 (F2.2 onda 2; pedidos dos lotes 02-12): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (05_chaves.sql).

ALTER TABLE acompanhante_internacao
  ADD COLUMN pessoa_portaria_id BIGINT UNSIGNED NULL COMMENT 'Cadastro da pessoa na portaria' AFTER pessoa_fisica_id,
  ADD COLUMN motivo_fim VARCHAR(500) NULL,
  ADD KEY ix_acompanhante_internacao_pessoa_portaria (pessoa_portaria_id);
