-- Lançamento automático com origem na diferença de acomodação e no pacote de diárias (04-INT linha 81, F3.4,
-- 25/11/2026). Só para frente e idempotente (ADR 0002, parte 2). Regra no domínio
-- (packages/dominio-faturamento/src/conta/diferenca-acomodacao.ts e pacote-diarias.ts); a gravação é da apuração da conta
-- (apps/api/src/modulos/faturamento/conta-entrada.ts). Nenhum gatilho.
--   - diferenca_acomodacao_id: a cobrança diária da diferença de acomodação aceita pelo paciente, lançada na conta
--     particular da diferença (chave "diferenca:<id>");
--   - conta_hospitalar_pacote_id: o lançamento que o pacote aplicado à conta faz nas diárias (chave "pacote-...": a
--     diária incluída no pacote, sem cobrança, e os itens complementar e adicional da acomodação);
--   - cada lançamento tem uma origem só (regra de diária, item da regra de lançamento, diferença ou pacote), e a chave
--     diz qual.

ALTER TABLE lancamento_automatico_conta
  ADD COLUMN IF NOT EXISTS diferenca_acomodacao_id BIGINT UNSIGNED NULL COMMENT 'Diferença de acomodação que gerou a cobrança' AFTER regra_lancamento_item_id,
  ADD COLUMN IF NOT EXISTS conta_hospitalar_pacote_id BIGINT UNSIGNED NULL COMMENT 'Pacote aplicado à conta que gerou o lançamento' AFTER diferenca_acomodacao_id;

ALTER TABLE lancamento_automatico_conta
  ADD KEY IF NOT EXISTS ix_lancamento_automatico_conta_diferenca_acomodacao_id (diferenca_acomodacao_id),
  ADD KEY IF NOT EXISTS ix_lancamento_automatico_conta_conta_hospitalar_pacote_id (conta_hospitalar_pacote_id);

ALTER TABLE lancamento_automatico_conta DROP CONSTRAINT IF EXISTS ck_lancamento_automatico_conta_regra;
ALTER TABLE lancamento_automatico_conta
  ADD CONSTRAINT ck_lancamento_automatico_conta_regra CHECK ((regra_diaria_id IS NOT NULL) + (regra_lancamento_item_id IS NOT NULL) + (diferenca_acomodacao_id IS NOT NULL) + (conta_hospitalar_pacote_id IS NOT NULL) = 1);

ALTER TABLE lancamento_automatico_conta DROP CONSTRAINT IF EXISTS ck_lancamento_automatico_conta_origem;
ALTER TABLE lancamento_automatico_conta
  ADD CONSTRAINT ck_lancamento_automatico_conta_origem CHECK ((chave LIKE 'diferenca:%') = (diferenca_acomodacao_id IS NOT NULL) AND (chave LIKE 'pacote-%') = (conta_hospitalar_pacote_id IS NOT NULL));
