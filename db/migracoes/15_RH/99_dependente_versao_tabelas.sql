-- Versão do dependente (C1-111, 07-RH): a alteração do dependente (nome, nascimento, tipo do eSocial, CPF, efeito no
-- IRRF e no salário-família) não sobrescreve o registro: a versão em vigor fecha na véspera da data da alteração e a
-- nova nasce ligada a ela (dependente_anterior_id), com o tipo de dependente da tabela 07 do eSocial. Só para frente e
-- idempotente (ADR 0002, parte 2):
--   1. a ligação com a versão anterior (uma versão nova por versão anterior);
--   2. a unicidade do CPF passa à versão vigente do dependente (não encerrada nem excluída): a versão fechada guarda o
--      CPF que tinha, e a nova pode repetir o mesmo CPF (RTRIM: o CHAR puro não entra em coluna gerada).
ALTER TABLE dependente
  ADD COLUMN IF NOT EXISTS dependente_anterior_id BIGINT UNSIGNED NULL COMMENT 'Versão anterior deste dependente, fechada na véspera desta' AFTER colaborador_id,
  ADD COLUMN IF NOT EXISTS cpf_vigente VARCHAR(11) AS (IF(data_fim_dependencia IS NULL AND excluido_em IS NULL, RTRIM(cpf), NULL)) PERSISTENT COMMENT 'Auxiliar da unicidade: o CPF da versão vigente',
  ADD UNIQUE KEY IF NOT EXISTS uq_dependente_anterior (dependente_anterior_id),
  ADD UNIQUE KEY IF NOT EXISTS uq_dependente_colaborador_cpf_vigente (colaborador_id, cpf_vigente);
-- A versão fechada libera o CPF para a versão nova (a unicidade passou à versão vigente).
ALTER TABLE dependente DROP KEY IF EXISTS uq_dependente_colaborador_id_cpf;
