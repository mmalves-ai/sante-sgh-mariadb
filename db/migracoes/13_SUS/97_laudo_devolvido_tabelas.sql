-- Laudo de internação SUS devolvido pelo gestor (C2-119, 06-SUS linha 57, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio (dominio-faturamento, sus/laudo-internacao.ts).
-- O gestor devolve o laudo para correção (a autorização fica "devolvida"): o laudo ganha a situação "devolvido", com a
-- data e o motivo da devolução; o reenvio corrigido volta o laudo a "emitido" (o histórico fica na trilha).
ALTER TABLE laudo_internacao_sus
  ADD COLUMN IF NOT EXISTS devolvido_em DATETIME(3) NULL COMMENT 'Devolução do laudo pelo gestor para correção' AFTER motivo_negativa,
  ADD COLUMN IF NOT EXISTS motivo_devolucao VARCHAR(500) NULL COMMENT 'Motivo da devolução dado pelo gestor' AFTER devolvido_em,
  DROP CONSTRAINT IF EXISTS ck_laudo_internacao_sus_situacao;
ALTER TABLE laudo_internacao_sus
  ADD CONSTRAINT ck_laudo_internacao_sus_situacao CHECK (situacao IN ('rascunho','emitido','enviado','autorizado','negado','devolvido','cancelado'));
