-- Operadora, crítica automática do prestador suspenso (F7, 08-SGO linha 101, C2-118, 25/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). A suspensão vigente do prestador inteiro (suspensao_prestador_rede) bloqueia a
-- autorização do pedido em que ele é solicitante ou executante; o código é o do domínio (CRITICAS_AUTOMATICAS_CATALOGO).
-- Sem gatilho; nenhuma coluna nova (o cadastro já traz as colunas de auditoria).
INSERT INTO critica_autorizacao (codigo, descricao, ativo, classe, bloqueia_liberacao_automatica, exige_auditoria_medica, criado_em)
SELECT 'prestador-suspenso', 'Prestador suspenso na rede', TRUE, 'rede', TRUE, FALSE, NOW(3)
 WHERE NOT EXISTS (SELECT 1 FROM critica_autorizacao c WHERE c.codigo = 'prestador-suspenso');
