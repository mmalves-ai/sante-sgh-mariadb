-- FAT, lote 12 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (12_chaves.sql).

-- L8-01 (21): repasse a empresa ou cooperativa sem profissional
ALTER TABLE favorecido_repasse
  MODIFY COLUMN profissional_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Profissional que gera a produção',
  ADD CONSTRAINT ck_favorecido_repasse_profissional CHECK (tipo_favorecido NOT IN ('proprio_profissional','terceiro_profissional') OR profissional_id IS NOT NULL);

-- L8-01 (22): número da guia único por fonte pagadora
ALTER TABLE guia_fonte_pagadora
  ADD KEY ix_guia_fonte_pagadora_estabelecimento (estabelecimento_id),
  DROP INDEX uq_guia_fonte_pagadora_estabelecimento_numero,
  ADD UNIQUE KEY uq_guia_fonte_pagadora_numero (estabelecimento_id, fonte_pagadora_id, numero);

-- L8-02 (2): lançamento migrado sem a regra de favorecido (o favorecido fica em tipo_favorecido e profissional_id)
ALTER TABLE lancamento_repasse
  MODIFY COLUMN favorecido_repasse_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD CONSTRAINT ck_lancamento_repasse_favorecido CHECK (origem = 'migracao' OR favorecido_repasse_id IS NOT NULL);

-- L8-02 (8)
ALTER TABLE evento_repasse
  ADD COLUMN tipo_deducao_irrf_id BIGINT UNSIGNED NULL COMMENT 'Tipo de dedução do IRRF',
  ADD COLUMN tipo_rendimento_isento_id BIGINT UNSIGNED NULL COMMENT 'Tipo de rendimento isento',
  ADD KEY ix_evento_repasse_tipo_deducao_irrf_id (tipo_deducao_irrf_id),
  ADD KEY ix_evento_repasse_tipo_rendimento_isento_id (tipo_rendimento_isento_id);

-- L8-02 (20)
ALTER TABLE regra_consistencia_lancamento
  ADD COLUMN grupo_item VARCHAR(20) NULL COMMENT 'Nulo: todos os grupos de item' AFTER categoria_atendimento_id,
  ADD CONSTRAINT ck_regra_consistencia_lancamento_grupo_item CHECK (grupo_item IS NULL OR grupo_item IN ('clinico','cirurgico','matmed','filme','diaria_taxa')),
  ADD KEY ix_regra_consistencia_lancamento_fonte (fonte_pagadora_id),
  DROP INDEX uq_regra_consistencia_lancamento_chave,
  ADD UNIQUE KEY uq_regra_consistencia_lancamento_chave (fonte_pagadora_id, tipo_regra, categoria_atendimento_id, grupo_item);

-- L8-02 (21)
ALTER TABLE cooperativa_medica
  ADD COLUMN percentual_repasse_internacao DECIMAL(7,4) NULL COMMENT 'Percentual de repasse de internacao' AFTER percentual_repasse,
  ADD COLUMN percentual_repasse_exame DECIMAL(7,4) NULL COMMENT 'Percentual de repasse de exame' AFTER percentual_repasse,
  ADD COLUMN percentual_repasse_procedimento DECIMAL(7,4) NULL COMMENT 'Percentual de repasse de procedimento' AFTER percentual_repasse,
  ADD COLUMN percentual_repasse_consulta DECIMAL(7,4) NULL COMMENT 'Percentual de repasse de consulta' AFTER percentual_repasse;
ALTER TABLE cooperativa_medica DROP CONSTRAINT ck_cooperativa_medica_aliquotas;
ALTER TABLE cooperativa_medica ADD CONSTRAINT ck_cooperativa_medica_aliquotas CHECK (COALESCE(aliquota_ir,0) BETWEEN 0 AND 100 AND COALESCE(aliquota_iss,0) BETWEEN 0 AND 100 AND COALESCE(percentual_repasse,0) BETWEEN 0 AND 100 AND COALESCE(percentual_repasse_consulta,0) BETWEEN 0 AND 100 AND COALESCE(percentual_repasse_procedimento,0) BETWEEN 0 AND 100 AND COALESCE(percentual_repasse_exame,0) BETWEEN 0 AND 100 AND COALESCE(percentual_repasse_internacao,0) BETWEEN 0 AND 100);

-- L8-03 (10) e L8-04 (11)
CREATE TABLE item_faturavel_tipo_servico (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_faturavel_id BIGINT UNSIGNED NOT NULL,
  tipo_servico_faturavel_id BIGINT UNSIGNED NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_faturavel_tipo_servico_par (item_faturavel_id, tipo_servico_faturavel_id),
  KEY ix_item_faturavel_tipo_servico_tipo_servico_faturavel_id (tipo_servico_faturavel_id),
  CONSTRAINT ck_item_faturavel_tipo_servico_origem CHECK (origem IN ('sistema','migracao','integracao'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tipos de serviço em que o item faturável se enquadra';

-- L8-03 (12)
CREATE TABLE tabela_preco_item_padrao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tabela_preco_id BIGINT UNSIGNED NOT NULL,
  finalidade VARCHAR(30) NOT NULL COMMENT 'consulta, consulta_eletiva, visita ou pedido',
  item_faturavel_id BIGINT UNSIGNED NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tabela_preco_item_padrao_finalidade (tabela_preco_id, finalidade),
  KEY ix_tabela_preco_item_padrao_item_faturavel_id (item_faturavel_id),
  CONSTRAINT ck_tabela_preco_item_padrao_finalidade CHECK (finalidade IN ('consulta','consulta_eletiva','visita','pedido')),
  CONSTRAINT ck_tabela_preco_item_padrao_origem CHECK (origem IN ('sistema','migracao','integracao'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Item cobrado por padrão em cada finalidade, por tabela de preço';
ALTER TABLE tabela_preco
  ADD COLUMN valor_cirurgico BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Tabela de valores cirúrgicos';

-- L8-03 (13)
ALTER TABLE local_cobranca
  ADD COLUMN tabela_preco_matmed_id BIGINT UNSIGNED NULL COMMENT 'Tabela de preço padrão de medicamentos do local',
  ADD COLUMN tabela_preco_material_id BIGINT UNSIGNED NULL COMMENT 'Tabela de preço padrão de materiais do local',
  ADD COLUMN usa_referencia_unificada BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Cobra pela referência unificada de preço',
  ADD COLUMN usa_referencia_operadora BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Cobra pela referência da operadora',
  ADD COLUMN cobra_paciente_particular BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Cobra o paciente particular no local',
  ADD COLUMN despesa_paciente BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Lança como despesa do paciente',
  ADD KEY ix_local_cobranca_tabela_preco_matmed_id (tabela_preco_matmed_id),
  ADD KEY ix_local_cobranca_tabela_preco_material_id (tabela_preco_material_id);

-- L8-05 (7)
ALTER TABLE sequencial_guia DROP CONSTRAINT ck_sequencial_guia_tipo_guia;
ALTER TABLE sequencial_guia ADD CONSTRAINT ck_sequencial_guia_tipo_guia CHECK (tipo_guia IN ('consulta','sp_sadt','internacao','resumo_internacao','honorario','outras_despesas','odontologia','prorrogacao','anexo_quimioterapia','anexo_radioterapia','anexo_opme','lote','recurso_glosa'));

-- L8-05 (16): retrato vindo de origem sem o total
ALTER TABLE auditoria_conta_versao
  MODIFY COLUMN valor_total_conta DECIMAL(15,2) NULL DEFAULT NULL;
ALTER TABLE auditoria_conta
  MODIFY COLUMN valor_original DECIMAL(15,2) NULL DEFAULT NULL;

-- L8-05 (19)
ALTER TABLE preco_negociado_matmed DROP CONSTRAINT ck_preco_negociado_matmed_regra;
ALTER TABLE preco_negociado_matmed ADD CONSTRAINT ck_preco_negociado_matmed_regra CHECK (valor_unitario IS NOT NULL OR percentual_ajuste IS NOT NULL OR quantidade_fixa IS NOT NULL);

-- L8-06 (20)
ALTER TABLE conta_hospitalar_item
  ADD COLUMN sequencial_item_guia SMALLINT UNSIGNED NULL COMMENT 'Sequencial do item na guia TISS enviada',
  ADD COLUMN codigo_autorizacao VARCHAR(20) NULL COMMENT 'Código de autorização do item',
  ADD COLUMN local_atendimento_id BIGINT UNSIGNED NULL,
  ADD COLUMN funcao_equipe_cobranca_id BIGINT UNSIGNED NULL,
  ADD KEY ix_conta_hospitalar_item_local_atendimento_id (local_atendimento_id),
  ADD KEY ix_conta_hospitalar_item_funcao_equipe_cobranca_id (funcao_equipe_cobranca_id);

-- L8-08 (11) e L8-06 (13): procedimento informado, lote, CID, guia complementar e APAC do item
ALTER TABLE conta_hospitalar_item
  ADD COLUMN procedimento_sigtap_informado_id BIGINT UNSIGNED NULL COMMENT 'Procedimento SUS informado no lançamento',
  ADD COLUMN validade_lote DATE NULL COMMENT 'Validade do lote do item',
  ADD COLUMN cid_termo_terminologia_id BIGINT UNSIGNED NULL COMMENT 'CID do item (termo da terminologia CID-10)',
  ADD COLUMN numero_guia_complementar VARCHAR(30) NULL COMMENT 'Número da guia complementar',
  ADD COLUMN apac_id BIGINT UNSIGNED NULL COMMENT 'APAC do item',
  ADD KEY ix_conta_hospitalar_item_procedimento_sigtap_informado (procedimento_sigtap_informado_id),
  ADD KEY ix_conta_hospitalar_item_cid_termo_terminologia_id (cid_termo_terminologia_id),
  ADD KEY ix_conta_hospitalar_item_apac_id (apac_id);
