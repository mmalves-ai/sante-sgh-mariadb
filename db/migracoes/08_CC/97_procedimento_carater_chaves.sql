-- Centro cirúrgico, procedimento cirúrgico: chave estrangeira (idempotente) do 97_procedimento_carater_tabelas.

ALTER TABLE procedimento_cirurgico ADD CONSTRAINT fk_procedimento_cirurgico_carater_cirurgia_id FOREIGN KEY IF NOT EXISTS (carater_cirurgia_id) REFERENCES carater_cirurgia (id) ON DELETE RESTRICT;
