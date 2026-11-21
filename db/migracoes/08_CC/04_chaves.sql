-- CC, lote 04: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE checklist_cirurgia_segura
  ADD CONSTRAINT fk_checklist_cirurgia_segura_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE ficha_anestesica
  ADD CONSTRAINT fk_ficha_anestesica_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ficha_anestesica_assinada_por_profissional_id FOREIGN KEY (assinada_por_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE passagem_ficha_anestesica
  ADD CONSTRAINT fk_passagem_ficha_anestesica_ficha_anestesica_id FOREIGN KEY (ficha_anestesica_id) REFERENCES ficha_anestesica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_ficha_anestesica_de_profissional_id FOREIGN KEY (de_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_passagem_ficha_anestesica_para_profissional_id FOREIGN KEY (para_profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE lacuna_ficha_anestesica
  ADD CONSTRAINT fk_lacuna_ficha_anestesica_ficha_anestesica_id FOREIGN KEY (ficha_anestesica_id) REFERENCES ficha_anestesica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lacuna_ficha_anestesica_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE adendo_ficha_anestesica
  ADD CONSTRAINT fk_adendo_ficha_anestesica_ficha_anestesica_id FOREIGN KEY (ficha_anestesica_id) REFERENCES ficha_anestesica (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adendo_ficha_anestesica_profissional_id FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
ALTER TABLE codigo_painel_familia
  ADD CONSTRAINT fk_codigo_painel_familia_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_codigo_painel_familia_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT;
ALTER TABLE agendamento_cirurgico_versao
  ADD CONSTRAINT fk_agendamento_cirurgico_versao_agendamento_cirurgico_id FOREIGN KEY (agendamento_cirurgico_id) REFERENCES agendamento_cirurgico (id) ON DELETE RESTRICT;
