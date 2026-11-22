-- AGE, lote 6: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L6-03 (9): motivo_marcacao por categoria de agenda
ALTER TABLE motivo_marcacao
  ADD CONSTRAINT fk_motivo_marcacao_categoria_agenda_id FOREIGN KEY (categoria_agenda_id) REFERENCES categoria_agenda (id) ON DELETE RESTRICT;

-- L6-03 (9): canal_marcacao por categoria de agenda
ALTER TABLE canal_marcacao
  ADD CONSTRAINT fk_canal_marcacao_categoria_agenda_id FOREIGN KEY (categoria_agenda_id) REFERENCES categoria_agenda (id) ON DELETE RESTRICT;

-- L6-04 (9), opção (a): histórico de cancelamento sem a marcação viva
ALTER TABLE cancelamento_marcacao
  ADD CONSTRAINT fk_cancelamento_marcacao_agenda_servico_id FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico (id) ON DELETE RESTRICT;
