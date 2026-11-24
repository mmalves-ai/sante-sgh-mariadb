-- Qualidade, gestão no banco próprio (modulos-proprios-3, família qualidade-q1, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2).
-- Assinatura (aprovação) da ata da reunião da comissão: quem e quando assinou a versão vigente da ata e, quando a ata
-- assinada é retificada, a assinatura da versão anterior (o texto novo aguarda nova assinatura; a reunião que já teve
-- ata assinada não se cancela). A assinatura exige o instante e o autor juntos.
ALTER TABLE reuniao_comissao
  ADD COLUMN IF NOT EXISTS ata_assinada_em DATETIME(3) NULL COMMENT 'Instante da assinatura da ata vigente',
  ADD COLUMN IF NOT EXISTS ata_assinada_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem assinou a ata vigente',
  ADD COLUMN IF NOT EXISTS assinatura_anterior_em DATETIME(3) NULL COMMENT 'Assinatura da versão anterior da ata retificada',
  ADD COLUMN IF NOT EXISTS assinatura_anterior_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem assinou a versão anterior da ata retificada',
  ADD CONSTRAINT IF NOT EXISTS ck_reuniao_comissao_ata_assinada
    CHECK ((ata_assinada_em IS NULL) = (ata_assinada_por_usuario_id IS NULL)),
  ADD CONSTRAINT IF NOT EXISTS ck_reuniao_comissao_assinatura_anterior
    CHECK ((assinatura_anterior_em IS NULL) = (assinatura_anterior_por_usuario_id IS NULL)),
  ADD CONSTRAINT IF NOT EXISTS ck_reuniao_comissao_ata_assinada_realizada
    CHECK (ata_assinada_em IS NULL OR situacao = 'realizada');

-- Cancelamento da auditoria interna lançada por engano: o instante e o motivo (a cancelada fica visível como inativa;
-- o registro nunca é apagado). O motivo só existe na cancelada, e a cancelada sempre o tem quando há o instante.
ALTER TABLE auditoria_interna
  ADD COLUMN IF NOT EXISTS cancelada_em DATETIME(3) NULL COMMENT 'Instante do cancelamento',
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(1000) NULL COMMENT 'Motivo do cancelamento',
  ADD CONSTRAINT IF NOT EXISTS ck_auditoria_interna_cancelamento
    CHECK ((cancelada_em IS NULL) = (motivo_cancelamento IS NULL)
      AND (cancelada_em IS NULL OR situacao = 'cancelada'));
