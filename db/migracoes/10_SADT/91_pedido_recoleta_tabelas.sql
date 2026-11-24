-- SADT, pedido de exames e recoleta no banco do cliente (F3.5, 05-SADT linhas 4 e 7; 24/11/2026). Só para frente e
-- idempotente (ADR 0002, parte 2); nenhuma tabela nova.
-- 1. A numeração da requisição de exames e da recoleta de cada estabelecimento (as mesmas que
--    tools/db/configurar_numeracoes.py inclui no "criar novo cliente" e a cada estabelecimento novo), semeada para os
--    clientes já criados: a gravação só lê e trava a linha. Começa depois do maior número inteiro já gravado.
INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, incremento, ativo, criado_em, versao)
SELECT e.id, 'requisicao_exame',
       COALESCE((SELECT MAX(CAST(r.numero AS UNSIGNED)) FROM requisicao_exame r
                  WHERE r.estabelecimento_id = e.id AND r.numero REGEXP '^[0-9]{1,18}$'), 0) + 1,
       1, TRUE, UTC_TIMESTAMP(3), 1
  FROM estabelecimento e
 WHERE e.excluido_em IS NULL
   AND NOT EXISTS (SELECT 1 FROM sequencia_negocio s WHERE s.estabelecimento_id = e.id AND s.tipo = 'requisicao_exame');

INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, incremento, ativo, criado_em, versao)
SELECT e.id, 'nova_coleta',
       COALESCE((SELECT MAX(CAST(n.numero AS UNSIGNED)) FROM nova_coleta n
                  WHERE n.estabelecimento_id = e.id AND n.numero REGEXP '^[0-9]{1,18}$'), 0) + 1,
       1, TRUE, UTC_TIMESTAMP(3), 1
  FROM estabelecimento e
 WHERE e.excluido_em IS NULL
   AND NOT EXISTS (SELECT 1 FROM sequencia_negocio s WHERE s.estabelecimento_id = e.id AND s.tipo = 'nova_coleta');

-- 2. Os motivos de partida do cancelamento do exame e da recoleta (o hospital edita, desativa e inclui os seus pelo
--    cadastro; o código não se repete). Só entram os que faltam.
INSERT INTO motivo_cancelamento_item_exame (codigo, descricao, ativo, aplica_a, remove_da_conta, exige_nova_coleta, exige_complemento, criado_em, versao)
SELECT x.codigo, x.descricao, TRUE, 'exame', x.remove, FALSE, x.complemento, UTC_TIMESTAMP(3), 1
  FROM (SELECT 'PEDIDO_DUPLICADO' AS codigo, 'Pedido em duplicidade' AS descricao, TRUE AS remove, FALSE AS complemento
        UNION ALL SELECT 'SUSPENSO_MEDICO', 'Suspenso pelo médico solicitante', TRUE, FALSE
        UNION ALL SELECT 'PACIENTE_RECUSOU', 'Paciente recusou o exame', TRUE, FALSE
        UNION ALL SELECT 'ALTA_OU_TRANSFERENCIA', 'Alta ou transferência antes da realização', TRUE, FALSE
        UNION ALL SELECT 'OUTRO', 'Outro motivo (descrever)', TRUE, TRUE) x
 WHERE NOT EXISTS (SELECT 1 FROM motivo_cancelamento_item_exame m WHERE m.codigo = x.codigo);

INSERT INTO motivo_nova_coleta (codigo, descricao, ativo, gera_nova_amostra, responsabilidade, conta_indicador_qualidade, criado_em, versao)
SELECT x.codigo, x.descricao, TRUE, TRUE, x.resp, TRUE, UTC_TIMESTAMP(3), 1
  FROM (SELECT 'HEMOLISE' AS codigo, 'Amostra hemolisada' AS descricao, 'coleta' AS resp
        UNION ALL SELECT 'COAGULADA', 'Amostra coagulada', 'coleta'
        UNION ALL SELECT 'VOLUME_INSUFICIENTE', 'Volume insuficiente', 'coleta'
        UNION ALL SELECT 'IDENTIFICACAO', 'Erro de identificação da amostra', 'coleta'
        UNION ALL SELECT 'TRANSPORTE', 'Acondicionamento ou transporte inadequado', 'transporte'
        UNION ALL SELECT 'RESULTADO_INCOMPATIVEL', 'Resultado incompatível com a clínica', 'laboratorio') x
 WHERE NOT EXISTS (SELECT 1 FROM motivo_nova_coleta m WHERE m.codigo = x.codigo);
