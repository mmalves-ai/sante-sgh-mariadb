-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

CREATE TABLE versao_regra_contabil (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  evento_contabil_id BIGINT UNSIGNED NOT NULL COMMENT 'Tipo de fato a que a regra se aplica',
  nome VARCHAR(60) NOT NULL,
  numero_versao SMALLINT UNSIGNED NOT NULL,
  prioridade SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  vigencia_inicio DATE NOT NULL,
  vigencia_fim DATE NULL,
  conteudo LONGTEXT NOT NULL COMMENT 'Forma canônica da regra (condições e partidas, JSON)',
  impressao CHAR(64) NOT NULL COMMENT 'SHA-256 da forma canônica',
  justificativa VARCHAR(500) NOT NULL,
  situacao VARCHAR(30) NOT NULL DEFAULT 'publicada',
  publicada_em DATETIME(3) NOT NULL,
  publicador_usuario_id BIGINT UNSIGNED NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_versao_regra_contabil_situacao CHECK (situacao IN ('publicada','substituida')),
  CONSTRAINT ck_versao_regra_contabil_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_versao_regra_contabil_conteudo CHECK (JSON_VALID(conteudo)),
  UNIQUE KEY uq_versao_regra_contabil_versao (estabelecimento_id, evento_contabil_id, nome, numero_versao),
  KEY ix_versao_regra_contabil_evento_contabil (evento_contabil_id),
  KEY ix_versao_regra_contabil_publicador_usuario (publicador_usuario_id),
  CONSTRAINT ck_versao_regra_contabil_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Versão publicada e imutável de uma regra de contabilização de fatos, com conteúdo canônico e impressão';

ALTER TABLE lancamento_contabil
  ADD COLUMN IF NOT EXISTS versao_regra_contabil_id BIGINT UNSIGNED NULL COMMENT 'Versão da regra que gerou o lançamento automático',
  ADD KEY IF NOT EXISTS ix_lancamento_contabil_versao_regra (versao_regra_contabil_id);
ALTER TABLE fato_contabil
  ADD COLUMN IF NOT EXISTS versao_regra_contabil_id BIGINT UNSIGNED NULL COMMENT 'Versão da regra aplicada na última situação',
  ADD KEY IF NOT EXISTS ix_fato_contabil_versao_regra (versao_regra_contabil_id);
ALTER TABLE conciliacao_conta_contabil
  ADD KEY IF NOT EXISTS ix_conciliacao_conta_contabil_conta_periodo (estabelecimento_id, conta_contabil_id, periodo_contabil_id),
  DROP INDEX IF EXISTS uq_conciliacao_conta_contabil_conta_periodo;

CREATE TABLE vinculo_contrato_fornecedor (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contrato_fornecedor_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(10) NOT NULL,
  pedido_compra_id BIGINT UNSIGNED NULL,
  titulo_pagar_id BIGINT UNSIGNED NULL,
  ocorrencia_contrato_id BIGINT UNSIGNED NULL COMMENT 'Exceção aprovada usada',
  pedido_origem_compra_id BIGINT UNSIGNED NULL COMMENT 'Pedido de compra de origem do título',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_vinculo_contrato_fornecedor_tipo CHECK (tipo IN ('pedido','titulo')),
  CONSTRAINT ck_vinculo_contrato_fornecedor_alvo CHECK ((tipo = 'pedido' AND pedido_compra_id IS NOT NULL AND titulo_pagar_id IS NULL) OR (tipo = 'titulo' AND titulo_pagar_id IS NOT NULL AND pedido_compra_id IS NULL)),
  UNIQUE KEY uq_vinculo_contrato_fornecedor_pedido (pedido_compra_id),
  UNIQUE KEY uq_vinculo_contrato_fornecedor_titulo (titulo_pagar_id),
  KEY ix_vinculo_contrato_fornecedor_contrato (contrato_fornecedor_id),
  KEY ix_vinculo_contrato_fornecedor_ocorrencia (ocorrencia_contrato_id),
  KEY ix_vinculo_contrato_fornecedor_pedido_origem (pedido_origem_compra_id)
) COMMENT='Ligação do contrato com fornecedor a um pedido de compra ou a um título a pagar, com a exceção aprovada usada';

