-- Recepção, canal de entrada do módulo de recepção (F3.1, 02-CAD linha 2, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a escolha do módulo fica no domínio (moduloDaAbertura) e na porta.
--   - canal_entrada: o canal por onde o paciente entra e que o módulo atende (agenda, urgencia, internacao, exames,
--     demanda). A abertura do atendimento sem local de atendimento tira o módulo de recepção do canal: a consulta
--     marcada vem da agenda, o pronto atendimento da urgência, a admissão da internação, o exame do SADT e o balcão da
--     demanda espontânea. Um módulo por canal (a chave única aceita vários módulos sem canal). Nulo: o módulo não
--     responde por canal nenhum e só vale pelo local, pela marcação, pela senha ou pelo guichê.
ALTER TABLE modulo_recepcao
  ADD COLUMN IF NOT EXISTS canal_entrada VARCHAR(20) NULL COMMENT 'Canal de entrada que o módulo atende (agenda, urgencia, internacao, exames, demanda; nulo: nenhum)' AFTER descricao,
  ADD UNIQUE KEY IF NOT EXISTS uq_modulo_recepcao_canal_entrada (canal_entrada);
ALTER TABLE modulo_recepcao
  ADD CONSTRAINT IF NOT EXISTS ck_modulo_recepcao_canal_entrada CHECK (canal_entrada IS NULL OR canal_entrada IN ('agenda','urgencia','internacao','exames','demanda'));
