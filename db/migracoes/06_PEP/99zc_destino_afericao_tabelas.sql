-- Rotina "destino confirmado -> aferição" (decisão 62, C2-003): os parâmetros migrados ficam em
-- destino_campo_estruturado inativos e sem parâmetro vital (ADR 0007). Quando o hospital confirma o destino (ativo,
-- entidade 'afericao', parâmetro vital e a pergunta do registro que o alimenta), a rotina do domínio
-- (@sgh/dominio-enfermagem, extracao-destino) reprocessa as respostas históricas daquela pergunta em aferição.
-- Esta migração só acrescenta: a pergunta ligada ao destino e o rastro de cada resposta reprocessada (uma vez só,
-- gerada ou pendente com o motivo), que torna a rotina idempotente. Só para frente e repetível (ADR 0002, parte 2).
-- Sem gatilho: a regra é do domínio e a gravação é da porta própria (extracao-destino-propria.ts).
ALTER TABLE destino_campo_estruturado
  ADD COLUMN IF NOT EXISTS modelo_campo_id BIGINT UNSIGNED NULL
    COMMENT 'Pergunta do registro clínico cujas respostas alimentam o destino (confirmada pelo hospital)' AFTER parametro_vital_id,
  ADD KEY IF NOT EXISTS ix_destino_campo_estruturado_modelo_campo (modelo_campo_id);
ALTER TABLE destino_campo_estruturado
  ADD CONSTRAINT fk_destino_campo_estruturado_modelo_campo_id
    FOREIGN KEY IF NOT EXISTS (modelo_campo_id) REFERENCES modelo_campo (id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS destino_campo_extracao (
  id                                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  destino_campo_estruturado_id      BIGINT UNSIGNED NOT NULL,
  registro_assistencial_resposta_id BIGINT UNSIGNED NOT NULL COMMENT 'Resposta histórica reprocessada (uma vez só)',
  situacao                          VARCHAR(20) NOT NULL COMMENT 'gerada (virou aferição) ou pendente (recusada com motivo)',
  motivo                            VARCHAR(30) NULL COMMENT 'Regra do domínio que recusou a resposta',
  afericao_id                       BIGINT UNSIGNED NULL,
  criado_em                         DATETIME(3) NOT NULL,
  criado_por                        BIGINT UNSIGNED NULL,
  alterado_em                       DATETIME(3) NULL,
  alterado_por                      BIGINT UNSIGNED NULL,
  versao                            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_destino_campo_extracao_situacao CHECK (situacao IN ('gerada','pendente')),
  CONSTRAINT ck_destino_campo_extracao_coerencia CHECK ((situacao = 'gerada' AND afericao_id IS NOT NULL AND motivo IS NULL)
    OR (situacao = 'pendente' AND afericao_id IS NULL AND motivo IS NOT NULL)),
  CONSTRAINT ck_destino_campo_extracao_motivo CHECK (motivo IS NULL OR motivo IN
    ('sem_valor','valor_nao_numerico','unidade_divergente','fora_da_faixa')),
  UNIQUE KEY uq_destino_campo_extracao_resposta (registro_assistencial_resposta_id),
  KEY ix_destino_campo_extracao_destino (destino_campo_estruturado_id, situacao),
  KEY ix_destino_campo_extracao_afericao (afericao_id),
  CONSTRAINT fk_destino_campo_extracao_destino FOREIGN KEY (destino_campo_estruturado_id) REFERENCES destino_campo_estruturado (id) ON DELETE RESTRICT,
  CONSTRAINT fk_destino_campo_extracao_resposta FOREIGN KEY (registro_assistencial_resposta_id) REFERENCES registro_assistencial_resposta (id) ON DELETE RESTRICT,
  CONSTRAINT fk_destino_campo_extracao_afericao FOREIGN KEY (afericao_id) REFERENCES afericao (id) ON DELETE RESTRICT
) COMMENT='Rastro da extração das respostas históricas do registro para o destino estruturado confirmado (gerada ou pendente)';

-- Colunas de auditoria (convenção do DDL) para o banco que já criou a tabela sem elas.
ALTER TABLE destino_campo_extracao
  ADD COLUMN IF NOT EXISTS alterado_em DATETIME(3) NULL AFTER criado_por,
  ADD COLUMN IF NOT EXISTS alterado_por BIGINT UNSIGNED NULL AFTER alterado_em,
  ADD COLUMN IF NOT EXISTS versao INT UNSIGNED NOT NULL DEFAULT 1 AFTER alterado_por;
