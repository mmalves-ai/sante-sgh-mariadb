-- CC, lote 04 (F2.2 ondas finais, onda 3; pedidos do lote 03-01). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (04_chaves.sql). CHECKs só ampliam ou valem sobre as colunas novas (nada recusa o que já grava).

-- 03-01: checklist e ficha anestésica abertos pelo agendamento, antes do ato
ALTER TABLE checklist_cirurgia_segura
  ADD COLUMN agendamento_cirurgico_id BIGINT UNSIGNED NULL COMMENT 'Agendamento que abriu o checklist antes do ato' AFTER ato_cirurgico_id,
  MODIFY ato_cirurgico_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT ck_checklist_cirurgia_segura_alvo CHECK (ato_cirurgico_id IS NOT NULL OR agendamento_cirurgico_id IS NOT NULL),
  ADD UNIQUE KEY uq_checklist_cirurgia_segura_agendamento (agendamento_cirurgico_id);
ALTER TABLE ficha_anestesica
  ADD COLUMN agendamento_cirurgico_id BIGINT UNSIGNED NULL COMMENT 'Agendamento que abriu a ficha antes do ato' AFTER ato_cirurgico_id,
  MODIFY ato_cirurgico_id BIGINT UNSIGNED NULL,
  ADD COLUMN hash_assinatura CHAR(64) NULL COMMENT 'Resumo SHA-256 do conteúdo assinado',
  ADD COLUMN assinada_por_profissional_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT ck_ficha_anestesica_alvo CHECK (ato_cirurgico_id IS NOT NULL OR agendamento_cirurgico_id IS NOT NULL),
  ADD KEY ix_ficha_anestesica_agendamento_cirurgico (agendamento_cirurgico_id),
  ADD KEY ix_ficha_anestesica_assinada_por_profissional (assinada_por_profissional_id);

CREATE TABLE passagem_ficha_anestesica (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ficha_anestesica_id BIGINT UNSIGNED NOT NULL,
  sequencia SMALLINT UNSIGNED NOT NULL,
  momento DATETIME(3) NOT NULL,
  de_profissional_id BIGINT UNSIGNED NOT NULL,
  para_profissional_id BIGINT UNSIGNED NOT NULL,
  resumo VARCHAR(1000) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_passagem_ficha_anestesica_pessoas CHECK (de_profissional_id <> para_profissional_id),
  UNIQUE KEY uq_passagem_ficha_anestesica_sequencia (ficha_anestesica_id, sequencia),
  KEY ix_passagem_ficha_anestesica_de_profissional (de_profissional_id),
  KEY ix_passagem_ficha_anestesica_para_profissional (para_profissional_id)
) COMMENT='Passagem do caso anestésico entre anestesistas durante o ato, com o resumo entregue';

CREATE TABLE lacuna_ficha_anestesica (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ficha_anestesica_id BIGINT UNSIGNED NOT NULL,
  inicio DATETIME(3) NOT NULL,
  fim DATETIME(3) NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  profissional_id BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_lacuna_ficha_anestesica_periodo CHECK (fim > inicio),
  KEY ix_lacuna_ficha_anestesica_ficha (ficha_anestesica_id, inicio),
  KEY ix_lacuna_ficha_anestesica_profissional (profissional_id)
) COMMENT='Intervalo sem registro na ficha anestésica, com o motivo declarado';

CREATE TABLE adendo_ficha_anestesica (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ficha_anestesica_id BIGINT UNSIGNED NOT NULL,
  sequencia SMALLINT UNSIGNED NOT NULL,
  texto TEXT NOT NULL,
  profissional_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_adendo_ficha_anestesica_sequencia (ficha_anestesica_id, sequencia),
  KEY ix_adendo_ficha_anestesica_profissional (profissional_id)
) COMMENT='Adendo à ficha anestésica depois de assinada (a ficha assinada não muda)';

ALTER TABLE avaliacao_pre_anestesica
  ADD COLUMN criterios_lee JSON NULL COMMENT 'Critérios do índice de risco cardíaco revisado',
  ADD COLUMN comorbidades TEXT NULL,
  ADD COLUMN medicacoes_em_uso TEXT NULL,
  ADD COLUMN plano_estruturado JSON NULL,
  ADD CONSTRAINT ck_avaliacao_pre_anestesica_criterios_lee CHECK (criterios_lee IS NULL OR JSON_VALID(criterios_lee)),
  ADD CONSTRAINT ck_avaliacao_pre_anestesica_plano_estruturado CHECK (plano_estruturado IS NULL OR JSON_VALID(plano_estruturado));

CREATE TABLE codigo_painel_familia (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  agendamento_cirurgico_id BIGINT UNSIGNED NOT NULL,
  dia DATE NOT NULL,
  codigo VARCHAR(10) NOT NULL COMMENT 'Código curto mostrado no painel da família no lugar do nome',
  valido_ate DATETIME(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_codigo_painel_familia_dia_codigo (estabelecimento_id, dia, codigo),
  UNIQUE KEY uq_codigo_painel_familia_agendamento_dia (agendamento_cirurgico_id, dia)
) COMMENT='Código do paciente no painel de acompanhamento da família no centro cirúrgico, por dia';

ALTER TABLE movimento_paciente_bloco
  ADD COLUMN destino_saida VARCHAR(30) NULL COMMENT 'Para onde o paciente saiu do bloco',
  ADD CONSTRAINT ck_movimento_paciente_bloco_destino CHECK (destino_saida IS NULL OR destino_saida IN ('unidade','uti','domicilio','centro_cirurgico','obito','outro'));

-- 03-01: pedido do portal do médico externo (paciente ainda não cadastrado) e versões do pedido
ALTER TABLE agendamento_cirurgico
  ADD COLUMN paciente_informado VARCHAR(150) NULL COMMENT 'Nome informado no pedido do portal, antes do cadastro',
  ADD COLUMN nascimento_informado DATE NULL,
  MODIFY paciente_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT ck_agendamento_cirurgico_paciente CHECK (paciente_id IS NOT NULL OR (canal_solicitacao = 'portal' AND paciente_informado IS NOT NULL AND situacao IN ('solicitado','em_analise','reprovado','cancelado'))),
  DROP CONSTRAINT ck_agendamento_cirurgico_situacao,
  ADD CONSTRAINT ck_agendamento_cirurgico_situacao CHECK (situacao IN ('solicitado','em_analise','reprovado','agendado','confirmado','no_bloco','em_andamento','realizado','suspenso','cancelado'));

CREATE TABLE agendamento_cirurgico_versao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agendamento_cirurgico_id BIGINT UNSIGNED NOT NULL,
  numero_versao SMALLINT UNSIGNED NOT NULL,
  dados JSON NOT NULL COMMENT 'Pedido como estava antes da substituição',
  motivo VARCHAR(500) NOT NULL,
  substituida_em DATETIME(3) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_agendamento_cirurgico_versao_dados CHECK (JSON_VALID(dados)),
  UNIQUE KEY uq_agendamento_cirurgico_versao_numero (agendamento_cirurgico_id, numero_versao)
) COMMENT='Versões anteriores do pedido de cirurgia, guardadas a cada correção';
