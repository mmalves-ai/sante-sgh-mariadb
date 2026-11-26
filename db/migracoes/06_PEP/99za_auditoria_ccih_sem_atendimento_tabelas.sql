-- Recusas da carga (fase 2, D2): a auditoria da comissão de controle de infecção sobre a ficha de antimicrobiano
-- migrada sem atendimento ligado na origem é gravável, com o atendimento nulo. A regra "atendimento obrigatório salvo
-- ficha migrada" mora no domínio (@sgh/dominio-qualidade, atendimentoDaAuditoria), porque depende da origem da ficha
-- (outra tabela); no banco fica a garantia de que a auditoria sem atendimento está sempre ligada a uma ficha.
-- Idempotente e válida em qualquer ordem (ADR 0002): MODIFY repetível, DROP CONSTRAINT IF EXISTS antes de recriar.
ALTER TABLE auditoria_prescricao_ccih
  MODIFY COLUMN atendimento_id BIGINT UNSIGNED NULL COMMENT 'Atendimento da ficha auditada; nulo só na auditoria de ficha migrada sem atendimento ligado na origem',
  DROP CONSTRAINT IF EXISTS ck_auditoria_prescricao_ccih_atendimento;
ALTER TABLE auditoria_prescricao_ccih
  ADD CONSTRAINT ck_auditoria_prescricao_ccih_atendimento CHECK (atendimento_id IS NOT NULL OR ficha_antimicrobiano_id IS NOT NULL);
