-- Massa SINTÉTICA do E2E com banco (tools/obra/e2e-vm.sh --banco; aplicada pelo tools/obra/e2e_banco.py no cliente
-- descartável, depois das contas sintéticas). C1-026 (07-FIN linha 66): o ciclo do pagamento eletrônico pede o que o
-- produto não cadastra por tela (vem do catálogo oficial ou da carga): o banco com o código de compensação, a conta do
-- estabelecimento nesse banco, o tipo de credor médico, a classificação gerencial e o profissional credor. O título a
-- pagar, a chave Pix, a remessa e o retorno o E2E faz pela API e pela tela. Idempotente; nada de dado real.
INSERT INTO tipo_credor (codigo, descricao, natureza, criado_em)
  SELECT 'medico', 'Médico', 'medico', UTC_TIMESTAMP(3) FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM tipo_credor WHERE codigo = 'medico');
INSERT INTO tipo_documento_financeiro (codigo, descricao, sentido, criado_em)
  SELECT 'recibo', 'Recibo', 'ambos', UTC_TIMESTAMP(3) FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM tipo_documento_financeiro WHERE codigo = 'recibo');
INSERT INTO tipo_lancamento_bancario (codigo, descricao, sentido, transferencia, criado_em)
  SELECT 'pagamento_titulo', 'Pagamento de título', 'debito', FALSE, UTC_TIMESTAMP(3) FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM tipo_lancamento_bancario WHERE codigo = 'pagamento_titulo');
INSERT INTO grupo_natureza_financeira (codigo, nome, tipo, criado_em)
  SELECT '9926', 'GRUPO SINTETICO E2E', 'ambos', UTC_TIMESTAMP(3) FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM grupo_natureza_financeira WHERE codigo = '9926');
INSERT INTO subgrupo_natureza_financeira (grupo_natureza_financeira_id, codigo, descricao, classificacao, criado_em)
  SELECT g.id, '1', 'SUBGRUPO SINTETICO E2E', 'despesa', UTC_TIMESTAMP(3) FROM grupo_natureza_financeira g
   WHERE g.codigo = '9926'
     AND NOT EXISTS (SELECT 1 FROM subgrupo_natureza_financeira s WHERE s.grupo_natureza_financeira_id = g.id AND s.codigo = '1');
INSERT INTO natureza_financeira (codigo, descricao, subgrupo_natureza_financeira_id, tipo, criado_em)
  SELECT '9926.1.1', 'HONORARIO SINTETICO E2E', s.id, 'despesa', UTC_TIMESTAMP(3)
    FROM subgrupo_natureza_financeira s JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
   WHERE g.codigo = '9926' AND s.codigo = '1'
     AND NOT EXISTS (SELECT 1 FROM natureza_financeira WHERE codigo = '9926.1.1');
INSERT INTO banco (codigo_ispb, codigo_compensacao, descricao, vigencia_inicio, versao_fonte, criado_em)
  SELECT '99260001', '926', 'BANCO SINTETICO E2E', '2000-01-01', 'e2e', UTC_TIMESTAMP(3) FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM banco WHERE codigo_ispb = '99260001');
INSERT INTO conta_bancaria (estabelecimento_id, codigo, descricao, tipo, banco_id, numero_agencia, numero_conta, criado_em)
  SELECT e.id, 'E2E-PIX', 'Conta sintética de pagamentos', 'corrente', b.id, 1234, '5678', UTC_TIMESTAMP(3)
    FROM estabelecimento e JOIN banco b ON b.codigo_ispb = '99260001'
   WHERE NOT EXISTS (SELECT 1 FROM conta_bancaria c WHERE c.estabelecimento_id = e.id AND c.codigo = 'E2E-PIX');
INSERT INTO pessoa_fisica (nome, criado_em)
  SELECT 'Profissional Sintético Pix', UTC_TIMESTAMP(3) FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM pessoa_fisica WHERE nome = 'Profissional Sintético Pix');
INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em)
  SELECT pf.id, 'corpo_clinico', UTC_TIMESTAMP(3) FROM pessoa_fisica pf
   WHERE pf.nome = 'Profissional Sintético Pix'
     AND NOT EXISTS (SELECT 1 FROM profissional p WHERE p.pessoa_fisica_id = pf.id);
