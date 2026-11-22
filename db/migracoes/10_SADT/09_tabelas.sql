-- SADT, lote 9 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (09_chaves.sql).

-- L7-01 (3)
ALTER TABLE doacao_sangue
  ADD COLUMN intercorrencia_tipo_reacao_transfusional_id BIGINT UNSIGNED NULL COMMENT 'Intercorrência na doação',
  ADD KEY ix_doacao_sangue_intercorrencia (intercorrencia_tipo_reacao_transfusional_id);

-- L7-03 (1), partes 1 e 2: interface e laboratório de apoio inativos sem alvo ou empresa
ALTER TABLE interface_equipamento DROP CONSTRAINT ck_interface_equipamento_alvo;
ALTER TABLE interface_equipamento ADD CONSTRAINT ck_interface_equipamento_alvo CHECK (equipamento_analitico_id IS NOT NULL OR laboratorio_apoio_id IS NOT NULL OR ativo = FALSE);
ALTER TABLE laboratorio_apoio
  MODIFY COLUMN empresa_fornecedora_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD CONSTRAINT ck_laboratorio_apoio_empresa CHECK (empresa_fornecedora_id IS NOT NULL OR ativo = FALSE);

-- L7-04 (11)
ALTER TABLE exame_item
  ADD COLUMN motivo_cancelamento_texto VARCHAR(500) NULL COMMENT 'Justificativa do cancelamento em texto' AFTER motivo_cancelamento_item_exame_id,
  ADD COLUMN conta_hospitalar_item_id BIGINT UNSIGNED NULL COMMENT 'Item da conta que cobrou o exame',
  ADD KEY ix_exame_item_conta_hospitalar_item_id (conta_hospitalar_item_id);

-- L7-04 (19)
ALTER TABLE resultado_exame
  ADD COLUMN referencia_texto TEXT NULL COMMENT 'Referência do exame como impressa no laudo (da época)';

-- L7-04 (5): setor por exame e solicitante externo (exatamente um solicitante)
ALTER TABLE requisicao_exame
  MODIFY COLUMN setor_diagnostico_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Setor executante da requisição; nulo: por exame (exame_item.setor_diagnostico_id)',
  MODIFY COLUMN solicitante_profissional_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Profissional solicitante (interno ou externo cadastrado); nunca por nome',
  ADD COLUMN solicitante_externo_id BIGINT UNSIGNED NULL COMMENT 'Solicitante externo, alternativa ao profissional' AFTER solicitante_profissional_id,
  ADD KEY ix_requisicao_exame_solicitante_externo_id (solicitante_externo_id),
  ADD CONSTRAINT ck_requisicao_exame_solicitante CHECK ((solicitante_profissional_id IS NULL) <> (solicitante_externo_id IS NULL));
