# Orçamento: regressao-w0-10b (27/11 09h)

A regressao-w0-10 passou do teto (1,5 M) com 3 agentes: cada correção revela a próxima falha do mesmo E2E longo
(w0-10-medico, portal do médico externo). Estado em 6b18fddb (sem push): crítico verde; assinatura avançou (certificado
em nuvem aparece, falta a fila: pm-ass-880005); o autocadastro (linha ~214/360) voltou a falhar: a tela interna de contas
(pmi-conta-77010) mostra o portal do médico externo, sinal de sessão trocada — suspeita: o módulo assinatura virou
global: true e o SERVICO_LOGIN_CERTIFICADO passou a ser injetado no AcessoController. Otimização: um agente, ordem fixa:
(1) isolar a regressão do autocadastro e, se for o global, ligar o serviço só no portal (sem global); (2) a fila da
assinatura. Sem push de 6b18fddb antes disso.

estimativa_M: 1
teto_M: 1.5
