-- Obrigações da folha no banco próprio (modulos-proprios-3, família folha-obrigacoes): a obrigação gerada pelo cálculo
-- (FGTS Digital, SEFIP, CAGED e RAIS) guarda o leiaute usado e se ele foi conferido, os totais apurados, a guia e os
-- acréscimos informados na entrega e o motivo da troca de situação (cancelamento). Para frente e idempotente.
-- O arquivo gerado (já cifrado) fica no armazenamento de arquivos da instalação (tabela `arquivo`, ADR 0004), ligado
-- por obrigacao_trabalhista.arquivo_id; o resumo SHA-256 e o tamanho ficam em arquivo_obrigacao (sequência 1); os
-- fechamentos usados, em obrigacao_fechamento. Quem gerou e quem trocou a situação vêm da auditoria (criado_por e
-- alterado_por).

ALTER TABLE obrigacao_trabalhista
  ADD COLUMN IF NOT EXISTS leiaute VARCHAR(20) NULL COMMENT 'Versão do leiaute oficial do arquivo gerado',
  ADD COLUMN IF NOT EXISTS leiaute_conferido BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O leiaute foi conferido contra a publicação oficial',
  ADD COLUMN IF NOT EXISTS totais LONGTEXT NULL COMMENT 'Totais apurados da obrigação (JSON: trabalhadores, remuneração, FGTS, movimentações)',
  ADD COLUMN IF NOT EXISTS valor_guia DECIMAL(15,2) NULL COMMENT 'Valor da guia emitida na entrega (FGTS Digital)',
  ADD COLUMN IF NOT EXISTS acrescimos DECIMAL(15,2) NULL COMMENT 'Juros e multa de atraso informados na entrega',
  ADD COLUMN IF NOT EXISTS motivo_situacao VARCHAR(400) NULL COMMENT 'Motivo da troca de situação (cancelamento)';
ALTER TABLE obrigacao_trabalhista
  DROP CONSTRAINT IF EXISTS ck_obrigacao_trabalhista_totais,
  ADD CONSTRAINT ck_obrigacao_trabalhista_totais CHECK (totais IS NULL OR JSON_VALID(totais)),
  DROP CONSTRAINT IF EXISTS ck_obrigacao_trabalhista_valores_entrega,
  ADD CONSTRAINT ck_obrigacao_trabalhista_valores_entrega CHECK ((valor_guia IS NULL OR valor_guia >= 0) AND (acrescimos IS NULL OR acrescimos >= 0));
