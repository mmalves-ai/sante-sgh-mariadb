-- ADM, lote 07 (F2.2 onda 3; pedido do lote 03-02: PIN da troca rápida). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (07_chaves.sql).

CREATE TABLE pin_troca_rapida (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  algoritmo VARCHAR(20) NOT NULL DEFAULT 'argon2id',
  resumo_pin VARCHAR(255) NULL COMMENT 'Resumo Argon2id (PHC) do PIN; o PIN em claro nunca é guardado; apagado ao encerrar',
  situacao VARCHAR(20) NOT NULL DEFAULT 'vivo',
  tentativas_invalidas SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Erros seguidos desde o último acerto',
  ultima_tentativa_invalida_em DATETIME(3) NULL,
  bloqueado_em DATETIME(3) NULL COMMENT 'Bloqueado ao atingir o teto de erros seguidos (parâmetro do estabelecimento)',
  encerrado_em DATETIME(3) NULL,
  motivo_encerramento VARCHAR(200) NULL,
  usuario_vivo_id BIGINT UNSIGNED AS (IF(situacao = 'vivo', usuario_id, NULL)) PERSISTENT COMMENT 'Usuário enquanto o PIN está vivo, para garantir um só vivo por estabelecimento',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_pin_troca_rapida_situacao CHECK (situacao IN ('vivo','substituido','retirado')),
  CONSTRAINT ck_pin_troca_rapida_algoritmo CHECK (algoritmo IN ('argon2id')),
  CONSTRAINT ck_pin_troca_rapida_resumo CHECK ((situacao = 'vivo') = (resumo_pin IS NOT NULL)),
  CONSTRAINT ck_pin_troca_rapida_encerramento CHECK (situacao = 'vivo' OR (encerrado_em IS NOT NULL AND motivo_encerramento IS NOT NULL)),
  CONSTRAINT ck_pin_troca_rapida_tentativas CHECK (tentativas_invalidas <= 10),
  UNIQUE KEY uq_pin_troca_rapida_vivo (estabelecimento_id, usuario_vivo_id),
  KEY ix_pin_troca_rapida_usuario (usuario_id)
) COMMENT='PIN da troca rápida de usuário na estação: resumo forte, erros seguidos, bloqueio e encerramento';
