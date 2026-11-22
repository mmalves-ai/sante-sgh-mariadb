-- ADR 0009 (dono, 2026-11-22): preço PARTICULAR definido pelo médico ou pela agenda. Não existe preço por médico em
-- convênio (decisão 24): o convênio segue tabela da conta > plano > convênio. No particular, o cálculo lê esta regra
-- ANTES da tabela do particular; a mais específica vence (item > grupo > consulta; estabelecimento > rede;
-- prioridade menor; vigência mais recente). O repasse continua separado, sobre o valor cobrado, e a "consulta
-- particular vai inteira ao médico" da origem é regra de repasse (regra_repasse_item: fonte particular, 100%), sem
-- tabela nova. Só para frente; FOREIGN KEY em 31_chaves.sql.

CREATE TABLE regra_preco_particular (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id     BIGINT UNSIGNED NULL COMMENT 'Nulo: vale na rede inteira do cliente',
  fonte_pagadora_id      BIGINT UNSIGNED NOT NULL COMMENT 'Fonte pagadora de tipo particular (o domínio confere o tipo)',
  profissional_id        BIGINT UNSIGNED NULL COMMENT 'Dono da regra: o profissional (exclusivo com a agenda)',
  agenda_servico_id      BIGINT UNSIGNED NULL COMMENT 'Dono da regra: a agenda (exclusivo com o profissional)',
  alvo                   VARCHAR(20) NOT NULL COMMENT 'item | grupo | consulta (qualquer consulta do dono, sem item)',
  item_faturavel_id      BIGINT UNSIGNED NULL COMMENT 'Procedimento (alvo item)',
  grupo_faturamento_id   BIGINT UNSIGNED NULL COMMENT 'Grupo de procedimentos (alvo grupo)',
  valor                  DECIMAL(15,2) NOT NULL COMMENT 'Valor fixo cobrado do paciente particular',
  prioridade             SMALLINT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'Desempate explícito entre regras igualmente específicas; menor vence',
  vigencia_inicio        DATE NOT NULL,
  vigencia_fim           DATE NULL,
  situacao_revisao       VARCHAR(20) NOT NULL DEFAULT 'confirmada' COMMENT 'estimada (extraída do texto, já vale) | confirmada | recusada (não vale)',
  texto_origem_agenda_id BIGINT UNSIGNED NULL COMMENT 'Texto da agenda de onde a regra foi extraída; nulo na cadastrada ou importada de campo',
  ativo                  BOOLEAN NOT NULL DEFAULT TRUE,
  observacao             VARCHAR(500) NULL,
  origem                 VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  criado_por             BIGINT UNSIGNED NULL,
  alterado_em            DATETIME(3) NULL,
  alterado_por           BIGINT UNSIGNED NULL,
  versao                 INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em            DATETIME(3) NULL,
  excluido_por           BIGINT UNSIGNED NULL,
  CONSTRAINT ck_regra_preco_particular_dono CHECK ((profissional_id IS NULL) <> (agenda_servico_id IS NULL)),
  CONSTRAINT ck_regra_preco_particular_alvo CHECK ((alvo = 'item' AND item_faturavel_id IS NOT NULL AND grupo_faturamento_id IS NULL)
                                                OR (alvo = 'grupo' AND grupo_faturamento_id IS NOT NULL AND item_faturavel_id IS NULL)
                                                OR (alvo = 'consulta' AND item_faturavel_id IS NULL AND grupo_faturamento_id IS NULL)),
  CONSTRAINT ck_regra_preco_particular_valor CHECK (valor >= 0),
  CONSTRAINT ck_regra_preco_particular_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_regra_preco_particular_revisao CHECK (situacao_revisao IN ('estimada','confirmada','recusada')),
  CONSTRAINT ck_regra_preco_particular_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_regra_preco_particular_profissional (profissional_id, vigencia_inicio),
  KEY ix_regra_preco_particular_agenda (agenda_servico_id, vigencia_inicio),
  KEY ix_regra_preco_particular_fonte (fonte_pagadora_id),
  KEY ix_regra_preco_particular_estabelecimento (estabelecimento_id),
  KEY ix_regra_preco_particular_item (item_faturavel_id),
  KEY ix_regra_preco_particular_grupo (grupo_faturamento_id),
  KEY ix_regra_preco_particular_texto (texto_origem_agenda_id)
) COMMENT='Preço particular de consulta ou exame definido pelo profissional ou pela agenda, por procedimento ou grupo, com vigência e prioridade';

-- Os dois valor_consulta duplicados viram regra (só fonte de tipo particular; em convênio não há preço por médico).
INSERT INTO regra_preco_particular (estabelecimento_id, fonte_pagadora_id, profissional_id, alvo, valor, vigencia_inicio,
                                    vigencia_fim, origem, observacao, criado_em, criado_por)
SELECT p.estabelecimento_id, p.fonte_pagadora_id, p.profissional_id, 'consulta', p.valor_consulta, p.vigencia_inicio,
       p.vigencia_fim, 'migracao', 'Valor de consulta do credenciamento (ADR 0009)', CURRENT_TIMESTAMP(3), p.criado_por
FROM profissional_fonte_pagadora p JOIN fonte_pagadora f ON f.id = p.fonte_pagadora_id
WHERE p.valor_consulta IS NOT NULL AND f.tipo = 'particular' AND p.excluido_em IS NULL;

INSERT INTO regra_preco_particular (estabelecimento_id, fonte_pagadora_id, profissional_id, alvo, valor, vigencia_inicio,
                                    vigencia_fim, ativo, origem, observacao, criado_em, criado_por)
SELECT c.estabelecimento_id, c.fonte_pagadora_id, c.profissional_id, 'consulta', c.valor_consulta, c.vigencia_inicio,
       c.vigencia_fim, c.ativo, c.origem, 'Valor de consulta do código do prestador (ADR 0009)', CURRENT_TIMESTAMP(3), c.criado_por
FROM codigo_prestador_fonte_pagadora c JOIN fonte_pagadora f ON f.id = c.fonte_pagadora_id
WHERE c.valor_consulta IS NOT NULL AND c.profissional_id IS NOT NULL AND f.tipo = 'particular' AND c.excluido_em IS NULL
  AND NOT EXISTS (SELECT 1 FROM regra_preco_particular r
                  WHERE r.profissional_id = c.profissional_id AND r.fonte_pagadora_id = c.fonte_pagadora_id
                    AND r.alvo = 'consulta' AND r.vigencia_inicio = c.vigencia_inicio AND r.valor = c.valor_consulta
                    AND r.estabelecimento_id <=> c.estabelecimento_id);

ALTER TABLE profissional_fonte_pagadora DROP CONSTRAINT IF EXISTS ck_profissional_fonte_pagadora_valor;
ALTER TABLE profissional_fonte_pagadora DROP COLUMN IF EXISTS valor_consulta;
ALTER TABLE codigo_prestador_fonte_pagadora DROP COLUMN IF EXISTS valor_consulta;

-- Memória de cálculo: a regra particular que decidiu o preço (a tela explica "regra do médico ou da agenda").
ALTER TABLE conta_hospitalar_item_memoria
  ADD COLUMN regra_preco_particular_id BIGINT UNSIGNED NULL COMMENT 'Regra de preço particular que decidiu o valor; nulo quando veio da tabela',
  ADD KEY ix_conta_hospitalar_item_memoria_regra_preco_particular (regra_preco_particular_id);
