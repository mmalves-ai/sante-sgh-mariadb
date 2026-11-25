-- Centro cirúrgico, cartão de preferência: chave estrangeira (idempotente) do 96_cartao_preferencia_vigencia_kit_tabelas.

ALTER TABLE cartao_preferencia_cirurgiao_item ADD CONSTRAINT fk_cartao_preferencia_cirurgiao_item_kit_material_id FOREIGN KEY IF NOT EXISTS (kit_material_id) REFERENCES kit_material (id) ON DELETE RESTRICT;
