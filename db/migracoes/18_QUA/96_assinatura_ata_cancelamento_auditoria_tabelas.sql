-- Qualidade, gestão no banco próprio (modulos-proprios-3, família qualidade-q1, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2).
-- As colunas da assinatura da ata (ata_assinada_em, ata_assinada_por_usuario_id) e do cancelamento da auditoria interna
-- (cancelada_em, motivo_cancelamento, com ck_auditoria_interna_cancelamento) já existem desde a 18_QUA/23; as da
-- assinatura da versão anterior da ata retificada vêm da 18_QUA/99_reuniao_ata. Esta migração só acrescenta a regra
-- que faltava: a ata assinada é sempre a de uma reunião realizada (a reunião com ata assinada não se cancela).
ALTER TABLE reuniao_comissao
  ADD CONSTRAINT IF NOT EXISTS ck_reuniao_comissao_ata_assinada_realizada
    CHECK (ata_assinada_em IS NULL OR situacao = 'realizada');
