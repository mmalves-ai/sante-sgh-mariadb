-- PEP, anexo do prontuário (família pep-resto2, modulos-proprios-3, 24/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho; as regras ficam no domínio e na porta.
--   - anexo_prontuario.arquivo_id deixa de ser único: a porta de armazenamento de arquivos (ADR 0004) endereça o
--     arquivo pelo conteúdo, e o mesmo PDF anexado a outro atendimento ou a outro paciente reaproveita o mesmo registro
--     de `arquivo`. A identidade do anexo é a linha de anexo_prontuario; o índice simples mantém a chave estrangeira.
--     Nenhum valor gravado muda. Registro clínico nunca é apagado (SBIS-26).

ALTER TABLE anexo_prontuario
  ADD KEY IF NOT EXISTS ix_anexo_prontuario_arquivo (arquivo_id);

ALTER TABLE anexo_prontuario
  DROP INDEX IF EXISTS uq_anexo_prontuario_arquivo;
