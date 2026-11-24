-- Ficha do eSocial do vínculo no banco próprio (modulos-proprios-2, família folha-executor). Para frente e idempotente.
-- O contrato da porta guarda a ficha do trabalhador para os eventos (S-2200, S-2205, S-2206) inteira e já cifrada pela
-- API (os dados pessoais nunca chegam em claro ao banco); a troca pela versão que a tela leu (trava otimista).
-- Decisão registrada: enquanto o contrato recebe a ficha cifrada inteira, ela fica nesta tabela; o desdobramento no
-- cadastro estruturado (pessoa, endereço, estágio, jornada) pedido no lote p-pessoas-esocial segue como evolução.
CREATE TABLE IF NOT EXISTS ficha_esocial_vinculo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id BIGINT UNSIGNED NOT NULL,
  vinculo_trabalho_id BIGINT UNSIGNED NOT NULL,
  dados_cifrados LONGTEXT NOT NULL COMMENT 'Ficha do trabalhador cifrada pela API (texto); nunca em claro',
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_ficha_esocial_vinculo_dados CHECK (CHAR_LENGTH(dados_cifrados) > 0),
  UNIQUE KEY uq_ficha_esocial_vinculo_vinculo (vinculo_trabalho_id),
  KEY ix_ficha_esocial_vinculo_estabelecimento (estabelecimento_id)
) COMMENT='Ficha do eSocial do vínculo (dados do trabalhador para os eventos), cifrada, com versão';
