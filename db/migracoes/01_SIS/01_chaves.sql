-- Chaves do módulo SIS, lote 01 (aplicadas depois de todos os tabelas.sql)
ALTER TABLE cadastro_padrao
  ADD CONSTRAINT fk_cadastro_padrao_tipo_cadastro_padrao_id FOREIGN KEY (tipo_cadastro_padrao_id) REFERENCES tipo_cadastro_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cadastro_padrao_cadastro_padrao_pai_id FOREIGN KEY (cadastro_padrao_pai_id) REFERENCES cadastro_padrao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cadastro_padrao_unidade_medida_id FOREIGN KEY (unidade_medida_id) REFERENCES unidade_medida (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cadastro_padrao_sexo_id FOREIGN KEY (sexo_id) REFERENCES sexo (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cadastro_padrao_confirmado_por_usuario_id FOREIGN KEY (confirmado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE cenario_homologacao
  ADD CONSTRAINT fk_cenario_homologacao_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE implantacao_estabelecimento
  ADD CONSTRAINT fk_implantacao_estabelecimento_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_implantacao_estabelecimento_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE modelo_item_prontidao
  ADD CONSTRAINT fk_modelo_item_prontidao_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_modelo_item_prontidao_tipo_cadastro_padrao_id FOREIGN KEY (tipo_cadastro_padrao_id) REFERENCES tipo_cadastro_padrao (id) ON DELETE RESTRICT;
ALTER TABLE item_prontidao
  ADD CONSTRAINT fk_item_prontidao_implantacao_estabelecimento_id FOREIGN KEY (implantacao_estabelecimento_id) REFERENCES implantacao_estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prontidao_modelo_item_prontidao_id FOREIGN KEY (modelo_item_prontidao_id) REFERENCES modelo_item_prontidao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prontidao_responsavel_usuario_id FOREIGN KEY (responsavel_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_item_prontidao_evidencia_arquivo_id FOREIGN KEY (evidencia_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE meta_implantacao
  ADD CONSTRAINT fk_meta_implantacao_implantacao_estabelecimento_id FOREIGN KEY (implantacao_estabelecimento_id) REFERENCES implantacao_estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meta_implantacao_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT;
ALTER TABLE execucao_cenario_homologacao
  ADD CONSTRAINT fk_execucao_cenario_homologacao_cenario_homologacao_id FOREIGN KEY (cenario_homologacao_id) REFERENCES cenario_homologacao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_cenario_homologacao_implantacao_estabelecimento_id FOREIGN KEY (implantacao_estabelecimento_id) REFERENCES implantacao_estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_cenario_homologacao_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_cenario_homologacao_evidencia_arquivo_id FOREIGN KEY (evidencia_arquivo_id) REFERENCES arquivo (id) ON DELETE RESTRICT;
ALTER TABLE rotina_agendada
  ADD CONSTRAINT fk_rotina_agendada_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rotina_agendada_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rotina_agendada_dono_usuario_id FOREIGN KEY (dono_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE execucao_rotina
  ADD CONSTRAINT fk_execucao_rotina_rotina_agendada_id FOREIGN KEY (rotina_agendada_id) REFERENCES rotina_agendada (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_execucao_rotina_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE execucao_rotina_etapa
  ADD CONSTRAINT fk_execucao_rotina_etapa_execucao_rotina_id FOREIGN KEY (execucao_rotina_id) REFERENCES execucao_rotina (id) ON DELETE RESTRICT;
ALTER TABLE lote_carga_legado
  ADD CONSTRAINT fk_lote_carga_legado_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_carga_legado_lote_anterior_id FOREIGN KEY (lote_anterior_id) REFERENCES lote_carga_legado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_carga_legado_execucao_rotina_id FOREIGN KEY (execucao_rotina_id) REFERENCES execucao_rotina (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_lote_carga_legado_disparado_por_usuario_id FOREIGN KEY (disparado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE lote_carga_legado_tabela
  ADD CONSTRAINT fk_lote_carga_legado_tabela_lote_carga_legado_id FOREIGN KEY (lote_carga_legado_id) REFERENCES lote_carga_legado (id) ON DELETE RESTRICT;
ALTER TABLE divergencia_carga
  ADD CONSTRAINT fk_divergencia_carga_lote_carga_legado_tabela_id FOREIGN KEY (lote_carga_legado_tabela_id) REFERENCES lote_carga_legado_tabela (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_divergencia_carga_tratado_por_usuario_id FOREIGN KEY (tratado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_divergencia_carga_pendencia_id FOREIGN KEY (pendencia_id) REFERENCES pendencia (id) ON DELETE RESTRICT;
ALTER TABLE aceite_carga_area
  ADD CONSTRAINT fk_aceite_carga_area_lote_carga_legado_id FOREIGN KEY (lote_carga_legado_id) REFERENCES lote_carga_legado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aceite_carga_area_modulo_sistema_id FOREIGN KEY (modulo_sistema_id) REFERENCES modulo_sistema (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_aceite_carga_area_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE mapa_identificador_legado
  ADD CONSTRAINT fk_mapa_identificador_legado_lote_carga_legado_id FOREIGN KEY (lote_carga_legado_id) REFERENCES lote_carga_legado (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_mapa_identificador_legado_ultimo_lote_carga_legado_id FOREIGN KEY (ultimo_lote_carga_legado_id) REFERENCES lote_carga_legado (id) ON DELETE RESTRICT;
ALTER TABLE marca_sincronismo
  ADD CONSTRAINT fk_marca_sincronismo_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_marca_sincronismo_ultimo_lote_carga_legado_id FOREIGN KEY (ultimo_lote_carga_legado_id) REFERENCES lote_carga_legado (id) ON DELETE RESTRICT;
