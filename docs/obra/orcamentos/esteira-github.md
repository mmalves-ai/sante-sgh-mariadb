# Orçamento: esteira-github (26/11 23h)

O GitHub ficou vermelho em 801e90b1, 3cbe477a, 5ffc5dbf, 8acaefe1 e 1a5abedb, com a esteira simulada da VM verde em
todos. Causa medida nos logs do GitHub (job verificar, passo verificar:tudo, nx test): (1) api
src/autorizacao/autorizacao.spec.ts, "desempenho: 4.000 opções; em cache por usuário abaixo de 5 ms" deu 6,34 ms no
runner; (2) web src/modulos/plataforma/carga.spec.ts (tela Carga e sincronismo): "leitura que falha com a carga ativa
não para o acompanhamento" expected false to be true, e Unhandled Rejection "Cannot read properties of null (reading
'insertBefore')" do Portal da SanteSelecao depois do teste "iniciar pede confirmação". Os dois dependem de tempo e a VM
(mais rápida) não reproduz. Correção na causa, sem afrouxar o que o teste exige, e a esteira simulada passa a rodar
com 4 CPUs (como o runner do GitHub) para pegar esse tipo de falha antes do push. Um agente.

estimativa_M: 1.5
teto_M: 2
