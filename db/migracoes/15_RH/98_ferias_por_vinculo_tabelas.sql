-- Férias por vínculo (fecho-1, família folha-ferias-obrigacoes; decisão do orquestrador pela prática de mercado e pela
-- CLT arts. 130 e 134): o período aquisitivo é de um CONTRATO DE TRABALHO (vinculo_trabalho), não da pessoa. Cada
-- vínculo tem o seu período de 12 meses contado da admissão; o colaborador com dois contratos (inclusive de mesmo
-- início) tem dois períodos. A chave natural passa de (colaborador_id, inicio) para (vinculo_trabalho_id, inicio).
-- Para frente e idempotente:
--   1. a coluna nasce anulável;
--   2. o período já gravado herda o vínculo das férias programadas nele; sem férias, o do único vínculo do colaborador
--      no mesmo estabelecimento cuja vigência alcança o início do período (o de admissão mais recente, se houver mais
--      de um: o contrato em curso no início);
--   3. a coluna fica obrigatória (período sem vínculo que a etapa 2 não resolveu faz a migração falhar, à vista: nunca
--      se inventa o contrato), com a chave estrangeira e a nova chave única.

ALTER TABLE periodo_aquisitivo
  ADD COLUMN IF NOT EXISTS vinculo_trabalho_id BIGINT UNSIGNED NULL
    COMMENT 'Contrato de trabalho dono do período (o período aquisitivo é por vínculo, CLT art. 130)' AFTER colaborador_id;

UPDATE periodo_aquisitivo pa
  JOIN (SELECT periodo_aquisitivo_id, MIN(vinculo_trabalho_id) AS vinculo
          FROM programacao_ferias GROUP BY periodo_aquisitivo_id) pf ON pf.periodo_aquisitivo_id = pa.id
   SET pa.vinculo_trabalho_id = pf.vinculo
 WHERE pa.vinculo_trabalho_id IS NULL;

UPDATE periodo_aquisitivo pa
   SET pa.vinculo_trabalho_id = (
         SELECT v.id FROM vinculo_trabalho v
          WHERE v.colaborador_id = pa.colaborador_id AND v.estabelecimento_id = pa.estabelecimento_id
            AND v.data_admissao <= pa.inicio
            AND (v.data_desligamento IS NULL OR v.data_desligamento >= pa.inicio)
          ORDER BY v.data_admissao DESC, v.id DESC LIMIT 1)
 WHERE pa.vinculo_trabalho_id IS NULL;

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
