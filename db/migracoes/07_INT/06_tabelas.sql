-- INT, lote 06 (F2.2 onda 3; pedidos do lote 03-01: NIR, leito, internação e pré-internação). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (06_chaves.sql).

CREATE TABLE limite_permanencia (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  escopo VARCHAR(20) NOT NULL COMMENT 'clinica, cid ou procedimento',
  chave VARCHAR(40) NOT NULL COMMENT 'Código da clínica, do CID ou do procedimento a que o limite se aplica',
  amarelo_dias SMALLINT UNSIGNED NOT NULL COMMENT 'Permanência a partir da qual o quadro sinaliza atenção',
  vermelho_dias SMALLINT UNSIGNED NOT NULL COMMENT 'Permanência a partir da qual o quadro sinaliza excesso',
  forma VARCHAR(20) NOT NULL DEFAULT 'manual' COMMENT 'manual ou calibrado pela série histórica',
  amostra INT UNSIGNED NULL COMMENT 'Internações usadas na calibragem',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_limite_permanencia_escopo CHECK (escopo IN ('clinica','cid','procedimento')),
  CONSTRAINT ck_limite_permanencia_forma CHECK (forma IN ('manual','calibrado')),
  CONSTRAINT ck_limite_permanencia_faixa CHECK (vermelho_dias >= amarelo_dias),
  CONSTRAINT ck_limite_permanencia_amostra CHECK (forma = 'manual' OR amostra IS NOT NULL),
  UNIQUE KEY uq_limite_permanencia_escopo_chave (estabelecimento_id, escopo, chave)
) COMMENT='Limites de permanência (atenção e excesso) do quadro do NIR, por clínica, CID ou procedimento, manuais ou calibrados';

ALTER TABLE leito_hospitalar
  ADD COLUMN idade_minima_dias INT UNSIGNED NULL COMMENT 'Idade mínima do paciente no leito, em dias',
  ADD COLUMN idade_maxima_dias INT UNSIGNED NULL COMMENT 'Idade máxima do paciente no leito, em dias',
  ADD CONSTRAINT ck_leito_hospitalar_faixa_etaria CHECK (idade_minima_dias IS NULL OR idade_maxima_dias IS NULL OR idade_minima_dias <= idade_maxima_dias);

ALTER TABLE internacao
  ADD COLUMN paciente_internado_vigente BIGINT UNSIGNED AS (IF(situacao IN ('ativa','alta_medica') AND excluido_em IS NULL, paciente_id, NULL)) PERSISTENT COMMENT 'Paciente enquanto a internação está aberta: uma internação aberta por paciente',
  ADD UNIQUE KEY uq_internacao_paciente_vigente (paciente_internado_vigente);

ALTER TABLE agendamento_internacao
  ADD COLUMN procedimento_sigtap_id BIGINT UNSIGNED NULL COMMENT 'Procedimento previsto, da tabela do SUS',
  ADD COLUMN item_faturavel_id BIGINT UNSIGNED NULL COMMENT 'Procedimento previsto, do cadastro de itens faturáveis',
  ADD CONSTRAINT ck_agendamento_internacao_procedimento CHECK (procedimento_sigtap_id IS NULL OR item_faturavel_id IS NULL),
  ADD KEY ix_agendamento_internacao_procedimento_sigtap_id (procedimento_sigtap_id),
  ADD KEY ix_agendamento_internacao_item_faturavel_id (item_faturavel_id);

ALTER TABLE pedido_leito
  ADD COLUMN agendamento_cirurgico_id BIGINT UNSIGNED NULL COMMENT 'Cirurgia que pede o leito (ex.: UTI no pós-operatório)',
  ADD KEY ix_pedido_leito_agendamento_cirurgico_id (agendamento_cirurgico_id);
