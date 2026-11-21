-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

CREATE TABLE IF NOT EXISTS ocorrencia_arquivo_prontuario (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  atendimento_id BIGINT UNSIGNED NOT NULL,
  movimento_prontuario_id BIGINT UNSIGNED NULL,
  tipo VARCHAR(20) NOT NULL,
  motivo VARCHAR(500) NULL,
  protocolo VARCHAR(60) NULL,
  prazo_devolucao DATE NULL,
  aval_comissao VARCHAR(200) NULL COMMENT 'Aval da comissão de revisão de prontuários (exigido no descarte)',
  registrado_em DATETIME(3) NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  excluido_em DATETIME(3) NULL,
  excluido_por BIGINT UNSIGNED NULL,
  CONSTRAINT ck_ocorrencia_arquivo_prontuario_tipo CHECK (tipo IN ('exclusao','remessa','aceite','cobranca','ocorrencia','descarte')),
  CONSTRAINT ck_ocorrencia_arquivo_prontuario_motivo CHECK (tipo NOT IN ('exclusao','descarte','ocorrencia') OR motivo IS NOT NULL),
  CONSTRAINT ck_ocorrencia_arquivo_prontuario_descarte CHECK (tipo <> 'descarte' OR aval_comissao IS NOT NULL),
  KEY ix_ocorrencia_arquivo_prontuario_atendimento (atendimento_id, registrado_em),
  KEY ix_ocorrencia_arquivo_prontuario_estabelecimento (estabelecimento_id, tipo),
  KEY ix_ocorrencia_arquivo_prontuario_movimento (movimento_prontuario_id),
  KEY ix_ocorrencia_arquivo_prontuario_usuario (usuario_id)
) COMMENT='Ocorrência do arquivo de prontuários que não é movimento físico do volume: remessa, aceite, cobrança, exclusão e descarte';
