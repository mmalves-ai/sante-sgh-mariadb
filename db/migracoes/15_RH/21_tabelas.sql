-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE ajuste_ponto
  ADD COLUMN IF NOT EXISTS data_referencia DATE NULL COMMENT 'Dia abonado pela justificativa',
  DROP CONSTRAINT IF EXISTS ck_ajuste_ponto_data_referencia,
  ADD CONSTRAINT ck_ajuste_ponto_data_referencia CHECK (data_referencia IS NULL OR tipo = 'justificativa');
ALTER TABLE rubrica
  ADD COLUMN IF NOT EXISTS papel_resumo_folha VARCHAR(20) NULL COMMENT 'Em que total do resumo da folha a rubrica soma',
  DROP CONSTRAINT IF EXISTS ck_rubrica_papel_resumo_folha,
  ADD CONSTRAINT ck_rubrica_papel_resumo_folha CHECK (papel_resumo_folha IS NULL OR papel_resumo_folha IN ('proventos','descontos','liquido','inss','inss_patronal','fgts','irrf','pis','sindical','pensao','consignado'));
ALTER TABLE lote_folha_externa_item
  ADD COLUMN IF NOT EXISTS vencimento DATE NULL COMMENT 'Vencimento informado pela folha externa';

CREATE TABLE IF NOT EXISTS integracao_folha_financeiro (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  vigencia_inicio DATE NOT NULL,
  vigente_chave TINYINT AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade entre os não excluídos',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_integracao_folha_financeiro_vigencia (estabelecimento_id, vigencia_inicio, vigente_chave)
) COMMENT='Vigência da integração da folha com o financeiro (credor, classificação e vencimento por destino)';

CREATE TABLE IF NOT EXISTS integracao_folha_financeiro_destino (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  integracao_folha_financeiro_id BIGINT UNSIGNED NOT NULL,
  destino VARCHAR(30) NOT NULL,
  empresa_fornecedora_id BIGINT UNSIGNED NOT NULL COMMENT 'Credor do título a pagar',
  natureza_financeira_id BIGINT UNSIGNED NOT NULL COMMENT 'Classificação financeira do título',
  dia_vencimento TINYINT UNSIGNED NOT NULL,
  mes_vencimento VARCHAR(10) NOT NULL DEFAULT 'seguinte',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_integracao_folha_financeiro_destino_destino CHECK (destino IN ('liquido_mensal','liquido_ferias','liquido_rescisao','liquido_decimo','inss','inss_patronal','fgts','irrf','sindical','pensao','consignado','outro')),
  CONSTRAINT ck_integracao_folha_financeiro_destino_dia CHECK (dia_vencimento BETWEEN 1 AND 31),
  CONSTRAINT ck_integracao_folha_financeiro_destino_mes CHECK (mes_vencimento IN ('mesmo','seguinte')),
  UNIQUE KEY uq_integracao_folha_financeiro_destino (integracao_folha_financeiro_id, destino),
  KEY ix_integracao_folha_financeiro_destino_credor (empresa_fornecedora_id),
  KEY ix_integracao_folha_financeiro_destino_natureza (natureza_financeira_id)
) COMMENT='Destino da folha (líquido, encargo, pensão) com credor, classificação e vencimento do título';

CREATE TABLE IF NOT EXISTS lancamento_titulos_folha (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  competencia_folha_id BIGINT UNSIGNED NOT NULL,
  origem_lancamento VARCHAR(20) NOT NULL COMMENT 'Fechamento da folha própria ou interface da folha externa',
  origem_id BIGINT UNSIGNED NOT NULL COMMENT 'Fechamento ou lote da folha externa que originou o lançamento',
  apuracao VARCHAR(20) NULL,
  resumo VARCHAR(400) NULL,
  total_liquido DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_encargos DECIMAL(15,2) NOT NULL DEFAULT 0,
  lancado_em DATETIME(3) NOT NULL,
  lancado_por_usuario_id BIGINT UNSIGNED NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_lancamento_titulos_folha_origem_lancamento CHECK (origem_lancamento IN ('fechamento','interface')),
  CONSTRAINT ck_lancamento_titulos_folha_totais CHECK (total_liquido >= 0 AND total_encargos >= 0),
  CONSTRAINT ck_lancamento_titulos_folha_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_lancamento_titulos_folha_origem (estabelecimento_id, origem_lancamento, origem_id),
  KEY ix_lancamento_titulos_folha_competencia (competencia_folha_id),
  KEY ix_lancamento_titulos_folha_lancado_por (lancado_por_usuario_id)
) COMMENT='Lançamento dos títulos a pagar de uma competência da folha, a partir do fechamento ou da folha externa';

ALTER TABLE titulo_folha
  ADD COLUMN IF NOT EXISTS lancamento_titulos_folha_id BIGINT UNSIGNED NOT NULL COMMENT 'Lançamento que gerou o título' AFTER competencia_folha_id,
  ADD COLUMN IF NOT EXISTS empresa_fornecedora_id BIGINT UNSIGNED NULL COMMENT 'Credor do título (o mesmo do título a pagar); nulo só no líquido' AFTER destino,
  DROP CONSTRAINT IF EXISTS ck_titulo_folha_credor,
  ADD CONSTRAINT ck_titulo_folha_credor CHECK (destino LIKE 'liquido%' OR empresa_fornecedora_id IS NOT NULL),
  ADD KEY IF NOT EXISTS ix_titulo_folha_lancamento (lancamento_titulos_folha_id),
  ADD KEY IF NOT EXISTS ix_titulo_folha_empresa_fornecedora (empresa_fornecedora_id);
