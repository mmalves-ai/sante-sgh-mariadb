-- PEP, lote 16 (F4 conector, rodada 3 de cobertura, grupo 3: pedidos de modelo das fatias L6-09 e L6-10, registrados
-- para a trilha F2.2 em docs/obra/passagens/F4-decisoes-destino.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (16_chaves.sql).

-- L6-09: a grade de horário de medicação vale também por unidade assistencial (a unidade que o hospital usa no
-- cadastro), além da unidade e do bloco de internação; a unidade entra na chave de escopo. Índice próprio do
-- estabelecimento antes de trocar a chave única (a FK do estabelecimento usava o índice da chave).
ALTER TABLE grade_horario_unidade
  ADD COLUMN unidade_assistencial_id BIGINT UNSIGNED NULL COMMENT 'Nulo: vale para qualquer unidade assistencial' AFTER setor_funcional_id,
  ADD KEY ix_grade_horario_unidade_estabelecimento (estabelecimento_id),
  ADD KEY ix_grade_horario_unidade_unidade_assistencial_id (unidade_assistencial_id),
  DROP INDEX uq_grade_horario_unidade_escopo,
  ADD UNIQUE KEY uq_grade_horario_unidade_escopo (estabelecimento_id, tipo_atendimento, unidade_internacao_id, bloco_internacao_id, setor_funcional_id, unidade_assistencial_id);

-- L6-10: regra que vale para a mudança PARA uma situação vinda de QUALQUER situação. A origem nula continua
-- querendo dizer "criação" quando a marca é falsa; com a marca, a origem fica nula e a regra vale para toda mudança.
ALTER TABLE regra_transicao_situacao_prescricao
  ADD COLUMN qualquer_origem BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Vale para a mudança vinda de qualquer situação (origem nula); falso com origem nula: criação' AFTER origem_situacao_prescricao_id,
  ADD KEY ix_regra_transicao_situacao_prescricao_estabelecimento (estabelecimento_id),
  ADD CONSTRAINT ck_regra_transicao_situacao_prescricao_qualquer_origem CHECK (qualquer_origem = FALSE OR origem_situacao_prescricao_id IS NULL),
  DROP INDEX uq_regra_transicao_situacao_prescricao,
  ADD UNIQUE KEY uq_regra_transicao_situacao_prescricao (estabelecimento_id, origem_situacao_prescricao_id, qualquer_origem, destino_situacao_prescricao_id, aplica_a, processo, categoria_profissional_id);
