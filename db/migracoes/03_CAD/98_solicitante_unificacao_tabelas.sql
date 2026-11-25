-- Cadastro, unificação de solicitante externo duplicado (F3.1, 02-CAD linha 20, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho.
-- O cadastro absorvido não é apagado e os registros clínicos que o citam (atendimento, pedido de exame, autorização,
-- receita) não são alterados: ele fica inativo e guarda o ponteiro para o cadastro que continua. A regra (quem pode
-- absorver quem, motivo, códigos por fonte pagadora) é do domínio; o banco só garante a coerência do ponteiro.
ALTER TABLE solicitante_externo
  ADD COLUMN IF NOT EXISTS sucessor_solicitante_externo_id BIGINT UNSIGNED NULL
    COMMENT 'Cadastro que continua, quando este foi unificado nele (o absorvido fica inativo e nunca é apagado)' AFTER observacao,
  ADD COLUMN IF NOT EXISTS unificado_em DATETIME(3) NULL
    COMMENT 'Momento da unificação no cadastro que continua' AFTER sucessor_solicitante_externo_id,
  ADD COLUMN IF NOT EXISTS unificado_por BIGINT UNSIGNED NULL
    COMMENT 'Usuário que unificou' AFTER unificado_em;
ALTER TABLE solicitante_externo
  ADD CONSTRAINT IF NOT EXISTS ck_solicitante_externo_unificacao CHECK (
    (sucessor_solicitante_externo_id IS NULL AND unificado_em IS NULL AND unificado_por IS NULL)
    OR (sucessor_solicitante_externo_id IS NOT NULL AND unificado_em IS NOT NULL AND ativo = FALSE));
ALTER TABLE solicitante_externo
  ADD KEY IF NOT EXISTS ix_solicitante_externo_sucessor (sucessor_solicitante_externo_id);
