-- Férias por vínculo (fecho-1, família folha-ferias-obrigacoes; decisão do orquestrador pela prática de mercado e pela
-- CLT arts. 130 e 134): o período aquisitivo é de um CONTRATO DE TRABALHO (vinculo_trabalho), não da pessoa. Cada
-- vínculo tem o seu período de 12 meses contado da admissão; o colaborador com dois contratos (inclusive de mesmo
-- início) tem dois períodos. A chave natural passa de (colaborador_id, inicio) para (vinculo_trabalho_id, inicio).
-- Para frente e idempotente:
--   1. a coluna nasce anulável;
--   2. o período já gravado herda o vínculo das férias programadas nele, só se TODAS as férias dele (inclusive as
--      canceladas e excluídas) são de um único vínculo, não excluído, do mesmo colaborador e do mesmo estabelecimento
--      do período; período sem férias herda o ÚNICO vínculo não excluído do colaborador no mesmo estabelecimento cuja
--      vigência alcança o início do período. Período com férias de dois vínculos, ou com dois contratos em curso no
--      início, fica sem vínculo;
--   3. a coluna fica obrigatória: período sem vínculo que a etapa 2 não resolveu faz o MODIFY falhar em modo estrito
--      (erro 1265/1138), à vista: nunca se escolhe nem se inventa o contrato. Depois, a chave estrangeira e a nova chave
--      única;
--   4. as férias sem vínculo herdam o do seu período, a coluna das férias fica obrigatória, e a chave composta
--      (periodo_aquisitivo_id, vinculo_trabalho_id) → periodo_aquisitivo (id, vinculo_trabalho_id) garante que a
--      fração de férias é do mesmo contrato do seu período aquisitivo.

ALTER TABLE periodo_aquisitivo
  ADD COLUMN IF NOT EXISTS vinculo_trabalho_id BIGINT UNSIGNED NULL
    COMMENT 'Contrato de trabalho dono do período (o período aquisitivo é por vínculo, CLT art. 130)' AFTER colaborador_id;

UPDATE periodo_aquisitivo pa
  JOIN (SELECT periodo_aquisitivo_id, MIN(vinculo_trabalho_id) AS vinculo,
               COUNT(DISTINCT vinculo_trabalho_id) AS vinculos
          FROM programacao_ferias
         WHERE vinculo_trabalho_id IS NOT NULL
         GROUP BY periodo_aquisitivo_id) pf ON pf.periodo_aquisitivo_id = pa.id
  JOIN vinculo_trabalho v ON v.id = pf.vinculo
   SET pa.vinculo_trabalho_id = pf.vinculo
 WHERE pa.vinculo_trabalho_id IS NULL
   AND pf.vinculos = 1
   AND v.colaborador_id = pa.colaborador_id
   AND v.estabelecimento_id = pa.estabelecimento_id
   AND v.excluido_em IS NULL;

UPDATE periodo_aquisitivo pa
   SET pa.vinculo_trabalho_id = (
         SELECT MIN(v.id) FROM vinculo_trabalho v
          WHERE v.colaborador_id = pa.colaborador_id AND v.estabelecimento_id = pa.estabelecimento_id
            AND v.excluido_em IS NULL
            AND v.data_admissao <= pa.inicio
            AND (v.data_desligamento IS NULL OR v.data_desligamento >= pa.inicio)
         HAVING COUNT(*) = 1)
 WHERE pa.vinculo_trabalho_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM programacao_ferias pf
                    WHERE pf.periodo_aquisitivo_id = pa.id AND pf.vinculo_trabalho_id IS NOT NULL);

ALTER TABLE periodo_aquisitivo
  MODIFY COLUMN vinculo_trabalho_id BIGINT UNSIGNED NOT NULL
    COMMENT 'Contrato de trabalho dono do período (o período aquisitivo é por vínculo, CLT art. 130)';

ALTER TABLE periodo_aquisitivo
  DROP INDEX IF EXISTS uq_periodo_aquisitivo_colaborador_inicio,
  ADD UNIQUE KEY IF NOT EXISTS uq_periodo_aquisitivo_vinculo_inicio (vinculo_trabalho_id, inicio),
  ADD KEY IF NOT EXISTS ix_periodo_aquisitivo_colaborador (colaborador_id, inicio);

ALTER TABLE periodo_aquisitivo
  ADD CONSTRAINT fk_periodo_aquisitivo_vinculo_trabalho_id FOREIGN KEY IF NOT EXISTS (vinculo_trabalho_id)
    REFERENCES vinculo_trabalho (id) ON DELETE RESTRICT;

-- 4. A fração de férias é do contrato do seu período aquisitivo.
UPDATE programacao_ferias pf
  JOIN periodo_aquisitivo pa ON pa.id = pf.periodo_aquisitivo_id
   SET pf.vinculo_trabalho_id = pa.vinculo_trabalho_id
 WHERE pf.vinculo_trabalho_id IS NULL;

ALTER TABLE programacao_ferias
  MODIFY COLUMN vinculo_trabalho_id BIGINT UNSIGNED NOT NULL
    COMMENT 'Contrato de trabalho das férias (o mesmo do período aquisitivo, chave composta)';

ALTER TABLE periodo_aquisitivo
  ADD UNIQUE KEY IF NOT EXISTS uq_periodo_aquisitivo_id_vinculo (id, vinculo_trabalho_id);

ALTER TABLE programacao_ferias
  ADD KEY IF NOT EXISTS ix_programacao_ferias_periodo_vinculo (periodo_aquisitivo_id, vinculo_trabalho_id);

-- Férias ligadas a período de outro vínculo fazem esta chave falhar à vista (erro 1452): nunca se corrige em silêncio.
ALTER TABLE programacao_ferias
  ADD CONSTRAINT fk_programacao_ferias_periodo_vinculo FOREIGN KEY IF NOT EXISTS
    (periodo_aquisitivo_id, vinculo_trabalho_id) REFERENCES periodo_aquisitivo (id, vinculo_trabalho_id)
    ON DELETE RESTRICT;
