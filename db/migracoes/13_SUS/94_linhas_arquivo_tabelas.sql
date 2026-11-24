-- Faturamento SUS, linhas guardadas dos arquivos na porta própria (família sus-resto, fecho-1, 24/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no serviço e na porta (porta-propria-resto.ts).
--   - dominio_sus: a lista fechada da fonte de remuneração da CIHA (comunicação de internação hospitalar), que o
--     registro_ciha exige (fonte_remuneracao_dominio_sus_id NOT NULL). Código próprio neutro e o código do leiaute
--     CIHA01 (TP_FREMU) em codigo_oficial, os mesmos do domínio (CODIGO_FONTE_CIHA).
--   - producao_ambulatorial_sus e apac: a geração nova da mesma competência substitui a remessa e guarda as linhas da
--     nova sem apagar as da anterior (histórico nunca apagado). A chave única passa a incluir a remessa (0 para a folha
--     ou a APAC ainda sem remessa, que continua única na competência).
ALTER TABLE dominio_sus DROP CONSTRAINT IF EXISTS ck_dominio_sus_lista;
ALTER TABLE dominio_sus ADD CONSTRAINT ck_dominio_sus_lista CHECK (lista IN ('motivo_saida','carater_atendimento','credor','classificacao_diagnostico','justificativa_paciente_sem_documento','tipo_apac','local_atendimento','associacao_quimioterapia','regional_saude','tipo_leito_uti','acesso_vascular','caracteristica_tratamento_dialitico','contraindicacao_transplante','situacao_transplante','grupo_atendimento','tipo_atendimento','tipo_prestador','nivel_atencao','fonte_orcamentaria','contraceptivo','finalidade_tratamento','grupo_justificativa_auditiva','justificativa_auditiva','medicamento_antineoplasico','local_metastase','atividade_profissional','estadio_tumor','localizacao_tumor','fonte_remuneracao_ciha'));

INSERT INTO dominio_sus (lista, codigo, codigo_oficial, descricao, ordem, ativo, criado_em)
VALUES
  ('fonte_remuneracao_ciha', 'plano-privado', '1', 'Plano privado de saúde', 1, TRUE, NOW(3)),
  ('fonte_remuneracao_ciha', 'plano-publico', '2', 'Plano público de saúde', 2, TRUE, NOW(3)),
  ('fonte_remuneracao_ciha', 'particular-pf', '3', 'Particular, pessoa física', 3, TRUE, NOW(3)),
  ('fonte_remuneracao_ciha', 'particular-pj', '4', 'Particular, pessoa jurídica', 4, TRUE, NOW(3)),
  ('fonte_remuneracao_ciha', 'programa-federal', '5', 'Programa federal', 5, TRUE, NOW(3)),
  ('fonte_remuneracao_ciha', 'recurso-proprio-gestor', '6', 'Recurso próprio do gestor', 6, TRUE, NOW(3)),
  ('fonte_remuneracao_ciha', 'dpvat', '7', 'Seguro de danos pessoais de trânsito', 7, TRUE, NOW(3)),
  ('fonte_remuneracao_ciha', 'gratuidade', '8', 'Gratuidade', 8, TRUE, NOW(3)),
  ('fonte_remuneracao_ciha', 'consorcio-publico', '9', 'Consórcio público', 9, TRUE, NOW(3))
ON DUPLICATE KEY UPDATE lista = lista;

ALTER TABLE producao_ambulatorial_sus
  ADD COLUMN IF NOT EXISTS chave_remessa BIGINT UNSIGNED AS (COALESCE(remessa_bpa_id, 0)) PERSISTENT COMMENT 'Apoio à unicidade da folha por remessa' AFTER remessa_bpa_id,
  DROP KEY IF EXISTS uq_producao_ambulatorial_sus_competencia_sus_id_tipo_folh_5660ae,
  DROP KEY IF EXISTS uq_producao_ambulatorial_sus_folha_remessa,
  ADD UNIQUE KEY uq_producao_ambulatorial_sus_folha_remessa (competencia_sus_id, tipo_folha, numero_folha, chave_remessa);

ALTER TABLE apac
  ADD COLUMN IF NOT EXISTS chave_remessa BIGINT UNSIGNED AS (COALESCE(remessa_apac_id, 0)) PERSISTENT COMMENT 'Apoio à unicidade da APAC por remessa' AFTER remessa_apac_id,
  DROP KEY IF EXISTS uq_apac_competencia_numero,
  DROP KEY IF EXISTS uq_apac_competencia_numero_remessa,
  ADD UNIQUE KEY uq_apac_competencia_numero_remessa (competencia_sus_id, numero_apac, chave_remessa);
