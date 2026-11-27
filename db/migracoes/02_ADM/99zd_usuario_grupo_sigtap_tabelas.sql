-- Permissão por procedimento do SUS no escopo da conta (01-ADM L59, C2-051; decisão em docs/obra/decisoes-tomadas.md):
-- a conta recebe grupos, subgrupos ou formas de organização da tabela unificada. Sem concessão vigente, vale só a
-- compatibilidade do procedimento com a ocupação (CBO); com concessões, a conta só lança no fechamento da AIH os
-- procedimentos dos ramos concedidos. Retirar é exclusão lógica, e a unicidade vale entre as vigentes (como a 94).
-- Só para frente e idempotente (ADR 0002, parte 2).

CREATE TABLE IF NOT EXISTS usuario_grupo_sigtap (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id        BIGINT UNSIGNED NOT NULL,
  grupo_sigtap_id   BIGINT UNSIGNED NOT NULL COMMENT 'Grupo, subgrupo ou forma de organização concedido',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em       DATETIME(3) NULL,
  excluido_por      BIGINT UNSIGNED NULL,
  vigente_chave     TINYINT UNSIGNED AS (IF(excluido_em IS NULL, 1, NULL)) PERSISTENT COMMENT 'Só para a unicidade: 1 enquanto não retirada',
  UNIQUE KEY uq_usuario_grupo_sigtap_par_vigente (usuario_id, grupo_sigtap_id, vigente_chave),
  KEY ix_usuario_grupo_sigtap_grupo (grupo_sigtap_id)
) COMMENT='Ramos da tabela unificada do SUS (grupo, subgrupo, forma) cujos procedimentos a conta pode lançar';
