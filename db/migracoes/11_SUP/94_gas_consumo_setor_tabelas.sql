-- Suprimentos, consumo de gás medicinal do setor sem paciente (C1-050, 05-SUP linha 30, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). O consumo do setor (rede de gases, cilindro aberto no setor, teste de equipamento)
-- é cancelado com o motivo quando lançado por engano: o registro nunca é apagado e o motivo fica na observação.
-- A regra é do domínio (conferirConsumoGasSetor e apurarConsumoGasPorSetor); o banco só guarda.
ALTER TABLE consumo_gas_medicinal
  ADD COLUMN IF NOT EXISTS observacao VARCHAR(500) NULL
    COMMENT 'Observação do registro; no cancelamento, o motivo' AFTER origem;
