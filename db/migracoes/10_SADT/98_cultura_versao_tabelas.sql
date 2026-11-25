-- SADT, microbiologia (F7, 05-SADT linha 12; 24/11/2026). Só para frente e idempotente (ADR 0002, parte 2).
-- A versão substituída da cultura: ao retificar a cultura final, a cultura inteira que vigorava (cabeçalho, isolados,
-- antibiograma e o texto do laudo emitido) fica guardada aqui antes da mudança, com o motivo. O laudo já emitido, que
-- pode ter orientado a conduta, continua consultável (laudo retificado com a versão anterior, boa prática SBIS).
-- Nunca se altera nem se apaga uma linha desta tabela.
CREATE TABLE IF NOT EXISTS resultado_cultura_versao (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  resultado_cultura_id   BIGINT UNSIGNED NOT NULL COMMENT 'Cultura retificada',
  versao_cultura         INT UNSIGNED NOT NULL COMMENT 'Versão da cultura que vigorava antes da retificação',
  situacao               VARCHAR(20) NOT NULL COMMENT 'Situação da cultura substituída (final ou retificado)',
  conteudo               LONGTEXT NOT NULL COMMENT 'A cultura substituída inteira em JSON: cabeçalho, isolados, testes e laudo',
  motivo                 VARCHAR(500) NOT NULL COMMENT 'Motivo da retificação que substituiu esta versão',
  substituida_em         DATETIME(3) NOT NULL,
  substituida_por        BIGINT UNSIGNED NULL COMMENT 'Usuário que retificou',
  origem                 VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em              DATETIME(3) NOT NULL,
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_resultado_cultura_versao_situacao CHECK (situacao IN ('final','retificado')),
  CONSTRAINT ck_resultado_cultura_versao_conteudo CHECK (JSON_VALID(conteudo)),
  CONSTRAINT ck_resultado_cultura_versao_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_resultado_cultura_versao (resultado_cultura_id, versao_cultura)
) COMMENT='Versão substituída da cultura do resultado, guardada inteira com o laudo emitido e o motivo da retificação';
