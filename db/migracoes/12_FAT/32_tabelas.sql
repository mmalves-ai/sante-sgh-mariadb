-- ADR 0009, volta 2 (mudança compartilhada). Só para frente; FOREIGN KEY em 32_chaves.sql.
--
-- 1) Pendência 3: alvo "exame" da regra de preço particular = o atendimento padrão de EXAME da agenda, sem item (o que
--    a origem tem no texto "valor do exame particular" sem dizer qual exame). Só a agenda pode ser dona desse alvo (o
--    profissional não tem "exame padrão"); o domínio aplica a regra ao exame lançado pela agenda, no mesmo nível de
--    especificidade da consulta (item e grupo vencem).
ALTER TABLE regra_preco_particular DROP CONSTRAINT IF EXISTS ck_regra_preco_particular_alvo;
ALTER TABLE regra_preco_particular
  MODIFY COLUMN alvo VARCHAR(20) NOT NULL COMMENT 'item | grupo | consulta (qualquer consulta do dono, sem item) | exame (o exame padrão da agenda, sem item; só com dono agenda)',
  ADD CONSTRAINT ck_regra_preco_particular_alvo CHECK ((alvo = 'item' AND item_faturavel_id IS NOT NULL AND grupo_faturamento_id IS NULL)
                                                    OR (alvo = 'grupo' AND grupo_faturamento_id IS NOT NULL AND item_faturavel_id IS NULL)
                                                    OR (alvo = 'consulta' AND item_faturavel_id IS NULL AND grupo_faturamento_id IS NULL)
                                                    OR (alvo = 'exame' AND item_faturavel_id IS NULL AND grupo_faturamento_id IS NULL
                                                        AND agenda_servico_id IS NOT NULL));

-- 2) Pendência 1: o valor de consulta do profissional por fonte pagadora que vem da origem chega ANTES de se saber se a
--    fonte é particular (a carga presume o tipo "outro"). Fica guardado aqui, íntegro, até a fonte ser classificada:
--    fonte particular -> vira regra_preco_particular (alvo consulta, dono o profissional, origem migracao) e a linha
--    fica "aplicada" com a regra ligada; fonte de outro tipo -> "descartada" (decisão 24: não existe preço por médico
--    em convênio), e o valor continua aqui para a conciliação provar que a informação não se perdeu.
CREATE TABLE preco_consulta_origem (
  id                                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id                  BIGINT UNSIGNED NULL COMMENT 'Nulo: vale na rede inteira do cliente',
  fonte_pagadora_id                   BIGINT UNSIGNED NOT NULL COMMENT 'Fonte pagadora da linha de origem, ainda sem tipo confirmado',
  profissional_id                     BIGINT UNSIGNED NOT NULL,
  codigo_prestador_fonte_pagadora_id  BIGINT UNSIGNED NULL COMMENT 'Código do profissional na fonte carregado da mesma linha de origem',
  valor                               DECIMAL(15,2) NOT NULL COMMENT 'Valor de consulta informado na origem',
  vigencia_inicio                     DATE NOT NULL,
  vigencia_fim                        DATE NULL,
  situacao                            VARCHAR(20) NOT NULL DEFAULT 'pendente' COMMENT 'pendente (fonte não classificada) | aplicada (virou regra particular) | descartada (fonte não é particular)',
  regra_preco_particular_id           BIGINT UNSIGNED NULL COMMENT 'Regra criada a partir desta linha (situação aplicada)',
  motivo_situacao                     VARCHAR(200) NULL,
  decidido_em                         DATETIME(3) NULL,
  origem                              VARCHAR(20) NOT NULL DEFAULT 'migracao',
  criado_em                           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  criado_por                          BIGINT UNSIGNED NULL,
  alterado_em                         DATETIME(3) NULL,
  alterado_por                        BIGINT UNSIGNED NULL,
  versao                              INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_preco_consulta_origem_valor CHECK (valor >= 0),
  CONSTRAINT ck_preco_consulta_origem_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_preco_consulta_origem_situacao CHECK (situacao IN ('pendente','aplicada','descartada')),
  CONSTRAINT ck_preco_consulta_origem_regra CHECK ((situacao = 'aplicada') = (regra_preco_particular_id IS NOT NULL)),
  CONSTRAINT ck_preco_consulta_origem_decisao CHECK ((situacao = 'pendente') = (decidido_em IS NULL)),
  CONSTRAINT ck_preco_consulta_origem_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uk_preco_consulta_origem_linha (fonte_pagadora_id, profissional_id, vigencia_inicio, estabelecimento_id),
  KEY ix_preco_consulta_origem_situacao (fonte_pagadora_id, situacao),
  KEY ix_preco_consulta_origem_profissional (profissional_id),
  KEY ix_preco_consulta_origem_estabelecimento (estabelecimento_id),
  KEY ix_preco_consulta_origem_codigo (codigo_prestador_fonte_pagadora_id),
  KEY ix_preco_consulta_origem_regra (regra_preco_particular_id)
) COMMENT='Valor de consulta do profissional por fonte pagadora vindo da origem, guardado até a fonte ser classificada (particular vira regra de preço particular)';
