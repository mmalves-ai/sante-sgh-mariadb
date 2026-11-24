-- Financeiro, prorrogação do vencimento da parcela a pagar no banco próprio (f3-funcoes F3.8-1, 07-FIN linha 63,
-- 24/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- Cada prorrogação fica registrada para sempre (histórico: nunca alterado nem apagado), com o vencimento de antes, o
-- novo, o motivo, quem e quando. O vencimento original da parcela (parcela_pagar.vencimento_original) não muda: a
-- parcela guarda o vigente e o original, e esta tabela guarda cada passo entre eles.
CREATE TABLE IF NOT EXISTS prorrogacao_parcela_pagar (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id   BIGINT UNSIGNED NOT NULL,
  parcela_pagar_id     BIGINT UNSIGNED NOT NULL,
  vencimento_anterior  DATE NOT NULL COMMENT 'Vencimento vigente antes da prorrogação',
  vencimento_novo      DATE NOT NULL COMMENT 'Vencimento que passou a valer',
  motivo               VARCHAR(300) NOT NULL COMMENT 'Por que o vencimento foi prorrogado (acordo com o credor, atraso na entrega)',
  origem               VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em            DATETIME(3) NOT NULL,
  criado_por           BIGINT UNSIGNED NOT NULL,
  alterado_em          DATETIME(3) NULL COMMENT 'Sempre nulo: o histórico não se altera',
  alterado_por         BIGINT UNSIGNED NULL,
  versao               INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_prorrogacao_parcela_pagar_datas CHECK (vencimento_novo > vencimento_anterior),
  CONSTRAINT ck_prorrogacao_parcela_pagar_motivo CHECK (CHAR_LENGTH(TRIM(motivo)) >= 5),
  CONSTRAINT ck_prorrogacao_parcela_pagar_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_prorrogacao_parcela_pagar_parcela (parcela_pagar_id, criado_em)
) COMMENT='Prorrogação do vencimento da parcela a pagar, com o vencimento anterior, o novo, o motivo, quem e quando';
