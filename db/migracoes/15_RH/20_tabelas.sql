-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

CREATE TABLE quadro_vaga (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  cargo_id BIGINT UNSIGNED NOT NULL,
  centro_custo_id BIGINT UNSIGNED NOT NULL,
  quantidade SMALLINT UNSIGNED NOT NULL,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  quadro_vaga_anterior_id BIGINT UNSIGNED NULL COMMENT 'Versão que esta substitui',
  motivo_alteracao VARCHAR(400) NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  motivo_situacao VARCHAR(400) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_quadro_vaga_quantidade CHECK (quantidade BETWEEN 1 AND 9999),
  CONSTRAINT ck_quadro_vaga_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_quadro_vaga_anterior CHECK (quadro_vaga_anterior_id IS NULL OR motivo_alteracao IS NOT NULL),
  UNIQUE KEY uq_quadro_vaga_vigencia (estabelecimento_id, cargo_id, centro_custo_id, vigencia_inicio),
  UNIQUE KEY uq_quadro_vaga_anterior (quadro_vaga_anterior_id),
  KEY ix_quadro_vaga_cargo (cargo_id),
  KEY ix_quadro_vaga_centro_custo (centro_custo_id),
  CONSTRAINT ck_quadro_vaga_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Quadro de vagas aprovado por cargo e centro de custo, com vigência e versão';

ALTER TABLE faixa_salarial
  ADD COLUMN IF NOT EXISTS vigencia_inicio DATE NULL COMMENT 'Início desta versão da faixa (nulo: a da tabela salarial)',
  ADD COLUMN IF NOT EXISTS vigencia_fim DATE NULL,
  ADD COLUMN IF NOT EXISTS faixa_salarial_anterior_id BIGINT UNSIGNED NULL COMMENT 'Versão que esta substitui',
  ADD COLUMN IF NOT EXISTS motivo_alteracao VARCHAR(400) NULL,
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS motivo_situacao VARCHAR(400) NULL,
  ADD COLUMN IF NOT EXISTS vigencia_chave DATE AS (IFNULL(vigencia_inicio, '1000-01-01')) PERSISTENT COMMENT 'Só para a unicidade: a faixa sem vigência própria conta como uma',
  DROP CONSTRAINT IF EXISTS ck_faixa_salarial_vigencia,
  ADD CONSTRAINT ck_faixa_salarial_vigencia CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio),
  DROP CONSTRAINT IF EXISTS ck_faixa_salarial_anterior,
  ADD CONSTRAINT ck_faixa_salarial_anterior CHECK (faixa_salarial_anterior_id IS NULL OR motivo_alteracao IS NOT NULL),
  ADD UNIQUE KEY IF NOT EXISTS uq_faixa_salarial_anterior (faixa_salarial_anterior_id),
  ADD UNIQUE KEY IF NOT EXISTS uq_faixa_salarial_cargo_nivel_vigencia (tabela_salarial_id, cargo_id, nivel, degrau, vigencia_chave),
  DROP INDEX IF EXISTS uq_faixa_salarial_tabela_salarial_id_cargo_id_nivel_degrau;
ALTER TABLE plantao
  ADD COLUMN IF NOT EXISTS inscricao_conselho_id BIGINT UNSIGNED NULL COMMENT 'Inscrição no conselho com que o profissional assume o plantão',
  ADD KEY IF NOT EXISTS ix_plantao_inscricao_conselho (inscricao_conselho_id);
ALTER TABLE recibo_ferias
  ADD COLUMN IF NOT EXISTS processamento_folha_id BIGINT UNSIGNED NULL COMMENT 'Processamento da folha que calculou as férias',
  ADD KEY IF NOT EXISTS ix_recibo_ferias_processamento_folha (processamento_folha_id);
ALTER TABLE rescisao
  ADD COLUMN IF NOT EXISTS processamento_folha_id BIGINT UNSIGNED NULL COMMENT 'Processamento da folha que calculou a rescisão',
  ADD KEY IF NOT EXISTS ix_rescisao_processamento_folha (processamento_folha_id);
ALTER TABLE regra_banco_horas
  ADD COLUMN IF NOT EXISTS regime_jornada_id BIGINT UNSIGNED NULL COMMENT 'Regime a que a regra se aplica; nulo: todos',
  ADD COLUMN IF NOT EXISTS destino VARCHAR(20) NULL COMMENT 'Destino do saldo no fim do ciclo',
  ADD COLUMN IF NOT EXISTS inicio_ciclo VARCHAR(30) NULL COMMENT 'Como o ciclo começa (zerado ou com o residual)',
  ADD COLUMN IF NOT EXISTS falta_debita BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A falta debita o banco em vez de descontar na folha',
  DROP CONSTRAINT IF EXISTS ck_regra_banco_horas_destino,
  ADD CONSTRAINT ck_regra_banco_horas_destino CHECK (destino IS NULL OR destino IN ('sem_banco','banco','folha','expiracao_negativa')),
  DROP CONSTRAINT IF EXISTS ck_regra_banco_horas_inicio_ciclo,
  ADD CONSTRAINT ck_regra_banco_horas_inicio_ciclo CHECK (inicio_ciclo IS NULL OR inicio_ciclo IN ('zerado','residual_positivo','residual_negativo','residual_ambos')),
  ADD UNIQUE KEY IF NOT EXISTS uq_regra_banco_horas_regime (estabelecimento_id, regime_jornada_id, vigencia_inicio),
  ADD KEY IF NOT EXISTS ix_regra_banco_horas_regime_jornada (regime_jornada_id);
ALTER TABLE movimento_banco_horas
  ADD COLUMN IF NOT EXISTS vinculo_trabalho_id BIGINT UNSIGNED NULL COMMENT 'Vínculo do movimento (obrigatório na gravação nova; nulo só no anterior à coluna)',
  ADD COLUMN IF NOT EXISTS competencia DATE NULL COMMENT 'Primeiro dia do mês do movimento',
  ADD COLUMN IF NOT EXISTS fechamento_ponto_id BIGINT UNSIGNED NULL,
  DROP CONSTRAINT IF EXISTS ck_movimento_banco_horas_motivo,
  ADD CONSTRAINT ck_movimento_banco_horas_motivo CHECK (motivo IN ('apuracao','ajuste_manual','compensacao','pagamento','desconto','vencimento','saldo_inicial','acerto','inicio_ciclo','pago_folha','expiracao')),
  ADD KEY IF NOT EXISTS ix_movimento_banco_horas_vinculo (vinculo_trabalho_id, competencia),
  ADD KEY IF NOT EXISTS ix_movimento_banco_horas_fechamento_ponto (fechamento_ponto_id);
ALTER TABLE ajuste_ponto
  ADD COLUMN IF NOT EXISTS vinculo_trabalho_id BIGINT UNSIGNED NULL COMMENT 'Vínculo do ajuste (obrigatório na gravação nova; nulo só no anterior à coluna)',
  ADD COLUMN IF NOT EXISTS tipo_movimento_ponto_id BIGINT UNSIGNED NULL COMMENT 'Abono da justificativa',
  ADD COLUMN IF NOT EXISTS minutos INT UNSIGNED NULL COMMENT 'Minutos abonados na justificativa',
  DROP CONSTRAINT IF EXISTS ck_ajuste_ponto_tipo,
  ADD CONSTRAINT ck_ajuste_ponto_tipo CHECK (tipo IN ('inclusao','desconsideracao','justificativa')),
  DROP CONSTRAINT IF EXISTS ck_ajuste_ponto_alvo,
  ADD CONSTRAINT ck_ajuste_ponto_alvo CHECK ((tipo = 'inclusao' AND marcacao_em IS NOT NULL) OR (tipo = 'desconsideracao' AND marcacao_ponto_id IS NOT NULL) OR (tipo = 'justificativa' AND tipo_movimento_ponto_id IS NOT NULL AND minutos IS NOT NULL)),
  ADD KEY IF NOT EXISTS ix_ajuste_ponto_vinculo_situacao (vinculo_trabalho_id, situacao),
  ADD KEY IF NOT EXISTS ix_ajuste_ponto_tipo_movimento (tipo_movimento_ponto_id);
ALTER TABLE curso
  DROP CONSTRAINT IF EXISTS ck_curso_tipo,
  ADD CONSTRAINT ck_curso_tipo CHECK (tipo IN ('integracao','reciclagem','norma_regulamentadora','capacitacao','educacao_continuada','procedimento_operacional','gestao','outro'));

CREATE TABLE processamento_folha (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  competencia DATE NOT NULL COMMENT 'Primeiro dia do mês',
  tipo VARCHAR(20) NOT NULL,
  numero SMALLINT UNSIGNED NOT NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'calculada',
  pagamento_em DATE NULL,
  totais LONGTEXT NOT NULL COMMENT 'Totais do processamento (JSON)',
  fora_da_folha BOOLEAN NOT NULL DEFAULT FALSE,
  tabela_legal LONGTEXT NULL COMMENT 'Tabelas legais usadas (JSON)',
  parametros LONGTEXT NULL COMMENT 'Parâmetros usados (JSON)',
  resumo VARCHAR(1000) NULL,
  motivo VARCHAR(500) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_processamento_folha_tipo CHECK (tipo IN ('mensal','ferias','decimo_terceiro_1','decimo_terceiro_2','rescisao')),
  CONSTRAINT ck_processamento_folha_situacao CHECK (situacao IN ('calculada','descartada')),
  CONSTRAINT ck_processamento_folha_descarte CHECK (situacao <> 'descartada' OR motivo IS NOT NULL),
  CONSTRAINT ck_processamento_folha_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_processamento_folha_json CHECK (JSON_VALID(totais) AND (tabela_legal IS NULL OR JSON_VALID(tabela_legal)) AND (parametros IS NULL OR JSON_VALID(parametros))),
  UNIQUE KEY uq_processamento_folha_numero (estabelecimento_id, competencia, tipo, numero),
  CONSTRAINT ck_processamento_folha_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Processamento do cálculo da folha por estabelecimento, competência e tipo, com totais, parâmetros e tabela legal usados';

CREATE TABLE processamento_folha_linha (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  processamento_folha_id BIGINT UNSIGNED NOT NULL,
  vinculo_trabalho_id BIGINT UNSIGNED NOT NULL,
  papel VARCHAR(40) NOT NULL COMMENT 'Papel do cálculo (o de-para para a rubrica fica nos parâmetros da folha)',
  rubrica_id BIGINT UNSIGNED NULL,
  quantidade DECIMAL(15,4) NULL,
  valor DECIMAL(15,2) NOT NULL,
  centro_custo_id BIGINT UNSIGNED NULL,
  dias_pagos SMALLINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_processamento_folha_linha_dias CHECK (dias_pagos IS NULL OR dias_pagos <= 31),
  KEY ix_processamento_folha_linha_processamento (processamento_folha_id, vinculo_trabalho_id),
  KEY ix_processamento_folha_linha_vinculo (vinculo_trabalho_id),
  KEY ix_processamento_folha_linha_rubrica (rubrica_id),
  KEY ix_processamento_folha_linha_centro_custo (centro_custo_id)
) COMMENT='Linha do processamento da folha por vínculo e papel do cálculo: quantidade, valor, centro de custo e dias pagos';

CREATE TABLE parametro_folha (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  vigencia_inicio DATE NOT NULL,
  dados LONGTEXT NOT NULL COMMENT 'Parâmetros da folha (JSON)',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_parametro_folha_dados CHECK (JSON_VALID(dados)),
  UNIQUE KEY uq_parametro_folha_vigencia (estabelecimento_id, vigencia_inicio)
) COMMENT='Parâmetros da folha por estabelecimento e vigência (JSON validado pelo domínio)';

CREATE TABLE fechamento_periodo_folha (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  apuracao VARCHAR(10) NOT NULL,
  periodo_inicio DATE NOT NULL COMMENT 'Primeiro dia do mês (mensal) ou do ano (anual)',
  numero SMALLINT UNSIGNED NOT NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'fechado',
  pagamento_em DATE NULL,
  processamentos LONGTEXT NOT NULL COMMENT 'Processamentos considerados (JSON com os ids)',
  totais LONGTEXT NOT NULL COMMENT 'Totais do período (JSON)',
  resumo VARCHAR(1000) NULL,
  fechado_em DATETIME(3) NOT NULL,
  fechado_por_usuario_id BIGINT UNSIGNED NOT NULL,
  reaberto_em DATETIME(3) NULL,
  reaberto_por_usuario_id BIGINT UNSIGNED NULL,
  motivo_reabertura VARCHAR(500) NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_fechamento_periodo_folha_apuracao CHECK (apuracao IN ('mensal','anual')),
  CONSTRAINT ck_fechamento_periodo_folha_periodo CHECK (DAYOFMONTH(periodo_inicio) = 1 AND (apuracao = 'mensal' OR MONTH(periodo_inicio) = 1)),
  CONSTRAINT ck_fechamento_periodo_folha_situacao CHECK (situacao IN ('fechado','reaberto')),
  CONSTRAINT ck_fechamento_periodo_folha_reabertura CHECK (situacao <> 'reaberto' OR (reaberto_em IS NOT NULL AND reaberto_por_usuario_id IS NOT NULL AND motivo_reabertura IS NOT NULL)),
  CONSTRAINT ck_fechamento_periodo_folha_json CHECK (JSON_VALID(processamentos) AND JSON_VALID(totais)),
  UNIQUE KEY uq_fechamento_periodo_folha_numero (estabelecimento_id, apuracao, periodo_inicio, numero),
  KEY ix_fechamento_periodo_folha_fechado_por (fechado_por_usuario_id),
  KEY ix_fechamento_periodo_folha_reaberto_por (reaberto_por_usuario_id)
) COMMENT='Fechamento do período da folha (mensal ou anual) por estabelecimento, com totais e reabertura';

CREATE TABLE obrigacao_fechamento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  obrigacao_trabalhista_id BIGINT UNSIGNED NOT NULL,
  fechamento_periodo_folha_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_obrigacao_fechamento (obrigacao_trabalhista_id, fechamento_periodo_folha_id),
  KEY ix_obrigacao_fechamento_fechamento (fechamento_periodo_folha_id)
) COMMENT='Fechamento do período da folha usado numa obrigação trabalhista';

CREATE TABLE evento_periodo_ponto (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  vinculo_trabalho_id BIGINT UNSIGNED NOT NULL,
  competencia DATE NOT NULL COMMENT 'Primeiro dia do mês',
  acao VARCHAR(20) NOT NULL,
  fechamento_ponto_id BIGINT UNSIGNED NULL,
  hash_espelho CHAR(64) NULL COMMENT 'SHA-256 do espelho fechado',
  totais LONGTEXT NULL COMMENT 'Totais do espelho (JSON)',
  concorda BOOLEAN NULL COMMENT 'Ciência: o colaborador concorda com o espelho',
  texto VARCHAR(1000) NULL,
  ocorrido_em DATETIME(3) NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_evento_periodo_ponto_acao CHECK (acao IN ('fechado','reaberto','ciencia')),
  CONSTRAINT ck_evento_periodo_ponto_ciencia CHECK (acao <> 'ciencia' OR concorda IS NOT NULL),
  CONSTRAINT ck_evento_periodo_ponto_fechado CHECK (acao <> 'fechado' OR hash_espelho IS NOT NULL),
  CONSTRAINT ck_evento_periodo_ponto_totais CHECK (totais IS NULL OR JSON_VALID(totais)),
  KEY ix_evento_periodo_ponto_vinculo (vinculo_trabalho_id, competencia),
  KEY ix_evento_periodo_ponto_estabelecimento (estabelecimento_id),
  KEY ix_evento_periodo_ponto_fechamento (fechamento_ponto_id),
  KEY ix_evento_periodo_ponto_usuario (usuario_id),
  CONSTRAINT ck_evento_periodo_ponto_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Evento do período do ponto por vínculo e competência: fechamento, reabertura e ciência do espelho';

CREATE TABLE inscricao_conselho_unidade (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  inscricao_conselho_id BIGINT UNSIGNED NOT NULL,
  unidade_assistencial_id BIGINT UNSIGNED NOT NULL,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_inscricao_conselho_unidade_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE KEY uq_inscricao_conselho_unidade (inscricao_conselho_id, unidade_assistencial_id, vigencia_inicio),
  KEY ix_inscricao_conselho_unidade_unidade (unidade_assistencial_id),
  CONSTRAINT ck_inscricao_conselho_unidade_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Unidade assistencial em que vale a inscrição no conselho de classe, com vigência';

CREATE TABLE curso_publico_alvo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  curso_id BIGINT UNSIGNED NOT NULL,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  setor_funcional_id BIGINT UNSIGNED NULL COMMENT 'Nulo com função nula: todo o estabelecimento',
  funcao_id BIGINT UNSIGNED NULL,
  obrigatorio BOOLEAN NOT NULL DEFAULT TRUE,
  setor_chave BIGINT UNSIGNED AS (IFNULL(setor_funcional_id, 0)) PERSISTENT COMMENT 'Só para a unicidade',
  funcao_chave BIGINT UNSIGNED AS (IFNULL(funcao_id, 0)) PERSISTENT COMMENT 'Só para a unicidade',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_curso_publico_alvo_alvo CHECK (setor_funcional_id IS NULL OR funcao_id IS NULL),
  UNIQUE KEY uq_curso_publico_alvo (curso_id, estabelecimento_id, setor_chave, funcao_chave),
  KEY ix_curso_publico_alvo_estabelecimento (estabelecimento_id),
  KEY ix_curso_publico_alvo_setor (setor_funcional_id),
  KEY ix_curso_publico_alvo_funcao (funcao_id)
) COMMENT='Público do curso no estabelecimento: todo o estabelecimento, um setor ou uma função, e se é obrigatório';

