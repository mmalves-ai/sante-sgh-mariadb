SELECT co_a.chave_original, x.registro, CAST(x.registro AS UNSIGNED)
FROM atendimento_conta ac
JOIN {ctl}.conector_origem co_a ON co_a.tabela_origem = 'ATCABECATEND' AND co_a.id_destino = ac.atendimento_id
  AND co_a.entidade_destino IN ('atendimento', 'externo') AND co_a.excluido_em IS NULL
JOIN (
  SELECT cr.id_destino AS conta_id, SUBSTRING_INDEX(cr.chave_original, '|', 1) AS registro
  FROM {ctl}.conector_origem cr
  WHERE cr.tabela_origem = 'RICONTAS' AND cr.entidade_destino IN ('conta_hospitalar', 'externo')
    AND cr.excluido_em IS NULL
  UNION ALL
  SELECT cf.id_destino, ce.chave_original
  FROM {ctl}.conector_origem cf
  JOIN conta_hospitalar ch ON ch.id = cf.id_destino
  JOIN {ctl}.conector_origem ce ON ce.tabela_origem = 'RECADATE' AND ce.id_destino = ch.atendimento_id
    AND ce.entidade_destino IN ('atendimento', 'externo') AND ce.excluido_em IS NULL
  WHERE cf.tabela_origem = 'FCCTAEXT' AND cf.entidade_destino IN ('conta_hospitalar', 'externo')
    AND cf.excluido_em IS NULL
) x ON x.conta_id = ac.conta_hospitalar_id
WHERE ac.excluido_em IS NULL
GROUP BY co_a.chave_original, x.registro
-- prova de não copiar (ADR 0006, 1) de ATCONTA, linha a linha por PAR (atendimento, registro da conta): o registro
-- é a ficha externa (RECADATE.REG, atendimento da conta externa FCCTAEXT) ou o registro da internação (primeira parte
-- da chave REG|CONTA de RICONTAS). Contas parciais do mesmo registro contam um par só (a origem liga o registro).
