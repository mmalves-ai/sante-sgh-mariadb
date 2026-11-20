-- Módulo HOT (hotelaria, portaria, nutrição, arquivo, manutenção), lote 04: 19 tabelas.
-- Convenções do ADR 0002, parte 2. Sem FOREIGN KEY aqui; as chaves ficam em 04_chaves.sql.
-- Instantes em DATETIME(3) UTC.

-- ---------------------------------------------------------------------------------------------
-- Domínios
-- ---------------------------------------------------------------------------------------------

CREATE TABLE tipo_destinatario_beneficio (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  categoria         VARCHAR(30) NOT NULL COMMENT 'Quem recebe: paciente, acompanhante, visitante, profissional, colaborador ou setor',
  exige_atendimento BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O benefício só é concedido vinculado a um atendimento',
  exige_paciente    BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O benefício só é concedido vinculado a um paciente',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_destinatario_beneficio_categoria CHECK (categoria IN ('paciente','acompanhante','visitante','profissional','colaborador','setor')),
  UNIQUE KEY uq_tipo_destinatario_beneficio_codigo (codigo)
) COMMENT='Quem pode receber o benefício (paciente, acompanhante, profissional, setor) e se exige atendimento ou paciente';

CREATE TABLE tipo_documento_arquivo (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  grupo             VARCHAR(30) NOT NULL DEFAULT 'prontuario' COMMENT 'prontuario, exame, conta, imagem, administrativo ou outro',
  exige_protocolo   BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A movimentação do documento exige protocolo de entrega',
  identificado_por_codigo BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O documento recebe etiqueta com código de barras',
  informa_conta     BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O documento acompanha a conta do atendimento',
  compoe_remessa    BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O documento segue na remessa ao convênio',
  guardado_no_arquivo BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'O documento é guardado no arquivo de prontuários',
  prazo_guarda_anos SMALLINT UNSIGNED NULL COMMENT 'Prazo legal de guarda em anos (prontuário: 20)',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_documento_arquivo_grupo CHECK (grupo IN ('prontuario','exame','conta','imagem','administrativo','outro')),
  CONSTRAINT ck_tipo_documento_arquivo_prazo CHECK (prazo_guarda_anos IS NULL OR prazo_guarda_anos BETWEEN 1 AND 100),
  UNIQUE KEY uq_tipo_documento_arquivo_codigo (codigo)
) COMMENT='Tipo de documento guardado no arquivo (prontuário, exames, conta, filme)';

CREATE TABLE tipo_entrada_enxoval (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  natureza          VARCHAR(30) NOT NULL COMMENT 'compra, doacao, reposicao, devolucao_setor, transferencia ou ajuste',
  gera_custo        BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A entrada compõe o custo do enxoval',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_entrada_enxoval_natureza CHECK (natureza IN ('compra','doacao','reposicao','devolucao_setor','transferencia','ajuste')),
  UNIQUE KEY uq_tipo_entrada_enxoval_codigo (codigo)
) COMMENT='Forma de entrada de peças no estoque do enxoval (compra, doação, reposição, devolução de setor)';

CREATE TABLE tipo_justificativa_impressao (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  exige_complemento BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Obriga texto livre complementando a justificativa',
  exige_autorizacao BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A impressão ou exportação depende de autorização prévia',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_tipo_justificativa_impressao_codigo (codigo)
) COMMENT='Justificativa para imprimir ou exportar o prontuário (pedido do paciente, judicial, auditoria, transferência)';

CREATE TABLE tipo_ocorrencia_limpeza (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  modalidade        VARCHAR(30) NOT NULL COMMENT 'programada ou emergencial',
  material_biologico BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Envolve sangue, urina, fezes, vômito ou outro fluido',
  prioridade        SMALLINT UNSIGNED NOT NULL DEFAULT 3 COMMENT '1 é a mais urgente',
  tempo_padrao_minutos SMALLINT UNSIGNED NULL COMMENT 'Tempo esperado de atendimento da limpeza',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_ocorrencia_limpeza_modalidade CHECK (modalidade IN ('programada','emergencial')),
  CONSTRAINT ck_tipo_ocorrencia_limpeza_prioridade CHECK (prioridade BETWEEN 1 AND 5),
  UNIQUE KEY uq_tipo_ocorrencia_limpeza_codigo (codigo)
) COMMENT='Ocorrência que gera limpeza (programada, emergencial, sangue, urina, fezes, vômito)';

CREATE TABLE tipo_ocorrencia_refeicao (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  gera_reposicao    BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A ocorrência pede nova refeição',
  exige_justificativa BOOLEAN NOT NULL DEFAULT FALSE,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_tipo_ocorrencia_refeicao_codigo (codigo)
) COMMENT='Ocorrência na entrega da refeição (recusa, troca, atraso, paciente ausente, dieta errada)';

CREATE TABLE tipo_ordem_servico_manutencao (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  natureza          VARCHAR(30) NOT NULL COMMENT 'corretiva, preventiva, preditiva, calibracao, instalacao, melhoria ou outra',
  exige_bem_patrimonial BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A ordem só pode ser aberta com o bem ou equipamento informado',
  prazo_entrega_horas INT UNSIGNED NULL COMMENT 'Prazo padrão de conclusão da ordem',
  codigo_integracao VARCHAR(50) NULL COMMENT 'Código do tipo no sistema externo de manutenção, quando houver integração',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_ordem_servico_manutencao_natureza CHECK (natureza IN ('corretiva','preventiva','preditiva','calibracao','instalacao','melhoria','outra')),
  CONSTRAINT ck_tipo_ordem_servico_manutencao_prazo CHECK (prazo_entrega_horas IS NULL OR prazo_entrega_horas > 0),
  UNIQUE KEY uq_tipo_ordem_servico_manutencao_codigo (codigo)
) COMMENT='Tipos de ordem de serviço da manutenção (corretiva, preventiva, instalação), com prazo e exigência de equipamento';

CREATE TABLE tipo_pendencia_prontuario (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  categoria         VARCHAR(30) NOT NULL COMMENT 'diagnostico, assinatura, evolucao, prescricao, documento, faturamento ou outra',
  responsavel       VARCHAR(30) NOT NULL DEFAULT 'medico' COMMENT 'Quem resolve: medico, enfermagem, multiprofissional, administrativo ou faturamento',
  tolerancia_horas  INT UNSIGNED NULL COMMENT 'Prazo até a pendência ser cobrada como atrasada',
  resolucao_manual  BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A pendência é baixada por um usuário, e não pelo próprio registro que a resolve',
  impeditiva        BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Impede o fechamento da conta ou do prontuário enquanto aberta',
  observacao        VARCHAR(500) NULL,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_pendencia_prontuario_categoria CHECK (categoria IN ('diagnostico','assinatura','evolucao','prescricao','documento','faturamento','outra')),
  CONSTRAINT ck_tipo_pendencia_prontuario_responsavel CHECK (responsavel IN ('medico','enfermagem','multiprofissional','administrativo','faturamento')),
  UNIQUE KEY uq_tipo_pendencia_prontuario_codigo (codigo)
) COMMENT='Tipo de pendência do prontuário (falta de diagnóstico, assinatura, evolução, documento) com setor responsável';

CREATE TABLE tipo_pertence (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  categoria         VARCHAR(30) NOT NULL DEFAULT 'outro' COMMENT 'documento, valor, roupa, eletronico, protese ou outro',
  guarda_em_cofre   BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O pertence vai para o cofre (dinheiro, joia, documento)',
  exige_descricao   BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Obriga descrever o item no recibo de guarda',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_pertence_categoria CHECK (categoria IN ('documento','valor','roupa','eletronico','protese','outro')),
  UNIQUE KEY uq_tipo_pertence_codigo (codigo)
) COMMENT='Tipos de pertence guardado (documento, valor, roupa, eletrônico, prótese)';

CREATE TABLE tipo_visitado (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  alvo              VARCHAR(30) NOT NULL COMMENT 'Ponta exigida na visita: paciente, setor, colaborador ou outro',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_visitado_alvo CHECK (alvo IN ('paciente','setor','colaborador','outro')),
  UNIQUE KEY uq_tipo_visitado_codigo (codigo)
) COMMENT='Quem é visitado (paciente, setor, funcionário)';

CREATE TABLE tipo_visitante (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  categoria         VARCHAR(30) NOT NULL COMMENT 'visitante, acompanhante, fornecedor, colaborador, representante, terceiro ou outro',
  exige_documento   BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Obriga documento de identificação na entrada',
  exige_autorizacao BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'A entrada depende de autorização do setor visitado',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_tipo_visitante_categoria CHECK (categoria IN ('visitante','acompanhante','fornecedor','colaborador','representante','terceiro','outro')),
  UNIQUE KEY uq_tipo_visitante_codigo (codigo)
) COMMENT='Tipo de pessoa na portaria (visitante, acompanhante, fornecedor, funcionário, representante, terceiro)';

CREATE TABLE via_dieta (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(30) NOT NULL,
  descricao         VARCHAR(150) NOT NULL,
  modalidade        VARCHAR(30) NOT NULL COMMENT 'oral, enteral, parenteral ou jejum',
  exige_dispositivo BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Exige sonda, ostomia ou acesso venoso registrado',
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_via_dieta_modalidade CHECK (modalidade IN ('oral','enteral','parenteral','jejum')),
  UNIQUE KEY uq_via_dieta_codigo (codigo)
) COMMENT='Via de administração da dieta (oral, sonda, ostomia, parenteral)';

-- ---------------------------------------------------------------------------------------------
-- Vínculo
-- ---------------------------------------------------------------------------------------------

CREATE TABLE tipo_pendencia_prontuario_setor (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tipo_pendencia_prontuario_id BIGINT UNSIGNED NOT NULL,
  setor_funcional_id BIGINT UNSIGNED NOT NULL COMMENT 'Setor que cobra a pendência',
  gera_pendencia    BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'O setor gera a pendência automaticamente',
  tolerancia_horas  INT UNSIGNED NULL COMMENT 'Tolerância própria do setor; nula usa a do tipo',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em       DATETIME(3) NULL,
  excluido_por      BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_tipo_pendencia_prontuario_setor_par (tipo_pendencia_prontuario_id, setor_funcional_id),
  KEY ix_tipo_pendencia_prontuario_setor_setor (setor_funcional_id)
) COMMENT='Setores ou módulos que cobram cada tipo de pendência';

-- ---------------------------------------------------------------------------------------------
-- Nutrição
-- ---------------------------------------------------------------------------------------------

CREATE TABLE triagem_nutricional (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  internacao_id     BIGINT UNSIGNED NOT NULL,
  paciente_id       BIGINT UNSIGNED NOT NULL,
  instrumento_triagem_nutricional_id BIGINT UNSIGNED NOT NULL COMMENT 'Instrumento aplicado (NRS-2002, NUTRIC modificado)',
  versao_instrumento VARCHAR(30) NOT NULL COMMENT 'Versão do instrumento usada no cálculo',
  triado_em         DATETIME(3) NOT NULL,
  profissional_id   BIGINT UNSIGNED NULL COMMENT 'Nutricionista ou profissional que aplicou a triagem',
  responsavel_usuario_id BIGINT UNSIGNED NOT NULL COMMENT 'Usuário que registrou a triagem',
  peso_kg           DECIMAL(6,2) NULL,
  altura_cm         SMALLINT UNSIGNED NULL,
  imc               DECIMAL(5,2) NULL COMMENT 'Índice de massa corporal calculado pelo servidor',
  pontuacao_estado_nutricional SMALLINT UNSIGNED NULL COMMENT 'Parcela do estado nutricional (NRS-2002, 0 a 3)',
  pontuacao_gravidade SMALLINT UNSIGNED NULL COMMENT 'Parcela da gravidade da doença (NRS-2002, 0 a 3)',
  pontuacao_idade   SMALLINT UNSIGNED NULL COMMENT 'Parcela da idade, vinda do cadastro',
  pontuacao_total   SMALLINT UNSIGNED NOT NULL COMMENT 'Escore total, sempre calculado pelo servidor',
  risco             VARCHAR(30) NOT NULL COMMENT 'sem_risco, risco ou alto',
  conduta           VARCHAR(500) NULL,
  horas_desde_admissao INT UNSIGNED NOT NULL COMMENT 'Horas entre a admissão e a triagem',
  dentro_prazo      BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Triagem feita no prazo da regra (até 48 h da admissão)',
  reavaliar_em      DATE NULL COMMENT 'Data prevista de reavaliação (triagem sem risco)',
  situacao          VARCHAR(30) NOT NULL DEFAULT 'ativo' COMMENT 'ativo, retificado ou estornado',
  substitui_triagem_nutricional_id BIGINT UNSIGNED NULL COMMENT 'Triagem anterior que esta retifica',
  motivo_correcao   VARCHAR(500) NULL COMMENT 'Motivo da retificação ou do estorno',
  origem            VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em       DATETIME(3) NULL,
  excluido_por      BIGINT UNSIGNED NULL,
  CONSTRAINT ck_triagem_nutricional_risco CHECK (risco IN ('sem_risco','risco','alto')),
  CONSTRAINT ck_triagem_nutricional_situacao CHECK (situacao IN ('ativo','retificado','estornado')),
  CONSTRAINT ck_triagem_nutricional_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_triagem_nutricional_peso CHECK (peso_kg IS NULL OR (peso_kg > 0 AND peso_kg <= 400)),
  CONSTRAINT ck_triagem_nutricional_altura CHECK (altura_cm IS NULL OR altura_cm BETWEEN 30 AND 250),
  CONSTRAINT ck_triagem_nutricional_estado CHECK (pontuacao_estado_nutricional IS NULL OR pontuacao_estado_nutricional <= 3),
  CONSTRAINT ck_triagem_nutricional_gravidade CHECK (pontuacao_gravidade IS NULL OR pontuacao_gravidade <= 3),
  CONSTRAINT ck_triagem_nutricional_correcao CHECK (situacao = 'ativo' OR motivo_correcao IS NOT NULL),
  KEY ix_triagem_nutricional_estabelecimento (estabelecimento_id, triado_em),
  KEY ix_triagem_nutricional_internacao (internacao_id, triado_em),
  KEY ix_triagem_nutricional_paciente (paciente_id),
  KEY ix_triagem_nutricional_instrumento (instrumento_triagem_nutricional_id),
  KEY ix_triagem_nutricional_profissional (profissional_id),
  KEY ix_triagem_nutricional_responsavel (responsavel_usuario_id),
  KEY ix_triagem_nutricional_substitui (substitui_triagem_nutricional_id),
  KEY ix_triagem_nutricional_reavaliar (estabelecimento_id, reavaliar_em)
) COMMENT='Triagem de risco nutricional do internado, com instrumento, escore, risco e reavaliação prevista';

CREATE TABLE triagem_nutricional_resposta (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  triagem_nutricional_id BIGINT UNSIGNED NOT NULL,
  sequencia         SMALLINT UNSIGNED NOT NULL,
  codigo_pergunta   VARCHAR(60) NOT NULL COMMENT 'Código da pergunta no instrumento (ex.: imc_abaixo_20_5, apache2)',
  resposta_booleana BOOLEAN NULL,
  resposta_numerica DECIMAL(15,4) NULL,
  resposta_texto    VARCHAR(500) NULL,
  pontuacao         SMALLINT UNSIGNED NULL COMMENT 'Pontos atribuídos pela resposta',
  origem            VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em       DATETIME(3) NULL,
  excluido_por      BIGINT UNSIGNED NULL,
  CONSTRAINT ck_triagem_nutricional_resposta_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_triagem_nutricional_resposta_valor CHECK (resposta_booleana IS NOT NULL OR resposta_numerica IS NOT NULL OR resposta_texto IS NOT NULL),
  UNIQUE KEY uq_triagem_nutricional_resposta_sequencia (triagem_nutricional_id, sequencia),
  UNIQUE KEY uq_triagem_nutricional_resposta_pergunta (triagem_nutricional_id, codigo_pergunta)
) COMMENT='Resposta a cada pergunta do instrumento na triagem';

CREATE TABLE vale_refeicao (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  numero            VARCHAR(30) NOT NULL COMMENT 'Número do vale, gerado por sequencia_negocio',
  refeicao_do_dia_id BIGINT UNSIGNED NULL COMMENT 'Refeição a que o vale dá direito; nula vale para qualquer refeição',
  tipo_destinatario_beneficio_id BIGINT UNSIGNED NOT NULL,
  pessoa_portaria_id BIGINT UNSIGNED NULL COMMENT 'Visitante ou acompanhante identificado na portaria',
  acompanhante_internacao_id BIGINT UNSIGNED NULL,
  internacao_id     BIGINT UNSIGNED NULL,
  paciente_id       BIGINT UNSIGNED NULL,
  quantidade        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  valor_unitario    DECIMAL(15,2) NOT NULL,
  valor_total       DECIMAL(15,2) NOT NULL,
  vendido_em        DATETIME(3) NOT NULL,
  sessao_caixa_id   BIGINT UNSIGNED NULL COMMENT 'Sessão do caixa que vendeu o vale',
  recebimento_particular_id BIGINT UNSIGNED NULL COMMENT 'Recebimento que quitou o vale',
  valido_ate        DATE NULL,
  situacao          VARCHAR(30) NOT NULL DEFAULT 'emitido' COMMENT 'emitido, pago, utilizado, cancelado ou expirado',
  utilizado_em      DATETIME(3) NULL,
  cancelado_em      DATETIME(3) NULL,
  motivo_cancelamento VARCHAR(500) NULL,
  origem            VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em       DATETIME(3) NULL,
  excluido_por      BIGINT UNSIGNED NULL,
  CONSTRAINT ck_vale_refeicao_situacao CHECK (situacao IN ('emitido','pago','utilizado','cancelado','expirado')),
  CONSTRAINT ck_vale_refeicao_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_vale_refeicao_quantidade CHECK (quantidade > 0),
  CONSTRAINT ck_vale_refeicao_valores CHECK (valor_unitario >= 0 AND valor_total >= 0),
  CONSTRAINT ck_vale_refeicao_cancelamento CHECK (situacao <> 'cancelado' OR (cancelado_em IS NOT NULL AND motivo_cancelamento IS NOT NULL)),
  CONSTRAINT ck_vale_refeicao_utilizacao CHECK (situacao <> 'utilizado' OR utilizado_em IS NOT NULL),
  UNIQUE KEY uq_vale_refeicao_estabelecimento_numero (estabelecimento_id, numero),
  KEY ix_vale_refeicao_estabelecimento (estabelecimento_id, vendido_em),
  KEY ix_vale_refeicao_refeicao_do_dia (refeicao_do_dia_id),
  KEY ix_vale_refeicao_tipo_destinatario (tipo_destinatario_beneficio_id),
  KEY ix_vale_refeicao_pessoa_portaria (pessoa_portaria_id),
  KEY ix_vale_refeicao_acompanhante (acompanhante_internacao_id),
  KEY ix_vale_refeicao_internacao (internacao_id),
  KEY ix_vale_refeicao_paciente (paciente_id),
  KEY ix_vale_refeicao_sessao_caixa (sessao_caixa_id),
  KEY ix_vale_refeicao_recebimento (recebimento_particular_id)
) COMMENT='Vale de refeição vendido no caixa a acompanhante ou visitante, com valor e situação';

-- ---------------------------------------------------------------------------------------------
-- Manutenção
-- ---------------------------------------------------------------------------------------------

CREATE TABLE valor_hora_tecnico_manutencao (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  colaborador_id    BIGINT UNSIGNED NOT NULL COMMENT 'Técnico de manutenção',
  oficina_manutencao_id BIGINT UNSIGNED NULL COMMENT 'Oficina em que o técnico atua com este valor',
  vigencia_inicio   DATE NOT NULL,
  vigencia_fim      DATE NULL,
  valor_hora        DECIMAL(15,2) NOT NULL COMMENT 'Custo da hora normal',
  valor_hora_extra  DECIMAL(15,2) NULL COMMENT 'Custo da hora extra',
  valor_venda_hora  DECIMAL(15,2) NULL COMMENT 'Valor cobrado por hora em serviço a terceiros',
  autoriza_hora_extra BOOLEAN NOT NULL DEFAULT FALSE,
  operacao          VARCHAR(30) NOT NULL DEFAULT 'inclusao',
  dados             JSON NULL COMMENT 'Fotografia do registro anterior na alteração ou exclusão',
  ocorrido_em       DATETIME(3) NOT NULL,
  usuario_id        BIGINT UNSIGNED NULL COMMENT 'Usuário que registrou a vigência',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_valor_hora_tecnico_manutencao_operacao CHECK (operacao IN ('inclusao','alteracao','exclusao')),
  CONSTRAINT ck_valor_hora_tecnico_manutencao_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_valor_hora_tecnico_manutencao_valores CHECK (valor_hora >= 0 AND (valor_hora_extra IS NULL OR valor_hora_extra >= 0) AND (valor_venda_hora IS NULL OR valor_venda_hora >= 0)),
  UNIQUE KEY uq_valor_hora_tecnico_manutencao_vigencia (estabelecimento_id, colaborador_id, vigencia_inicio),
  KEY ix_valor_hora_tecnico_manutencao_colaborador (colaborador_id, vigencia_inicio),
  KEY ix_valor_hora_tecnico_manutencao_oficina (oficina_manutencao_id),
  KEY ix_valor_hora_tecnico_manutencao_usuario (usuario_id)
) COMMENT='Valor da hora normal, extra e de venda do técnico de manutenção por vigência, base do custo da ordem de serviço';

-- ---------------------------------------------------------------------------------------------
-- Portaria
-- ---------------------------------------------------------------------------------------------

CREATE TABLE visita (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  pessoa_portaria_id BIGINT UNSIGNED NOT NULL COMMENT 'Pessoa identificada na portaria',
  tipo_visitante_id BIGINT UNSIGNED NOT NULL,
  tipo_visitado_id  BIGINT UNSIGNED NOT NULL,
  paciente_id       BIGINT UNSIGNED NULL COMMENT 'Paciente visitado',
  atendimento_id    BIGINT UNSIGNED NULL,
  internacao_id     BIGINT UNSIGNED NULL,
  acompanhante_internacao_id BIGINT UNSIGNED NULL COMMENT 'Registro do acompanhante, quando a pessoa entra como acompanhante',
  setor_funcional_id BIGINT UNSIGNED NULL COMMENT 'Setor visitado ou de destino',
  visitado_colaborador_id BIGINT UNSIGNED NULL COMMENT 'Colaborador visitado',
  tipo_parentesco_id BIGINT UNSIGNED NULL COMMENT 'Parentesco com o paciente visitado',
  forma_identificacao_visitante_id BIGINT UNSIGNED NULL COMMENT 'Como a pessoa foi identificada na entrada',
  cracha_visitante_id BIGINT UNSIGNED NULL,
  entrada_ponto_acesso_id BIGINT UNSIGNED NOT NULL,
  saida_ponto_acesso_id BIGINT UNSIGNED NULL,
  entrada_em        DATETIME(3) NOT NULL,
  saida_em          DATETIME(3) NULL,
  entrada_usuario_id BIGINT UNSIGNED NOT NULL COMMENT 'Usuário da portaria que registrou a entrada',
  saida_usuario_id  BIGINT UNSIGNED NULL,
  autorizador_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem autorizou a entrada, quando o tipo exige',
  ramal_contato     VARCHAR(20) NULL,
  situacao          VARCHAR(30) NOT NULL DEFAULT 'em_andamento' COMMENT 'em_andamento, encerrada ou cancelada',
  observacao        TEXT NULL,
  origem            VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em       DATETIME(3) NULL,
  excluido_por      BIGINT UNSIGNED NULL,
  CONSTRAINT ck_visita_situacao CHECK (situacao IN ('em_andamento','encerrada','cancelada')),
  CONSTRAINT ck_visita_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_visita_saida CHECK (saida_em IS NULL OR saida_em >= entrada_em),
  CONSTRAINT ck_visita_encerrada CHECK (situacao <> 'encerrada' OR saida_em IS NOT NULL),
  CONSTRAINT ck_visita_visitado CHECK (paciente_id IS NOT NULL OR setor_funcional_id IS NOT NULL OR visitado_colaborador_id IS NOT NULL),
  KEY ix_visita_estabelecimento (estabelecimento_id, entrada_em),
  KEY ix_visita_pessoa_portaria (pessoa_portaria_id, entrada_em),
  KEY ix_visita_tipo_visitante (tipo_visitante_id),
  KEY ix_visita_tipo_visitado (tipo_visitado_id),
  KEY ix_visita_paciente (paciente_id),
  KEY ix_visita_atendimento (atendimento_id),
  KEY ix_visita_internacao (internacao_id),
  KEY ix_visita_acompanhante (acompanhante_internacao_id),
  KEY ix_visita_setor (setor_funcional_id),
  KEY ix_visita_colaborador (visitado_colaborador_id),
  KEY ix_visita_parentesco (tipo_parentesco_id),
  KEY ix_visita_forma_identificacao (forma_identificacao_visitante_id),
  KEY ix_visita_cracha (cracha_visitante_id),
  KEY ix_visita_entrada_ponto (entrada_ponto_acesso_id),
  KEY ix_visita_saida_ponto (saida_ponto_acesso_id),
  KEY ix_visita_entrada_usuario (entrada_usuario_id),
  KEY ix_visita_saida_usuario (saida_usuario_id),
  KEY ix_visita_autorizador (autorizador_usuario_id),
  KEY ix_visita_em_andamento (estabelecimento_id, situacao)
) COMMENT='Entrada e saída de visitante ou acompanhante, com visitado, crachá, ponto de acesso e horários';

-- ---------------------------------------------------------------------------------------------
-- Arquivo de prontuários
-- ---------------------------------------------------------------------------------------------

CREATE TABLE volume_prontuario (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  paciente_id       BIGINT UNSIGNED NOT NULL,
  tipo_documento_arquivo_id BIGINT UNSIGNED NOT NULL,
  numero_volume     SMALLINT UNSIGNED NOT NULL COMMENT 'Número do volume do paciente para o tipo de documento (1, 2, 3...)',
  numero_matricula  VARCHAR(30) NULL COMMENT 'Matrícula do volume no arquivo (etiqueta), gerada por sequencia_negocio',
  atendimento_id    BIGINT UNSIGNED NULL COMMENT 'Atendimento, quando o volume é de um atendimento só (pasta parcial)',
  local_arquivo_id  BIGINT UNSIGNED NULL COMMENT 'Local de guarda (arquivo, armário)',
  posicao_linha     VARCHAR(10) NULL COMMENT 'Linha no armário ou estante',
  posicao_coluna    VARCHAR(10) NULL COMMENT 'Coluna no armário ou estante',
  identificador_envelope VARCHAR(30) NULL COMMENT 'Envelope ou caixa de guarda externa',
  aberto_em         DATETIME(3) NOT NULL,
  abertura_usuario_id BIGINT UNSIGNED NOT NULL,
  encerrado_em      DATETIME(3) NULL,
  encerramento_usuario_id BIGINT UNSIGNED NULL,
  periodo_inicio    DATE NULL COMMENT 'Data do primeiro documento do volume',
  periodo_fim       DATE NULL COMMENT 'Data do último documento do volume',
  no_local          BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'O volume está no local de guarda (falso quando emprestado ou em trânsito)',
  portador_colaborador_id BIGINT UNSIGNED NULL COMMENT 'Quem está com o volume fora do local',
  enviado_guarda_externa_em DATETIME(3) NULL COMMENT 'Envio à empresa de guarda externa',
  extraviado_em     DATETIME(3) NULL,
  extravio_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem registrou o extravio',
  situacao          VARCHAR(30) NOT NULL DEFAULT 'aberto' COMMENT 'aberto, encerrado, arquivado, emprestado, extraviado ou eliminado',
  observacao        VARCHAR(500) NULL,
  origem            VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em         DATETIME(3) NOT NULL,
  criado_por        BIGINT UNSIGNED NULL,
  alterado_em       DATETIME(3) NULL,
  alterado_por      BIGINT UNSIGNED NULL,
  versao            INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em       DATETIME(3) NULL,
  excluido_por      BIGINT UNSIGNED NULL,
  CONSTRAINT ck_volume_prontuario_situacao CHECK (situacao IN ('aberto','encerrado','arquivado','emprestado','extraviado','eliminado')),
  CONSTRAINT ck_volume_prontuario_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_volume_prontuario_numero CHECK (numero_volume >= 1),
  CONSTRAINT ck_volume_prontuario_encerramento CHECK (encerrado_em IS NULL OR encerrado_em >= aberto_em),
  CONSTRAINT ck_volume_prontuario_periodo CHECK (periodo_fim IS NULL OR periodo_inicio IS NULL OR periodo_fim >= periodo_inicio),
  CONSTRAINT ck_volume_prontuario_extravio CHECK (situacao <> 'extraviado' OR extraviado_em IS NOT NULL),
  UNIQUE KEY uq_volume_prontuario_volume (estabelecimento_id, paciente_id, tipo_documento_arquivo_id, numero_volume),
  UNIQUE KEY uq_volume_prontuario_matricula (estabelecimento_id, numero_matricula),
  KEY ix_volume_prontuario_paciente (paciente_id),
  KEY ix_volume_prontuario_tipo_documento (tipo_documento_arquivo_id),
  KEY ix_volume_prontuario_atendimento (atendimento_id),
  KEY ix_volume_prontuario_local (local_arquivo_id),
  KEY ix_volume_prontuario_abertura_usuario (abertura_usuario_id),
  KEY ix_volume_prontuario_encerramento_usuario (encerramento_usuario_id),
  KEY ix_volume_prontuario_portador (portador_colaborador_id),
  KEY ix_volume_prontuario_extravio_usuario (extravio_usuario_id)
) COMMENT='Volume físico do prontuário do paciente, com número, tipo de documento, local atual e situação';
