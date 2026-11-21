-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

ALTER TABLE queixa_tecnica_produto ADD CONSTRAINT fk_queixa_tecnica_produto_alerta FOREIGN KEY IF NOT EXISTS (alerta_sanitario_id) REFERENCES alerta_sanitario (id) ON DELETE RESTRICT;
ALTER TABLE caso_infeccao ADD CONSTRAINT fk_caso_infeccao_exame_item FOREIGN KEY IF NOT EXISTS (exame_item_id) REFERENCES exame_item (id) ON DELETE RESTRICT;
ALTER TABLE decisao_antimicrobiano ADD CONSTRAINT fk_decisao_antimicrobiano_estabelecimento FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE decisao_antimicrobiano ADD CONSTRAINT fk_decisao_antimicrobiano_prescricao_item FOREIGN KEY IF NOT EXISTS (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT;
ALTER TABLE decisao_antimicrobiano ADD CONSTRAINT fk_decisao_antimicrobiano_prescricao FOREIGN KEY IF NOT EXISTS (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT;
ALTER TABLE decisao_antimicrobiano ADD CONSTRAINT fk_decisao_antimicrobiano_internacao FOREIGN KEY IF NOT EXISTS (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT;
ALTER TABLE decisao_antimicrobiano ADD CONSTRAINT fk_decisao_antimicrobiano_paciente FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE decisao_antimicrobiano ADD CONSTRAINT fk_decisao_antimicrobiano_insumo FOREIGN KEY IF NOT EXISTS (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE decisao_antimicrobiano ADD CONSTRAINT fk_decisao_antimicrobiano_ficha FOREIGN KEY IF NOT EXISTS (ficha_antimicrobiano_id) REFERENCES ficha_antimicrobiano (id) ON DELETE RESTRICT;
ALTER TABLE decisao_antimicrobiano ADD CONSTRAINT fk_decisao_antimicrobiano_usuario FOREIGN KEY IF NOT EXISTS (decidido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE revisao_decisao_antimicrobiano ADD CONSTRAINT fk_revisao_decisao_antimicrobiano_decisao FOREIGN KEY IF NOT EXISTS (decisao_antimicrobiano_id) REFERENCES decisao_antimicrobiano (id) ON DELETE RESTRICT;
ALTER TABLE revisao_decisao_antimicrobiano ADD CONSTRAINT fk_revisao_decisao_antimicrobiano_usuario FOREIGN KEY IF NOT EXISTS (revisado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_antimicrobiano_insumo ADD CONSTRAINT fk_configuracao_antimicrobiano_insumo_estab FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE configuracao_antimicrobiano_insumo ADD CONSTRAINT fk_configuracao_antimicrobiano_insumo_insumo FOREIGN KEY IF NOT EXISTS (insumo_id) REFERENCES insumo (id) ON DELETE RESTRICT;
ALTER TABLE nao_conformidade_qualidade ADD CONSTRAINT fk_nao_conformidade_qualidade_cancelada_por FOREIGN KEY IF NOT EXISTS (cancelada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE nao_conformidade_qualidade ADD CONSTRAINT fk_nao_conformidade_qualidade_duplicada FOREIGN KEY IF NOT EXISTS (duplicada_de_id) REFERENCES nao_conformidade_qualidade (id) ON DELETE RESTRICT;
ALTER TABLE documento_qualidade_versao ADD CONSTRAINT fk_documento_qualidade_versao_retirada_por FOREIGN KEY IF NOT EXISTS (retirada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reuniao_comissao ADD CONSTRAINT fk_reuniao_comissao_ata_assinada_por FOREIGN KEY IF NOT EXISTS (ata_assinada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE envio_regulatorio_qualidade ADD CONSTRAINT fk_envio_regulatorio_qualidade_estabelecimento FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE envio_regulatorio_qualidade ADD CONSTRAINT fk_envio_regulatorio_qualidade_gerado_por FOREIGN KEY IF NOT EXISTS (gerado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE envio_regulatorio_qualidade ADD CONSTRAINT fk_envio_regulatorio_qualidade_transmitido_por FOREIGN KEY IF NOT EXISTS (transmitido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
