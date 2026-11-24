-- Qualidade, segurança do paciente, etapa 2 (modulos-proprios-1, família qualidade-a): chaves da sugestão resolvida.

ALTER TABLE sugestao_notificacao_resolvida ADD CONSTRAINT fk_sugestao_notificacao_resolvida_estabelecimento FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE sugestao_notificacao_resolvida ADD CONSTRAINT fk_sugestao_notificacao_resolvida_criado_por FOREIGN KEY IF NOT EXISTS (criado_por) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE sugestao_notificacao_resolvida ADD CONSTRAINT fk_sugestao_notificacao_resolvida_alterado_por FOREIGN KEY IF NOT EXISTS (alterado_por) REFERENCES usuario (id) ON DELETE RESTRICT;
