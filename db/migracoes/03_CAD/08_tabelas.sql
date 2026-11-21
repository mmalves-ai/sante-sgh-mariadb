-- CAD, lote 08 (F2.2 ondas finais, onda 5d; pedido do lote 05-15). Convenções do ADR 0002 (parte 2). Só para frente.

-- 05-15: a leitura incremental do índice de busca (worker) filtra cada cadastro por faixas indexáveis
-- (coluna >= marca, unidas): um índice por coluna de criação e de alteração evita a varredura da tabela inteira.
ALTER TABLE paciente
  ADD KEY ix_paciente_criado_em (criado_em),
  ADD KEY ix_paciente_alterado_em (alterado_em);
ALTER TABLE pessoa_fisica
  ADD KEY ix_pessoa_fisica_criado_em (criado_em),
  ADD KEY ix_pessoa_fisica_alterado_em (alterado_em);
ALTER TABLE profissional
  ADD KEY ix_profissional_criado_em (criado_em),
  ADD KEY ix_profissional_alterado_em (alterado_em);
ALTER TABLE solicitante_externo
  ADD KEY ix_solicitante_externo_criado_em (criado_em),
  ADD KEY ix_solicitante_externo_alterado_em (alterado_em);
