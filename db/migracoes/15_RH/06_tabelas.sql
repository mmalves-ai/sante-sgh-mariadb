-- RH, lote 6 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (06_chaves.sql).

-- L5-07 (5): tipos de admissão e condições de ingresso do leiaute oficial
ALTER TABLE vinculo_trabalho DROP CONSTRAINT ck_vinculo_trabalho_tipo_admissao;
ALTER TABLE vinculo_trabalho ADD CONSTRAINT ck_vinculo_trabalho_tipo_admissao CHECK (tipo_admissao IN ('admissao','transferencia_mesmo_grupo','transferencia_consorcio','transferencia_sucessao','transferencia_domestico','transferencia_sucedida_inapta','transferencia_cessao','reintegracao','mudanca_cpf','transferencia_regime'));
ALTER TABLE estrangeiro_colaborador DROP CONSTRAINT ck_estrangeiro_colaborador_condicao_ingresso;
ALTER TABLE estrangeiro_colaborador ADD CONSTRAINT ck_estrangeiro_colaborador_condicao_ingresso CHECK (condicao_ingresso IN ('refugiado','solicitante_refugio','reuniao_familiar','residencia_mercosul','tratado_brasil_portugal','residencia_humanitaria','residencia_trabalho','dependente_diplomata','outra'));

-- L5-08 (4): escolha do empregador para gerar o evento de pagamentos
ALTER TABLE cadastro_empregador
  ADD COLUMN geracao_evento_pagamentos VARCHAR(30) NULL COMMENT 'Quando gerar o evento de pagamentos: pagamento_folha, baixa_financeira ou manual',
  ADD CONSTRAINT ck_cadastro_empregador_geracao_evento_pagamentos CHECK (geracao_evento_pagamentos IS NULL OR geracao_evento_pagamentos IN ('pagamento_folha','baixa_financeira','manual'));

-- L5-12 (7): habilitação do lançamento automático antes da escolha da rubrica
ALTER TABLE lancamento_automatico_rubrica
  MODIFY COLUMN rubrica_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Rubrica lançada; nula: habilitado, rubrica a escolher';
ALTER TABLE lancamento_automatico_rubrica DROP CONSTRAINT ck_lancamento_automatico_rubrica_evento_gatilho;
ALTER TABLE lancamento_automatico_rubrica ADD CONSTRAINT ck_lancamento_automatico_rubrica_evento_gatilho CHECK (evento_gatilho IN ('salario_familia','vale_transporte','adiantamento','insalubridade','periculosidade','adicional_noturno','pensao_alimenticia','consignado','contribuicao_sindical','beneficio','licenca_maternidade','rescisao','afastamento','outro'));

-- L5-12 (8): incidência pelo tributo, com o código oficial e a guia opcionais
ALTER TABLE incidencia_rubrica
  ADD COLUMN tributo VARCHAR(30) NULL COMMENT 'Tributo em que a rubrica incide (mesmo domínio de codigo_incidencia_rubrica.tributo)' AFTER rubrica_id,
  MODIFY COLUMN tributo_folha_id BIGINT UNSIGNED NULL DEFAULT NULL,
  MODIFY COLUMN codigo_incidencia_rubrica_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Código de incidência do leiaute oficial; nulo: a completar pelo cliente',
  ADD CONSTRAINT ck_incidencia_rubrica_tributo CHECK (tributo IS NULL OR tributo IN ('inss','irrf','fgts','pis_pasep','contribuicao_sindical','regime_proprio')),
  ADD CONSTRAINT ck_incidencia_rubrica_alvo CHECK (tributo IS NOT NULL OR codigo_incidencia_rubrica_id IS NOT NULL),
  ADD UNIQUE KEY uq_incidencia_rubrica_tributo (rubrica_id, tributo, vigencia_inicio);

-- L5-12 (9)
ALTER TABLE justificativa_ponto
  ADD COLUMN mantenedora_id BIGINT UNSIGNED NULL COMMENT 'Nulo: vale para toda a rede' AFTER id,
  ADD KEY ix_justificativa_ponto_mantenedora_id (mantenedora_id),
  DROP INDEX uq_justificativa_ponto_codigo,
  ADD UNIQUE KEY uq_justificativa_ponto_codigo (mantenedora_id, codigo);
