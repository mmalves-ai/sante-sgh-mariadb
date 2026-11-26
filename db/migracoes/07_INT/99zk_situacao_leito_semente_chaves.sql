-- Recusas da carga (fase 2, K2, C8): as 8 situações-base do leito, uma por valor do CHECK de situacao_base, com o
-- efeito no censo (ocupação, ocupado, operacional). Sem elas, o leito migrado era recusado.
-- Espelha db/sementes/07_internacao.json (situacao_leito) para o cliente que já existe: a semente em JSON só entra no "criar novo
-- cliente"; esta migração leva o mesmo item ao banco já criado, para o conector achar pelo código. Idempotente e
-- válida em qualquer ordem (ADR 0002): só inclui o código que falta; o que o cliente já tem (editado ou
-- inativado) fica como está.
INSERT INTO situacao_leito (codigo, descricao, situacao_base, permite_ocupacao, conta_como_ocupado, conta_como_operacional, exige_motivo, cor_exibicao, ordem_exibicao, criado_em)
  SELECT 'livre', 'Livre', 'livre', TRUE, FALSE, TRUE, FALSE, '#388E3C', 1, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM situacao_leito WHERE codigo = 'livre');
INSERT INTO situacao_leito (codigo, descricao, situacao_base, permite_ocupacao, conta_como_ocupado, conta_como_operacional, exige_motivo, cor_exibicao, ordem_exibicao, criado_em)
  SELECT 'ocupado', 'Ocupado', 'ocupado', FALSE, TRUE, TRUE, FALSE, '#D32F2F', 2, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM situacao_leito WHERE codigo = 'ocupado');
INSERT INTO situacao_leito (codigo, descricao, situacao_base, permite_ocupacao, conta_como_ocupado, conta_como_operacional, exige_motivo, cor_exibicao, ordem_exibicao, criado_em)
  SELECT 'reservado', 'Reservado', 'reservado', FALSE, FALSE, TRUE, FALSE, '#1976D2', 3, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM situacao_leito WHERE codigo = 'reservado');
INSERT INTO situacao_leito (codigo, descricao, situacao_base, permite_ocupacao, conta_como_ocupado, conta_como_operacional, exige_motivo, cor_exibicao, ordem_exibicao, criado_em)
  SELECT 'higienizacao', 'Em higienização', 'higienizacao', FALSE, FALSE, TRUE, FALSE, '#F57C00', 4, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM situacao_leito WHERE codigo = 'higienizacao');
INSERT INTO situacao_leito (codigo, descricao, situacao_base, permite_ocupacao, conta_como_ocupado, conta_como_operacional, exige_motivo, cor_exibicao, ordem_exibicao, criado_em)
  SELECT 'interditado', 'Interditado', 'interditado', FALSE, FALSE, FALSE, TRUE, '#616161', 5, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM situacao_leito WHERE codigo = 'interditado');
INSERT INTO situacao_leito (codigo, descricao, situacao_base, permite_ocupacao, conta_como_ocupado, conta_como_operacional, exige_motivo, cor_exibicao, ordem_exibicao, criado_em)
  SELECT 'manutencao', 'Em manutenção', 'manutencao', FALSE, FALSE, FALSE, TRUE, '#795548', 6, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM situacao_leito WHERE codigo = 'manutencao');
INSERT INTO situacao_leito (codigo, descricao, situacao_base, permite_ocupacao, conta_como_ocupado, conta_como_operacional, exige_motivo, cor_exibicao, ordem_exibicao, criado_em)
  SELECT 'bloqueado', 'Bloqueado', 'bloqueado', FALSE, FALSE, FALSE, TRUE, '#9E9E9E', 7, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM situacao_leito WHERE codigo = 'bloqueado');
INSERT INTO situacao_leito (codigo, descricao, situacao_base, permite_ocupacao, conta_como_ocupado, conta_como_operacional, exige_motivo, cor_exibicao, ordem_exibicao, criado_em)
  SELECT 'inativo', 'Inativo', 'inativo', FALSE, FALSE, FALSE, FALSE, '#424242', 8, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM situacao_leito WHERE codigo = 'inativo');
