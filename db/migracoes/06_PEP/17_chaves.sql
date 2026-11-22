-- PEP, lote 17: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L6-11 (7)
ALTER TABLE painel_filtro_usuario
  ADD CONSTRAINT fk_painel_filtro_usuario_unidade_assistencial_id FOREIGN KEY (unidade_assistencial_id) REFERENCES unidade_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE painel_filtro_usuario
  ADD CONSTRAINT fk_painel_filtro_usuario_bloco_internacao_id FOREIGN KEY (bloco_internacao_id) REFERENCES bloco_internacao (id) ON DELETE RESTRICT;

-- L7-07 (principio_ativo_cliente): alergia_paciente_principio pelo oficial ou pelo do cliente
ALTER TABLE alergia_paciente_principio
  ADD CONSTRAINT fk_alergia_paciente_principio_principio_ativo_cliente_id FOREIGN KEY (principio_ativo_cliente_id) REFERENCES principio_ativo_cliente (id) ON DELETE RESTRICT;

-- L7-07 (principio_ativo_cliente): item_nao_padronizado_principio pelo oficial ou pelo do cliente
ALTER TABLE item_nao_padronizado_principio
  ADD CONSTRAINT fk_item_nao_padronizado_principio_principio_ativo_cliente_id FOREIGN KEY (principio_ativo_cliente_id) REFERENCES principio_ativo_cliente (id) ON DELETE RESTRICT;

-- L7-07 (principio_ativo_cliente): alergeno_principio_ativo pelo oficial ou pelo do cliente
ALTER TABLE alergeno_principio_ativo
  ADD CONSTRAINT fk_alergeno_principio_ativo_principio_ativo_cliente_id FOREIGN KEY (principio_ativo_cliente_id) REFERENCES principio_ativo_cliente (id) ON DELETE RESTRICT;

-- L6-13 (16): semente de unidade de duração
INSERT IGNORE INTO unidade_duracao_tratamento (codigo, descricao, dias_equivalentes, ativo, criado_em) VALUES
  ('dia', 'Dia', 1, TRUE, CURRENT_TIMESTAMP(3)),
  ('semana', 'Semana', 7, TRUE, CURRENT_TIMESTAMP(3)),
  ('mes', 'Mês', 30, TRUE, CURRENT_TIMESTAMP(3)),
  ('ano', 'Ano', 365, TRUE, CURRENT_TIMESTAMP(3));
