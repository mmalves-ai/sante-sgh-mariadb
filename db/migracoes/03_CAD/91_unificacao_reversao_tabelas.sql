-- Cadastro, desfazer a unificação com segurança (F3.1, correção da revisão, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho.
-- 1. Cada item da unificação guarda a versão do registro logo depois da transferência. Desfazer confere essa versão:
--    registro alterado depois da unificação (evolução, faturamento, cobertura) não volta em silêncio ao outro paciente;
--    a reversão é recusada e a unificação passa a não reversível. Itens gravados antes desta migração ficam sem a
--    versão (só o ponteiro é conferido).
-- 2. O retrato do cadastro ganha o motivo próprio da reversão (unificacao_desfeita), separado da unificação, para a
--    linha do tempo distinguir os dois.
ALTER TABLE unificacao_cadastro_item
  ADD COLUMN IF NOT EXISTS versao_registro INT UNSIGNED NULL
    COMMENT 'Versão do registro logo depois da transferência (desfazer recusa quando mudou)' AFTER coluna;
ALTER TABLE paciente_versao DROP CONSTRAINT IF EXISTS ck_paciente_versao_motivo;
ALTER TABLE paciente_versao
  ADD CONSTRAINT ck_paciente_versao_motivo CHECK (
    motivo IN ('alteracao_cadastro','registro_clinico','atendimento','unificacao','unificacao_desfeita','migracao'));
