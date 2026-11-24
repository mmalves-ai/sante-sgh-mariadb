-- Qualidade, gestão no banco próprio (modulos-proprios-1, família qualidade-b, 23/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2).
-- Envio regulatório: o arquivo do envio é gerado na hora a partir dos dados da competência e devolvido à tela (com o
-- resumo SHA-256 gravado para a conferência da transmissão); ele não é guardado no armazenamento. A chave do objeto
-- passa a opcional: preenchida só quando o arquivo for de fato guardado (ADR 0004), nunca com valor inventado.
ALTER TABLE envio_regulatorio_qualidade
  MODIFY COLUMN chave_objeto VARCHAR(500) NULL COMMENT 'Chave do arquivo no armazenamento, quando guardado';
