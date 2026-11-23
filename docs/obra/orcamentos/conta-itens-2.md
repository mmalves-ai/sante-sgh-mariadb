# Orçamento: conta-itens-2

estimativa_M: 9
teto_M: 12

- **Prova da conta-itens (23/11, 2h33):** itens da conta 5.278 -> 18.241 no recorte, produção de repasse 0 -> 179,
  recusas por CHECK de glosa 12.963 -> 0. Sobra: FCLANEXT TIPO 4 (material e medicamento) com 6.776 recusas 1048 em
  item_faturavel_id; TBMATMED 20.000 `licenca_nao_comprovada` (tabelas com marca Brasíndice/Simpro, puladas de
  propósito pelo ADR 0006, 3). Na origem real: FCLANEXT 4,32 milhões, TBMATMED 910 mil.
- **Desenho decidido pelo orquestrador (ADR 0006):** item de tabela licenciada liga ao item do ESPELHO pelo código e
  edição (o conector só liga, nunca traz o conteúdo); item de tabela própria entra como item próprio ativo; os dois
  viram item faturável e o item da conta grava.
- **Repasse por grupo de ato:** TBREPGER.ATO e TBPACTHM.ATO são grupo de ato; coluna nova
  regra_repasse_item.grupo_ato_id (migração só para frente, 12_FAT) e domínio do repasse lendo o grupo.
- **Agentes:** compartilhado (DDL + domínio) 1 × 2 M; matmed 1 × 2,5 M; revisões 2 × 0,5 M; conferidor 2,5 M.
  Soma 8 M × 1,15 = **9 M**; teto 30% acima = **12 M**.
