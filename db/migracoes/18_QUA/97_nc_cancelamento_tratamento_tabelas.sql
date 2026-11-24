-- Qualidade, cancelamento da não conformidade no banco próprio (fecho-1, família qualidade-resto, 24/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2).
-- A 23 acrescentou a situação 'cancelada' (com ck_nao_conformidade_qualidade_cancelamento: instante, motivo e quem),
-- mas ck_nao_conformidade_qualidade_tratamento continuou exigindo responsável e prazo em toda situação fora de
-- 'aberta'. A não conformidade se cancela aberta (o contrato só cancela a aberta, inclusive a reaberta), quando
-- ainda não tem responsável nem prazo: o CHECK antigo recusava todo cancelamento dela. O tratamento continua exigido
-- em toda situação de tratamento; a cancelada passa só com o cancelamento registrado (instante, que o CHECK do
-- cancelamento amarra ao motivo e a quem).
ALTER TABLE nao_conformidade_qualidade
  DROP CONSTRAINT IF EXISTS ck_nao_conformidade_qualidade_tratamento;
ALTER TABLE nao_conformidade_qualidade
  ADD CONSTRAINT ck_nao_conformidade_qualidade_tratamento CHECK (
    situacao = 'aberta'
    OR (situacao = 'cancelada' AND cancelada_em IS NOT NULL)
    OR (responsavel_usuario_id IS NOT NULL AND prazo IS NOT NULL));
