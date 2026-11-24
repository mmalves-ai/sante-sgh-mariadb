-- Centro cirúrgico, gasto de sala do ato: chaves estrangeiras (idempotentes) do 92_gasto_sala_tabelas.

ALTER TABLE consumo_cirurgia_motivo ADD CONSTRAINT fk_consumo_cirurgia_motivo_consumo_cirurgia_id FOREIGN KEY IF NOT EXISTS (consumo_cirurgia_id) REFERENCES consumo_cirurgia (id) ON DELETE RESTRICT;
ALTER TABLE consumo_cirurgia_motivo ADD CONSTRAINT fk_consumo_cirurgia_motivo_insumo_id FOREIGN KEY IF NOT EXISTS (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE consumo_cirurgia_motivo ADD CONSTRAINT fk_consumo_cirurgia_motivo_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
