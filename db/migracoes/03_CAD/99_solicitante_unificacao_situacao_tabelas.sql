-- Cadastro, situação anterior do solicitante externo unificado (F3.1, 02-CAD linha 20, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho.
-- Desfazer a unificação devolve o cadastro à situação que ele tinha: quem já estava inativo antes de ser unificado
-- continua inativo, com a data de inativação original (que a unificação não altera). A coluna guarda só se ele
-- estava ativo no momento da unificação; fora da unificação fica vazia.
ALTER TABLE solicitante_externo
  ADD COLUMN IF NOT EXISTS ativo_antes_unificacao BOOLEAN NULL
    COMMENT 'Se o cadastro estava ativo quando foi unificado em outro (para o desfazer devolver a situação anterior)' AFTER unificado_por;
ALTER TABLE solicitante_externo
  ADD CONSTRAINT IF NOT EXISTS ck_solicitante_externo_unificacao_situacao CHECK (
    sucessor_solicitante_externo_id IS NOT NULL OR ativo_antes_unificacao IS NULL);
