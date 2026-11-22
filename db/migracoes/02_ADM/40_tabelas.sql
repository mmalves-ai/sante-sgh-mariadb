-- F4 rodada 5 (ADR 0007, item 17): credenciais da origem COPIADAS. O login é o mesmo; a senha com hash de algoritmo
-- conhecido é importada como está, marcada para a API regravar em argon2id no primeiro login bem-sucedido (a
-- conferência do login é da API: F4-pedidos-f22.md); a senha legível ou reversível já chega em argon2id.

ALTER TABLE credencial_usuario
  DROP CONSTRAINT ck_credencial_usuario_algoritmo,
  ADD CONSTRAINT ck_credencial_usuario_algoritmo CHECK (algoritmo IN ('argon2id','bcrypt','scrypt','md5','sha1','sha256','sha512')),
  ADD COLUMN regravar_no_login BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Resumo importado de algoritmo antigo: a API confere pelo algoritmo e regrava em argon2id no 1º login',
  ADD CONSTRAINT ck_credencial_usuario_regravar CHECK (algoritmo = 'argon2id' OR regravar_no_login OR algoritmo IN ('bcrypt','scrypt'));
