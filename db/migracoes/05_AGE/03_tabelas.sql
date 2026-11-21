-- AGE, lote 03 (F2.2 onda 1): calendário de feriados, recorte diário do bloqueio e exames cobertos por agenda.
-- Sem FOREIGN KEY aqui (03_chaves.sql). Os feriados nacionais fixos e móveis continuam calculados no domínio da agenda;
-- a tabela guarda os estaduais, municipais e do estabelecimento (e o nacional que o hospital queira registrar).

CREATE TABLE feriado (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  data               DATE NOT NULL,
  nome               VARCHAR(150) NOT NULL,
  abrangencia        VARCHAR(20) NOT NULL,
  uf                 CHAR(2) NULL,
  municipio_ibge_id  BIGINT UNSIGNED NULL,
  estabelecimento_id BIGINT UNSIGNED NULL,
  ponto_facultativo  BOOLEAN NOT NULL DEFAULT FALSE,
  ativo              BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_feriado_abrangencia CHECK (abrangencia IN ('nacional','estadual','municipal','estabelecimento')),
  CONSTRAINT ck_feriado_alvo CHECK (
    (abrangencia = 'nacional' AND uf IS NULL AND municipio_ibge_id IS NULL AND estabelecimento_id IS NULL)
    OR (abrangencia = 'estadual' AND uf IS NOT NULL AND municipio_ibge_id IS NULL AND estabelecimento_id IS NULL)
    OR (abrangencia = 'municipal' AND municipio_ibge_id IS NOT NULL AND estabelecimento_id IS NULL)
    OR (abrangencia = 'estabelecimento' AND estabelecimento_id IS NOT NULL)),
  KEY ix_feriado_data (data),
  KEY ix_feriado_municipio_ibge (municipio_ibge_id),
  KEY ix_feriado_estabelecimento (estabelecimento_id)
) COMMENT='Feriados e pontos facultativos que fecham a agenda, por abrangência';

ALTER TABLE bloqueio_agenda
  ADD COLUMN hora_inicio_diaria TIME NULL COMMENT 'Recorte diário do bloqueio (hora local); nulo: intervalo contínuo',
  ADD COLUMN hora_fim_diaria TIME NULL,
  ADD CONSTRAINT ck_bloqueio_agenda_recorte CHECK ((hora_inicio_diaria IS NULL AND hora_fim_diaria IS NULL)
    OR (hora_inicio_diaria IS NOT NULL AND hora_fim_diaria IS NOT NULL AND hora_fim_diaria > hora_inicio_diaria));

CREATE TABLE agenda_servico_exame (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agenda_servico_id  BIGINT UNSIGNED NOT NULL,
  exame_id           BIGINT UNSIGNED NOT NULL,
  fonte_pagadora_id  BIGINT UNSIGNED NULL COMMENT 'Nulo: a agenda faz o exame para todas as fontes pagadoras aceitas',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  fonte_pagadora_chave BIGINT UNSIGNED AS (COALESCE(fonte_pagadora_id, 0)) STORED COMMENT 'Chave de unicidade (nulo vira 0)',
  UNIQUE KEY uq_agenda_servico_exame_par (agenda_servico_id, exame_id, fonte_pagadora_chave),
  KEY ix_agenda_servico_exame_exame (exame_id),
  KEY ix_agenda_servico_exame_fonte_pagadora (fonte_pagadora_id)
) COMMENT='Exames feitos por agenda de serviço e a fonte pagadora que cobre cada um';
