-- SUS, lote 6 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (06_chaves.sql).

-- L8-07 (0) e L8-08 (1): largura da lista e lista de localização do tumor
ALTER TABLE dominio_sus MODIFY COLUMN lista VARCHAR(40) NOT NULL;
ALTER TABLE dominio_sus DROP CONSTRAINT IF EXISTS ck_dominio_sus_lista;
ALTER TABLE dominio_sus ADD CONSTRAINT ck_dominio_sus_lista CHECK (lista IN ('motivo_saida','carater_atendimento','credor','classificacao_diagnostico','justificativa_paciente_sem_documento','tipo_apac','local_atendimento','associacao_quimioterapia','regional_saude','tipo_leito_uti','acesso_vascular','caracteristica_tratamento_dialitico','contraindicacao_transplante','situacao_transplante','grupo_atendimento','tipo_atendimento','tipo_prestador','nivel_atencao','fonte_orcamentaria','contraceptivo','finalidade_tratamento','grupo_justificativa_auditiva','justificativa_auditiva','medicamento_antineoplasico','local_metastase','atividade_profissional','estadio_tumor','localizacao_tumor','fonte_remuneracao_ciha'));
