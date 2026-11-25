-- Regras do montador pela apresentação da fonte pagadora (06-FAT linha 30, F3, 25/11/2026): só para frente e idempotente.
-- A identificação do contratado (código, CNPJ ou CPF), a série de numeração da guia do prestador, os dias de corte do
-- resumo de internação por período e a separação da SP/SADT (por prestador ou por data, já em geracao_sp_sadt) ficam
-- na regra; o domínio (df/tiss/montagem-apresentacao.ts) confere o dígito do documento e monta as guias.

ALTER TABLE regra_apresentacao_tiss
  ADD COLUMN IF NOT EXISTS cpf_contratado CHAR(11) NULL COMMENT 'CPF do contratado quando a identificação é por CPF' AFTER cnpj_contratado,
  ADD COLUMN IF NOT EXISTS prefixo_numero_guia VARCHAR(10) NULL COMMENT 'Prefixo da série de numeração da guia do prestador' AFTER numeracao_guia,
  ADD COLUMN IF NOT EXISTS largura_numero_guia TINYINT UNSIGNED NOT NULL DEFAULT 8 COMMENT 'Dígitos da sequência da série (zeros à esquerda)' AFTER prefixo_numero_guia,
  ADD COLUMN IF NOT EXISTS proximo_numero_guia BIGINT UNSIGNED NULL COMMENT 'Próximo número da série; nulo: o hospital não numera pela série' AFTER largura_numero_guia,
  ADD COLUMN IF NOT EXISTS dias_corte_resumo SMALLINT UNSIGNED NULL COMMENT 'Dias de cada parte do resumo de internação quebrado por período' AFTER quebra_resumo_internacao;

ALTER TABLE regra_apresentacao_tiss
  ADD CONSTRAINT IF NOT EXISTS ck_regra_apresentacao_tiss_cpf CHECK (cpf_contratado IS NULL OR cpf_contratado REGEXP '^[0-9]{11}$'),
  ADD CONSTRAINT IF NOT EXISTS ck_regra_apresentacao_tiss_documento CHECK (
    (identificacao_contratado <> 'cnpj' OR cnpj_contratado IS NOT NULL)
    AND (identificacao_contratado <> 'cpf' OR cpf_contratado IS NOT NULL)),
  ADD CONSTRAINT IF NOT EXISTS ck_regra_apresentacao_tiss_largura CHECK (largura_numero_guia BETWEEN 1 AND 20),
  ADD CONSTRAINT IF NOT EXISTS ck_regra_apresentacao_tiss_proximo CHECK (proximo_numero_guia IS NULL OR proximo_numero_guia >= 1),
  ADD CONSTRAINT IF NOT EXISTS ck_regra_apresentacao_tiss_serie CHECK (
    proximo_numero_guia IS NULL OR CHAR_LENGTH(COALESCE(prefixo_numero_guia, '')) + largura_numero_guia <= 20),
  ADD CONSTRAINT IF NOT EXISTS ck_regra_apresentacao_tiss_corte CHECK (
    (dias_corte_resumo IS NULL OR dias_corte_resumo BETWEEN 1 AND 366)
    AND (quebra_resumo_internacao <> 'por_periodo' OR dias_corte_resumo IS NOT NULL));
