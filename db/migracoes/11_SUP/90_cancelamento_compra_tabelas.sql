-- Suprimentos, cancelamento do pedido de compra como evento (F3.6, 05-SUP linha 20, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2).
-- Cada cancelamento de um item do pedido (de parte, de todo o pendente ou do pedido inteiro) vira uma linha própria:
-- quanto, o motivo do cadastro, a justificativa, quem e quando. O item guarda só o acumulado (quantidade_cancelada); o
-- histórico de todos os cancelamentos, inclusive os parciais, fica aqui e nunca é alterado nem apagado.
CREATE TABLE IF NOT EXISTS cancelamento_pedido_compra_item (
  id                            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pedido_compra_id              BIGINT UNSIGNED NOT NULL,
  pedido_compra_item_id         BIGINT UNSIGNED NOT NULL,
  abrangencia                   VARCHAR(10) NOT NULL COMMENT 'item (parte ou todo o pendente do item) ou pedido (o pedido inteiro)',
  quantidade                    DECIMAL(15,4) NOT NULL COMMENT 'Quantidade cancelada neste evento',
  motivo_cancelamento_compra_id BIGINT UNSIGNED NOT NULL,
  justificativa                 VARCHAR(500) NULL COMMENT 'Obrigatória quando o motivo exige (regra no domínio)',
  usuario_id                    BIGINT UNSIGNED NOT NULL COMMENT 'Quem cancelou',
  ocorrido_em                   DATETIME(3) NOT NULL,
  origem                        VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'sistema, migracao ou integracao',
  criado_em                     DATETIME(3) NOT NULL,
  criado_por                    BIGINT UNSIGNED NULL,
  alterado_em                   DATETIME(3) NULL,
  alterado_por                  BIGINT UNSIGNED NULL,
  versao                        INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em                   DATETIME(3) NULL,
  excluido_por                  BIGINT UNSIGNED NULL,
  CONSTRAINT ck_cancelamento_pedido_compra_item_abrangencia CHECK (abrangencia IN ('item','pedido')),
  CONSTRAINT ck_cancelamento_pedido_compra_item_quantidade CHECK (quantidade > 0),
  CONSTRAINT ck_cancelamento_pedido_compra_item_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_cancelamento_pedido_compra_item_pedido (pedido_compra_id, ocorrido_em),
  KEY ix_cancelamento_pedido_compra_item_item (pedido_compra_item_id, ocorrido_em),
  KEY ix_cancelamento_pedido_compra_item_motivo (motivo_cancelamento_compra_id),
  KEY ix_cancelamento_pedido_compra_item_usuario_id (usuario_id)
) COMMENT='Cada cancelamento de item do pedido de compra, com quantidade, motivo, justificativa, quem e quando';

-- A parte de cada entrega programada abatida pelo cancelamento: a entrega aponta para o evento que a reduziu (uma
-- entrega pode ser abatida por mais de um cancelamento parcial).
CREATE TABLE IF NOT EXISTS cancelamento_pedido_compra_entrega (
  id                                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cancelamento_pedido_compra_item_id BIGINT UNSIGNED NOT NULL,
  pedido_compra_entrega_id           BIGINT UNSIGNED NOT NULL,
  quantidade                         DECIMAL(15,4) NOT NULL COMMENT 'Quantidade abatida desta entrega',
  origem                             VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'sistema, migracao ou integracao',
  criado_em                          DATETIME(3) NOT NULL,
  criado_por                         BIGINT UNSIGNED NULL,
  alterado_em                        DATETIME(3) NULL,
  alterado_por                       BIGINT UNSIGNED NULL,
  versao                             INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em                        DATETIME(3) NULL,
  excluido_por                       BIGINT UNSIGNED NULL,
  CONSTRAINT ck_cancelamento_pedido_compra_entrega_quantidade CHECK (quantidade > 0),
  CONSTRAINT ck_cancelamento_pedido_compra_entrega_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_cancelamento_pedido_compra_entrega (cancelamento_pedido_compra_item_id, pedido_compra_entrega_id),
  KEY ix_cancelamento_pedido_compra_entrega_entrega (pedido_compra_entrega_id)
) COMMENT='Parte de cada entrega programada abatida por um cancelamento do item do pedido de compra';
