-- Chaves do orçamento da OS e da remessa para conserto externo (98_manutencao_orcamento_tabelas.sql). Idempotente.
ALTER TABLE orcamento_ordem_servico_manutencao
  DROP FOREIGN KEY IF EXISTS fk_orcamento_ordem_servico_manutencao_estabelecimento_id,
  DROP FOREIGN KEY IF EXISTS fk_orcamento_ordem_servico_manutencao_os_id,
  DROP FOREIGN KEY IF EXISTS fk_orcamento_ordem_servico_manutencao_fornecedor_id,
  DROP FOREIGN KEY IF EXISTS fk_orcamento_ordem_servico_manutencao_registrado_id,
  DROP FOREIGN KEY IF EXISTS fk_orcamento_ordem_servico_manutencao_decidido_id;
ALTER TABLE orcamento_ordem_servico_manutencao
  ADD CONSTRAINT fk_orcamento_ordem_servico_manutencao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_ordem_servico_manutencao_os_id FOREIGN KEY (ordem_servico_manutencao_id) REFERENCES ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_ordem_servico_manutencao_fornecedor_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_ordem_servico_manutencao_registrado_id FOREIGN KEY (registrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_orcamento_ordem_servico_manutencao_decidido_id FOREIGN KEY (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE remessa_conserto_manutencao
  DROP FOREIGN KEY IF EXISTS fk_remessa_conserto_manutencao_estabelecimento_id,
  DROP FOREIGN KEY IF EXISTS fk_remessa_conserto_manutencao_os_id,
  DROP FOREIGN KEY IF EXISTS fk_remessa_conserto_manutencao_equipamento_id,
  DROP FOREIGN KEY IF EXISTS fk_remessa_conserto_manutencao_fornecedor_id,
  DROP FOREIGN KEY IF EXISTS fk_remessa_conserto_manutencao_orcamento_id,
  DROP FOREIGN KEY IF EXISTS fk_remessa_conserto_manutencao_enviado_por_id,
  DROP FOREIGN KEY IF EXISTS fk_remessa_conserto_manutencao_retornado_por_id;
ALTER TABLE remessa_conserto_manutencao
  ADD CONSTRAINT fk_remessa_conserto_manutencao_estabelecimento_id FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_conserto_manutencao_os_id FOREIGN KEY (ordem_servico_manutencao_id) REFERENCES ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_conserto_manutencao_equipamento_id FOREIGN KEY (equipamento_saude_id) REFERENCES equipamento_saude (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_conserto_manutencao_fornecedor_id FOREIGN KEY (empresa_fornecedora_id) REFERENCES empresa_fornecedora (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_conserto_manutencao_orcamento_id FOREIGN KEY (orcamento_ordem_servico_manutencao_id) REFERENCES orcamento_ordem_servico_manutencao (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_conserto_manutencao_enviado_por_id FOREIGN KEY (enviado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_remessa_conserto_manutencao_retornado_por_id FOREIGN KEY (retornado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
