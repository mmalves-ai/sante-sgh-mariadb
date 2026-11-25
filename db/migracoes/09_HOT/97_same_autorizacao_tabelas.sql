-- SAME: autorização da solicitação de prontuário pelo motivo (F3.9, 04-HOT L128, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-hotelaria, same-tramite) e na
-- porta (adt/same-tramite-propria).
--   - O motivo com `exige_autorizacao` (pesquisa, processo judicial) deixa a solicitação aguardando a decisão do
--     responsável do arquivo; o arquivo só entrega o volume depois de autorizada. A decisão (autorizada ou negada)
--     grava quem decidiu, quando e a justificativa (obrigatória na negativa), como pede a guarda do prontuário
--     (CFM 1.638/2002) e o acesso a dado de saúde (LGPD, art. 11). Nada se apaga: a negativa cancela a solicitação.
--   - Solicitação de motivo que não exige: `autorizacao` nula.
ALTER TABLE solicitacao_prontuario
  ADD COLUMN IF NOT EXISTS autorizacao VARCHAR(20) NULL COMMENT 'Nula quando o motivo não exige; aguardando, autorizada ou negada' AFTER situacao,
  ADD COLUMN IF NOT EXISTS autorizacao_decidida_em DATETIME(3) NULL COMMENT 'Quando o responsável decidiu a autorização' AFTER autorizacao,
  ADD COLUMN IF NOT EXISTS autorizacao_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem decidiu a autorização' AFTER autorizacao_decidida_em,
  ADD COLUMN IF NOT EXISTS autorizacao_justificativa VARCHAR(500) NULL COMMENT 'Justificativa da decisão (obrigatória na negativa)' AFTER autorizacao_usuario_id;
ALTER TABLE solicitacao_prontuario ADD INDEX IF NOT EXISTS ix_solicitacao_prontuario_autorizacao (estabelecimento_id, autorizacao);
ALTER TABLE solicitacao_prontuario ADD INDEX IF NOT EXISTS ix_solicitacao_prontuario_autorizacao_usuario (autorizacao_usuario_id);
ALTER TABLE solicitacao_prontuario DROP CONSTRAINT IF EXISTS ck_solicitacao_prontuario_autorizacao;
ALTER TABLE solicitacao_prontuario ADD CONSTRAINT ck_solicitacao_prontuario_autorizacao
  CHECK (autorizacao IS NULL OR autorizacao IN ('aguardando','autorizada','negada'));
ALTER TABLE solicitacao_prontuario DROP CONSTRAINT IF EXISTS ck_solicitacao_prontuario_autorizacao_decisao;
ALTER TABLE solicitacao_prontuario ADD CONSTRAINT ck_solicitacao_prontuario_autorizacao_decisao
  CHECK (autorizacao IS NULL OR autorizacao = 'aguardando'
         OR (autorizacao_decidida_em IS NOT NULL AND autorizacao_usuario_id IS NOT NULL));
ALTER TABLE solicitacao_prontuario DROP CONSTRAINT IF EXISTS ck_solicitacao_prontuario_autorizacao_negada;
ALTER TABLE solicitacao_prontuario ADD CONSTRAINT ck_solicitacao_prontuario_autorizacao_negada
  CHECK (autorizacao IS NULL OR autorizacao <> 'negada' OR autorizacao_justificativa IS NOT NULL);
