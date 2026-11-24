-- PEP, seções configuráveis do sumário de alta (F3.3, linha 03-PEP L124, correção de 24/11/2026). Só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio e na porta.
--   - periodo_consulta_id: a seção aponta um período próprio do cliente (periodo_consulta_sumario_alta), que vale no
--     lugar do recorte fixo; os dois juntos são recusados pelo CHECK.
--   - estabelecimento_chave: coluna gerada (estabelecimento ou 0 para o cliente inteiro). A chave única passa a ser
--     sobre ela, porque o UNIQUE com estabelecimento_id NULL não barrava duas linhas iguais do cliente inteiro.
--     O índice simples de estabelecimento_id fica para a chave estrangeira.

ALTER TABLE componente_sumario_alta
  ADD COLUMN IF NOT EXISTS periodo_consulta_id BIGINT UNSIGNED NULL COMMENT 'Período próprio do cliente; vale no lugar do recorte fixo' AFTER periodo,
  ADD COLUMN IF NOT EXISTS estabelecimento_chave BIGINT UNSIGNED AS (COALESCE(estabelecimento_id, 0)) STORED COMMENT 'Estabelecimento, ou 0 para o cliente inteiro (chave única)' AFTER estabelecimento_id;

ALTER TABLE componente_sumario_alta ADD KEY IF NOT EXISTS ix_componente_sumario_alta_estabelecimento (estabelecimento_id);
ALTER TABLE componente_sumario_alta ADD KEY IF NOT EXISTS ix_componente_sumario_alta_periodo_consulta (periodo_consulta_id);
ALTER TABLE componente_sumario_alta ADD UNIQUE KEY IF NOT EXISTS uq_componente_sumario_alta_chave (estabelecimento_chave, tipo_atendimento, codigo);
ALTER TABLE componente_sumario_alta DROP INDEX IF EXISTS uq_componente_sumario_alta_codigo;
ALTER TABLE componente_sumario_alta DROP CONSTRAINT IF EXISTS ck_componente_sumario_alta_periodo_unico;
ALTER TABLE componente_sumario_alta ADD CONSTRAINT ck_componente_sumario_alta_periodo_unico CHECK (periodo_consulta_id IS NULL OR periodo IS NULL);
