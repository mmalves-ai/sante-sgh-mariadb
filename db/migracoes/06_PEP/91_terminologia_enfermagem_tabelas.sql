-- PEP, terminologias de enfermagem licenciadas por edição (família sae-terminologia, fecho-1, 24/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio (montarEdicaoTerminologia) e na porta.
-- Decisão do orquestrador (fecho-1): NANDA-I, NIC, NOC e CIPE com chave única por sistema + código + edição, nunca só
-- pelo código; o produto traz a estrutura e o carregador versionado da edição licenciada (ADR 0006), sem conteúdo
-- licenciado no repositório. Os catálogos de uso (diagnostico_enfermagem e os demais) seguem únicos pelo código: são o
-- vocabulário ativo do hospital, e a carga da edição só inclui o que falta ou reativa o que estava inativo.
--   - edicao_terminologia_enfermagem: a edição carregada de cada sistema (versão, licença de uso, impressão SHA-256 da
--     carga e contagem), imutável: uma edição carregada não se recarrega nem se apaga;
--   - termo_terminologia_enfermagem: o termo da edição, único por sistema + código + edição, só de acréscimo;
--   - ligacao_termo_enfermagem: o termo ao seu superior na mesma edição (característica e fator ao diagnóstico,
--     atividade à intervenção); a mesma característica em vários diagnósticos é um termo com várias ligações.
--   - descrição dos catálogos de uso alargada para 300 (o que a carga aceita), sem cortar o enunciado. Só alarga.

CREATE TABLE IF NOT EXISTS edicao_terminologia_enfermagem (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sistema            VARCHAR(10) NOT NULL COMMENT 'Sistema de classificação: NANDA-I, NIC, NOC ou CIPE',
  edicao             VARCHAR(30) NOT NULL COMMENT 'Versão da edição carregada',
  pacote             VARCHAR(10) NOT NULL COMMENT 'Pacote da carga: NNN (NANDA-I, NIC e NOC juntos) ou CIPE',
  licenca            VARCHAR(200) NOT NULL COMMENT 'Licença de uso da edição informada na carga',
  hash_sha256        CHAR(64) NOT NULL COMMENT 'Impressão SHA-256 dos termos da carga do pacote',
  total_termos       INT UNSIGNED NOT NULL,
  carregada_em       DATETIME(3) NOT NULL,
  origem             VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em          DATETIME(3) NOT NULL,
  criado_por         BIGINT UNSIGNED NULL,
  alterado_em        DATETIME(3) NULL,
  alterado_por       BIGINT UNSIGNED NULL,
  versao             INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_edicao_terminologia_enfermagem_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_edicao_terminologia_enfermagem_sistema CHECK (
    (pacote = 'NNN' AND sistema IN ('NANDA-I','NIC','NOC')) OR (pacote = 'CIPE' AND sistema = 'CIPE')),
  CONSTRAINT ck_edicao_terminologia_enfermagem_hash CHECK (hash_sha256 REGEXP '^[0-9a-f]{64}$'),
  UNIQUE KEY uq_edicao_terminologia_enfermagem (sistema, edicao),
  KEY ix_edicao_terminologia_enfermagem_pacote (pacote, edicao)
) COMMENT='Edição carregada de uma terminologia de enfermagem licenciada (NANDA-I, NIC, NOC, CIPE), imutável';

CREATE TABLE IF NOT EXISTS termo_terminologia_enfermagem (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sistema            VARCHAR(10) NOT NULL,
  edicao             VARCHAR(30) NOT NULL,
  codigo             VARCHAR(40) NOT NULL COMMENT 'Código do termo no sistema de classificação',
  tipo               VARCHAR(20) NOT NULL,
  descricao          VARCHAR(300) NOT NULL,
  risco              BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Diagnóstico de risco',
  origem             VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em          DATETIME(3) NOT NULL,
  criado_por         BIGINT UNSIGNED NULL,
  alterado_em        DATETIME(3) NULL,
  alterado_por       BIGINT UNSIGNED NULL,
  versao             INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_termo_terminologia_enfermagem_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_termo_terminologia_enfermagem_tipo CHECK (
    tipo IN ('diagnostico','caracteristica','fator','resultado','intervencao','atividade')),
  CONSTRAINT ck_termo_terminologia_enfermagem_risco CHECK (NOT risco OR tipo = 'diagnostico'),
  UNIQUE KEY uq_termo_terminologia_enfermagem (sistema, codigo, edicao),
  KEY ix_termo_terminologia_enfermagem_edicao (sistema, edicao, tipo)
) COMMENT='Termo de uma edição de terminologia de enfermagem, único por sistema, código e edição';

CREATE TABLE IF NOT EXISTS ligacao_termo_enfermagem (
  id                                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  termo_terminologia_enfermagem_id            BIGINT UNSIGNED NOT NULL,
  superior_termo_terminologia_enfermagem_id   BIGINT UNSIGNED NOT NULL COMMENT 'Diagnóstico da característica e do fator; intervenção da atividade',
  origem                                      VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em                                   DATETIME(3) NOT NULL,
  criado_por                                  BIGINT UNSIGNED NULL,
  alterado_em                                 DATETIME(3) NULL,
  alterado_por                                BIGINT UNSIGNED NULL,
  versao                                      INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_ligacao_termo_enfermagem_origem CHECK (origem IN ('sistema','migracao','integracao')),
  CONSTRAINT ck_ligacao_termo_enfermagem_distintos CHECK (termo_terminologia_enfermagem_id <> superior_termo_terminologia_enfermagem_id),
  UNIQUE KEY uq_ligacao_termo_enfermagem (termo_terminologia_enfermagem_id, superior_termo_terminologia_enfermagem_id),
  KEY ix_ligacao_termo_enfermagem_superior (superior_termo_terminologia_enfermagem_id)
) COMMENT='Ligação do termo de enfermagem ao superior na mesma edição';

ALTER TABLE diagnostico_enfermagem
  MODIFY COLUMN descricao VARCHAR(300) NOT NULL COMMENT 'Enunciado do diagnóstico';
ALTER TABLE caracteristica_diagnostico_enfermagem
  MODIFY COLUMN descricao VARCHAR(300) NOT NULL;
ALTER TABLE resultado_enfermagem
  MODIFY COLUMN descricao VARCHAR(300) NOT NULL;
ALTER TABLE intervencao_enfermagem
  MODIFY COLUMN descricao VARCHAR(300) NOT NULL;
