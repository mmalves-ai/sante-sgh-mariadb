-- Plataforma 0092 (modulos-proprios-2, família acesso-email; pedido do dono de 23/11): "Esqueci a senha" e segundo
-- fator por código no e-mail para o ADMINISTRADOR DA PLATAFORMA. Só para frente e idempotente.
-- O token da recuperação e o código do e-mail nunca são guardados aqui: vivem só como resumo SHA-256, com validade
-- curta, no armazém de sessões. Aqui ficam a escolha do segundo fator e a linha do tempo da credencial (só de
-- acréscimo: sem UPDATE nem DELETE pela aplicação).

ALTER TABLE credencial_administrador_plataforma
  ADD COLUMN IF NOT EXISTS metodo_segundo_fator VARCHAR(20) NOT NULL DEFAULT 'aplicativo'
    COMMENT 'aplicativo (autenticador) ou email (código enviado ao e-mail do administrador)';
ALTER TABLE credencial_administrador_plataforma
  DROP CONSTRAINT IF EXISTS ck_credencial_adm_plataforma_metodo_segundo_fator;
ALTER TABLE credencial_administrador_plataforma
  ADD CONSTRAINT ck_credencial_adm_plataforma_metodo_segundo_fator CHECK (metodo_segundo_fator IN ('aplicativo','email'));

CREATE TABLE IF NOT EXISTS credencial_administrador_evento (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  administrador_plataforma_id BIGINT UNSIGNED NOT NULL,
  tipo                        VARCHAR(40) NOT NULL,
  origem_resumo               CHAR(64) NULL COMMENT 'SHA-256 do endereço de origem; nunca o endereço',
  correlacao                  VARCHAR(64) NULL,
  ocorrido_em                 DATETIME(3) NOT NULL,
  criado_em                   DATETIME(3) NOT NULL,
  CONSTRAINT ck_credencial_administrador_evento_tipo CHECK (tipo IN
    ('recuperacao_pedida','senha_recuperada','segundo_fator_metodo_alterado','codigo_email_enviado','codigo_email_conferido','codigo_email_recusado')),
  KEY ix_credencial_administrador_evento_adm (administrador_plataforma_id, ocorrido_em),
  CONSTRAINT fk_credencial_administrador_evento_adm
    FOREIGN KEY (administrador_plataforma_id) REFERENCES administrador_plataforma (id) ON DELETE RESTRICT
) COMMENT='Linha do tempo da credencial do administrador da plataforma (recuperação e segundo fator); só de acréscimo';
