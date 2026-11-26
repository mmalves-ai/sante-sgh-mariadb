-- Segundo fator pela chave do dispositivo (WebAuthn/FIDO2 com biometria local; 01-ADM L62, DP-45 decidida em 26/11:
-- opcional ao lado do aplicativo autenticador e do código no e-mail). Só para frente e idempotente (ADR 0002, parte 2).
-- A biometria nunca sai do dispositivo: aqui fica só a chave PÚBLICA da credencial (COSE, base64url), o contador de
-- assinaturas (contra cópia da chave) e o nome que o usuário deu ao aparelho. Remover é revogar (revogada_em).
-- O nome 99w ordena depois das 99_ (o criador do cliente aplica em ordem de nome).

CREATE TABLE IF NOT EXISTS credencial_dispositivo (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id              BIGINT UNSIGNED NOT NULL COMMENT 'Conta de acesso dona do dispositivo',
  identificador_credencial VARCHAR(1400) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Identificador da credencial dado pelo dispositivo (base64url)',
  chave_publica           VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Chave pública COSE da credencial (base64url); nenhum dado biométrico',
  algoritmo               SMALLINT NOT NULL COMMENT 'Algoritmo COSE: -7 ES256, -8 EdDSA, -257 RS256',
  contador_assinatura     BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Último contador de assinaturas aceito (só anda para frente)',
  nome                    VARCHAR(60) NOT NULL COMMENT 'Nome do aparelho dado pelo usuário',
  formato_atestado        VARCHAR(32) NOT NULL COMMENT 'Formato do atestado recebido no cadastro (none: não se pede a marca do aparelho)',
  verificacao_usuario     BOOLEAN NOT NULL COMMENT 'O dispositivo conferiu biometria ou PIN no cadastro',
  ultimo_uso_em           DATETIME(3) NULL COMMENT 'Última validação aceita',
  revogada_em             DATETIME(3) NULL COMMENT 'Remoção pelo usuário ou pelo administrador (a credencial deixa de valer)',
  revogada_por            BIGINT UNSIGNED NULL,
  criado_em               DATETIME(3) NOT NULL,
  criado_por              BIGINT UNSIGNED NULL,
  alterado_em             DATETIME(3) NULL,
  alterado_por            BIGINT UNSIGNED NULL,
  versao                  INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_credencial_dispositivo_algoritmo CHECK (algoritmo IN (-7, -8, -257)),
  CONSTRAINT ck_credencial_dispositivo_nome CHECK (CHAR_LENGTH(TRIM(nome)) >= 1),
  UNIQUE KEY uq_credencial_dispositivo_identificador (identificador_credencial(767)),
  KEY ix_credencial_dispositivo_usuario (usuario_id, revogada_em)
) COMMENT='Chaves de dispositivo (WebAuthn) cadastradas como segundo fator: só a chave pública, nunca a biometria';
