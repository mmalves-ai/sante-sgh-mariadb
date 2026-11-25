-- Recepção, contato ativo com o paciente antes da consulta (02-REC linha 39, C2-040, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; a decisão fica no domínio (decidirContato, @sgh/dominio-agenda).
--   - resultado_contato.efeito_marcacao: o que o resultado faz na marcação ligada ao contato (confirmar: a marcação
--     aguardando fica confirmada; cancelar: desistência do paciente, a vaga volta à grade). Nulo: só registra.
--   - padrão da base (o hospital renomeia ou inativa): os resultados de contato mais usados pela central e o motivo de
--     cancelamento "desistência do paciente", usado quando o resultado cancela.
ALTER TABLE resultado_contato
  ADD COLUMN IF NOT EXISTS efeito_marcacao VARCHAR(20) NULL COMMENT 'Efeito na marcação ligada (confirmar, cancelar; nulo: só registra)' AFTER encerra_tentativas;
ALTER TABLE resultado_contato
  ADD CONSTRAINT IF NOT EXISTS ck_resultado_contato_efeito_marcacao CHECK (efeito_marcacao IS NULL OR efeito_marcacao IN ('confirmar','cancelar'));
ALTER TABLE resultado_contato
  ADD CONSTRAINT IF NOT EXISTS ck_resultado_contato_efeito_sucesso CHECK (efeito_marcacao IS NULL OR sucesso = TRUE);

INSERT IGNORE INTO resultado_contato (codigo, descricao, ativo, sucesso, encerra_tentativas, efeito_marcacao, criado_em) VALUES
  ('confirmou', 'Paciente confirmou a consulta', TRUE, TRUE, TRUE, 'confirmar', NOW(3)),
  ('desistiu', 'Paciente desistiu da consulta', TRUE, TRUE, TRUE, 'cancelar', NOW(3)),
  ('atendeu', 'Atendeu (recado dado, sem mudar a consulta)', TRUE, TRUE, TRUE, NULL, NOW(3)),
  ('nao_atendeu', 'Não atendeu', TRUE, FALSE, FALSE, NULL, NOW(3)),
  ('caixa_postal', 'Caixa postal ou recado gravado', TRUE, FALSE, FALSE, NULL, NOW(3)),
  ('numero_errado', 'Número errado ou inexistente', TRUE, FALSE, TRUE, NULL, NOW(3)),
  ('pediu_sem_contato', 'Pediu para não ser contatado', TRUE, TRUE, TRUE, NULL, NOW(3));

INSERT IGNORE INTO motivo_cancelamento_operacao (codigo, descricao, ativo, exige_justificativa, permanece_fila, criado_em) VALUES
  ('desistencia_paciente', 'Desistência do paciente', TRUE, FALSE, FALSE, NOW(3));
