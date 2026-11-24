-- Qualidade, gestão no banco próprio (modulos-proprios-3, família qualidade-q1): chaves da assinatura da ata.

ALTER TABLE reuniao_comissao ADD CONSTRAINT fk_reuniao_comissao_ata_assinada_por FOREIGN KEY IF NOT EXISTS (ata_assinada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE reuniao_comissao ADD CONSTRAINT fk_reuniao_comissao_assinatura_anterior_por FOREIGN KEY IF NOT EXISTS (assinatura_anterior_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
