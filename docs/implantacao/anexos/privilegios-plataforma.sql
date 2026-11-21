-- Anexo: privilégios do papel papel_aplicacao no banco da PLATAFORMA (clientes, credencial do administrador, fila do
-- conector). Execute como administrador, conectado ao banco da plataforma (USE <banco da plataforma>), na
-- instalação e depois de cada migração de db/plataforma. Os bancos dos clientes têm o seu anexo:
-- privilegios-papel.sql (o mesmo papel; os dois são necessários).
-- Gerado por `pnpm implantacao:listas`; não edite à mão.
--
-- Só cria o papel, concede e retira: nenhuma tabela nem dado é alterado. Cada GRANT vem seguido do REVOKE do que a
-- tabela não deve ter, para que reaplicar o anexo convirja (a tabela que passou à exclusão lógica perde o DELETE).
-- Depois, atribua o papel à conta da aplicação e torne-o o papel padrão dela (GRANT e SET DEFAULT ROLE).
-- 6 tabelas. Só de acréscimo: cliente_evento, trilha_auditoria; tabela com exclusão lógica não recebe DELETE.

CREATE ROLE IF NOT EXISTS papel_aplicacao;

GRANT SELECT, INSERT, UPDATE, DELETE ON administrador_plataforma TO papel_aplicacao;
GRANT SELECT, INSERT, UPDATE, DELETE ON cliente TO papel_aplicacao;
GRANT SELECT, INSERT ON cliente_evento TO papel_aplicacao;
REVOKE UPDATE, DELETE ON cliente_evento FROM papel_aplicacao;
GRANT SELECT, INSERT, UPDATE, DELETE ON cliente_origem TO papel_aplicacao;
GRANT SELECT, INSERT, UPDATE, DELETE ON conector_execucao TO papel_aplicacao;
GRANT SELECT, INSERT, UPDATE, DELETE ON credencial_administrador_plataforma TO papel_aplicacao;
