-- Cadastro, marca da inativação do profissional no registro do conselho (família cadastro-sessao-resto, fecho-1,
-- correção da revisão, 24/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho.
-- A inativação do profissional desliga os registros ativos e marca cada um com inativado_com_profissional; a
-- reativação volta só os registros marcados (o que aquela inativação desligou de fato), nunca um registro que a pessoa
-- inativou à mão (alterar o registro limpa a marca). Registro inativado antes desta migração fica sem a marca: a
-- reativação recusa e pede a reativação registro a registro, com o motivo.
ALTER TABLE inscricao_conselho
  ADD COLUMN IF NOT EXISTS inativado_com_profissional BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Registro desligado pela inativação do profissional (a reativação do profissional volta só estes)' AFTER situacao;
ALTER TABLE inscricao_conselho
  ADD CONSTRAINT IF NOT EXISTS ck_inscricao_conselho_inativado_com_profissional CHECK (
    NOT inativado_com_profissional OR situacao = 'inativa');
