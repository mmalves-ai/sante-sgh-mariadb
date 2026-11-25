-- Recepção, módulo de recepção do local de atendimento (F3.1, 02-CAD linha 2, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio e na porta.
--   - modulo_recepcao_id: o contexto de recepção (interna, externa, diagnóstico) em que o local trabalha. A abertura
--     do atendimento feita num local (senha chamada no guichê) aplica a regra de campo do cadastro desse módulo sem a
--     tela precisar informá-lo. Nulo: o local não pertence a um módulo, e só valem as regras de todos os módulos.
ALTER TABLE local_atendimento
  ADD COLUMN IF NOT EXISTS modulo_recepcao_id BIGINT UNSIGNED NULL COMMENT 'Módulo de recepção em que o local trabalha (nulo: nenhum)' AFTER ponto_recepcao_id,
  ADD KEY IF NOT EXISTS ix_local_atendimento_modulo_recepcao_id (modulo_recepcao_id);
