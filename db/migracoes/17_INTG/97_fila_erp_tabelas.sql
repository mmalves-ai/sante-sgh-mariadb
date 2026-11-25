-- Fila com o sistema de gestão corporativo (08-INTG L136): só para frente e idempotente (ADR 0002, parte 2).
-- O lote passa a cobrir também compras (pedidos de compra) e faturamento (faturas às fontes pagadoras), além de contas
-- a pagar, contas a receber e estoque.

ALTER TABLE exportacao_erp
  DROP CONSTRAINT IF EXISTS ck_exportacao_erp_tipo,
  ADD CONSTRAINT ck_exportacao_erp_tipo CHECK (tipo IN ('contabil','financeiro_pagar','financeiro_receber','estoque','compras','faturamento','fornecedor','plano_contas','centro_custo','caucao','folha','outro'));
