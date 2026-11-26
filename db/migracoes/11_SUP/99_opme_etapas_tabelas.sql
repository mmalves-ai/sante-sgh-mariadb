-- Suprimentos, OPME (órteses, próteses e materiais especiais), etapas logísticas da solicitação (C3-021, 05-SUP linha
-- 25, 26/11/2026): só para frente e idempotente (ADR 0002, parte 2). O pedido de compra, o recebimento em consignação,
-- a esterilização na CME (central de material e esterilização) e a nota fiscal de entrada ficam ligados à solicitação
-- por chave, cada um à estrutura real que já existe (pedido_compra, remessa_consignada, recebimento_material_terceiro,
-- nota_entrada): nada de número solto em texto. Uma linha por etapa registrada; a situação da solicitação é lida dos
-- registros. O consumo em sala ganha o modelo do material (o rastreio pede fabricante, modelo, lote e série).
-- A regra de cada etapa é do domínio (regras/opme: conferirEtapaOpme e escolherVinculoEtapaOpme); o banco só guarda.
CREATE TABLE IF NOT EXISTS etapa_solicitacao_opme (
  id                               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id               BIGINT UNSIGNED NOT NULL,
  solicitacao_opme_id              BIGINT UNSIGNED NOT NULL,
  etapa                            VARCHAR(20) NOT NULL,
  pedido_compra_id                 BIGINT UNSIGNED NULL,
  remessa_consignada_id            BIGINT UNSIGNED NULL,
  recebimento_material_terceiro_id BIGINT UNSIGNED NULL COMMENT 'Recebimento do material na CME, reprocessado e disponível',
  nota_entrada_id                  BIGINT UNSIGNED NULL,
  empresa_fornecedora_id           BIGINT UNSIGNED NULL,
  observacao                       VARCHAR(4000) NULL,
  registrado_por_usuario_id        BIGINT UNSIGNED NOT NULL,
  registrado_em                    DATETIME(3) NOT NULL,
  origem                           VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em                        DATETIME(3) NOT NULL,
  criado_por                       BIGINT UNSIGNED NULL,
  alterado_em                      DATETIME(3) NULL,
  alterado_por                     BIGINT UNSIGNED NULL,
  versao                           INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em                      DATETIME(3) NULL,
  excluido_por                     BIGINT UNSIGNED NULL,
  CONSTRAINT ck_etapa_solicitacao_opme_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_etapa_solicitacao_opme_etapa CHECK (etapa IN ('pedido','consignacao','esterilizacao','nota_fiscal')),
  CONSTRAINT ck_etapa_solicitacao_opme_vinculo CHECK (
    (etapa = 'pedido' AND pedido_compra_id IS NOT NULL) OR
    (etapa = 'consignacao' AND remessa_consignada_id IS NOT NULL) OR
    (etapa = 'esterilizacao' AND recebimento_material_terceiro_id IS NOT NULL) OR
    (etapa = 'nota_fiscal' AND nota_entrada_id IS NOT NULL)),
  KEY ix_etapa_solicitacao_opme_estabelecimento (estabelecimento_id),
  KEY ix_etapa_solicitacao_opme_solicitacao (solicitacao_opme_id, registrado_em),
  KEY ix_etapa_solicitacao_opme_pedido_compra (pedido_compra_id),
  KEY ix_etapa_solicitacao_opme_remessa_consignada (remessa_consignada_id),
  KEY ix_etapa_solicitacao_opme_recebimento_terceiro (recebimento_material_terceiro_id),
  KEY ix_etapa_solicitacao_opme_nota_entrada (nota_entrada_id),
  KEY ix_etapa_solicitacao_opme_fornecedor (empresa_fornecedora_id),
  KEY ix_etapa_solicitacao_opme_usuario (registrado_por_usuario_id)
) COMMENT='Etapa logística da solicitação de OPME (pedido, consignação, esterilização, nota) ligada ao documento real';

ALTER TABLE consumo_opme
  ADD COLUMN IF NOT EXISTS modelo VARCHAR(80) NULL COMMENT 'Modelo do material implantado (rastreio)' AFTER fabricante_id;
