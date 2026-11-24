-- PEP, porta própria dos documentos (família pep-resto, modulos-proprios-2, 24/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio e na porta.
--   - receita_medica: o conteúdo da receita como foi emitido (texto formatado da tela) e o resumo SHA-256 dele, para a
--     releitura e a conferência da assinatura. Registro clínico nunca é apagado: a receita emitida não muda de
--     conteúdo (suspensão e cancelamento gravam situação e motivo; a correção é nova receita).

ALTER TABLE receita_medica
  ADD COLUMN IF NOT EXISTS conteudo LONGTEXT NULL COMMENT 'Conteúdo da receita como emitido (texto formatado)',
  ADD COLUMN IF NOT EXISTS hash_conteudo CHAR(64) NULL COMMENT 'Resumo SHA-256 (hexadecimal) do conteúdo emitido';

ALTER TABLE receita_medica
  DROP CONSTRAINT IF EXISTS ck_receita_medica_hash_conteudo,
  ADD CONSTRAINT ck_receita_medica_hash_conteudo CHECK (hash_conteudo IS NULL OR hash_conteudo REGEXP '^[0-9a-f]{64}$');
