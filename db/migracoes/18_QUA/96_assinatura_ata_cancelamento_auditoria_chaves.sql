-- Qualidade, gestão no banco próprio (modulos-proprios-3, família qualidade-q1): a assinatura da ata não cria chave
-- nova (a de ata_assinada_por_usuario_id é a fk_reuniao_comissao_ata_assinada_por da 18_QUA/23; a de
-- assinatura_anterior_por_usuario_id é da 18_QUA/99_reuniao_ata). Só para frente e idempotente: retira a chave repetida
-- sobre assinatura_anterior_por_usuario_id que a primeira versão desta migração criou nos bancos de teste.
ALTER TABLE reuniao_comissao DROP FOREIGN KEY IF EXISTS fk_reuniao_comissao_assinatura_anterior_por;
