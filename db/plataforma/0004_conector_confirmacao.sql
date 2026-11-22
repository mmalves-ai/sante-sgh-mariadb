-- F4 L9 (2026-11-22): confirmação da exclusão em massa no pedido do Sincronizar.
-- O alerta de exclusão em massa retém as exclusões até o administrador pedir um Sincronizar CONFIRMADO pelo painel;
-- quem confirmou fica em `solicitado_por` e no evento da fila (`cliente_evento`). Idempotente.
ALTER TABLE conector_execucao
  ADD COLUMN IF NOT EXISTS confirmar_exclusao_em_massa BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Sincronizar confirmado: exclui o que o alerta de exclusão em massa reteve';
