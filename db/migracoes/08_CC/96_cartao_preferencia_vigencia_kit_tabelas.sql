-- Centro cirúrgico, cartão de preferência do cirurgião: vigência e kit padrão (F8, 04-CC linha 105, correção da
-- C1-012, 25/11/2026). Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio
-- (@sgh/dominio-cirurgia, cartao-preferencia: validarCartaoPreferencia, cartaoAplicavel, itensParaGasto).
--   - cartao_preferencia_cirurgiao.vigencia_inicio / vigencia_fim (novas): datas inclusivas em que o cartão vale para o
--     ato; vazias = sem limite. Fora da vigência o cartão não é sugerido, e nada se apaga.
--   - cartao_preferencia_cirurgiao_item.kit_material_id (nova): o kit padrão do cadastro de kits de material, natureza
--     'kit'; no gasto de sala ele se abre nos produtos do kit.

ALTER TABLE cartao_preferencia_cirurgiao
  ADD COLUMN IF NOT EXISTS vigencia_inicio DATE NULL COMMENT 'Início da vigência do cartão (inclusivo); vazio: sem limite' AFTER sala_cirurgica_id,
  ADD COLUMN IF NOT EXISTS vigencia_fim DATE NULL COMMENT 'Fim da vigência do cartão (inclusivo); vazio: sem limite' AFTER vigencia_inicio,
  DROP CONSTRAINT IF EXISTS ck_cartao_preferencia_cirurgiao_vigencia;
ALTER TABLE cartao_preferencia_cirurgiao
  ADD CONSTRAINT ck_cartao_preferencia_cirurgiao_vigencia CHECK (vigencia_inicio IS NULL OR vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio);

ALTER TABLE cartao_preferencia_cirurgiao_item
  ADD COLUMN IF NOT EXISTS kit_material_id BIGINT UNSIGNED NULL COMMENT 'Kit padrão do cadastro de kits (natureza kit)' AFTER equipamento_saude_id,
  ADD KEY IF NOT EXISTS ix_cartao_preferencia_cirurgiao_item_kit_material_id (kit_material_id),
  DROP CONSTRAINT IF EXISTS ck_cartao_preferencia_cirurgiao_item_natureza,
  DROP CONSTRAINT IF EXISTS ck_cartao_preferencia_cirurgiao_item_item;
ALTER TABLE cartao_preferencia_cirurgiao_item
  ADD CONSTRAINT ck_cartao_preferencia_cirurgiao_item_natureza CHECK (natureza IN ('material','medicamento','fio','instrumental','equipamento','kit','outro')),
  ADD CONSTRAINT ck_cartao_preferencia_cirurgiao_item_item CHECK (insumo_id IS NOT NULL OR caixa_instrumental_id IS NOT NULL OR equipamento_saude_id IS NOT NULL OR kit_material_id IS NOT NULL OR descricao IS NOT NULL);
