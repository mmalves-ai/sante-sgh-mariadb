-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE recurso_glosa_recebido
  MODIFY COLUMN justificativa_prestador VARCHAR(1000) NULL,
  MODIFY COLUMN justificativa_operadora VARCHAR(1000) NULL;
ALTER TABLE recurso_glosa_recebido_item
  MODIFY COLUMN justificativa_prestador VARCHAR(1000) NOT NULL,
  MODIFY COLUMN justificativa_operadora VARCHAR(1000) NULL;
ALTER TABLE envio_ans
  DROP CONSTRAINT IF EXISTS ck_envio_ans_ressarcimento,
  ADD CONSTRAINT ck_envio_ans_ressarcimento CHECK (obrigacao = 'ressarcimento_sus' OR cobranca_ressarcimento_sus_id IS NULL);
ALTER TABLE protocolo_beneficiario
  ADD COLUMN IF NOT EXISTS classe VARCHAR(20) NULL COMMENT 'Demanda assistencial ou não assistencial' AFTER natureza,
  DROP CONSTRAINT IF EXISTS ck_protocolo_beneficiario_classe,
  ADD CONSTRAINT ck_protocolo_beneficiario_classe CHECK (classe IS NULL OR classe IN ('assistencial','nao_assistencial'));
