-- Financeiro, parcelas a pagar enviadas em remessa bancária (F3.8, 07-FIN linha 63, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2).
-- Cada parcela enviada no arquivo de remessa fica ligada a ela, com o valor e o vencimento mandados ao banco, e o vínculo
-- fica pendente até o retorno. Enquanto pendente, o vencimento da parcela não é prorrogado (o banco pagaria na data
-- antiga). O retorno do banco marca o vínculo como retornado ou rejeitado; nada é apagado.
CREATE TABLE IF NOT EXISTS parcela_remessa_bancaria (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  remessa_bancaria_id BIGINT UNSIGNED NOT NULL,
  parcela_pagar_id    BIGINT UNSIGNED NOT NULL,
  valor               DECIMAL(15,2) NOT NULL COMMENT 'Valor enviado ao banco',
  vencimento          DATE NOT NULL COMMENT 'Vencimento enviado ao banco',
  situacao            VARCHAR(20) NOT NULL DEFAULT 'pendente',
  retornada_em        DATETIME(3) NULL COMMENT 'Quando o retorno do banco respondeu pela parcela',
  origem              VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'sistema, migracao ou integracao',
  criado_em           DATETIME(3) NOT NULL,
  criado_por          BIGINT UNSIGNED NULL,
  alterado_em         DATETIME(3) NULL,
  alterado_por        BIGINT UNSIGNED NULL,
  versao              INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em         DATETIME(3) NULL,
  excluido_por        BIGINT UNSIGNED NULL,
  CONSTRAINT ck_parcela_remessa_bancaria_situacao CHECK (situacao IN ('pendente','retornada','rejeitada')),
  CONSTRAINT ck_parcela_remessa_bancaria_retorno CHECK ((situacao = 'pendente') = (retornada_em IS NULL)),
  CONSTRAINT ck_parcela_remessa_bancaria_valor CHECK (valor > 0),
  CONSTRAINT ck_parcela_remessa_bancaria_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_parcela_remessa_bancaria (remessa_bancaria_id, parcela_pagar_id),
  KEY ix_parcela_remessa_bancaria_parcela (parcela_pagar_id, situacao)
) COMMENT='Parcela a pagar enviada numa remessa bancária, pendente até o retorno do banco';
