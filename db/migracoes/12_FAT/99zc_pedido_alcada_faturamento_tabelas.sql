-- FAT, lote 99zc (F3.7, 06-FAT linha 38, C1-135): o pedido de aprovação pela alçada do faturamento. Quem pede grava o
-- pedido pendente (documento fat_*, a referência do documento e o valor); outro usuário, com a alçada vigente do
-- documento para aquele valor, aprova ou recusa (quem pede não aprova); o fluxo do documento consome a aprovação
-- uma vez só (situação 'usado'). Nada se apaga. Só para frente; idempotente.
CREATE TABLE IF NOT EXISTS pedido_alcada_faturamento (
  id                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id         BIGINT UNSIGNED NOT NULL,
  documento                  VARCHAR(40) NOT NULL COMMENT 'Código do tipo de documento de aprovação (fat_*)',
  referencia_tabela          VARCHAR(64) NOT NULL COMMENT 'Tabela do documento (fechamento da competência, glosa, conta)',
  referencia_id              BIGINT UNSIGNED NOT NULL,
  valor                      DECIMAL(15,2) NOT NULL COMMENT 'Valor do documento no pedido (faixa da alçada)',
  motivo                     VARCHAR(250) NOT NULL,
  situacao                   VARCHAR(20) NOT NULL DEFAULT 'pendente',
  solicitado_por_usuario_id  BIGINT UNSIGNED NOT NULL,
  solicitado_em              DATETIME(3) NOT NULL,
  decidido_por_usuario_id    BIGINT UNSIGNED NULL,
  decidido_em                DATETIME(3) NULL,
  nivel_alcada               SMALLINT UNSIGNED NULL COMMENT 'Nível da alçada que cobriu a aprovação',
  motivo_decisao             VARCHAR(250) NULL,
  usado_em                   DATETIME(3) NULL COMMENT 'Quando o fluxo do documento consumiu a aprovação',
  origem                     VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em                  DATETIME(3) NOT NULL,
  criado_por                 BIGINT UNSIGNED NULL,
  alterado_em                DATETIME(3) NULL,
  alterado_por               BIGINT UNSIGNED NULL,
  versao                     INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em                DATETIME(3) NULL,
  excluido_por               BIGINT UNSIGNED NULL,
  CONSTRAINT ck_pedido_alcada_faturamento_documento CHECK (documento IN ('fat_reabertura_competencia','fat_aceite_glosa','fat_cancelamento_conta')),
  CONSTRAINT ck_pedido_alcada_faturamento_situacao CHECK (situacao IN ('pendente','aprovado','recusado','usado')),
  CONSTRAINT ck_pedido_alcada_faturamento_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_pedido_alcada_faturamento_valor CHECK (valor >= 0),
  CONSTRAINT ck_pedido_alcada_faturamento_decisao CHECK (situacao = 'pendente' OR (decidido_por_usuario_id IS NOT NULL AND decidido_em IS NOT NULL)),
  CONSTRAINT ck_pedido_alcada_faturamento_quem CHECK (decidido_por_usuario_id IS NULL OR decidido_por_usuario_id <> solicitado_por_usuario_id),
  KEY ix_pedido_alcada_faturamento_referencia (documento, referencia_id, situacao),
  KEY ix_pedido_alcada_faturamento_estabelecimento (estabelecimento_id, situacao),
  KEY ix_pedido_alcada_faturamento_solicitante (solicitado_por_usuario_id),
  KEY ix_pedido_alcada_faturamento_decisor (decidido_por_usuario_id)
) COMMENT='Pedido de aprovação pela alçada do faturamento: quem pede não aprova; a aprovação vale uma vez';
