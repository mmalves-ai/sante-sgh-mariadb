-- Qualidade, reuniões das comissões (família qualidade-q4): limpeza para frente e idempotente (ADR 0002, parte 2).
-- A primeira versão da 99_reuniao_ata repetia a assinatura da ata (18_QUA/23) e a da versão anterior (18_QUA/96) com
-- outros nomes: cada coluna ficava com duas chaves para usuario e a assinatura vigente com dois índices, e o CHECK
-- ck_reuniao_comissao_ata_assinada_texto exigia texto na ata assinada, contra o ck_reuniao_comissao_assinatura da 23,
-- que aceita a ata só em arquivo. Aqui se apagam as repetições nos bancos onde ela rodou; nos demais nada muda.
-- O índice da chave da versão anterior passa a ter o mesmo nome que a 96 cria num banco novo (o antigo some na mesma
-- instrução, para a chave nunca ficar sem índice).
ALTER TABLE reuniao_comissao DROP FOREIGN KEY IF EXISTS fk_reuniao_comissao_ata_assinada_por_usuario_id;
ALTER TABLE reuniao_comissao DROP FOREIGN KEY IF EXISTS fk_reuniao_comissao_assinatura_anterior_por_usuario_id;
ALTER TABLE reuniao_comissao DROP CONSTRAINT IF EXISTS ck_reuniao_comissao_ata_assinada_texto;
ALTER TABLE reuniao_comissao DROP INDEX IF EXISTS ix_reuniao_comissao_ata_assinada_por_usuario;
ALTER TABLE reuniao_comissao
  ADD KEY IF NOT EXISTS fk_reuniao_comissao_assinatura_anterior_por (assinatura_anterior_por_usuario_id),
  DROP INDEX IF EXISTS ix_reuniao_comissao_assinatura_anterior_por_usuario;
