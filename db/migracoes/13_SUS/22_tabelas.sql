-- F2.4 (dívida da migração), 3ª etapa: DDL pedido pelos lotes da 2ª volta, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v3.md
-- Faturamento SUS: as 18 gravações de apps/api/src/modulos/sus/porta-propria.ts, lidas contra o contrato da porta
-- (porta.ts, porta-aih.ts, tipos.ts). As tabelas estavam vazias em todos os clientes.

-- Competência: quando a crítica rodou (vale também para a rodada sem nenhuma crítica).
ALTER TABLE competencia_sus
  ADD COLUMN IF NOT EXISTS criticada_em DATETIME(3) NULL COMMENT 'Última rodada da crítica prévia' AFTER quantidade_registros_criticados;

-- Crítica prévia: a crítica da competência inteira (sem conta, como o estabelecimento sem CNES) exige regra e chave.
ALTER TABLE critica_sus
  DROP CONSTRAINT IF EXISTS ck_critica_sus_alvo,
  ADD CONSTRAINT ck_critica_sus_alvo CHECK (conta_aih_id IS NOT NULL OR apac_id IS NOT NULL OR laudo_apac_id IS NOT NULL OR producao_ambulatorial_sus_item_id IS NOT NULL OR registro_raas_id IS NOT NULL OR conta_hospitalar_id IS NOT NULL OR atendimento_id IS NOT NULL OR (codigo_regra IS NOT NULL AND chave_critica IS NOT NULL));

-- Arquivo gerado: o arquivo fica no armazenamento pela chave e versão do objeto (ADR 0004); o registro no núcleo
-- deixa de ser a única prova do arquivo.
ALTER TABLE remessa_bpa
  DROP CONSTRAINT IF EXISTS ck_remessa_bpa_arquivo,
  ADD CONSTRAINT ck_remessa_bpa_arquivo CHECK (situacao NOT IN ('gerada','conferida','enviada') OR (hash_sha256 IS NOT NULL AND (arquivo_id IS NOT NULL OR chave_objeto IS NOT NULL)));
ALTER TABLE remessa_ciha
  DROP CONSTRAINT IF EXISTS ck_remessa_ciha_arquivo,
  ADD CONSTRAINT ck_remessa_ciha_arquivo CHECK (situacao NOT IN ('gerada','conferida','enviada') OR (hash_sha256 IS NOT NULL AND (arquivo_id IS NOT NULL OR chave_objeto IS NOT NULL)));
ALTER TABLE remessa_sisaih
  DROP CONSTRAINT IF EXISTS ck_remessa_sisaih_arquivo,
  ADD CONSTRAINT ck_remessa_sisaih_arquivo CHECK (situacao NOT IN ('gerada','conferida','exportada','enviada') OR (hash_sha256 IS NOT NULL AND (arquivo_id IS NOT NULL OR chave_objeto IS NOT NULL)));
-- A APAC passa a ter o mesmo ciclo do arquivo dos outros instrumentos (conferido, substituído, quem gerou).
ALTER TABLE remessa_apac
  ADD COLUMN IF NOT EXISTS quantidade_procedimentos DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER quantidade_apac,
  ADD COLUMN IF NOT EXISTS gerador_usuario_id BIGINT UNSIGNED NULL AFTER gerada_em,
  ADD COLUMN IF NOT EXISTS substituta_remessa_apac_id BIGINT UNSIGNED NULL COMMENT 'Remessa que substituiu esta' AFTER gerador_usuario_id,
  ADD KEY IF NOT EXISTS ix_remessa_apac_gerador_usuario_id (gerador_usuario_id),
  ADD KEY IF NOT EXISTS ix_remessa_apac_substituta_remessa_apac_id (substituta_remessa_apac_id),
  DROP CONSTRAINT IF EXISTS ck_remessa_apac_situacao,
  ADD CONSTRAINT ck_remessa_apac_situacao CHECK (situacao IN ('aberta','fechada','gerada','conferida','enviada','processada','substituida','cancelada')),
  DROP CONSTRAINT IF EXISTS ck_remessa_apac_gerada,
  ADD CONSTRAINT ck_remessa_apac_gerada CHECK (situacao NOT IN ('gerada','conferida','enviada','processada') OR (hash_sha256 IS NOT NULL AND (arquivo_id IS NOT NULL OR chave_objeto IS NOT NULL)));

-- APAC pela tela: o laudo é a raiz; a autorização guarda o tipo, a última competência, o encerramento e os motivos.
ALTER TABLE autorizacao_apac
  ADD COLUMN IF NOT EXISTS tipo_apac VARCHAR(30) NULL COMMENT 'APAC inicial (com continuidade) ou única' AFTER numero_apac,
  ADD COLUMN IF NOT EXISTS cns_autorizador CHAR(15) NULL COMMENT 'Cartão nacional de saúde do autorizador, como veio na autorização' AFTER autorizador_sus_id,
  ADD COLUMN IF NOT EXISTS ultima_competencia CHAR(6) NULL COMMENT 'Última competência de continuidade registrada' AFTER validade_fim,
  ADD COLUMN IF NOT EXISTS motivo_saida_dominio_sigtap_id BIGINT UNSIGNED NULL COMMENT 'Motivo de saída do encerramento' AFTER motivo_negativa,
  ADD COLUMN IF NOT EXISTS data_encerramento DATE NULL AFTER motivo_saida_dominio_sigtap_id,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(500) NULL AFTER data_encerramento,
  ADD KEY IF NOT EXISTS ix_autorizacao_apac_motivo_saida (motivo_saida_dominio_sigtap_id),
  DROP CONSTRAINT IF EXISTS ck_autorizacao_apac_situacao,
  ADD CONSTRAINT ck_autorizacao_apac_situacao CHECK (situacao IN ('solicitada','autorizada','negada','encerrada','cancelada')),
  DROP CONSTRAINT IF EXISTS ck_autorizacao_apac_tipo_apac,
  ADD CONSTRAINT ck_autorizacao_apac_tipo_apac CHECK (tipo_apac IS NULL OR tipo_apac IN ('inicial','unica')),
  DROP CONSTRAINT IF EXISTS ck_autorizacao_apac_cns_autorizador,
  ADD CONSTRAINT ck_autorizacao_apac_cns_autorizador CHECK (cns_autorizador IS NULL OR cns_autorizador REGEXP '^[0-9]{15}$'),
  DROP CONSTRAINT IF EXISTS ck_autorizacao_apac_ultima_competencia,
  ADD CONSTRAINT ck_autorizacao_apac_ultima_competencia CHECK (ultima_competencia IS NULL OR ultima_competencia REGEXP '^[0-9]{4}(0[1-9]|1[0-2])$'),
  DROP CONSTRAINT IF EXISTS ck_autorizacao_apac_negada,
  ADD CONSTRAINT ck_autorizacao_apac_negada CHECK (situacao <> 'negada' OR motivo_negativa IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_autorizacao_apac_encerrada,
  ADD CONSTRAINT ck_autorizacao_apac_encerrada CHECK (situacao <> 'encerrada' OR (motivo_saida_dominio_sigtap_id IS NOT NULL AND data_encerramento IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_autorizacao_apac_cancelada,
  ADD CONSTRAINT ck_autorizacao_apac_cancelada CHECK (situacao <> 'cancelada' OR motivo_cancelamento IS NOT NULL);
-- A linha da APAC no arquivo aponta a conta de onde veio.
ALTER TABLE apac_procedimento
  ADD COLUMN IF NOT EXISTS conta_hospitalar_id BIGINT UNSIGNED NULL COMMENT 'Conta de onde veio a produção' AFTER item_faturavel_id,
  ADD KEY IF NOT EXISTS ix_apac_procedimento_conta_hospitalar_id (conta_hospitalar_id);

-- AIH pela tela: a autorização é a raiz (laudo, conta e autorizador); cada fechamento é uma conta da AIH.
ALTER TABLE autorizacao_internacao_sus
  ADD COLUMN IF NOT EXISTS conta_hospitalar_id BIGINT UNSIGNED NULL COMMENT 'Conta da internação faturada pela AIH' AFTER internacao_id,
  ADD COLUMN IF NOT EXISTS cns_autorizador CHAR(15) NULL COMMENT 'Cartão nacional de saúde do autorizador, como veio na autorização' AFTER autorizador_sus_id,
  ADD KEY IF NOT EXISTS ix_autorizacao_internacao_sus_conta_hospitalar_id (conta_hospitalar_id),
  DROP CONSTRAINT IF EXISTS ck_autorizacao_internacao_sus_cns_autorizador,
  ADD CONSTRAINT ck_autorizacao_internacao_sus_cns_autorizador CHECK (cns_autorizador IS NULL OR cns_autorizador REGEXP '^[0-9]{15}$'),
  DROP CONSTRAINT IF EXISTS ck_autorizacao_internacao_sus_motivo,
  ADD CONSTRAINT ck_autorizacao_internacao_sus_motivo CHECK (situacao NOT IN ('negada','cancelada','devolvida') OR motivo_situacao IS NOT NULL);
ALTER TABLE conta_aih
  MODIFY COLUMN competencia_sus_id BIGINT UNSIGNED NULL COMMENT 'Competência da apresentação (nula até o arquivo)',
  ADD COLUMN IF NOT EXISTS numero_fechamento SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Ordem do fechamento da AIH (a reabertura abre o seguinte)' AFTER anterior_conta_aih_id,
  ADD COLUMN IF NOT EXISTS diarias_uti SMALLINT UNSIGNED NULL COMMENT 'Diárias de UTI da competência' AFTER dias_permanencia,
  ADD COLUMN IF NOT EXISTS diarias_uti_mes_anterior SMALLINT UNSIGNED NULL COMMENT 'Diárias de UTI do mês anterior' AFTER diarias_uti,
  ADD COLUMN IF NOT EXISTS motivo_situacao VARCHAR(500) NULL COMMENT 'Justificativa da reabertura ou do cancelamento' AFTER situacao,
  ADD UNIQUE KEY IF NOT EXISTS uq_conta_aih_autorizacao_fechamento (autorizacao_internacao_sus_id, numero_fechamento),
  DROP CONSTRAINT IF EXISTS ck_conta_aih_situacao,
  ADD CONSTRAINT ck_conta_aih_situacao CHECK (situacao IN ('solicitada','autorizada','negada','fechada','reaberta','apresentada','aprovada','rejeitada','cancelada')),
  DROP CONSTRAINT IF EXISTS ck_conta_aih_apresentacao,
  ADD CONSTRAINT ck_conta_aih_apresentacao CHECK (situacao NOT IN ('apresentada','aprovada','rejeitada') OR (competencia_sus_id IS NOT NULL AND remessa_sisaih_id IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_conta_aih_motivo,
  ADD CONSTRAINT ck_conta_aih_motivo CHECK (situacao NOT IN ('reaberta','cancelada') OR motivo_situacao IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_conta_aih_fechamento,
  ADD CONSTRAINT ck_conta_aih_fechamento CHECK (numero_fechamento >= 1);
-- Itens do fechamento: a diária de UTI com o tipo de leito, e a OPM com o item da conta.
ALTER TABLE conta_aih_procedimento
  ADD COLUMN IF NOT EXISTS tipo_leito_uti SMALLINT UNSIGNED NULL COMMENT 'Tipo do leito de UTI habilitado (diária de UTI)' AFTER tipo,
  DROP CONSTRAINT IF EXISTS ck_conta_aih_procedimento_tipo,
  ADD CONSTRAINT ck_conta_aih_procedimento_tipo CHECK (tipo IN ('principal','secundario','especial','diaria_uti')),
  DROP CONSTRAINT IF EXISTS ck_conta_aih_procedimento_uti,
  ADD CONSTRAINT ck_conta_aih_procedimento_uti CHECK ((tipo = 'diaria_uti') = (tipo_leito_uti IS NOT NULL));
ALTER TABLE conta_aih_opm
  ADD COLUMN IF NOT EXISTS conta_hospitalar_item_id BIGINT UNSIGNED NULL COMMENT 'Item da conta de onde veio a OPM' AFTER conta_aih_procedimento_id,
  ADD KEY IF NOT EXISTS ix_conta_aih_opm_conta_hospitalar_item_id (conta_hospitalar_item_id);

-- Retorno do gestor por linha: o arquivo de retorno é identificado pelo nome e pelo SHA-256; a linha guarda o
-- motivo como veio e não se repete no mesmo retorno.
ALTER TABLE retorno_sus
  MODIFY COLUMN arquivo_id BIGINT UNSIGNED NULL COMMENT 'Arquivo de retorno guardado (nulo: identificado só pelo nome e pelo SHA-256)';
ALTER TABLE retorno_sus_item
  ADD COLUMN IF NOT EXISTS motivo VARCHAR(500) NULL COMMENT 'Motivo da rejeição ou da glosa, como veio no retorno' AFTER motivo_rejeicao_sus_id,
  ADD UNIQUE KEY IF NOT EXISTS uq_retorno_sus_item_identificacao (retorno_sus_id, identificacao);
