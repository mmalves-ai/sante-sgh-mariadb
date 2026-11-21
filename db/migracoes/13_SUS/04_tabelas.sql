-- SUS, lote 04 (F2.2 onda 2; pedidos dos lotes 02-03): tabelas e colunas que as portas próprias pedem.
-- Convenções do ADR 0002 (parte 2). Sem FOREIGN KEY aqui (04_chaves.sql).

ALTER TABLE contrato_gestor_sus
  ADD observacao VARCHAR(500) NULL,
  ADD motivo_encerramento VARCHAR(300) NULL,
  ADD encerrado_em DATETIME(3) NULL,
  ADD encerrado_por_usuario_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT ck_contrato_gestor_sus_encerramento CHECK (situacao <> 'encerrado' OR (encerrado_em IS NOT NULL AND motivo_encerramento IS NOT NULL));

ALTER TABLE meta_contratual_sus
  ADD complexidade_dominio_contratualizacao_sus_id BIGINT UNSIGNED NULL COMMENT 'Bloco de financiamento da meta (lista complexidade)',
  ADD tipo_afericao_dominio_contratualizacao_sus_id BIGINT UNSIGNED NULL COMMENT 'De onde vem o dado que comprova a meta',
  DROP CONSTRAINT ck_meta_contratual_sus_formato_resposta,
  ADD CONSTRAINT ck_meta_contratual_sus_formato_resposta CHECK (formato_resposta IN ('numero','inteiro','percentual','sim_nao') OR formato_resposta IS NULL);

ALTER TABLE afericao_meta_sus
  ADD origem_realizado VARCHAR(30) NULL,
  ADD CONSTRAINT ck_afericao_meta_sus_origem_realizado CHECK (origem_realizado IN ('faturamento_sus','contas_sus','informado') OR origem_realizado IS NULL);
