-- PEP, oncologia (C2-090, 03-PEP L111, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; as
-- regras ficam no domínio (dominio-pep/especialidades/oncologia) e na porta própria.
--   - protocolo_quimioterapia.farmacos_publicados: o conteúdo publicado da versão (fármaco pelo nome genérico, dose,
--     unidade da base do cálculo, via, dias do ciclo e administração), imutável, que o hash_conteudo (SHA-256) confere.
--     A versão publicada pela tela não depende do cadastro de itens prescritíveis; os fármacos ligados ao cadastro
--     continuam em protocolo_quimioterapia_droga (os protocolos anteriores à versão leem dali).
--   - ciclo_quimioterapia.protocolo_quimioterapia_id: a versão do protocolo com que o ciclo foi calculado (o tratamento
--     guarda a versão adotada; uma versão nova no meio do tratamento vale para os ciclos seguintes).
--   - ciclo_quimioterapia.doses_validadas: as doses finais que o farmacêutico calculou na dupla checagem independente.
-- Nada é apagado: as colunas são novas e nulas nos registros existentes.

ALTER TABLE protocolo_quimioterapia
  ADD COLUMN IF NOT EXISTS farmacos_publicados JSON NULL COMMENT 'Fármacos da versão publicada (imutável; conferidos pelo hash do conteúdo)',
  DROP CONSTRAINT IF EXISTS ck_protocolo_quimioterapia_farmacos,
  ADD CONSTRAINT ck_protocolo_quimioterapia_farmacos CHECK (farmacos_publicados IS NULL OR JSON_VALID(farmacos_publicados));

ALTER TABLE ciclo_quimioterapia
  ADD COLUMN IF NOT EXISTS protocolo_quimioterapia_id BIGINT UNSIGNED NULL COMMENT 'Versão do protocolo com que o ciclo foi calculado',
  ADD COLUMN IF NOT EXISTS doses_validadas JSON NULL COMMENT 'Doses finais calculadas pelo farmacêutico na validação',
  DROP CONSTRAINT IF EXISTS ck_ciclo_quimioterapia_doses_validadas,
  ADD CONSTRAINT ck_ciclo_quimioterapia_doses_validadas CHECK (doses_validadas IS NULL OR JSON_VALID(doses_validadas)),
  ADD KEY IF NOT EXISTS ix_ciclo_quimioterapia_protocolo (protocolo_quimioterapia_id);
