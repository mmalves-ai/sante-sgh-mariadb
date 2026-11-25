-- Operadora, catálogo das críticas automáticas da autorização de guias (F7, 08-SGO linha 103, C2-122, 25/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). As críticas que o domínio calcula no pedido (elegibilidade, segmentação,
-- carência, cobertura parcial temporária, rede e as regras de cobertura do rol) passam a ser gravadas por pedido em
-- critica_pedido_autorizacao, que pede a crítica do cadastro: estas linhas são o cadastro delas (o código é o do
-- domínio, CRITICAS_AUTOMATICAS_CATALOGO). Sem gatilho; nenhuma coluna nova.
INSERT INTO critica_autorizacao (codigo, descricao, ativo, classe, bloqueia_liberacao_automatica, exige_auditoria_medica, criado_em)
SELECT x.codigo, x.descricao, TRUE, x.classe, x.bloqueia, x.medica, NOW(3)
  FROM (SELECT 'beneficiario-inelegivel' AS codigo, 'Beneficiário inelegível na data' AS descricao, 'elegibilidade' AS classe, TRUE AS bloqueia, FALSE AS medica
        UNION ALL SELECT 'produto-nao-e-plano', 'Produto não é plano de saúde', 'cobertura', TRUE, FALSE
        UNION ALL SELECT 'fora-da-segmentacao', 'Fora da segmentação assistencial do plano', 'cobertura', TRUE, TRUE
        UNION ALL SELECT 'obstetricia-a-conferir', 'Cobertura obstétrica a conferir no contrato', 'cobertura', FALSE, TRUE
        UNION ALL SELECT 'em-carencia', 'Beneficiário em carência', 'carencia', TRUE, FALSE
        UNION ALL SELECT 'urgencia-em-carencia', 'Urgência com internação em carência', 'carencia', FALSE, TRUE
        UNION ALL SELECT 'cpt-vigente', 'Cobertura parcial temporária vigente', 'preexistencia', FALSE, TRUE
        UNION ALL SELECT 'prestador-fora-da-rede', 'Prestador fora da rede credenciada', 'rede', TRUE, FALSE
        UNION ALL SELECT 'prestador-sem-regime', 'Prestador sem o regime do atendimento', 'rede', TRUE, FALSE
        UNION ALL SELECT 'rol-sexo-nao-permitido', 'Procedimento não indicado para o sexo', 'cobertura', TRUE, TRUE
        UNION ALL SELECT 'rol-idade-fora-da-faixa', 'Idade fora da faixa da regra do rol', 'cobertura', TRUE, TRUE
        UNION ALL SELECT 'rol-quantidade-acima', 'Quantidade acima do máximo por solicitação', 'limite', TRUE, TRUE
        UNION ALL SELECT 'rol-diretriz-a-conferir', 'Diretriz de utilização a conferir', 'cobertura', FALSE, TRUE
        UNION ALL SELECT 'rol-fora-do-rol', 'Procedimento fora do rol da ANS', 'cobertura', FALSE, TRUE
        UNION ALL SELECT 'rol-exige-junta', 'Procedimento exige junta médica', 'outra', FALSE, TRUE
        UNION ALL SELECT 'rol-exige-pericia', 'Procedimento exige perícia', 'outra', FALSE, TRUE) x
 WHERE NOT EXISTS (SELECT 1 FROM critica_autorizacao c WHERE c.codigo = x.codigo);
