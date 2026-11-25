-- PEP, cadastros mínimos do registro de enfermagem do turno no prontuário (03-PEP L113, C1-023, correção da revisão,
-- 25/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio
-- (dominio-enfermagem/checagem/registro-turno.ts) e a gravação na porta (enfermagem/fechamento-checagem-propria.ts).
-- O fechamento da checagem do turno gera, por paciente, um documento do prontuário lançado e à espera da assinatura do
-- enfermeiro. Todo cliente novo (comando "criar novo cliente") nasce com:
--   - o tipo de documento clínico do registro de enfermagem do turno (categoria 'relatorio', gera pendência de
--     assinatura, não é ordem médica); o cliente pode renomear ou reordenar, nunca é apagado;
--   - a situação "lançado" do documento do prontuário, só quando o cliente ainda não tem uma ativa (a do cliente que
--     já tem cadastro próprio, inclusive a importada, é preservada).
INSERT INTO tipo_documento_clinico
  (codigo, descricao, ativo, categoria, ordem_medica, compoe_prontuario, gera_pendencia, impede_alta, criado_em) VALUES
  ('registro_enfermagem_turno', 'Registro de enfermagem do turno (checagem)', TRUE, 'relatorio', FALSE, TRUE, TRUE, FALSE, NOW(3))
ON DUPLICATE KEY UPDATE codigo = codigo;

INSERT INTO situacao_documento_prontuario (codigo, descricao, ativo, categoria, permite_edicao, final, criado_em)
SELECT 'lancado', 'Lançado, à espera de assinatura', TRUE, 'lancado', FALSE, FALSE, NOW(3) FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE)
ON DUPLICATE KEY UPDATE codigo = codigo;
