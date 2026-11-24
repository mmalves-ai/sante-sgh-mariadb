-- Centro cirúrgico, gasto de sala do ato: chave estrangeira (idempotente) do 95_gasto_sala_cirurgiao_tabelas.

ALTER TABLE consumo_cirurgia ADD CONSTRAINT fk_consumo_cirurgia_cirurgiao_profissional_id FOREIGN KEY IF NOT EXISTS (cirurgiao_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
