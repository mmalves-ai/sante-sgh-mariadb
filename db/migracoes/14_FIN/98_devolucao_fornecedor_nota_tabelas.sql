-- Suprimentos e financeiro, devolução de compra ao fornecedor (C2-015, 05-SUP linha 22, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Fica no 14_FIN porque liga a devolução (11_SUP) à nota de crédito (14_FIN).
-- 1) A nota de crédito do fornecedor que nasce da devolução guarda a devolução de origem (devolucao_fornecedor_id): a
--    devolução abate uma ou mais parcelas do título a pagar da nota de entrada, uma nota por parcela.
-- 2) A devolução guarda o quanto abateu no contas a pagar e o crédito que sobrou sem parcela em aberto (a compensar).
-- 3) O tipo de movimento "devolucao_fornecedor" (saída pelo valor da compra, recalcula o custo médio) e os motivos de
--    devolução ao fornecedor entram nos catálogos (nativos; INSERT IGNORE pelo código não reescreve o que o hospital
--    já ajustou).
-- A regra é do domínio (conferirDevolucaoFornecedor, valoresDevolucao, distribuirAbatimento); o banco só guarda.
ALTER TABLE nota_credito_debito
  ADD COLUMN IF NOT EXISTS devolucao_fornecedor_id BIGINT UNSIGNED NULL
    COMMENT 'Devolução ao fornecedor que originou a nota de crédito' AFTER nota_entrada_id;
CREATE INDEX IF NOT EXISTS ix_nota_credito_debito_devolucao_fornecedor ON nota_credito_debito (devolucao_fornecedor_id);
ALTER TABLE nota_credito_debito ADD CONSTRAINT fk_nota_credito_debito_devolucao_fornecedor_id
  FOREIGN KEY IF NOT EXISTS (devolucao_fornecedor_id) REFERENCES devolucao_fornecedor (id) ON DELETE RESTRICT;

ALTER TABLE devolucao_fornecedor
  ADD COLUMN IF NOT EXISTS valor_abatido DECIMAL(15,2) NOT NULL DEFAULT 0
    COMMENT 'Quanto a devolução abateu nas parcelas a pagar da nota de entrada' AFTER titulo_pagar_id,
  ADD COLUMN IF NOT EXISTS valor_credito_pendente DECIMAL(15,2) NOT NULL DEFAULT 0
    COMMENT 'Crédito do fornecedor que sobrou sem parcela em aberto (a compensar)' AFTER valor_abatido;
ALTER TABLE devolucao_fornecedor
  ADD CONSTRAINT IF NOT EXISTS ck_devolucao_fornecedor_abatimento
    CHECK (valor_abatido >= 0 AND valor_credito_pendente >= 0 AND valor_abatido + valor_credito_pendente <= valor_total),
  ADD CONSTRAINT IF NOT EXISTS ck_devolucao_fornecedor_sem_abater
    CHECK (abate_contas_pagar = TRUE OR (valor_abatido = 0 AND valor_credito_pendente = 0));

INSERT IGNORE INTO tipo_movimento_estoque (codigo, descricao, natureza, sentido, afeta_saldo, afeta_custo_medio, sistema, ativo, criado_em) VALUES
  ('devolucao_fornecedor', 'Devolução de compra ao fornecedor', 'devolucao_fornecedor', 'saida', TRUE, TRUE, TRUE, TRUE, UTC_TIMESTAMP(3));

INSERT IGNORE INTO motivo_devolucao_fornecedor (codigo, descricao, tipo_fiscal, criado_em) VALUES
  ('avaria', 'Produto avariado ou embalagem violada no recebimento', 'devolucao_compra', UTC_TIMESTAMP(3)),
  ('divergencia_pedido', 'Produto, quantidade ou apresentação diferente do pedido', 'devolucao_compra', UTC_TIMESTAMP(3)),
  ('validade_curta', 'Validade abaixo do mínimo aceito no recebimento', 'devolucao_compra', UTC_TIMESTAMP(3)),
  ('desvio_qualidade', 'Desvio de qualidade notificado (queixa técnica)', 'devolucao_compra', UTC_TIMESTAMP(3)),
  ('recolhimento_sanitario', 'Recolhimento de lote determinado pela vigilância sanitária ou pelo fabricante', 'recolhimento', UTC_TIMESTAMP(3)),
  ('troca', 'Remessa para troca pelo fornecedor', 'remessa_troca', UTC_TIMESTAMP(3));
