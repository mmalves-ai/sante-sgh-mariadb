-- Recusas da carga (fase 2, K2, C9): os tributos nativos (IRRF, ISS, PIS, COFINS, CSLL, INSS), para a retenção
-- migrada ligar ao tributo pelo código.
-- Espelha db/sementes/14_financeiro.json (tributo) para o cliente que já existe: a semente em JSON só entra no "criar novo
-- cliente"; esta migração leva o mesmo item ao banco já criado, para o conector achar pelo código. Idempotente e
-- válida em qualquer ordem (ADR 0002): só inclui o código que falta; o que o cliente já tem (editado ou
-- inativado) fica como está.
INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em)
  SELECT 'IRRF', 'Imposto de renda retido na fonte', 'federal', 'por_pagamento', 'retido', UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM tributo WHERE codigo = 'IRRF');
INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em)
  SELECT 'ISS', 'Imposto sobre serviços de qualquer natureza', 'municipal', 'mensal', 'ambos', UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM tributo WHERE codigo = 'ISS');
INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em)
  SELECT 'PIS', 'Contribuição para o PIS/Pasep', 'federal', 'mensal', 'ambos', UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM tributo WHERE codigo = 'PIS');
INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em)
  SELECT 'COFINS', 'Contribuição para o financiamento da seguridade social', 'federal', 'mensal', 'ambos', UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM tributo WHERE codigo = 'COFINS');
INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em)
  SELECT 'CSLL', 'Contribuição social sobre o lucro líquido', 'federal', 'mensal', 'ambos', UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM tributo WHERE codigo = 'CSLL');
INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em)
  SELECT 'INSS', 'Contribuição previdenciária (INSS)', 'federal', 'mensal', 'ambos', UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM tributo WHERE codigo = 'INSS');
