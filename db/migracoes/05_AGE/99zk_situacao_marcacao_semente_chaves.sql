-- Recusas da carga (fase 2, K2, C10): situação de marcação 'nao_informada_origem' (significado 'nao_informada',
-- decisão 3), para a marcação migrada sem situação entrar viva em vez de recusada.
-- Espelha db/sementes/05_agenda.json (situacao_marcacao) para o cliente que já existe: a semente em JSON só entra no "criar novo
-- cliente"; esta migração leva o mesmo item ao banco já criado, para o conector achar pelo código. Idempotente e
-- válida em qualquer ordem (ADR 0002): só inclui o código que falta; o que o cliente já tem (editado ou
-- inativado) fica como está.
INSERT INTO situacao_marcacao (codigo, descricao, significado, cor, ordem, criado_em)
  SELECT 'nao_informada_origem', 'Situação não informada na origem', 'nao_informada', '#BDBDBD', 9, UTC_TIMESTAMP(3) FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM situacao_marcacao WHERE codigo = 'nao_informada_origem');
