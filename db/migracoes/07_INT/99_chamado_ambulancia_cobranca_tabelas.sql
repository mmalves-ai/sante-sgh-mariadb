-- Chamado de ambulância com cobrança e maqueiro do transporte interno (04-INT linha 83, F8, 25/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio (@sgh/dominio-internacao,
-- chamado-ambulancia.ts) e na porta (apps/api/src/modulos/adt/chamado-ambulancia-propria.ts).
-- O chamado concluído guarda o item lançado na conta (cobrança por quilômetro rodado ou por trajeto, pela regra de
-- cobrança de ambulância); um chamado nunca é cobrado duas vezes. A reprovação guarda o motivo. O pedido de transporte
-- interno guarda o maqueiro designado.
ALTER TABLE chamado_ambulancia
  ADD COLUMN IF NOT EXISTS motivo_reprovacao VARCHAR(1000) NULL COMMENT 'Motivo da reprovação do chamado' AFTER reprovado_por_usuario_id,
  ADD COLUMN IF NOT EXISTS conta_hospitalar_item_id BIGINT UNSIGNED NULL COMMENT 'Item da remoção lançado na conta' AFTER quilometragem_final;
ALTER TABLE chamado_ambulancia DROP CONSTRAINT IF EXISTS ck_chamado_ambulancia_reprovado;
ALTER TABLE chamado_ambulancia
  ADD CONSTRAINT IF NOT EXISTS ck_chamado_ambulancia_reprovado CHECK (situacao <> 'reprovado' OR origem <> 'sistema' OR motivo_reprovacao IS NOT NULL);
ALTER TABLE chamado_ambulancia ADD UNIQUE KEY IF NOT EXISTS uq_chamado_ambulancia_conta_hospitalar_item_id (conta_hospitalar_item_id);

ALTER TABLE solicitacao_transporte_paciente
  ADD COLUMN IF NOT EXISTS maqueiro_profissional_id BIGINT UNSIGNED NULL COMMENT 'Maqueiro designado no transporte interno' AFTER acompanhante_nome;
ALTER TABLE solicitacao_transporte_paciente ADD INDEX IF NOT EXISTS ix_solicitacao_transporte_paciente_maqueiro_profissional_id (maqueiro_profissional_id);
