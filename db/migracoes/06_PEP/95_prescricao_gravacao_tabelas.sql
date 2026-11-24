-- PEP, gravação da prescrição no banco próprio (pep-gravacao, 23/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Regra de negócio no domínio e na porta; aqui só chaves e coerência. Registro clínico nunca é apagado: a
-- correção é suspensão, cancelamento com motivo ou nova versão.
--   - prescricao: coassinatura (exigida, quem e quando coassinou);
--   - prescricao_evento: eventos de coassinatura e de inclusão de item depois da liberação;
--   - decisao_alerta: a versão da regra no momento da decisão (a leitura não depende mais da versão vigente) e a
--     decisão sem item (item retirado diante do alerta), ligada à prescrição;
--   - planejamento_prescricao: a prescrição futura programada antes de existir a prescrição (descrição e itens
--     programados), ligada à prescrição quando efetivada;
--   - grade_horario_classe: horários padrão de administração por unidade e classe de frequência, por vigência.

ALTER TABLE prescricao
  ADD COLUMN IF NOT EXISTS coassinatura_exigida BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A prescrição pede coassinatura (residente, supervisão)',
  ADD COLUMN IF NOT EXISTS coassinada_em DATETIME(3) NULL COMMENT 'Quando foi coassinada',
  ADD COLUMN IF NOT EXISTS coassinatura_profissional_id BIGINT UNSIGNED NULL COMMENT 'Profissional que coassinou',
  DROP CONSTRAINT IF EXISTS ck_prescricao_14,
  ADD CONSTRAINT ck_prescricao_14 CHECK ((coassinada_em IS NULL) = (coassinatura_profissional_id IS NULL)),
  DROP CONSTRAINT IF EXISTS ck_prescricao_15,
  ADD CONSTRAINT ck_prescricao_15 CHECK (coassinada_em IS NULL OR coassinatura_exigida);

ALTER TABLE prescricao_evento
  DROP CONSTRAINT IF EXISTS ck_prescricao_evento_02,
  ADD CONSTRAINT ck_prescricao_evento_02 CHECK (evento IN ('criacao','liberacao','assinatura','alteracao','suspensao','suspensao_correcao','cancelamento','renovacao','copia','reagendamento','troca_prescritor','intercorrencia','impressao','vencimento','coassinatura','inclusao_item'));

ALTER TABLE decisao_alerta
  ADD COLUMN IF NOT EXISTS versao_regra INT UNSIGNED NULL COMMENT 'Versão da regra de alerta no momento da decisão',
  DROP CONSTRAINT IF EXISTS ck_decisao_alerta_versao_regra,
  ADD CONSTRAINT ck_decisao_alerta_versao_regra CHECK (versao_regra IS NULL OR versao_regra > 0);

-- A decisão diante de um alerta cujo item o prescritor retirou antes de gravar não tem item: fica ligada à prescrição,
-- com a chave do item na tela (rastreabilidade do alerta de segurança do paciente).
ALTER TABLE decisao_alerta
  MODIFY COLUMN prescricao_item_id BIGINT UNSIGNED NULL COMMENT 'Item a que o alerta pertence; nulo quando o item foi retirado antes de gravar',
  ADD COLUMN IF NOT EXISTS prescricao_id BIGINT UNSIGNED NULL COMMENT 'Prescrição em que a decisão foi tomada',
  ADD COLUMN IF NOT EXISTS chave_item VARCHAR(40) NULL COMMENT 'Chave do item na tela quando ele foi retirado antes de gravar',
  ADD INDEX IF NOT EXISTS ix_decisao_alerta_prescricao (prescricao_id, chave_item, sequencia),
  DROP CONSTRAINT IF EXISTS ck_decisao_alerta_alvo,
  ADD CONSTRAINT ck_decisao_alerta_alvo CHECK (prescricao_item_id IS NOT NULL OR (prescricao_id IS NOT NULL AND chave_item IS NOT NULL));

ALTER TABLE planejamento_prescricao
  MODIFY COLUMN prescricao_id BIGINT UNSIGNED NULL COMMENT 'Prescrição planejada; nula enquanto a programação só traz os itens',
  ADD COLUMN IF NOT EXISTS descricao VARCHAR(500) NULL COMMENT 'Resumo da programação para a tela',
  ADD COLUMN IF NOT EXISTS itens_programados JSON NULL COMMENT 'Itens programados (forma da tela) até a efetivação',
  ADD COLUMN IF NOT EXISTS motivo_programacao VARCHAR(500) NULL COMMENT 'Motivo informado ao programar',
  DROP CONSTRAINT IF EXISTS ck_planejamento_prescricao_09,
  ADD CONSTRAINT ck_planejamento_prescricao_09 CHECK (prescricao_id IS NOT NULL OR (descricao IS NOT NULL AND itens_programados IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_planejamento_prescricao_10,
  ADD CONSTRAINT ck_planejamento_prescricao_10 CHECK (situacao <> 'efetivada' OR prescricao_id IS NOT NULL),
  DROP CONSTRAINT IF EXISTS ck_planejamento_prescricao_11,
  ADD CONSTRAINT ck_planejamento_prescricao_11 CHECK (itens_programados IS NULL OR JSON_VALID(itens_programados));

CREATE TABLE IF NOT EXISTS grade_horario_classe (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id        BIGINT UNSIGNED NOT NULL,
  unidade_assistencial_id   BIGINT UNSIGNED NOT NULL COMMENT 'Unidade a que a grade se aplica',
  classe                    VARCHAR(60) NOT NULL COMMENT 'Classe de frequência (ex.: 6/6h)',
  doses_por_dia             TINYINT UNSIGNED NOT NULL,
  horarios                  VARCHAR(400) NOT NULL COMMENT 'Horários HH:MM separados por ponto e vírgula',
  vigente_desde             DATE NOT NULL,
  ativo                     BOOLEAN NOT NULL DEFAULT TRUE,
  autor_usuario_id          BIGINT UNSIGNED NOT NULL COMMENT 'Quem gravou esta versão',
  origem                    VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em                 DATETIME(3) NOT NULL,
  criado_por                BIGINT UNSIGNED NULL,
  alterado_em               DATETIME(3) NULL,
  alterado_por              BIGINT UNSIGNED NULL,
  versao                    INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em               DATETIME(3) NULL,
  KEY ix_grade_horario_classe_unidade (estabelecimento_id, unidade_assistencial_id, classe, vigente_desde),
  CONSTRAINT ck_grade_horario_classe_doses CHECK (doses_por_dia BETWEEN 1 AND 48),
  CONSTRAINT ck_grade_horario_classe_horarios CHECK (horarios REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9](;([01][0-9]|2[0-3]):[0-5][0-9])*$'),
  CONSTRAINT ck_grade_horario_classe_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Horários padrão de administração por unidade e classe de frequência, com vigência e autor (versões só por inclusão)';
