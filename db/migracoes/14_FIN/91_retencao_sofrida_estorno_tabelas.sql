-- Motivo do estorno da retenção do título (07-FIN linha 109, F3.8, 25/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-financeiro, retencao-sofrida.ts:
-- conferirEstornoRetencaoSofrida, o estorno exige motivo e é recusado depois da compensação) e na operação
-- (apps/api/src/modulos/financeiro/retencao-sofrida-propria.ts). A retenção estornada nunca é apagada: fica marcada
-- como excluída, com quem, quando e por quê.
ALTER TABLE retencao_titulo
  ADD COLUMN IF NOT EXISTS motivo_estorno VARCHAR(300) NULL COMMENT 'Por que a retenção foi estornada (retido informado errado pelo tomador, baixa desfeita)' AFTER origem;
