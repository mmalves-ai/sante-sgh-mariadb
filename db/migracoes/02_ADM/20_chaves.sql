-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE politica_segundo_fator ADD CONSTRAINT fk_politica_segundo_fator_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE politica_segundo_fator ADD CONSTRAINT fk_politica_segundo_fator_perfil_acesso_id FOREIGN KEY IF NOT EXISTS (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;
ALTER TABLE politica_segundo_fator ADD CONSTRAINT fk_politica_segundo_fator_encerrada_por_usuario_id FOREIGN KEY IF NOT EXISTS (encerrada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE politica_segundo_fator ADD CONSTRAINT fk_politica_segundo_fator_substituida_por_id FOREIGN KEY IF NOT EXISTS (substituida_por_id) REFERENCES politica_segundo_fator (id) ON DELETE RESTRICT;

ALTER TABLE pedido_titular ADD CONSTRAINT fk_pedido_titular_conta_portal_paciente_id FOREIGN KEY IF NOT EXISTS (conta_portal_paciente_id) REFERENCES conta_portal_paciente (id) ON DELETE RESTRICT;
ALTER TABLE consentimento_titular ADD CONSTRAINT fk_consentimento_titular_conta_portal_paciente_id FOREIGN KEY IF NOT EXISTS (conta_portal_paciente_id) REFERENCES conta_portal_paciente (id) ON DELETE RESTRICT;
ALTER TABLE consentimento_titular ADD CONSTRAINT fk_consentimento_titular_vinculo_responsavel_portal_id FOREIGN KEY IF NOT EXISTS (vinculo_responsavel_portal_id) REFERENCES vinculo_responsavel_portal (id) ON DELETE RESTRICT;

ALTER TABLE usuario_perfil_alteracao ADD CONSTRAINT fk_usuario_perfil_alteracao_usuario_perfil_id FOREIGN KEY IF NOT EXISTS (usuario_perfil_id) REFERENCES usuario_perfil (id) ON DELETE RESTRICT;

ALTER TABLE politica_senha_versao ADD CONSTRAINT fk_politica_senha_versao_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE politica_senha_versao ADD CONSTRAINT fk_politica_senha_versao_cancelada_por_usuario_id FOREIGN KEY IF NOT EXISTS (cancelada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE limite_sessao_perfil ADD CONSTRAINT fk_limite_sessao_perfil_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE limite_sessao_perfil ADD CONSTRAINT fk_limite_sessao_perfil_perfil_acesso_id FOREIGN KEY IF NOT EXISTS (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;

ALTER TABLE excecao_conta_dormente ADD CONSTRAINT fk_excecao_conta_dormente_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE excecao_conta_dormente ADD CONSTRAINT fk_excecao_conta_dormente_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;

ALTER TABLE conferencia_registro_conselho ADD CONSTRAINT fk_conferencia_registro_conselho_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_registro_conselho ADD CONSTRAINT fk_conferencia_registro_conselho_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE conferencia_registro_conselho ADD CONSTRAINT fk_conferencia_registro_conselho_inscricao_conselho_id FOREIGN KEY IF NOT EXISTS (inscricao_conselho_id) REFERENCES inscricao_conselho (id) ON DELETE RESTRICT;

ALTER TABLE perfil_cargo_rh ADD CONSTRAINT fk_perfil_cargo_rh_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE perfil_cargo_rh ADD CONSTRAINT fk_perfil_cargo_rh_cargo_id FOREIGN KEY IF NOT EXISTS (cargo_id) REFERENCES cargo (id) ON DELETE RESTRICT;
ALTER TABLE perfil_cargo_rh ADD CONSTRAINT fk_perfil_cargo_rh_perfil_acesso_id FOREIGN KEY IF NOT EXISTS (perfil_acesso_id) REFERENCES perfil_acesso (id) ON DELETE RESTRICT;

ALTER TABLE resolucao_tarefa_rh ADD CONSTRAINT fk_resolucao_tarefa_rh_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE resolucao_tarefa_rh ADD CONSTRAINT fk_resolucao_tarefa_rh_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE resolucao_tarefa_rh ADD CONSTRAINT fk_resolucao_tarefa_rh_resolvido_por_usuario_id FOREIGN KEY IF NOT EXISTS (resolvido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE comunicado_versao ADD CONSTRAINT fk_comunicado_versao_comunicado_id FOREIGN KEY IF NOT EXISTS (comunicado_id) REFERENCES comunicado (id) ON DELETE RESTRICT;

ALTER TABLE trilha_auditoria_fecho ADD CONSTRAINT fk_trilha_auditoria_fecho_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE trilha_auditoria_fecho ADD CONSTRAINT fk_trilha_auditoria_fecho_primeiro_trilha_auditoria_id FOREIGN KEY IF NOT EXISTS (primeiro_trilha_auditoria_id) REFERENCES trilha_auditoria (id) ON DELETE RESTRICT;
ALTER TABLE trilha_auditoria_fecho ADD CONSTRAINT fk_trilha_auditoria_fecho_ultimo_trilha_auditoria_id FOREIGN KEY IF NOT EXISTS (ultimo_trilha_auditoria_id) REFERENCES trilha_auditoria (id) ON DELETE RESTRICT;

