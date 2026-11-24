-- Plataforma 0090: contas da plataforma e do suporte técnico, atribuições e auditoria do "login como" (ADR 0021).
-- Decisão do orquestrador (rodada modulos-proprios-1): as contas que entram por /api/plataforma (papel plataforma ou
-- suporte), o segundo fator, o convite, as atribuições por estabelecimento e a auditoria das sessões "como" ficam no
-- banco plataforma, fora dos bancos dos clientes. Resumo da senha em argon2id; o segredo do segundo fator só cifrado
-- com a chave mestra (envelope); o convite só pelo resumo SHA-256. Registro de auditoria nunca é apagado (sem DELETE no
-- código; as FKs são RESTRICT). Sem gatilhos. Idempotente.

CREATE TABLE IF NOT EXISTS conta_plataforma (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email                 VARCHAR(254) NOT NULL COMMENT 'E-mail de entrada (minúsculas)',
  nome                  VARCHAR(150) NULL,
  papel                 VARCHAR(20) NOT NULL COMMENT 'plataforma = acesso total; suporte = só nos estabelecimentos atribuídos',
  ativo                 BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Função ativa; desligada a conta não entra',
  resumo_senha          VARCHAR(255) NULL COMMENT 'Resumo argon2id (PHC); nulo até o convite ser aceito; nunca a senha',
  segredo_segundo_fator VARCHAR(512) NULL COMMENT 'Segredo TOTP cifrado com a chave mestra (envelope); nunca em claro',
  segundo_fator_ativo   BOOLEAN NOT NULL DEFAULT FALSE,
  convite_resumo        CHAR(64) NULL COMMENT 'SHA-256 do token do convite; nunca o token',
  convite_valido_ate    DATETIME(3) NULL,
  criado_em             DATETIME(3) NOT NULL,
  criado_por            BIGINT UNSIGNED NULL,
  alterado_em           DATETIME(3) NULL,
  alterado_por          BIGINT UNSIGNED NULL,
  versao                INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_conta_plataforma_email (email),
  UNIQUE KEY uq_conta_plataforma_convite (convite_resumo),
  CONSTRAINT ck_conta_plataforma_papel CHECK (papel IN ('plataforma','suporte')),
  CONSTRAINT ck_conta_plataforma_argon2id CHECK (resumo_senha IS NULL OR resumo_senha LIKE '$argon2id$%'),
  CONSTRAINT ck_conta_plataforma_segundo_fator CHECK (NOT segundo_fator_ativo OR segredo_segundo_fator IS NOT NULL),
  CONSTRAINT ck_conta_plataforma_convite CHECK (convite_resumo IS NULL OR CAST(convite_resumo AS BINARY) REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_conta_plataforma_email CHECK (email LIKE '_%@_%')
) COMMENT='Conta da plataforma ou do suporte técnico (login próprio por e-mail, segundo fator e convite)';

CREATE TABLE IF NOT EXISTS atribuicao_suporte (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conta_plataforma_id   BIGINT UNSIGNED NOT NULL,
  rede                  VARCHAR(40) NOT NULL COMMENT 'Código da rede',
  estabelecimento       VARCHAR(20) NOT NULL COMMENT 'Código do estabelecimento na rede',
  ativo                 BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Desligada fica no histórico',
  criado_em             DATETIME(3) NOT NULL,
  criado_por            BIGINT UNSIGNED NULL,
  alterado_em           DATETIME(3) NULL,
  alterado_por          BIGINT UNSIGNED NULL,
  versao                INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_atribuicao_suporte_par (conta_plataforma_id, rede, estabelecimento),
  CONSTRAINT fk_atribuicao_suporte_conta FOREIGN KEY (conta_plataforma_id) REFERENCES conta_plataforma (id) ON DELETE RESTRICT
) COMMENT='Estabelecimentos em que a conta de suporte pode entrar como';

CREATE TABLE IF NOT EXISTS conta_plataforma_evento (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ator_conta_id         BIGINT UNSIGNED NULL COMMENT 'Conta que agiu (nulo: desconhecida)',
  evento                VARCHAR(80) NOT NULL,
  conta_alvo_id         BIGINT UNSIGNED NULL,
  detalhe               VARCHAR(2000) NULL,
  estacao               VARCHAR(64) NULL,
  ocorrido_em           DATETIME(3) NOT NULL,
  criado_em             DATETIME(3) NOT NULL,
  criado_por            BIGINT UNSIGNED NULL,
  alterado_em           DATETIME(3) NULL,
  alterado_por          BIGINT UNSIGNED NULL,
  versao                INT UNSIGNED NOT NULL DEFAULT 1,
  KEY ix_conta_plataforma_evento_ocorrido (ocorrido_em),
  CONSTRAINT fk_conta_plataforma_evento_ator FOREIGN KEY (ator_conta_id) REFERENCES conta_plataforma (id) ON DELETE RESTRICT,
  CONSTRAINT fk_conta_plataforma_evento_alvo FOREIGN KEY (conta_alvo_id) REFERENCES conta_plataforma (id) ON DELETE RESTRICT
) COMMENT='Auditoria das contas da plataforma (login, convite, segundo fator, função, atribuições)';

CREATE TABLE IF NOT EXISTS sessao_suporte (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conta_plataforma_id   BIGINT UNSIGNED NOT NULL,
  ator_tipo             VARCHAR(20) NOT NULL,
  rede                  VARCHAR(40) NOT NULL,
  estabelecimento       VARCHAR(20) NOT NULL,
  alvo_login            VARCHAR(80) NOT NULL COMMENT 'Login do usuário do estabelecimento em nome de quem a sessão age',
  alvo_usuario_id       BIGINT UNSIGNED NULL COMMENT 'Id do usuário no banco do cliente (outro banco: sem FK)',
  motivo                VARCHAR(500) NULL,
  modo                  VARCHAR(20) NOT NULL DEFAULT 'como',
  inicio                DATETIME(3) NOT NULL,
  expira_em             DATETIME(3) NOT NULL,
  fim                   DATETIME(3) NULL,
  encerramento          VARCHAR(60) NULL COMMENT 'Motivo do encerramento',
  encerrado_por         BIGINT UNSIGNED NULL,
  estacao               VARCHAR(64) NULL,
  criado_em             DATETIME(3) NOT NULL,
  criado_por            BIGINT UNSIGNED NULL,
  alterado_em           DATETIME(3) NULL,
  alterado_por          BIGINT UNSIGNED NULL,
  versao                INT UNSIGNED NOT NULL DEFAULT 1,
  KEY ix_sessao_suporte_estabelecimento (estabelecimento, inicio),
  KEY ix_sessao_suporte_conta (conta_plataforma_id, inicio),
  CONSTRAINT ck_sessao_suporte_ator_tipo CHECK (ator_tipo IN ('plataforma','suporte')),
  CONSTRAINT ck_sessao_suporte_modo CHECK (modo IN ('como','acesso-total')),
  CONSTRAINT ck_sessao_suporte_prazo CHECK (expira_em > inicio),
  CONSTRAINT ck_sessao_suporte_fim CHECK ((fim IS NULL) = (encerramento IS NULL)),
  CONSTRAINT fk_sessao_suporte_conta FOREIGN KEY (conta_plataforma_id) REFERENCES conta_plataforma (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sessao_suporte_encerrado_por FOREIGN KEY (encerrado_por) REFERENCES conta_plataforma (id) ON DELETE RESTRICT
) COMMENT='Sessão do login como (suporte técnico ou plataforma em nome de um usuário do estabelecimento)';

CREATE TABLE IF NOT EXISTS sessao_suporte_acao (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sessao_suporte_id     BIGINT UNSIGNED NOT NULL,
  metodo                VARCHAR(10) NOT NULL,
  caminho               VARCHAR(2000) NOT NULL,
  situacao              VARCHAR(20) NOT NULL COMMENT 'concluida, erro, bloqueada ou interrompida',
  codigo_http           SMALLINT UNSIGNED NULL,
  clinico               BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Ato clínico (marcado na tela)',
  nao_reversivel        VARCHAR(200) NULL COMMENT 'Por que a escrita não se desfaz (nulo: reversível)',
  ocorrido_em           DATETIME(3) NOT NULL,
  criado_em             DATETIME(3) NOT NULL,
  criado_por            BIGINT UNSIGNED NULL,
  alterado_em           DATETIME(3) NULL,
  alterado_por          BIGINT UNSIGNED NULL,
  versao                INT UNSIGNED NOT NULL DEFAULT 1,
  KEY ix_sessao_suporte_acao_sessao (sessao_suporte_id, id),
  CONSTRAINT ck_sessao_suporte_acao_situacao CHECK (situacao IN ('concluida','erro','bloqueada','interrompida')),
  CONSTRAINT fk_sessao_suporte_acao_sessao FOREIGN KEY (sessao_suporte_id) REFERENCES sessao_suporte (id) ON DELETE RESTRICT
) COMMENT='Cada escrita feita numa sessão do login como, registrada antes do handler';

CREATE TABLE IF NOT EXISTS sessao_suporte_leitura (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sessao_suporte_id     BIGINT UNSIGNED NOT NULL,
  caminho               VARCHAR(700) NOT NULL,
  quantidade            INT UNSIGNED NOT NULL,
  primeira_em           DATETIME(3) NOT NULL,
  ultima_em             DATETIME(3) NOT NULL,
  criado_em             DATETIME(3) NOT NULL,
  criado_por            BIGINT UNSIGNED NULL,
  alterado_em           DATETIME(3) NULL,
  alterado_por          BIGINT UNSIGNED NULL,
  versao                INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_sessao_suporte_leitura_caminho (sessao_suporte_id, caminho),
  CONSTRAINT ck_sessao_suporte_leitura_periodo CHECK (ultima_em >= primeira_em),
  CONSTRAINT fk_sessao_suporte_leitura_sessao FOREIGN KEY (sessao_suporte_id) REFERENCES sessao_suporte (id) ON DELETE RESTRICT
) COMMENT='Leituras de uma sessão do login como, agregadas por caminho';
