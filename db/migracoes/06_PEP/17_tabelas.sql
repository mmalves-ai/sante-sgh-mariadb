-- PEP, lote 17 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (17_chaves.sql).

-- L6-06 (7)
ALTER TABLE condicao_se_necessario
  ADD COLUMN codigo_interoperabilidade VARCHAR(36) NULL COMMENT 'Código para troca com outros sistemas' AFTER codigo;

-- L6-09 (9): ação de restrição que exige justificativa
ALTER TABLE cuidado_enfermagem DROP CONSTRAINT ck_cuidado_enfermagem_acao_restricao_sexo;
ALTER TABLE cuidado_enfermagem ADD CONSTRAINT ck_cuidado_enfermagem_acao_restricao_sexo CHECK (acao_restricao_sexo IS NULL OR acao_restricao_sexo IN ('alertar','exigir_justificativa','bloquear'));
ALTER TABLE cuidado_enfermagem DROP CONSTRAINT ck_cuidado_enfermagem_acao_restricao_idade;
ALTER TABLE cuidado_enfermagem ADD CONSTRAINT ck_cuidado_enfermagem_acao_restricao_idade CHECK (acao_restricao_idade IS NULL OR acao_restricao_idade IN ('alertar','exigir_justificativa','bloquear'));

-- L6-10 (20): recorte do sumário de alta
ALTER TABLE componente_sumario_alta DROP CONSTRAINT ck_componente_sumario_alta_periodo;
ALTER TABLE componente_sumario_alta ADD CONSTRAINT ck_componente_sumario_alta_periodo CHECK (periodo IS NULL OR periodo IN ('nenhum','atendimento_inteiro','ultimas_24_horas','ultimas_48_horas','ultimas_72_horas','ultimo_registro'));

-- L6-11 (7)
ALTER TABLE painel_filtro_usuario
  ADD COLUMN unidade_assistencial_id BIGINT UNSIGNED NULL COMMENT 'Filtro por unidade assistencial' AFTER unidade_internacao_id,
  ADD COLUMN bloco_internacao_id BIGINT UNSIGNED NULL COMMENT 'Filtro por bloco de internação' AFTER unidade_assistencial_id,
  ADD KEY ix_painel_filtro_usuario_unidade_assistencial_id (unidade_assistencial_id),
  ADD KEY ix_painel_filtro_usuario_bloco_internacao_id (bloco_internacao_id);

-- L6-13 (15)
ALTER TABLE horario_administracao
  ADD COLUMN observacao_enfermagem TEXT NULL COMMENT 'Observação da enfermagem no horário',
  ADD COLUMN urgente BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Horário marcado como urgente';

-- L6-13 (16), parte das colunas
ALTER TABLE receita_medica_item
  ADD COLUMN duracao_descricao VARCHAR(60) NULL COMMENT 'Duração como sai impressa' AFTER quantidade_descricao,
  ADD COLUMN frequencia_descricao VARCHAR(60) NULL COMMENT 'Frequência como sai impressa' AFTER duracao_descricao,
  ADD COLUMN prazo_descricao VARCHAR(60) NULL COMMENT 'Prazo como sai impresso' AFTER frequencia_descricao;

-- L7-07 (principio_ativo_cliente): alergia_paciente_principio pelo oficial ou pelo do cliente
ALTER TABLE alergia_paciente_principio
  MODIFY COLUMN principio_ativo_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN principio_ativo_cliente_id BIGINT UNSIGNED NULL COMMENT 'Princípio do cadastro próprio do cliente (sem par no oficial)' AFTER principio_ativo_id,
  ADD KEY ix_alergia_paciente_principio_principio_ativo_cliente_id (principio_ativo_cliente_id),
  ADD CONSTRAINT ck_alergia_paciente_principio_principio CHECK ((principio_ativo_id IS NULL) <> (principio_ativo_cliente_id IS NULL));

-- L7-07 (principio_ativo_cliente): item_nao_padronizado_principio pelo oficial ou pelo do cliente
ALTER TABLE item_nao_padronizado_principio
  MODIFY COLUMN principio_ativo_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN principio_ativo_cliente_id BIGINT UNSIGNED NULL COMMENT 'Princípio do cadastro próprio do cliente (sem par no oficial)' AFTER principio_ativo_id,
  ADD KEY ix_item_nao_padronizado_principio_principio_ativo_cliente_id (principio_ativo_cliente_id),
  ADD CONSTRAINT ck_item_nao_padronizado_principio_principio CHECK ((principio_ativo_id IS NULL) <> (principio_ativo_cliente_id IS NULL));

-- L7-07 (principio_ativo_cliente): alergeno_principio_ativo pelo oficial ou pelo do cliente
ALTER TABLE alergeno_principio_ativo
  MODIFY COLUMN principio_ativo_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN principio_ativo_cliente_id BIGINT UNSIGNED NULL COMMENT 'Princípio do cadastro próprio do cliente (sem par no oficial)' AFTER principio_ativo_id,
  ADD KEY ix_alergeno_principio_ativo_principio_ativo_cliente_id (principio_ativo_cliente_id),
  ADD CONSTRAINT ck_alergeno_principio_ativo_principio CHECK ((principio_ativo_id IS NULL) <> (principio_ativo_cliente_id IS NULL));
