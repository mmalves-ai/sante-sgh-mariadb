-- Cadastro, encerramento da vigência no mesmo dia (F3.1, 02-CAD linhas 3 e 4, correção da revisão, 24/11/2026): só
-- para frente e idempotente (ADR 0002, parte 2). Sem gatilho.
-- O endereço da pessoa e o vínculo de responsável do paciente encerram com o fim da vigência ontem. O registro que
-- começou hoje ou começa no futuro não tem "ontem" dentro da vigência: o encerramento dele grava o fim no dia anterior
-- ao início, o intervalo vazio, que nenhum filtro de vigência (início <= hoje e fim >= hoje) considera vigente. O CHECK
-- passa a aceitar só esse intervalo vazio além dos de antes (fim antes do dia anterior ao início continua recusado).
ALTER TABLE endereco_pessoa DROP CONSTRAINT IF EXISTS ck_endereco_pessoa_vigencia;
ALTER TABLE endereco_pessoa
  ADD CONSTRAINT ck_endereco_pessoa_vigencia CHECK (
    vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio - INTERVAL 1 DAY);
ALTER TABLE responsavel_paciente DROP CONSTRAINT IF EXISTS ck_responsavel_paciente_vigencia;
ALTER TABLE responsavel_paciente
  ADD CONSTRAINT ck_responsavel_paciente_vigencia CHECK (
    vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio - INTERVAL 1 DAY);
