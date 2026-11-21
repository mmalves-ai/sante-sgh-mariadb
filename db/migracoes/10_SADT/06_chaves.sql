-- SADT, lote 06: chaves (aplicadas depois de todos os tabelas.sql)
ALTER TABLE teste_imuno_hematologico
  ADD CONSTRAINT fk_teste_imuno_hematologico_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE requisicao_transfusao_versao
  ADD CONSTRAINT fk_requisicao_transfusao_versao_requisicao FOREIGN KEY (requisicao_transfusao_id) REFERENCES requisicao_transfusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_versao_hemocomponente FOREIGN KEY (hemocomponente_id) REFERENCES hemocomponente (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_versao_tipo FOREIGN KEY (tipo_transfusao_id) REFERENCES tipo_transfusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_requisicao_transfusao_versao_usuario FOREIGN KEY (alterada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE ato_transfusional_adendo
  ADD CONSTRAINT fk_ato_transfusional_adendo_ato FOREIGN KEY (ato_transfusional_id) REFERENCES ato_transfusional (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_adendo_monitoramento FOREIGN KEY (monitoramento_transfusao_id) REFERENCES monitoramento_transfusao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ato_transfusional_adendo_profissional FOREIGN KEY (profissional_id) REFERENCES profissional (id) ON DELETE RESTRICT;
