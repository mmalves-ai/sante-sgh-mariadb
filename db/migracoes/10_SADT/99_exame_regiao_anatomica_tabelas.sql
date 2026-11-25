-- SADT, região anatômica do exame (F8, 09-AREA linha 84; 25/11/2026). Só para frente e idempotente (ADR 0002, parte 2).
-- Sem gatilho: as regras ficam no domínio (@sgh/dominio-pep, terminologia-clinica.ts) e na porta própria.
-- As regiões anatômicas codificadas que o exame admite (ex.: radiografia de mão admite mão, punho e dedos), lidas de
-- regiao_anatomica_codificada (carregada da terminologia clínica pelo catalogos/carregadores/snomed.py). A ligação
-- nunca é apagada: a retirada só desativa (com quem e quando), e a religação reativa a mesma linha.
CREATE TABLE IF NOT EXISTS exame_regiao_anatomica (
  id                             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  exame_id                       BIGINT UNSIGNED NOT NULL,
  regiao_anatomica_codificada_id BIGINT UNSIGNED NOT NULL,
  padrao                         BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Região sugerida no pedido do exame',
  ativo                          BOOLEAN NOT NULL DEFAULT TRUE,
  desativado_em                  DATETIME(3) NULL,
  desativado_por                 BIGINT UNSIGNED NULL COMMENT 'Usuário que retirou a região do exame',
  criado_em                      DATETIME(3) NOT NULL,
  criado_por                     BIGINT UNSIGNED NULL,
  alterado_em                    DATETIME(3) NULL,
  alterado_por                   BIGINT UNSIGNED NULL,
  versao                         INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_exame_regiao_anatomica_desativacao CHECK (ativo OR desativado_em IS NOT NULL),
  UNIQUE KEY uq_exame_regiao_anatomica_par (exame_id, regiao_anatomica_codificada_id),
  KEY ix_exame_regiao_anatomica_regiao (regiao_anatomica_codificada_id),
  KEY ix_exame_regiao_anatomica_desativado_por (desativado_por)
) COMMENT='Regiões anatômicas codificadas que o exame admite, com a região padrão sugerida no pedido';
