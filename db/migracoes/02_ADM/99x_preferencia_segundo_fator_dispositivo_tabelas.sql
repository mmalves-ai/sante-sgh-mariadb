-- Segundo fator pela chave do dispositivo na entrada (01-ADM L62, DP-45 decidida em 26/11): a conta pode escolher o
-- dispositivo (WebAuthn com biometria local) como método da entrada, ao lado do aplicativo e do código no e-mail.
-- Só para frente e idempotente (ADR 0002, parte 2). O nome 99x ordena depois da 99w (tabela credencial_dispositivo).

ALTER TABLE preferencia_segundo_fator
  MODIFY metodo VARCHAR(20) NOT NULL COMMENT 'aplicativo (autenticador), email (código enviado ao e-mail da conta) ou dispositivo (chave do aparelho com biometria local)',
  DROP CONSTRAINT IF EXISTS ck_preferencia_segundo_fator_metodo,
  ADD CONSTRAINT ck_preferencia_segundo_fator_metodo CHECK (metodo IN ('aplicativo','email','dispositivo'));
