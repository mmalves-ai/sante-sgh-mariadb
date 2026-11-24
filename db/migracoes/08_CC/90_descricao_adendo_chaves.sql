-- Centro cirúrgico, descrição cirúrgica assinada: chaves estrangeiras (idempotentes) do 90_descricao_adendo_tabelas.

ALTER TABLE descricao_cirurgica_adendo ADD CONSTRAINT fk_descricao_cirurgica_adendo_descricao_cirurgica_id FOREIGN KEY IF NOT EXISTS (descricao_cirurgica_id) REFERENCES descricao_cirurgica (id) ON DELETE RESTRICT;
ALTER TABLE descricao_cirurgica_adendo ADD CONSTRAINT fk_descricao_cirurgica_adendo_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
