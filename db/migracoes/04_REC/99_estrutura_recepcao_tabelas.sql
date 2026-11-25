-- Recepção, cadastro da estrutura pela tela (F3.2, 02-REC linha 33, 25/11/2026): só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio e na porta.
--   - ordem_botao: a posição do botão do serviço no totem e no balcão (menor aparece antes). Nulo: depois dos
--     posicionados, pelo nome. Não é única: dois botões na mesma posição seguem pelo nome.
ALTER TABLE gerador_senha
  ADD COLUMN IF NOT EXISTS ordem_botao SMALLINT UNSIGNED NULL COMMENT 'Posição do botão no totem e no balcão (menor antes); nulo: pelo nome' AFTER botao_principal;
