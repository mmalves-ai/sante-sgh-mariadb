-- Recusas da carga (fase 2, K1b): requisição de setor e lote de insumo migrados. Só relaxa no registro migrado
-- (col IS NOT NULL OR origem = 'migracao', precedente 06_PEP/40_tabelas.sql); no sistema a obrigatoriedade continua.
-- Idempotente e válida em qualquer ordem (ADR 0002): DROP CONSTRAINT IF EXISTS antes de recriar, MODIFY repetível,
-- ADD COLUMN IF NOT EXISTS, ADD UNIQUE KEY IF NOT EXISTS.

-- Requisição de setor migrada: o histórico não guarda o setor nem o centro de custo fora do documento de saída.
ALTER TABLE requisicao_material DROP CONSTRAINT IF EXISTS ck_requisicao_material_setor;
ALTER TABLE requisicao_material
  ADD CONSTRAINT ck_requisicao_material_setor CHECK (tipo <> 'setor' OR setor_funcional_id IS NOT NULL OR centro_custo_id IS NOT NULL OR origem = 'migracao');

-- Lote de insumo migrado sem validade conhecida: presumir uma data seria inventar; a validade fica nula e visível.
ALTER TABLE lote_insumo
  MODIFY COLUMN validade DATE NULL COMMENT 'Validade do lote; nula só no lote migrado sem validade conhecida',
  DROP CONSTRAINT IF EXISTS ck_lote_insumo_validade;
ALTER TABLE lote_insumo
  ADD CONSTRAINT ck_lote_insumo_validade CHECK (validade IS NOT NULL OR origem = 'migracao');
-- A chave única (estabelecimento, insumo, número, validade) não barra duas linhas de validade nula: este auxiliar
-- mantém um só lote sem validade por estabelecimento, insumo e número.
ALTER TABLE lote_insumo
  ADD COLUMN IF NOT EXISTS lote_sem_validade BOOLEAN AS (IF(validade IS NULL, TRUE, NULL)) PERSISTENT COMMENT 'Auxiliar da unicidade: um lote sem validade por insumo e número' AFTER validade;
ALTER TABLE lote_insumo
  ADD UNIQUE KEY IF NOT EXISTS uq_lote_insumo_sem_validade (estabelecimento_id, insumo_id, numero_lote, lote_sem_validade);
