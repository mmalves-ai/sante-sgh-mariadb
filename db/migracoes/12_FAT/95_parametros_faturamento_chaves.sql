-- FAT, lote 95 (F3.7, 06-FAT linha 38): parâmetros tipados do faturamento no catálogo de parâmetros (parametro_definicao,
-- chave faturamento.<nome>): a rotina diária das contas (ligada e hora de início, no lugar da variável de ambiente), o
-- prazo do recurso de glosa e o dia-limite do fechamento da competência, por rede ou estabelecimento; e as preferências
-- do faturista (faturamento.preferencia.<nome>) só no nível do usuário. Os tipos de documento da alçada do faturamento
-- (tipo_documento_aprovacao fat_*) entram para a alçada por faixa de valor e cargo. Sem tabela nova. Só para frente;
-- idempotente (chaves únicas).
INSERT INTO modulo_sistema (codigo, descricao, ativo, ordem, criado_em)
  SELECT 'faturamento', 'Faturamento', TRUE, 0, CURRENT_TIMESTAMP(3) FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM modulo_sistema WHERE codigo = 'faturamento');
INSERT IGNORE INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, valor_padrao, permite_rede, permite_estabelecimento, permite_unidade, permite_perfil, permite_usuario, critico, obrigatorio, minimo, maximo, formato_expressao, formato_mensagem, area_dona, fundamento, rota_tela, ativo, criado_em)
  SELECT x.chave, m.id, x.descricao, x.tipo, x.padrao, x.rede, x.rede, FALSE, FALSE, x.usuario, FALSE, FALSE, x.minimo, x.maximo, NULL, NULL, x.dono,
         'Ficha F3.7, 06-FAT linha 38 (parâmetros, preferências e alçadas do faturamento)', x.tela, TRUE, CURRENT_TIMESTAMP(3)
  FROM (
    SELECT 'faturamento.rotinaDiaria' AS chave, 'Rotina diária das contas ligada (abre a conta que ficou sem conta e lança a diária do dia de corte)' AS descricao, 'booleano' AS tipo, 'true' AS padrao, NULL AS minimo, NULL AS maximo, TRUE AS rede, FALSE AS usuario, 'faturamento' AS dono, '/administracao/parametros' AS tela
    UNION ALL SELECT 'faturamento.rotinaDiariaHora', 'Hora local a partir da qual a rotina diária das contas roda (0 a 23)', 'inteiro', '0', '0', '23', TRUE, FALSE, 'faturamento', '/administracao/parametros'
    UNION ALL SELECT 'faturamento.prazoRecursoGlosaDias', 'Dias para recorrer da glosa, contados do recebimento do demonstrativo', 'inteiro', '30', '1', '180', TRUE, FALSE, 'faturamento', '/administracao/parametros'
    UNION ALL SELECT 'faturamento.fechamentoDiaLimite', 'Dia do mês seguinte até o qual a competência do convênio deve ser fechada', 'inteiro', '5', '1', '28', TRUE, FALSE, 'faturamento', '/administracao/parametros'
    UNION ALL SELECT 'faturamento.preferencia.telaInicial', 'Tela inicial do faturista no faturamento', 'lista', 'contas', NULL, NULL, FALSE, TRUE, 'faturista', '/faturamento/preferencias'
    UNION ALL SELECT 'faturamento.preferencia.itensPorPagina', 'Itens por página nas listas do faturamento', 'inteiro', '50', '10', '200', FALSE, TRUE, 'faturista', '/faturamento/preferencias'
    UNION ALL SELECT 'faturamento.preferencia.agruparPorPaciente', 'Listas do faturamento agrupadas por paciente', 'booleano', 'true', NULL, NULL, FALSE, TRUE, 'faturista', '/faturamento/preferencias'
  ) x
  JOIN (SELECT MIN(id) AS id FROM modulo_sistema WHERE codigo = 'faturamento') m;
INSERT IGNORE INTO parametro_opcao (parametro_definicao_id, sequencia, valor, rotulo, criado_em)
  SELECT d.id, o.sequencia, o.valor, o.rotulo, CURRENT_TIMESTAMP(3)
  FROM (
    SELECT 1 AS sequencia, 'contas' AS valor, 'Contas' AS rotulo
    UNION ALL SELECT 2, 'worklist', 'Fila de trabalho'
    UNION ALL SELECT 3, 'guias', 'Guias do convênio'
    UNION ALL SELECT 4, 'auditoria', 'Auditoria da conta'
    UNION ALL SELECT 5, 'glosas', 'Glosas'
  ) o
  JOIN parametro_definicao d ON d.chave = 'faturamento.preferencia.telaInicial';
INSERT IGNORE INTO tipo_documento_aprovacao (codigo, descricao, ativo, modulo_sistema_id, entidade, tipo_limite, exige_motivo_recusa, criado_em)
  SELECT x.codigo, x.descricao, TRUE, m.id, x.entidade, 'valor', TRUE, CURRENT_TIMESTAMP(3)
  FROM (
    SELECT 'fat_reabertura_competencia' AS codigo, 'Reabertura da competência com contas apresentadas (valor apresentado)' AS descricao, 'competencia_faturamento' AS entidade
    UNION ALL SELECT 'fat_aceite_glosa', 'Aceite da glosa sem recurso (valor glosado)', 'glosa_item'
    UNION ALL SELECT 'fat_cancelamento_conta', 'Cancelamento da conta do paciente (valor da conta)', 'conta_hospitalar'
  ) x
  JOIN (SELECT MIN(id) AS id FROM modulo_sistema WHERE codigo = 'faturamento') m;
