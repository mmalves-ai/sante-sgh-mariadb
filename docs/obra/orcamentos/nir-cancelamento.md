# Orçamento: nir-cancelamento

estimativa_M: 4
teto_M: 5.2

- **Decisão do dono (23/11, 11h15):** pedido e reserva de leito do NIR (núcleo interno de regulação) deixam de ser
  apagados fisicamente: "excluir" vira cancelamento com motivo (quem, quando, por quê), e a linha fica para a
  auditoria. Origem: conflito achado na rodada sbis-16-26 (deleteClinicoProibido marca pedido_leito e reserva_leito
  como clínicas; o anexo de privilégios ainda concedia DELETE nelas; `tx.excluir` em
  apps/api/src/modulos/adt/nir-porta-propria.ts ~959 e ~997).
- **Agentes:** construtor 1 × 1,5 M; revisor só do diff 1 × 0,5 M; conferidor 1 × 1,5 M. Soma 3,5 M × 1,2 = **4 M**;
  teto **5,2 M**.
- **Fora:** cliente_prontocardio (carga em curso): a migração, se houver, entra nele depois da carga.
