-- RH, lote 05 (F2.2 ondas finais, onda 3; pedidos dos lotes 03-02, 03-04, 03-05, 03-06, 03-10 e 03-11).
-- Convenções do ADR 0002 (parte 2). Só para frente. Sem FOREIGN KEY aqui (05_chaves.sql).
-- CHECKs só ampliam domínios ou valem sobre as colunas novas: nada do que o código grava hoje passa a ser recusado.
-- Os CHECKs que amarram a situação atual às colunas novas (ex.: recusa do realizado exige motivo) entram com o
-- código que grava essas colunas (lote de continuação), para não recusar as gravações de hoje.

-- 03-02: competências, PDI, versões e ciência da avaliação, atestado com CID restrito
CREATE TABLE competencia_avaliacao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  nome VARCHAR(150) NOT NULL,
  descricao VARCHAR(1000) NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  motivo_situacao VARCHAR(500) NULL,
  criterio_avaliacao_id BIGINT UNSIGNED NULL COMMENT 'Critério do modelo que a competência alimenta',
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_competencia_avaliacao_estabelecimento_nome (estabelecimento_id, nome),
  KEY ix_competencia_avaliacao_criterio_avaliacao (criterio_avaliacao_id),
  CONSTRAINT ck_competencia_avaliacao_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_competencia_avaliacao_inativa CHECK (ativo = TRUE OR motivo_situacao IS NOT NULL)
) COMMENT='Competência avaliada no estabelecimento';

CREATE TABLE cargo_competencia (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cargo_id BIGINT UNSIGNED NOT NULL,
  competencia_avaliacao_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_cargo_competencia (cargo_id, competencia_avaliacao_id),
  KEY ix_cargo_competencia_competencia_avaliacao (competencia_avaliacao_id)
) COMMENT='Competências avaliadas em cada cargo';

ALTER TABLE avaliacao_desempenho
  ADD COLUMN avaliacao_anterior_id BIGINT UNSIGNED NULL COMMENT 'Versão que esta avaliação corrige',
  ADD COLUMN numero_versao SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN motivo_correcao VARCHAR(500) NULL,
  ADD COLUMN marco_experiencia_dias SMALLINT UNSIGNED NULL COMMENT 'Avaliação do contrato de experiência (45 ou 90 dias)',
  ADD COLUMN cargo_id BIGINT UNSIGNED NULL COMMENT 'Cargo do colaborador na data da avaliação',
  ADD COLUMN finalizada_por_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN ciencia_por_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN ciencia_modo VARCHAR(20) NULL COMMENT 'Ciência dada pelo próprio colaborador ou registrada pelo gestor',
  ADD COLUMN ciencia_observacao VARCHAR(500) NULL,
  ADD CONSTRAINT ck_avaliacao_desempenho_marco CHECK (marco_experiencia_dias IS NULL OR marco_experiencia_dias IN (45,90)),
  ADD CONSTRAINT ck_avaliacao_desempenho_ciencia_modo CHECK (ciencia_modo IS NULL OR ciencia_modo IN ('proprio','registrada')),
  ADD CONSTRAINT ck_avaliacao_desempenho_correcao CHECK (avaliacao_anterior_id IS NULL OR motivo_correcao IS NOT NULL),
  DROP INDEX uq_avaliacao_desempenho_ciclo_avaliacao_colaborador_avaliador_co,
  ADD UNIQUE KEY uq_avaliacao_desempenho_versao (ciclo_avaliacao_id, colaborador_id, avaliador_colaborador_id, tipo, numero_versao),
  ADD UNIQUE KEY uq_avaliacao_desempenho_anterior (avaliacao_anterior_id),
  ADD KEY ix_avaliacao_desempenho_cargo (cargo_id),
  ADD KEY ix_avaliacao_desempenho_finalizada_por_usuario (finalizada_por_usuario_id),
  ADD KEY ix_avaliacao_desempenho_ciencia_por_usuario (ciencia_por_usuario_id);

ALTER TABLE ciclo_avaliacao
  ADD COLUMN motivo_situacao VARCHAR(500) NULL;

CREATE TABLE plano_desenvolvimento (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  vinculo_trabalho_id BIGINT UNSIGNED NOT NULL,
  avaliacao_desempenho_id BIGINT UNSIGNED NULL,
  competencia_avaliacao_id BIGINT UNSIGNED NULL,
  curso_id BIGINT UNSIGNED NULL,
  acao VARCHAR(1000) NOT NULL,
  prazo DATE NOT NULL,
  situacao VARCHAR(20) NOT NULL DEFAULT 'aberta',
  concluida_em DATE NULL,
  motivo_situacao VARCHAR(500) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_plano_desenvolvimento_situacao CHECK (situacao IN ('aberta','concluida','cancelada')),
  CONSTRAINT ck_plano_desenvolvimento_conclusao CHECK (situacao <> 'concluida' OR concluida_em IS NOT NULL),
  CONSTRAINT ck_plano_desenvolvimento_motivo CHECK (situacao = 'aberta' OR motivo_situacao IS NOT NULL),
  CONSTRAINT ck_plano_desenvolvimento_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_plano_desenvolvimento_vinculo (vinculo_trabalho_id, prazo),
  KEY ix_plano_desenvolvimento_estabelecimento (estabelecimento_id),
  KEY ix_plano_desenvolvimento_avaliacao_desempenho (avaliacao_desempenho_id),
  KEY ix_plano_desenvolvimento_competencia_avaliacao (competencia_avaliacao_id),
  KEY ix_plano_desenvolvimento_curso (curso_id)
) COMMENT='Plano de desenvolvimento individual do colaborador';

CREATE TABLE atestado_colaborador (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  solicitacao_colaborador_id BIGINT UNSIGNED NOT NULL,
  emitido_em DATE NOT NULL,
  dias SMALLINT UNSIGNED NOT NULL,
  cid_termo_terminologia_id BIGINT UNSIGNED NULL COMMENT 'CID do atestado (leitura restrita e registrada)',
  emitente VARCHAR(150) NOT NULL,
  registro_conselho VARCHAR(30) NULL,
  arquivo_id BIGINT UNSIGNED NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_atestado_colaborador_solicitacao (solicitacao_colaborador_id),
  KEY ix_atestado_colaborador_cid (cid_termo_terminologia_id),
  KEY ix_atestado_colaborador_arquivo (arquivo_id),
  CONSTRAINT ck_atestado_colaborador_dias CHECK (dias BETWEEN 1 AND 365),
  CONSTRAINT ck_atestado_colaborador_origem CHECK (origem IN ('sistema','migracao','integracao'))
) COMMENT='Atestado entregue pelo colaborador, com o CID de leitura restrita';

CREATE TABLE atestado_colaborador_acesso (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  atestado_colaborador_id BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  acessado_em DATETIME(3) NOT NULL,
  viu_cid BOOLEAN NOT NULL DEFAULT FALSE,
  finalidade VARCHAR(200) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  KEY ix_atestado_colaborador_acesso (atestado_colaborador_id, acessado_em),
  KEY ix_atestado_colaborador_acesso_usuario (usuario_id)
) COMMENT='Trilha de leitura do atestado do colaborador (LGPD)';

ALTER TABLE solicitacao_colaborador
  ADD COLUMN vinculo_trabalho_id BIGINT UNSIGNED NULL,
  ADD KEY ix_solicitacao_colaborador_vinculo (vinculo_trabalho_id, solicitado_em);

-- 03-04: escala, plantão, sobreaviso, jornada e dimensionamento
ALTER TABLE escala
  ADD COLUMN cobertura_minima_manha SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Profissionais mínimos no turno da manhã',
  ADD COLUMN cobertura_minima_tarde SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Profissionais mínimos no turno da tarde',
  ADD COLUMN cobertura_minima_noite SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Profissionais mínimos no turno da noite';

ALTER TABLE plantao
  ADD COLUMN fonte_realizado VARCHAR(20) NULL COMMENT 'De onde veio o horário real: informado ou ponto',
  ADD COLUMN motivo_recusa_realizado VARCHAR(500) NULL,
  ADD COLUMN lancamento_repasse_id BIGINT UNSIGNED NULL COMMENT 'Lançamento do plantão no repasse',
  ADD COLUMN lancado_por_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN estornado_em DATETIME(3) NULL,
  ADD COLUMN estornado_por_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN motivo_estorno VARCHAR(500) NULL,
  ADD COLUMN estorno_lancamento_repasse_id BIGINT UNSIGNED NULL COMMENT 'Lançamento negativo do estorno',
  ADD COLUMN alerta_conselho VARCHAR(300) NULL COMMENT 'Alerta de validade do registro no conselho aceito na escala',
  ADD COLUMN rede_nao_conferida BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Sobreposição na rede não conferida ao gravar',
  ADD COLUMN tolerancia_chegada_minutos SMALLINT UNSIGNED NULL COMMENT 'Sobreaviso: minutos para chegar depois do acionamento',
  ADD CONSTRAINT ck_plantao_fonte_realizado CHECK (fonte_realizado IS NULL OR fonte_realizado IN ('informado','ponto')),
  ADD CONSTRAINT ck_plantao_estorno CHECK (estornado_em IS NULL OR (motivo_estorno IS NOT NULL AND estornado_por_usuario_id IS NOT NULL)),
  ADD KEY ix_plantao_lancamento_repasse (lancamento_repasse_id),
  ADD KEY ix_plantao_estorno_lancamento_repasse (estorno_lancamento_repasse_id),
  ADD KEY ix_plantao_lancado_por_usuario (lancado_por_usuario_id),
  ADD KEY ix_plantao_estornado_por_usuario (estornado_por_usuario_id);

ALTER TABLE acionamento_sobreaviso
  ADD COLUMN prazo_chegada_em DATETIME(3) NULL,
  ADD COLUMN atendimento_id BIGINT UNSIGNED NULL COMMENT 'Atendimento que motivou o acionamento',
  ADD COLUMN motivo_cancelamento VARCHAR(500) NULL,
  ADD CONSTRAINT ck_acionamento_sobreaviso_prazo CHECK (prazo_chegada_em IS NULL OR prazo_chegada_em >= chamado_em),
  ADD KEY ix_acionamento_sobreaviso_atendimento (atendimento_id);

ALTER TABLE regime_jornada
  ADD COLUMN tempo_parcial VARCHAR(20) NULL COMMENT 'Contrato em tempo parcial: limite semanal (nulo: não é tempo parcial)',
  ADD COLUMN acordo_compensacao VARCHAR(300) NULL,
  ADD CONSTRAINT ck_regime_jornada_tempo_parcial CHECK (tempo_parcial IS NULL OR tempo_parcial IN ('ate_25h','ate_26h','ate_30h'));

ALTER TABLE dimensionamento_enfermagem
  ADD COLUMN nas_soma DECIMAL(9,2) NULL COMMENT 'Soma da carga de trabalho de enfermagem dos pacientes',
  ADD COLUMN nas_pacientes SMALLINT UNSIGNED NULL,
  ADD COLUMN pacientes_nao_classificados SMALLINT UNSIGNED NULL,
  ADD COLUMN constante_marinho DECIMAL(9,4) NULL COMMENT 'Constante de Marinho da resolução do conselho de enfermagem',
  ADD COLUMN categoria_prevalente VARCHAR(30) NULL,
  ADD COLUMN cobertura_sugerida SMALLINT UNSIGNED NULL;

CREATE TABLE evento_escala (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escala_id BIGINT UNSIGNED NOT NULL,
  plantao_id BIGINT UNSIGNED NULL,
  acao VARCHAR(30) NOT NULL,
  descricao VARCHAR(200) NOT NULL,
  motivo VARCHAR(500) NULL,
  ocorrido_em DATETIME(3) NOT NULL,
  usuario_id BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_evento_escala_acao CHECK (acao IN ('criada','cobertura','plantao_incluido','plantao_alterado','plantao_cancelado','publicada','cancelada','troca','acionamento')),
  KEY ix_evento_escala_escala (escala_id, ocorrido_em),
  KEY ix_evento_escala_plantao (plantao_id),
  KEY ix_evento_escala_usuario (usuario_id)
) COMMENT='Histórico de cada mudança da escala e dos plantões';

-- 03-05: eSocial (vigência do empregador, conferência, ambiente coletor, eventos de tabela)
ALTER TABLE cadastro_empregador
  ADD COLUMN transmissor VARCHAR(20) NOT NULL DEFAULT 'sistema' COMMENT 'Quem transmite o eSocial da raiz de CNPJ',
  ADD COLUMN leiaute_esocial_versao VARCHAR(20) NULL COMMENT 'Versão do leiaute em uso',
  ADD COLUMN cnae_preponderante CHAR(7) NULL,
  ADD COLUMN aliquota_rat TINYINT UNSIGNED NULL,
  ADD COLUMN fap DECIMAL(5,4) NULL,
  ADD COLUMN codigo_lotacao_tributaria VARCHAR(30) NULL,
  ADD COLUMN identificador_tabela_rubricas VARCHAR(8) NULL,
  ADD COLUMN sindicato_pessoa_juridica_id BIGINT UNSIGNED NULL,
  ADD COLUMN registro_eletronico_empregados BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT ck_cadastro_empregador_transmissor CHECK (transmissor IN ('sistema','externo')),
  ADD CONSTRAINT ck_cadastro_empregador_aliquota_rat CHECK (aliquota_rat IS NULL OR aliquota_rat BETWEEN 1 AND 3),
  ADD CONSTRAINT ck_cadastro_empregador_fap CHECK (fap IS NULL OR fap BETWEEN 0.5 AND 2),
  ADD CONSTRAINT ck_cadastro_empregador_cnae CHECK (cnae_preponderante IS NULL OR cnae_preponderante REGEXP '^[0-9]{7}$'),
  DROP CONSTRAINT ck_cadastro_empregador_indicador_desoneracao,
  ADD CONSTRAINT ck_cadastro_empregador_indicador_desoneracao CHECK (indicador_desoneracao IN ('nao_aplicavel','empresa_enquadrada','municipio_enquadrado')),
  ADD KEY ix_cadastro_empregador_sindicato_pessoa_juridica (sindicato_pessoa_juridica_id);

CREATE TABLE conferencia_eventos_esocial (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  competencia DATE NOT NULL COMMENT 'Primeiro dia do mês',
  transmissor VARCHAR(20) NULL,
  situacao VARCHAR(20) NOT NULL,
  observacao VARCHAR(1000) NULL,
  conferente_usuario_id BIGINT UNSIGNED NULL,
  conferido_em DATETIME(3) NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_conferencia_eventos_esocial_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_conferencia_eventos_esocial_situacao CHECK (situacao IN ('conciliada','divergente','sem_transmissor')),
  CONSTRAINT ck_conferencia_eventos_esocial_transmissor CHECK (transmissor IS NULL OR transmissor IN ('sistema','externo')),
  CONSTRAINT ck_conferencia_eventos_esocial_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_conferencia_eventos_esocial_estabelecimento_competencia (estabelecimento_id, competencia),
  KEY ix_conferencia_eventos_esocial_conferente_usuario (conferente_usuario_id)
) COMMENT='Conferência das contagens de eventos do eSocial na competência';

CREATE TABLE conferencia_eventos_esocial_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conferencia_eventos_esocial_id BIGINT UNSIGNED NOT NULL,
  tipo_evento_esocial_id BIGINT UNSIGNED NOT NULL,
  quantidade_sistema INT UNSIGNED NOT NULL,
  quantidade_externo INT UNSIGNED NULL,
  quantidade_repasse INT UNSIGNED NOT NULL DEFAULT 0,
  quantidade_migrada_pendente INT UNSIGNED NOT NULL DEFAULT 0,
  situacao VARCHAR(20) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_conferencia_eventos_esocial_item_situacao CHECK (situacao IN ('conciliada','divergente','sem_transmissor')),
  UNIQUE KEY uq_conferencia_eventos_esocial_item_evento (conferencia_eventos_esocial_id, tipo_evento_esocial_id),
  KEY ix_conferencia_eventos_esocial_item_tipo_evento (tipo_evento_esocial_id)
) COMMENT='Contagem por tipo de evento na conferência do eSocial';

ALTER TABLE evento_esocial
  DROP CONSTRAINT ck_evento_esocial_ambiente,
  ADD CONSTRAINT ck_evento_esocial_ambiente CHECK (ambiente IN ('coletor','producao','producao_restrita')),
  ADD COLUMN operacao_tabela VARCHAR(20) NULL COMMENT 'Inclusão, alteração ou exclusão nos eventos de tabela',
  ADD COLUMN data_referencia DATE NULL COMMENT 'Data do fato (admissão, afastamento, desligamento) ou competência',
  ADD CONSTRAINT ck_evento_esocial_operacao_tabela CHECK (operacao_tabela IS NULL OR operacao_tabela IN ('inclusao','alteracao','exclusao')),
  ADD KEY ix_evento_esocial_data_referencia (estabelecimento_id, data_referencia);
ALTER TABLE lote_esocial
  DROP CONSTRAINT ck_lote_esocial_ambiente,
  ADD CONSTRAINT ck_lote_esocial_ambiente CHECK (ambiente IN ('coletor','producao','producao_restrita')),
  DROP CONSTRAINT ck_lote_esocial_situacao_2,
  ADD CONSTRAINT ck_lote_esocial_situacao_2 CHECK (situacao IN ('montando','cancelado') OR ambiente = 'coletor' OR protocolo IS NOT NULL);

-- 03-06: folha (intercâmbio com a folha externa, afastamento, férias, rescisão, 13º, obrigações)
CREATE TABLE lote_folha_intercambio (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  competencia_folha_id BIGINT UNSIGNED NULL,
  competencia DATE NOT NULL COMMENT 'Primeiro dia do mês',
  sentido VARCHAR(20) NOT NULL,
  lote_exportado_id BIGINT UNSIGNED NULL COMMENT 'Lote exportado a que o retorno recebido responde',
  leiaute VARCHAR(30) NOT NULL,
  situacao VARCHAR(30) NOT NULL,
  quantidade_colaboradores INT UNSIGNED NOT NULL,
  soma DECIMAL(15,2) NOT NULL,
  totais JSON NOT NULL,
  vinculos JSON NULL,
  divergencias JSON NULL,
  resumo VARCHAR(1000) NOT NULL,
  gerado_em DATETIME(3) NOT NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_lote_folha_intercambio_competencia CHECK (DAYOFMONTH(competencia) = 1),
  CONSTRAINT ck_lote_folha_intercambio_sentido CHECK (sentido IN ('exportado','recebido')),
  CONSTRAINT ck_lote_folha_intercambio_situacao CHECK (situacao IN ('gerado','conferido','divergente','lancado','cancelado')),
  CONSTRAINT ck_lote_folha_intercambio_retorno CHECK (sentido = 'recebido' OR lote_exportado_id IS NULL),
  CONSTRAINT ck_lote_folha_intercambio_vinculos CHECK (sentido = 'exportado' OR vinculos IS NULL),
  CONSTRAINT ck_lote_folha_intercambio_totais CHECK (JSON_VALID(totais)),
  CONSTRAINT ck_lote_folha_intercambio_json CHECK ((vinculos IS NULL OR JSON_VALID(vinculos)) AND (divergencias IS NULL OR JSON_VALID(divergencias))),
  CONSTRAINT ck_lote_folha_intercambio_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_lote_folha_intercambio_estabelecimento_competencia (estabelecimento_id, competencia),
  KEY ix_lote_folha_intercambio_competencia_folha (competencia_folha_id),
  KEY ix_lote_folha_intercambio_lote_exportado (lote_exportado_id)
) COMMENT='Lote de intercâmbio com a folha de pagamento externa: o exportado e o retorno recebido, com a conferência';

CREATE TABLE lote_folha_intercambio_resumo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lote_folha_intercambio_id BIGINT UNSIGNED NOT NULL,
  sequencia INT UNSIGNED NOT NULL,
  vinculo_trabalho_id BIGINT UNSIGNED NULL,
  centro_custo_id BIGINT UNSIGNED NULL,
  rubrica VARCHAR(30) NOT NULL,
  valor DECIMAL(15,2) NOT NULL,
  vencimento DATE NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_lote_folha_intercambio_resumo_sequencia (lote_folha_intercambio_id, sequencia),
  KEY ix_lote_folha_intercambio_resumo_vinculo (vinculo_trabalho_id),
  KEY ix_lote_folha_intercambio_resumo_centro_custo (centro_custo_id)
) COMMENT='Linhas do lote de intercâmbio da folha por vínculo, centro de custo e rubrica';

ALTER TABLE afastamento
  ADD COLUMN motivo_cancelamento VARCHAR(400) NULL;

ALTER TABLE historico_salarial
  ADD COLUMN adicional_escolhido VARCHAR(20) NULL COMMENT 'Adicional escolhido quando há direito aos dois',
  ADD CONSTRAINT ck_historico_salarial_adicional CHECK (adicional_escolhido IS NULL OR adicional_escolhido IN ('insalubridade','periculosidade'));

ALTER TABLE programacao_ferias
  ADD COLUMN vinculo_trabalho_id BIGINT UNSIGNED NULL,
  ADD COLUMN dias_dobra SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Dias pagos em dobro (férias fora do prazo concessivo)',
  ADD COLUMN pagamento_previsto_em DATE NULL,
  ADD CONSTRAINT ck_programacao_ferias_dias_dobra CHECK (dias_dobra <= 30),
  ADD KEY ix_programacao_ferias_vinculo_trabalho (vinculo_trabalho_id);
ALTER TABLE recibo_ferias
  ADD COLUMN base_inss DECIMAL(15,2) NULL,
  ADD CONSTRAINT ck_recibo_ferias_base_inss CHECK (base_inss IS NULL OR base_inss >= 0);
ALTER TABLE rescisao
  ADD COLUMN modalidade VARCHAR(30) NULL,
  ADD COLUMN dias_aviso_indenizados SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN saldo_fgts_informado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN motivo_situacao VARCHAR(400) NULL,
  ADD CONSTRAINT ck_rescisao_modalidade CHECK (modalidade IS NULL OR modalidade IN ('sem_justa_causa','justa_causa','pedido_demissao','acordo','termino_contrato','antecipada_empregador','antecipada_empregado','culpa_reciproca','rescisao_indireta','falecimento')),
  DROP CONSTRAINT ck_rescisao_situacao,
  ADD CONSTRAINT ck_rescisao_situacao CHECK (situacao IN ('simulacao','calculada','conferida','paga','homologada','cancelada','substituida'));
ALTER TABLE parcela_decimo_terceiro
  ADD COLUMN vinculo_trabalho_id BIGINT UNSIGNED NULL,
  ADD KEY ix_parcela_decimo_terceiro_vinculo_trabalho (vinculo_trabalho_id);

ALTER TABLE obrigacao_trabalhista
  ADD COLUMN leiaute VARCHAR(30) NULL,
  ADD COLUMN leiaute_conferido BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN totais JSON NULL,
  ADD COLUMN valor_acrescimos DECIMAL(15,2) NULL,
  ADD COLUMN motivo_cancelamento VARCHAR(400) NULL,
  ADD CONSTRAINT ck_obrigacao_trabalhista_totais CHECK (totais IS NULL OR JSON_VALID(totais)),
  ADD CONSTRAINT ck_obrigacao_trabalhista_valor_acrescimos CHECK (valor_acrescimos IS NULL OR valor_acrescimos >= 0);
ALTER TABLE arquivo_obrigacao
  ADD COLUMN nome_arquivo VARCHAR(120) NULL;

CREATE TABLE parametro_obrigacao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NULL COMMENT 'Nulo: vale para a rede inteira',
  vigencia_inicio DATE NOT NULL,
  dados JSON NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_parametro_obrigacao_dados CHECK (JSON_VALID(dados)),
  UNIQUE KEY uq_parametro_obrigacao_vigencia (estabelecimento_id, vigencia_inicio)
) COMMENT='Parâmetros das obrigações trabalhistas por vigência';

-- 03-10: saúde ocupacional
CREATE TABLE sorologia_exposicao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  exposicao_biologica_id BIGINT UNSIGNED NOT NULL,
  marco VARCHAR(10) NOT NULL COMMENT 'd0, d30, d90, d180 do protocolo de profilaxia pós-exposição',
  data_prevista DATE NOT NULL,
  data_realizada DATE NULL,
  resultado VARCHAR(20) NULL,
  observacao VARCHAR(500) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_sorologia_exposicao_marco CHECK (marco IN ('d0','d30','d90','d180')),
  CONSTRAINT ck_sorologia_exposicao_resultado CHECK (resultado IS NULL OR resultado IN ('sem_alteracao','soroconversao','nao_realizada')),
  CONSTRAINT ck_sorologia_exposicao_realizada CHECK (data_realizada IS NULL OR resultado IS NOT NULL),
  CONSTRAINT ck_sorologia_exposicao_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_sorologia_exposicao_marco (exposicao_biologica_id, marco)
) COMMENT='Marco do acompanhamento sorológico depois da exposição a material biológico';

ALTER TABLE comunicacao_acidente
  ADD COLUMN setor_funcional_id BIGINT UNSIGNED NULL,
  ADD COLUMN prazo_comunicacao DATE NULL COMMENT 'Prazo legal da comunicação calculado no registro',
  ADD COLUMN encerrado_em DATETIME(3) NULL,
  ADD COLUMN encerrado_por BIGINT UNSIGNED NULL,
  ADD COLUMN motivo_encerramento VARCHAR(500) NULL,
  ADD COLUMN observacao VARCHAR(1000) NULL,
  ADD COLUMN emitente_conselho_classe_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT ck_comunicacao_acidente_encerramento CHECK (encerrado_em IS NULL OR motivo_encerramento IS NOT NULL),
  ADD KEY ix_comunicacao_acidente_setor_funcional (setor_funcional_id),
  ADD KEY ix_comunicacao_acidente_emitente_conselho_classe (emitente_conselho_classe_id);

ALTER TABLE exposicao_biologica
  ADD COLUMN situacao_profilaxia VARCHAR(20) NOT NULL DEFAULT 'nao_indicada',
  ADD COLUMN profilaxia_em DATE NULL,
  ADD COLUMN observacao_profilaxia VARCHAR(500) NULL,
  ADD CONSTRAINT ck_exposicao_biologica_situacao_profilaxia CHECK (situacao_profilaxia IN ('nao_indicada','indicada','iniciada','recusada'));

ALTER TABLE vacina_colaborador
  ADD COLUMN titulo_anti_hbs DECIMAL(9,2) NULL COMMENT 'Título em mUI/mL, quando a dose é a sorologia',
  ADD COLUMN retifica_vacina_colaborador_id BIGINT UNSIGNED NULL COMMENT 'Registro que esta linha retifica',
  ADD KEY ix_vacina_colaborador_retifica (retifica_vacina_colaborador_id);
ALTER TABLE aso
  ADD COLUMN retifica_aso_id BIGINT UNSIGNED NULL COMMENT 'Atestado de saúde ocupacional que este retifica',
  ADD COLUMN motivo_retificacao VARCHAR(500) NULL,
  ADD CONSTRAINT ck_aso_retificacao CHECK (retifica_aso_id IS NULL OR motivo_retificacao IS NOT NULL),
  ADD KEY ix_aso_retifica (retifica_aso_id);

CREATE TABLE leitura_dosimetria (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vinculo_trabalho_id BIGINT UNSIGNED NOT NULL,
  periodo_inicio DATE NOT NULL,
  periodo_fim DATE NOT NULL,
  dosimetro VARCHAR(40) NOT NULL,
  dose_msv DECIMAL(9,4) NOT NULL COMMENT 'Dose no período, em mSv',
  observacao VARCHAR(500) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_leitura_dosimetria_periodo CHECK (periodo_fim >= periodo_inicio),
  CONSTRAINT ck_leitura_dosimetria_dose CHECK (dose_msv >= 0),
  CONSTRAINT ck_leitura_dosimetria_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_leitura_dosimetria_periodo (vinculo_trabalho_id, dosimetro, periodo_inicio)
) COMMENT='Leitura do dosímetro do colaborador exposto a radiação ionizante, por período';

CREATE TABLE exposicao_quimioterapico (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vinculo_trabalho_id BIGINT UNSIGNED NOT NULL,
  data_exposicao DATE NOT NULL,
  agente VARCHAR(150) NOT NULL,
  duracao_minutos SMALLINT UNSIGNED NULL,
  observacao VARCHAR(500) NULL,
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_exposicao_quimioterapico_origem CHECK (origem IN ('sistema','migracao','integracao')),
  KEY ix_exposicao_quimioterapico_vinculo (vinculo_trabalho_id, data_exposicao)
) COMMENT='Exposição do colaborador a quimioterápico antineoplásico no manuseio';

ALTER TABLE rubrica
  ADD COLUMN incide_dsr BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN incide_salario_familia BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN incide_vale_transporte BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN incide_pensao BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN incide_rais BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN incide_informe_rendimentos BOOLEAN NOT NULL DEFAULT FALSE;

-- 03-11: treinamento
ALTER TABLE presenca_treinamento
  ADD COLUMN vinculo_trabalho_id BIGINT UNSIGNED NULL,
  ADD COLUMN concluido_em DATE NULL COMMENT 'Data da conclusão do colaborador na turma',
  ADD COLUMN observacao VARCHAR(400) NULL,
  ADD CONSTRAINT ck_presenca_treinamento_conclusao CHECK (concluido_em IS NULL OR situacao = 'presente'),
  ADD KEY ix_presenca_treinamento_vinculo_trabalho (vinculo_trabalho_id);
ALTER TABLE turma_treinamento
  ADD COLUMN documento_qualidade_versao_id BIGINT UNSIGNED NULL COMMENT 'Versão do procedimento operacional trabalhada na turma',
  ADD KEY ix_turma_treinamento_documento_qualidade_versao (documento_qualidade_versao_id);
