-- FIN, lote 14: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L8-10 (2): titulo_pagar
ALTER TABLE titulo_pagar
  ADD CONSTRAINT fk_titulo_pagar_grupo_lancamento_financeiro_id FOREIGN KEY (grupo_lancamento_financeiro_id) REFERENCES grupo_lancamento_financeiro (id) ON DELETE RESTRICT;

-- L8-10 (2): titulo_receber
ALTER TABLE titulo_receber
  ADD CONSTRAINT fk_titulo_receber_grupo_lancamento_financeiro_id FOREIGN KEY (grupo_lancamento_financeiro_id) REFERENCES grupo_lancamento_financeiro (id) ON DELETE RESTRICT;

-- L8-10 (2): movimento_bancario
ALTER TABLE movimento_bancario
  ADD CONSTRAINT fk_movimento_bancario_grupo_lancamento_financeiro_id FOREIGN KEY (grupo_lancamento_financeiro_id) REFERENCES grupo_lancamento_financeiro (id) ON DELETE RESTRICT;

-- L8-10 (2): adiantamento
ALTER TABLE adiantamento
  ADD CONSTRAINT fk_adiantamento_grupo_lancamento_financeiro_id FOREIGN KEY (grupo_lancamento_financeiro_id) REFERENCES grupo_lancamento_financeiro (id) ON DELETE RESTRICT;

-- L8-11 (15) e L8-12 (5): parâmetros do financeiro por estabelecimento no catálogo tipado do produto (semente idempotente)
INSERT INTO modulo_sistema (codigo, descricao, ativo, ordem, criado_em)
  SELECT 'financeiro', 'Financeiro', TRUE, 0, CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'financeiro');
INSERT IGNORE INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, permite_rede, permite_estabelecimento, permite_unidade, permite_perfil, permite_usuario, critico, obrigatorio, minimo, area_dona, ativo, criado_em)
  SELECT x.chave, m.id, x.descricao, x.tipo, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, x.minimo, 'financeiro', TRUE, CURRENT_TIMESTAMP(3)
  FROM (
    SELECT 'financeiro.centroCustoPadraoCreditoPagar' AS chave, 'Centro de custo padrão do crédito a pagar (id do centro de custo)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.centroCustoPadraoBancoPagar' AS chave, 'Centro de custo padrão do banco a pagar (id do centro de custo)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.centroCustoPadraoDevedorReceber' AS chave, 'Centro de custo padrão do devedor a receber (id do centro de custo)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.centroCustoPadraoBancoReceber' AS chave, 'Centro de custo padrão do banco a receber (id do centro de custo)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.centroCustoPadraoGlosa' AS chave, 'Centro de custo padrão da glosa (id do centro de custo)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.tipoAjustePadraoGlosa' AS chave, 'Tipo de ajuste padrão da glosa (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.tipoAjustePadraoAcrescimo' AS chave, 'Tipo de ajuste padrão do acréscimo (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.tipoAjustePadraoDesconto' AS chave, 'Tipo de ajuste padrão do desconto (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.tipoAjustePadraoAdiantamento' AS chave, 'Tipo de ajuste padrão do adiantamento (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.tipoAjustePadraoChequeCompensado' AS chave, 'Tipo de ajuste padrão do cheque compensado (id)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.diasAlertaVencimento' AS chave, 'Dias de antecedência do alerta de vencimento' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.diasVencimentoPadrao' AS chave, 'Quantidade de dias do vencimento padrão' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.mesesConsulta' AS chave, 'Meses de consulta nas telas do financeiro' AS descricao, 'inteiro' AS tipo, 0 AS minimo
    UNION ALL SELECT 'financeiro.formaPagamentoObrigatoria' AS chave, 'Forma de pagamento obrigatória no título' AS descricao, 'booleano' AS tipo, NULL AS minimo
    UNION ALL SELECT 'financeiro.usaEmpenho' AS chave, 'Usa empenho nas despesas' AS descricao, 'booleano' AS tipo, NULL AS minimo
    UNION ALL SELECT 'financeiro.restringeContaBancariaPorUsuario' AS chave, 'Restringe as contas bancárias aos usuários com permissão' AS descricao, 'booleano' AS tipo, NULL AS minimo
    UNION ALL SELECT 'financeiro.naturezaFinanceiraPadrao' AS chave, 'Natureza financeira padrão (id da natureza financeira)' AS descricao, 'inteiro' AS tipo, 0 AS minimo
  ) x
  JOIN (SELECT MIN(id) AS id FROM modulo_sistema WHERE codigo = 'financeiro') m;

-- L8-05 (9), parte: filtros por tipo de conta e de lançamento (tipo de ato e subtipo da diária a detalhar)
ALTER TABLE depara_conta_externa
  ADD CONSTRAINT fk_depara_conta_externa_tipo_conta_id FOREIGN KEY (tipo_conta_id) REFERENCES tipo_conta (id) ON DELETE RESTRICT;
ALTER TABLE depara_conta_externa
  ADD CONSTRAINT fk_depara_conta_externa_tipo_lancamento_id FOREIGN KEY (tipo_lancamento_id) REFERENCES tipo_lancamento (id) ON DELETE RESTRICT;
