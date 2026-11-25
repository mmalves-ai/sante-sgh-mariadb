-- Efeito da resposta do paciente na marcação (08-INTG L133): só para frente e idempotente (ADR 0002, parte 2).
-- O retorno de resposta interpretada guarda o efeito que teve na marcação ligada ao pedido: confirmou a presença, abriu
-- o pedido de cancelamento ou de reagendamento (confirmação recusada, para a equipe da agenda tratar) ou nenhum, e a
-- confirmação da marcação que gerou. A resposta nunca cancela nem remarca sozinha.

ALTER TABLE pedido_mensagem_paciente_retorno
  ADD COLUMN IF NOT EXISTS efeito_resposta VARCHAR(30) NULL COMMENT 'Efeito da resposta na marcação ligada ao pedido' AFTER resposta_interpretada,
  ADD COLUMN IF NOT EXISTS confirmacao_marcacao_id BIGINT UNSIGNED NULL COMMENT 'Confirmação da marcação gerada pela resposta' AFTER efeito_resposta,
  DROP CONSTRAINT IF EXISTS ck_pedido_mensagem_paciente_retorno_efeito_resposta,
  ADD CONSTRAINT ck_pedido_mensagem_paciente_retorno_efeito_resposta CHECK (efeito_resposta IS NULL OR efeito_resposta IN ('confirmar_presenca','pedir_cancelamento','pedir_reagendamento','nenhum')),
  ADD KEY IF NOT EXISTS ix_pedido_mensagem_paciente_retorno_confirmacao (confirmacao_marcacao_id);

-- O disparo pelos eventos procura o pedido já feito pela regra para a mesma entidade (não pede duas vezes).
ALTER TABLE pedido_mensagem_paciente
  ADD KEY IF NOT EXISTS ix_pedido_mensagem_paciente_regra_entidade (regra_envio_mensagem_paciente_id, entidade, entidade_id);
