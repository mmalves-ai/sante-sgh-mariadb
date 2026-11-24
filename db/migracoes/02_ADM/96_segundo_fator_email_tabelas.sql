-- Segundo fator por código no e-mail (modulos-proprios-2, família acesso-email; pedido do dono de 23/11): a escolha
-- do segundo fator de cada usuário, ao lado do aplicativo autenticador. Só para frente e idempotente (ADR 0002,
-- parte 2). O código em si nunca é guardado no banco: vive só como resumo SHA-256, com validade curta, no armazém de
-- sessões. Sem linha para o usuário: vale o aplicativo (o padrão de antes).

CREATE TABLE IF NOT EXISTS preferencia_segundo_fator (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id   BIGINT UNSIGNED NOT NULL COMMENT 'Conta de acesso dona da escolha',
  metodo       VARCHAR(20) NOT NULL COMMENT 'aplicativo (autenticador) ou email (código enviado ao e-mail da conta)',
  criado_em    DATETIME(3) NOT NULL,
  criado_por   BIGINT UNSIGNED NULL,
  alterado_em  DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao       INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_preferencia_segundo_fator_metodo CHECK (metodo IN ('aplicativo','email')),
  UNIQUE KEY uq_preferencia_segundo_fator_usuario (usuario_id)
) COMMENT='Segundo fator escolhido por cada usuário: aplicativo autenticador ou código enviado ao e-mail';
