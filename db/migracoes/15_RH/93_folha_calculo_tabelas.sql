-- Cálculo da folha no banco próprio (modulos-proprios-2, família folha-porta): o processamento da folha no formato do
-- contrato do cálculo (pedido do lote f24 03-pessoas) e o aviso prévio e o termo do contrato na rescisão.
-- Para frente e idempotente. As tabelas do processamento nasceram vazias (nenhuma gravação ligada até esta migração),
-- então a troca das colunas é direta, sem perda.
--
-- processamento_folha:
--   - situação `substituida` (o recálculo troca o vigente; o anterior fica, só de acréscimo);
--   - fora_da_folha (booleano) vira a contagem dos vínculos que o cálculo deixou de fora;
--   - tabela_legal e parametros (JSON) viram as datas de início da tabela legal e dos parâmetros usados.
-- processamento_folha_linha: o tipo da linha, a unidade da quantidade e a memória do cálculo (texto sem dado pessoal).
-- rescisao: o aviso prévio, os dias do aviso (Lei 12.506/2011) e o termo do contrato a prazo (art. 479 da CLT).

ALTER TABLE processamento_folha
  DROP CONSTRAINT IF EXISTS ck_processamento_folha_json,
  DROP CONSTRAINT IF EXISTS ck_processamento_folha_situacao,
  DROP COLUMN IF EXISTS fora_da_folha,
  DROP COLUMN IF EXISTS tabela_legal,
  DROP COLUMN IF EXISTS parametros,
  ADD COLUMN IF NOT EXISTS quantidade_fora_da_folha SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Vínculos que o cálculo deixou de fora',
  ADD COLUMN IF NOT EXISTS tabela_legal_inicio DATE NULL COMMENT 'Início da vigência da tabela legal usada',
  ADD COLUMN IF NOT EXISTS parametros_inicio DATE NULL COMMENT 'Início da vigência dos parâmetros da folha usados',
  ADD CONSTRAINT ck_processamento_folha_situacao CHECK (situacao IN ('calculada','substituida','descartada'));
ALTER TABLE processamento_folha
  DROP CONSTRAINT IF EXISTS ck_processamento_folha_totais,
  ADD CONSTRAINT ck_processamento_folha_totais CHECK (JSON_VALID(totais)),
  ADD KEY IF NOT EXISTS ix_processamento_folha_competencia (estabelecimento_id, tipo, competencia);

ALTER TABLE processamento_folha_linha
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(12) NOT NULL COMMENT 'Provento, desconto, base ou informativa' AFTER papel,
  ADD COLUMN IF NOT EXISTS unidade VARCHAR(12) NOT NULL COMMENT 'Unidade da quantidade' AFTER quantidade,
  ADD COLUMN IF NOT EXISTS memoria_calculo VARCHAR(400) NOT NULL DEFAULT '' COMMENT 'Memória do cálculo da linha (sem dado pessoal)' AFTER valor,
  DROP CONSTRAINT IF EXISTS ck_processamento_folha_linha_tipo,
  ADD CONSTRAINT ck_processamento_folha_linha_tipo CHECK (tipo IN ('provento','desconto','base','informativa')),
  DROP CONSTRAINT IF EXISTS ck_processamento_folha_linha_unidade,
  ADD CONSTRAINT ck_processamento_folha_linha_unidade CHECK (unidade IN ('dias','minutos','dependentes','percentual','valor')),
  DROP CONSTRAINT IF EXISTS ck_processamento_folha_linha_quantidade,
  ADD CONSTRAINT ck_processamento_folha_linha_quantidade CHECK (quantidade IS NULL OR quantidade >= 0);

ALTER TABLE rescisao
  ADD COLUMN IF NOT EXISTS aviso_previo VARCHAR(20) NULL COMMENT 'Aviso prévio: indenizado, trabalhado, dispensado, não cumprido ou nenhum',
  ADD COLUMN IF NOT EXISTS dias_aviso SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Dias do aviso prévio (Lei 12.506/2011)',
  ADD COLUMN IF NOT EXISTS termo_contrato DATE NULL COMMENT 'Termo do contrato a prazo (antecipação; art. 479 da CLT)',
  DROP CONSTRAINT IF EXISTS ck_rescisao_aviso_previo,
  ADD CONSTRAINT ck_rescisao_aviso_previo CHECK (aviso_previo IS NULL OR aviso_previo IN ('indenizado','trabalhado','dispensado','nao_cumprido','nenhum')),
  DROP CONSTRAINT IF EXISTS ck_rescisao_dias_aviso,
  ADD CONSTRAINT ck_rescisao_dias_aviso CHECK (dias_aviso <= 90 AND dias_aviso_indenizados <= 90);
