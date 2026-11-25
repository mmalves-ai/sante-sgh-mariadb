-- Controle orçamentário na compra e no pagamento (07-FIN linha 130, C2-112, F8, 25/11/2026): a liberação da reserva
-- (pedido cancelado, título baixado por outro meio) guarda quem liberou, quando e o motivo; a reserva nunca se apaga.
-- Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho: a regra fica no domínio
-- (packages/dominio-financeiro/src/controle-orcamentario.ts) e na porta
-- (apps/api/src/modulos/orcamento/controle-orcamentario-propria.ts).
ALTER TABLE reserva_orcamentaria
  ADD COLUMN IF NOT EXISTS liberado_em DATETIME(3) NULL COMMENT 'Quando o saldo em aberto foi liberado',
  ADD COLUMN IF NOT EXISTS liberado_por BIGINT UNSIGNED NULL COMMENT 'Usuário que liberou o saldo em aberto',
  ADD COLUMN IF NOT EXISTS motivo_liberacao VARCHAR(400) NULL COMMENT 'Motivo da liberação';

ALTER TABLE reserva_orcamentaria
  ADD CONSTRAINT IF NOT EXISTS ck_reserva_orcamentaria_liberacao CHECK (motivo_liberacao IS NULL OR liberado_em IS NOT NULL);
