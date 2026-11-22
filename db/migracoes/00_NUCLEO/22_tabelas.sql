-- ADR 0004 (armazenamento de arquivos local, sem S3): a chave do arquivo passa a ser o caminho relativo na raiz de
-- arquivos da instalação (ARQUIVOS_RAIZ/<banco do cliente>/<chave>). Só para frente (ADR 0002); só comentários.
ALTER TABLE arquivo
  MODIFY COLUMN chave_armazenamento VARCHAR(512) NOT NULL COMMENT 'Caminho relativo na raiz de arquivos',
  COMMENT = 'Metadado de documento ou anexo binário guardado no armazenamento de arquivos da instalação';
