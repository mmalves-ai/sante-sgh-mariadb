-- F2.4 (dívida da migração), 3ª etapa: DDL pedido pelos lotes da 2ª volta, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v3.md

-- Lotes da folha externa: o exportado anterior passa a substituído, e o lote tem número de negócio.
ALTER TABLE lote_folha_intercambio
  ADD COLUMN IF NOT EXISTS numero INT UNSIGNED NOT NULL COMMENT 'Número de negócio do lote no estabelecimento (sequência lote_folha_intercambio)' AFTER estabelecimento_id,
  DROP CONSTRAINT IF EXISTS ck_lote_folha_intercambio_situacao,
  ADD CONSTRAINT ck_lote_folha_intercambio_situacao CHECK (situacao IN ('gerado','conferido','divergente','lancado','cancelado','substituido')),
  ADD UNIQUE KEY IF NOT EXISTS uq_lote_folha_intercambio_numero (estabelecimento_id, numero);

-- Avaliação de desempenho: as avaliações de 45 e de 90 dias do mesmo avaliador não colidem.
ALTER TABLE avaliacao_desempenho
  ADD COLUMN IF NOT EXISTS marco_experiencia_chave SMALLINT UNSIGNED AS (IFNULL(marco_experiencia_dias, 0)) PERSISTENT COMMENT 'Só para a unicidade: o marco da experiência (0 fora dela)',
  DROP INDEX IF EXISTS uq_avaliacao_desempenho_versao,
  ADD UNIQUE KEY IF NOT EXISTS uq_avaliacao_desempenho_versao_marco (ciclo_avaliacao_id, colaborador_id, avaliador_colaborador_id, tipo, marco_experiencia_chave, numero_versao);

-- Parâmetros do empregador no eSocial: de-para do motivo de afastamento para a tabela oficial, por vigência do cadastro.
CREATE TABLE IF NOT EXISTS cadastro_empregador_motivo_afastamento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cadastro_empregador_id BIGINT UNSIGNED NOT NULL COMMENT 'Cadastro do empregador na vigência',
  motivo_afastamento_id BIGINT UNSIGNED NOT NULL,
  codigo_esocial CHAR(2) NOT NULL COMMENT 'Código do motivo na tabela oficial de motivos de afastamento',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_cadastro_empregador_motivo_afastamento_codigo CHECK (codigo_esocial REGEXP '^[0-9]{2}$'),
  UNIQUE KEY uq_cadastro_empregador_motivo_afastamento (cadastro_empregador_id, motivo_afastamento_id),
  KEY ix_cadastro_empregador_motivo_afastamento_motivo (motivo_afastamento_id)
) COMMENT='De-para do motivo de afastamento do hospital para o código oficial do eSocial, por vigência do cadastro do empregador';

-- Ficha do eSocial do vínculo: o que faltava no cadastro estruturado (o resto já está na pessoa, no endereço,
-- no estágio e no regime de jornada).
ALTER TABLE vinculo_trabalho
  ADD COLUMN IF NOT EXISTS regime_controle_jornada VARCHAR(30) NOT NULL DEFAULT 'submetido_horario' COMMENT 'Controle da jornada: horário de trabalho, atividade externa, cargo de confiança ou teletrabalho',
  ADD COLUMN IF NOT EXISTS indicativo_admissao VARCHAR(20) NOT NULL DEFAULT 'normal' COMMENT 'Admissão normal, por ação fiscal ou por decisão judicial',
  DROP CONSTRAINT IF EXISTS ck_vinculo_trabalho_regime_controle_jornada,
  ADD CONSTRAINT ck_vinculo_trabalho_regime_controle_jornada CHECK (regime_controle_jornada IN ('submetido_horario','atividade_externa','cargo_confianca','teletrabalho')),
  DROP CONSTRAINT IF EXISTS ck_vinculo_trabalho_indicativo_admissao,
  ADD CONSTRAINT ck_vinculo_trabalho_indicativo_admissao CHECK (indicativo_admissao IN ('normal','acao_fiscal','decisao_judicial'));

-- Conferência do eSocial: a situação exata de cada linha (as tabelas estavam vazias em todos os clientes).
UPDATE conferencia_eventos_esocial_item SET situacao = 'conciliado' WHERE situacao = 'conciliada';
ALTER TABLE conferencia_eventos_esocial_item
  DROP CONSTRAINT IF EXISTS ck_conferencia_eventos_esocial_item_situacao,
  ADD CONSTRAINT ck_conferencia_eventos_esocial_item_situacao CHECK (situacao IN ('conciliado','dois_transmissores','repasse_no_periodico','repasse_no_externo','so_contagem','sem_transmissor'));

-- Processamento da folha: o recálculo substitui o vigente, a contagem dos vínculos fora da folha e a vigência
-- da tabela legal e dos parâmetros usados (as tabelas estavam vazias em todos os clientes).
ALTER TABLE processamento_folha
  DROP CONSTRAINT IF EXISTS ck_processamento_folha_json,
  DROP CONSTRAINT IF EXISTS ck_processamento_folha_situacao;
ALTER TABLE processamento_folha
  DROP COLUMN IF EXISTS fora_da_folha,
  DROP COLUMN IF EXISTS tabela_legal,
  DROP COLUMN IF EXISTS parametros,
  ADD COLUMN IF NOT EXISTS quantidade_fora_da_folha SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Vínculos que o cálculo deixou de fora' AFTER totais,
  ADD COLUMN IF NOT EXISTS tabela_legal_inicio DATE NULL COMMENT 'Início da vigência da tabela legal usada' AFTER quantidade_fora_da_folha,
  ADD COLUMN IF NOT EXISTS parametros_inicio DATE NULL COMMENT 'Início da vigência dos parâmetros da folha usados' AFTER tabela_legal_inicio,
  ADD CONSTRAINT ck_processamento_folha_situacao CHECK (situacao IN ('calculada','substituida','descartada')),
  ADD CONSTRAINT ck_processamento_folha_json CHECK (JSON_VALID(totais));
ALTER TABLE processamento_folha_linha
  ADD COLUMN IF NOT EXISTS unidade VARCHAR(12) NOT NULL COMMENT 'Unidade da quantidade' AFTER quantidade,
  ADD COLUMN IF NOT EXISTS memoria_calculo VARCHAR(400) NOT NULL DEFAULT '' COMMENT 'Memória do cálculo da linha' AFTER dias_pagos,
  DROP CONSTRAINT IF EXISTS ck_processamento_folha_linha_unidade,
  ADD CONSTRAINT ck_processamento_folha_linha_unidade CHECK (unidade IN ('dias','minutos','dependentes','percentual','valor'));

-- Integração da folha com o financeiro: a conta contábil sugerida ao contábil por destino.
ALTER TABLE integracao_folha_financeiro_destino
  ADD COLUMN IF NOT EXISTS conta_contabil_id BIGINT UNSIGNED NULL COMMENT 'Conta contábil sugerida ao contábil' AFTER natureza_financeira_id,
  ADD KEY IF NOT EXISTS ix_integracao_folha_financeiro_destino_conta_contabil (conta_contabil_id);
