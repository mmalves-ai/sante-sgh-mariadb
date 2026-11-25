-- Agenda, retirada da tabela `feriado` (F3.1, 02-CAD linha 28, 25/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho.
-- A 05_AGE/90 copiou o conteúdo de `feriado` para o cadastro único `dia_nao_util`, e desde então nada do produto grava
-- nem lê `feriado`: todos os leitores (agenda de consultas e de exames, acréscimo de feriado da conta, grade da sala
-- cirúrgica, ponto, portal do paciente, prazos da qualidade e SLA do contrato com fornecedor) passam pelo leitor comum
-- `apps/api/src/modulos/agenda/dias-sem-expediente-leitor.ts`, e o mapa do conector leva o calendário da origem direto
-- para `dia_nao_util`. A tabela sai, com as suas chaves. Fica nas chaves (aplicadas depois de todas as tabelas e das
-- chaves do lote 03, que criam as FK de `feriado`), para a cópia da 05_AGE/90 rodar antes num banco novo.
DROP TABLE IF EXISTS feriado;
