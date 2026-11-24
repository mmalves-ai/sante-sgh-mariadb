-- SAME pelo volume (F3.9, fatia F3.9-4, 04-HOT L126, 24/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- Sem gatilho; as regras ficam no domínio (@sgh/dominio-hotelaria, same-guarda) e na porta (adt/same-guarda-propria).
--   - operacao_movimento_prontuario: as operações padrão do produto, com códigos de negócio, tipo, sentido e
--     exigências. Todo cliente novo nasce com elas; o de-para dos códigos da origem fica no conector.
--   - ocorrencia_arquivo_prontuario: passa a aceitar o volume como alvo (extravio, descarte e guarda externa do volume
--     sem atendimento). Continua exigindo um alvo: o atendimento ou o volume. Novo tipo 'extravio'.

INSERT INTO operacao_movimento_prontuario
  (codigo, descricao, ativo, tipo, sentido, exige_destino, exige_previsao_retorno, encerra_guarda, criado_em) VALUES
  ('registro', 'Registro no arquivo', TRUE, 'registro', 'entrada', FALSE, FALSE, FALSE, NOW(3)),
  ('saida', 'Saída para setor', TRUE, 'saida', 'saida', TRUE, TRUE, FALSE, NOW(3)),
  ('emprestimo', 'Empréstimo (pesquisa, auditoria, jurídico)', TRUE, 'emprestimo', 'saida', TRUE, TRUE, FALSE, NOW(3)),
  ('devolucao', 'Devolução ao arquivo', TRUE, 'devolucao', 'entrada', FALSE, FALSE, FALSE, NOW(3)),
  ('transferencia', 'Transferência entre setores ou locais', TRUE, 'transferencia', 'neutro', TRUE, FALSE, FALSE, NOW(3)),
  ('recebimento', 'Recebimento no setor de destino', TRUE, 'recebimento', 'neutro', FALSE, FALSE, FALSE, NOW(3)),
  ('descarte', 'Descarte com aval da comissão', TRUE, 'descarte', 'saida', FALSE, FALSE, TRUE, NOW(3))
ON DUPLICATE KEY UPDATE codigo = codigo;

ALTER TABLE ocorrencia_arquivo_prontuario MODIFY COLUMN atendimento_id BIGINT UNSIGNED NULL;
ALTER TABLE ocorrencia_arquivo_prontuario
  ADD COLUMN IF NOT EXISTS volume_prontuario_id BIGINT UNSIGNED NULL COMMENT 'Volume alvo (extravio, descarte, guarda externa)' AFTER movimento_prontuario_id;
ALTER TABLE ocorrencia_arquivo_prontuario ADD INDEX IF NOT EXISTS ix_ocorrencia_arquivo_prontuario_volume (volume_prontuario_id);
ALTER TABLE ocorrencia_arquivo_prontuario DROP CONSTRAINT IF EXISTS ck_ocorrencia_arquivo_prontuario_alvo;
ALTER TABLE ocorrencia_arquivo_prontuario ADD CONSTRAINT ck_ocorrencia_arquivo_prontuario_alvo CHECK (atendimento_id IS NOT NULL OR volume_prontuario_id IS NOT NULL);
ALTER TABLE ocorrencia_arquivo_prontuario DROP CONSTRAINT IF EXISTS ck_ocorrencia_arquivo_prontuario_tipo;
ALTER TABLE ocorrencia_arquivo_prontuario ADD CONSTRAINT ck_ocorrencia_arquivo_prontuario_tipo CHECK (tipo IN ('exclusao','remessa','aceite','cobranca','ocorrencia','descarte','extravio','guarda_externa'));
ALTER TABLE ocorrencia_arquivo_prontuario DROP CONSTRAINT IF EXISTS ck_ocorrencia_arquivo_prontuario_motivo;
ALTER TABLE ocorrencia_arquivo_prontuario ADD CONSTRAINT ck_ocorrencia_arquivo_prontuario_motivo CHECK (tipo NOT IN ('exclusao','descarte','ocorrencia','extravio') OR motivo IS NOT NULL);
