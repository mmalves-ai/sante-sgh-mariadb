-- PEP, seções configuráveis do sumário de alta: chave estrangeira (idempotente) do 99_sumario_secoes_tabelas.

ALTER TABLE componente_sumario_alta ADD CONSTRAINT fk_componente_sumario_alta_periodo_consulta_id FOREIGN KEY IF NOT EXISTS (periodo_consulta_id) REFERENCES periodo_consulta_sumario_alta (id) ON DELETE RESTRICT;
