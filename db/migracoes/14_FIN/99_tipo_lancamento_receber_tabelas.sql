-- Financeiro, tipo de documento por perfil no título a receber (F3.8, 07-FIN linha 99, C1-044, 25/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2).
-- A liberação por perfil ganha o terceiro alvo: o tipo de documento financeiro a receber (fatura, nota, recibo), usado
-- na operação contas_receber. A regra "exatamente um alvo por linha" continua, agora entre os três; a chave única passa
-- a incluir o estabelecimento e o novo alvo (a anterior fica substituída, nenhuma linha é apagada).
ALTER TABLE permissao_tipo_lancamento
  ADD COLUMN IF NOT EXISTS tipo_documento_financeiro_id BIGINT UNSIGNED NULL COMMENT 'Tipo de documento liberado no título a receber' AFTER tipo_lancamento_bancario_id;

ALTER TABLE permissao_tipo_lancamento DROP CONSTRAINT IF EXISTS ck_permissao_tipo_lancamento_alvo;
ALTER TABLE permissao_tipo_lancamento
  ADD CONSTRAINT ck_permissao_tipo_lancamento_alvo CHECK ((tipo_credor_id IS NOT NULL) + (tipo_lancamento_bancario_id IS NOT NULL) + (tipo_documento_financeiro_id IS NOT NULL) = 1);
