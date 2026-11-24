-- Anexo: privilégios do papel papel_aplicacao no banco da PLATAFORMA (clientes, credencial do administrador, fila do
-- conector). Execute como administrador, conectado ao banco da plataforma (USE <banco da plataforma>), na
-- instalação e depois de cada migração de db/plataforma. Os bancos dos clientes têm o seu anexo:
-- privilegios-papel.sql (o mesmo papel; os dois são necessários).
-- Gerado por `pnpm implantacao:listas`; não edite à mão.
--
-- Só cria o papel, concede e retira: nenhuma tabela nem dado é alterado. Cada GRANT vem seguido do REVOKE do que a
-- tabela não deve ter, para que reaplicar o anexo convirja (a tabela que passou à exclusão lógica perde o DELETE).
-- Depois, atribua o papel à conta da aplicação e torne-o o papel padrão dela (GRANT e SET DEFAULT ROLE).
-- 13 tabelas. Só de acréscimo: cliente_evento, conta_plataforma_evento, modelo_documento_evento, sessao_suporte_aviso, sugestao_notificacao_resolvida, trilha_auditoria, trilha_auditoria_fecho, trilha_encadeamento_inicio; tabela com exclusão lógica e tabela clínica não recebem DELETE.

CREATE ROLE IF NOT EXISTS papel_aplicacao;

GRANT SELECT, INSERT, UPDATE, DELETE ON administrador_plataforma TO papel_aplicacao;
GRANT SELECT, INSERT, UPDATE ON atribuicao_suporte TO papel_aplicacao;
REVOKE DELETE ON atribuicao_suporte FROM papel_aplicacao;
GRANT SELECT, INSERT, UPDATE, DELETE ON cliente TO papel_aplicacao;
GRANT SELECT, INSERT ON cliente_evento TO papel_aplicacao;
REVOKE UPDATE, DELETE ON cliente_evento FROM papel_aplicacao;
GRANT SELECT, INSERT, UPDATE, DELETE ON cliente_origem TO papel_aplicacao;
GRANT SELECT, INSERT, UPDATE, DELETE ON conector_execucao TO papel_aplicacao;
GRANT SELECT, INSERT, UPDATE ON conta_plataforma TO papel_aplicacao;
REVOKE DELETE ON conta_plataforma FROM papel_aplicacao;
GRANT SELECT, INSERT ON conta_plataforma_evento TO papel_aplicacao;
REVOKE UPDATE, DELETE ON conta_plataforma_evento FROM papel_aplicacao;
GRANT SELECT, INSERT, UPDATE, DELETE ON credencial_administrador_plataforma TO papel_aplicacao;
GRANT SELECT, INSERT, UPDATE ON sessao_suporte TO papel_aplicacao;
REVOKE DELETE ON sessao_suporte FROM papel_aplicacao;
GRANT SELECT, INSERT, UPDATE ON sessao_suporte_acao TO papel_aplicacao;
REVOKE DELETE ON sessao_suporte_acao FROM papel_aplicacao;
GRANT SELECT, INSERT ON sessao_suporte_aviso TO papel_aplicacao;
REVOKE UPDATE, DELETE ON sessao_suporte_aviso FROM papel_aplicacao;
GRANT SELECT, INSERT, UPDATE ON sessao_suporte_leitura TO papel_aplicacao;
REVOKE DELETE ON sessao_suporte_leitura FROM papel_aplicacao;
