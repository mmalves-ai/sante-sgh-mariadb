-- Centro cirúrgico, tipo de documento assinável da descrição cirúrgica e do adendo (04-CC linha 96, C2-019, correção
-- da revisão, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio e na
-- operação (apps/api/src/modulos/cirurgia/descricao-cirurgica-operacoes.ts).
-- A descrição assinada e cada adendo entram no prontuário como documento do cirurgião. Para a fila de assinaturas com
-- certificado ICP-Brasil (CFM 1.821/2007 e 2.299/2021, SBIS NGS2) reconhecer o documento, o tipo precisa ter o código
-- de negócio que ela conhece ('registro-clinico'). Todo cliente (o novo, pelo comando "criar novo cliente", e o
-- importado, cujo tipo de origem guarda outro código) passa a ter:
--   - o tipo 'registro-clinico' (categoria registro cirúrgico, gera pendência de assinatura, não é ordem médica), só
--     quando o cliente ainda não tem esse código; o do cliente que já tem é preservado como está;
--   - a situação "lançado" do documento do prontuário, só quando o cliente ainda não tem uma ativa.
-- Se a assinatura com certificado é exigida continua decisão do estabelecimento, pela política de assinatura do tipo.
INSERT INTO tipo_documento_clinico
  (codigo, descricao, ativo, categoria, ordem_medica, compoe_prontuario, gera_pendencia, impede_alta, criado_em) VALUES
  ('registro-clinico', 'Registro clínico (descrição cirúrgica e adendo)', TRUE, 'registro_cirurgico', FALSE, TRUE, TRUE,
   FALSE, NOW(3))
ON DUPLICATE KEY UPDATE codigo = codigo;

INSERT INTO situacao_documento_prontuario (codigo, descricao, ativo, categoria, permite_edicao, final, criado_em)
SELECT 'lancado', 'Lançado, à espera de assinatura', TRUE, 'lancado', FALSE, FALSE, NOW(3) FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE)
ON DUPLICATE KEY UPDATE codigo = codigo;
