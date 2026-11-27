-- Decisão 61 (27/11): com os modelos migrados publicados, a lista de modelos do registro clínico conta o uso recente de
-- cada modelo no estabelecimento (modelo + estabelecimento + data de lançamento). Sem índice composto a contagem varria
-- a tabela inteira por modelo (cerca de 20 s por modelo na carga da ProntoCardio, 67 modelos: a rota esgotava o tempo).
-- O índice cobre modelo, estabelecimento e data (excluido_em é conferido na linha). Idempotente.
ALTER TABLE registro_assistencial
  ADD INDEX IF NOT EXISTS ix_registro_assistencial_modelo_uso (modelo_documento_clinico_id, estabelecimento_id, data_hora_lancamento);
