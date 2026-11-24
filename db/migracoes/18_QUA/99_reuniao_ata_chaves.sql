-- Qualidade, reuniões das comissões (família qualidade-q4): chaves estrangeiras (idempotentes) do 99_reuniao_ata_tabelas.

ALTER TABLE reuniao_comissao ADD CONSTRAINT fk_reuniao_comissao_ata_assinada_por_usuario_id FOREIGN KEY IF NOT EXISTS (ata_assinada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reuniao_comissao ADD CONSTRAINT fk_reuniao_comissao_assinatura_anterior_por_usuario_id FOREIGN KEY IF NOT EXISTS (assinatura_anterior_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
