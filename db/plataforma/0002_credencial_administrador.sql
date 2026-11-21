-- Plataforma 0002: credencial do administrador da plataforma (decisão do dono 2026-11-20, b).
-- O administrador da plataforma entra pelo banco plataforma, com a própria credencial, escolhe o cliente no login
-- (ou há um só) e tem todas as permissões nele. Nada de usuário-espelho no banco do cliente.
-- Resumo da senha em argon2id (formato PHC, com o sal embutido); a senha nunca é guardada. Idempotente.
CREATE TABLE IF NOT EXISTS credencial_administrador_plataforma (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  administrador_plataforma_id BIGINT UNSIGNED NOT NULL,
  login                       VARCHAR(80) NOT NULL COMMENT 'Login do administrador na plataforma (ASCII, minúsculas)',
  resumo_senha                VARCHAR(255) NOT NULL COMMENT 'Resumo argon2id (PHC); nunca a senha',
  senha_alterada_em           DATETIME(3) NOT NULL,
  troca_obrigatoria           BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A sessão abre só para trocar a senha',
  tentativas_falhas           SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Senhas erradas seguidas; no limite arma bloqueado_ate e volta a zero',
  bloqueado_ate               DATETIME(3) NULL COMMENT 'Bloqueio por tentativas; nulo = liberado',
  criado_em                   DATETIME(3) NOT NULL,
  criado_por                  BIGINT UNSIGNED NULL,
  alterado_em                 DATETIME(3) NULL,
  alterado_por                BIGINT UNSIGNED NULL,
  versao                      INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_credencial_adm_plataforma_administrador (administrador_plataforma_id),
  UNIQUE KEY uq_credencial_adm_plataforma_login (login),
  CONSTRAINT ck_credencial_adm_plataforma_argon2id CHECK (resumo_senha LIKE '$argon2id$%'),
  CONSTRAINT ck_credencial_adm_plataforma_login CHECK (CAST(login AS BINARY) REGEXP '^[a-z0-9._-]{1,80}$'),
  CONSTRAINT fk_credencial_adm_plataforma_administrador
    FOREIGN KEY (administrador_plataforma_id) REFERENCES administrador_plataforma (id) ON DELETE RESTRICT
) COMMENT='Credencial do administrador da plataforma (login próprio, argon2id)';

-- Login só em ASCII minúsculo: a colação do banco ignora caracteres invisíveis (U+00AD, U+200B) e acentos, e um login
-- com eles seria outra grafia da mesma credencial para a contagem de tentativas. Refeito aqui para a tabela já criada
-- pela versão anterior desta migração (idempotente).
ALTER TABLE credencial_administrador_plataforma
  DROP CONSTRAINT IF EXISTS ck_credencial_adm_plataforma_login;
ALTER TABLE credencial_administrador_plataforma
  ADD CONSTRAINT ck_credencial_adm_plataforma_login CHECK (CAST(login AS BINARY) REGEXP '^[a-z0-9._-]{1,80}$');
