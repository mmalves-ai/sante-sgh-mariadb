-- Recusas da carga (fase 2, V-D1): agendamento cirúrgico sem situação na origem (nula, sem par no de-para ou
-- "não informado") entra com a situação 'nao_informada', como a agenda de consultas (decisão do dono de 25/11).
-- Não é acionável: fica fora do mapa do bloco, da fila do dia e do aviso de cirurgia; aparece na consulta e no
-- prontuário e pode ser cancelada ou reagendada pelo usuário. A mesma lista está em 01_tabelas.sql e 04_tabelas.sql
-- (iguais de propósito: o aplicador reaplica todos os arquivos, e o último a rodar não pode tirar um valor em uso).
-- Idempotente e válida em qualquer ordem (ADR 0002): DROP CONSTRAINT IF EXISTS antes de recriar.
ALTER TABLE agendamento_cirurgico
  DROP CONSTRAINT IF EXISTS ck_agendamento_cirurgico_situacao;
ALTER TABLE agendamento_cirurgico
  ADD CONSTRAINT ck_agendamento_cirurgico_situacao CHECK (situacao IN ('solicitado','em_analise','reprovado','agendado','confirmado','no_bloco','em_andamento','realizado','suspenso','cancelado','nao_informada'));
