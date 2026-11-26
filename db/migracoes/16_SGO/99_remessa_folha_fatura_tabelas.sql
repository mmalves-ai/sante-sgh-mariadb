-- Cobrança da mensalidade que o item da remessa de desconto em folha leva (C3-028, 08-SGO linha 97, 26/11/2026): só
-- para frente e idempotente (ADR 0002, parte 2). O retorno da contratante baixa a cobrança pelo item; sem esta ligação a
-- baixa teria de adivinhar a fatura pelo beneficiário e pela competência. A regra (o que entra na remessa, a conciliação
-- do retorno, a baixa) é do domínio (dominio-operadora/desconto-folha); o banco só guarda.
ALTER TABLE remessa_desconto_folha_item
  ADD COLUMN IF NOT EXISTS fatura_plano_id BIGINT UNSIGNED NULL COMMENT 'Cobrança que o item leva ao desconto em folha',
  ADD INDEX IF NOT EXISTS ix_remessa_desconto_folha_item_fatura_plano (fatura_plano_id);
