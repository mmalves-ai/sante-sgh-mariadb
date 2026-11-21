-- CAD, lote 8 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (08_chaves.sql).

-- L5-04 (6): nascimento exigido só na conversão em paciente
ALTER TABLE pre_cadastro
  MODIFY COLUMN data_nascimento DATE NULL DEFAULT NULL,
  ADD CONSTRAINT ck_pre_cadastro_nascimento_conversao CHECK (situacao <> 'convertido' OR data_nascimento IS NOT NULL);

-- L5-05 (5) e L8-02 (16): empresa nacional sem CNPJ não passa (NULL REGEXP dava NULL e o CHECK aceitava)
ALTER TABLE pessoa_juridica DROP CONSTRAINT ck_pessoa_juridica_cnpj;
ALTER TABLE pessoa_juridica ADD CONSTRAINT ck_pessoa_juridica_cnpj CHECK ((estrangeira AND cnpj IS NULL) OR (NOT estrangeira AND cnpj IS NOT NULL AND cnpj REGEXP '^[0-9]{14}$'));

-- L5-05 (6): lotação por unidade assistencial; descrição do contador
ALTER TABLE lotacao_profissional
  ADD COLUMN unidade_assistencial_id BIGINT UNSIGNED NULL COMMENT 'Unidade assistencial da lotação; nulo: o estabelecimento todo' AFTER estabelecimento_id,
  ADD KEY ix_lotacao_profissional_profissional (profissional_id),
  ADD KEY ix_lotacao_profissional_unidade_assistencial_id (unidade_assistencial_id),
  DROP INDEX uq_lotacao_profissional_par,
  ADD UNIQUE KEY uq_lotacao_profissional_par (profissional_id, estabelecimento_id, ocupacao_cbo_id, vigencia_inicio, unidade_assistencial_id);
ALTER TABLE sequencia_negocio
  ADD COLUMN descricao VARCHAR(150) NULL COMMENT 'Descrição do contador' AFTER tipo;

-- L8-15 (20) e L5-03 (3b)
ALTER TABLE pessoa_fisica
  ADD COLUMN numero_declaracao_obito VARCHAR(11) NULL COMMENT 'Número da declaração de óbito informada (óbito não atestado no hospital)' AFTER data_obito,
  ADD COLUMN causa_obito_termo_terminologia_id BIGINT UNSIGNED NULL COMMENT 'Causa do óbito informado (CID-10)' AFTER numero_declaracao_obito,
  ADD KEY ix_pessoa_fisica_causa_obito_termo_terminologia_id (causa_obito_termo_terminologia_id);
ALTER TABLE registro_excluido
  MODIFY COLUMN entidade_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Id do registro excluído; nulo só no excluído antes da migração',
  ADD CONSTRAINT ck_registro_excluido_entidade CHECK (entidade_id IS NOT NULL OR origem = 'migracao');
