-- Manutenção corretiva (F7, 04-HOT L135, 25/11/2026): a remessa ao fornecedor só sai com orçamento aprovado dentro da
-- alçada (RDC 509/2021, NBR 15943). A exceção sem custo (garantia, contrato de manutenção, comodato) fica gravada com
-- o motivo e a justificativa de quem enviou. Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho: a regra
-- fica no domínio (@sgh/dominio-manutencao, planejarRemessa) e a CHECK só garante que nenhuma remessa fica sem um dos
-- dois (orçamento aprovado ou motivo registrado).
ALTER TABLE remessa_conserto_manutencao
  ADD COLUMN IF NOT EXISTS motivo_sem_orcamento VARCHAR(20) NULL COMMENT 'Saída sem orçamento: garantia, contrato ou comodato' AFTER orcamento_ordem_servico_manutencao_id,
  ADD COLUMN IF NOT EXISTS justificativa_sem_orcamento VARCHAR(500) NULL COMMENT 'Justificativa da saída sem orçamento (garantia, contrato ou comodato)' AFTER motivo_sem_orcamento;

ALTER TABLE remessa_conserto_manutencao
  DROP CONSTRAINT IF EXISTS ck_remessa_conserto_manutencao_motivo_sem_orcamento,
  DROP CONSTRAINT IF EXISTS ck_remessa_conserto_manutencao_autorizacao;

ALTER TABLE remessa_conserto_manutencao
  ADD CONSTRAINT ck_remessa_conserto_manutencao_motivo_sem_orcamento CHECK (motivo_sem_orcamento IS NULL OR motivo_sem_orcamento IN ('garantia','contrato','comodato')),
  ADD CONSTRAINT ck_remessa_conserto_manutencao_autorizacao CHECK (
    (orcamento_ordem_servico_manutencao_id IS NOT NULL AND motivo_sem_orcamento IS NULL AND justificativa_sem_orcamento IS NULL)
    OR (orcamento_ordem_servico_manutencao_id IS NULL AND motivo_sem_orcamento IS NOT NULL AND CHAR_LENGTH(TRIM(justificativa_sem_orcamento)) >= 10)
  );
