-- Referência do empenho no título a pagar (C3-025, 07-FIN linha 132, 26/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). A execução orçamentária fica no sistema contábil do ente; o hospital guarda só a referência do empenho que
-- recebeu (tabela empenho de suprimentos), já ligada ao pedido de compra (pedido_compra.empenho_id), e agora também ao
-- título a pagar que o liquida. A regra (empenho em vigor, mesmo credor, soma dos títulos até o valor empenhado) é do
-- domínio (regras-suprimentos/referencia-empenho); o banco só guarda.
ALTER TABLE titulo_pagar
  ADD COLUMN IF NOT EXISTS empenho_id BIGINT UNSIGNED NULL COMMENT 'Empenho do ente que o título liquida (só a referência)',
  ADD INDEX IF NOT EXISTS ix_titulo_pagar_empenho (empenho_id);
