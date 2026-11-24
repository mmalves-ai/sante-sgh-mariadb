# Orçamento: modulos-proprios-2

estimativa_M: 69.4
teto_M: 90

- **Recontagem medida (24/11, 01h):** restam no banco próprio cerca de 173 métodos pendentes: portal do paciente 20
  (19 leituras e confirmarPagamento), SUS 11 operações de APAC/AIH/retorno e as leituras e montagens dos arquivos
  (CIHA, BPA, APAC, AIH), qualidade 58 (porta-propria 5, gestão o resto), PEP 2 métodos (gravarRegra,
  registrarFicha) e 7 operações do executar de documentos (emitirDocumento, registrarAlergia, inativarAlergia,
  anexarDocumento, lancarExameExterno, solicitarExame, finalizarSumarioAlta), pessoas/folha 41 (cálculo da folha 17
  na porta e 20 no executor, eSocial 1, autoatendimento 3), SAE 7, atendimento 7, cadastro 6, rede 4, acesso
  (recuperação de senha e troca rápida nunca providos; pedido do dono de 23/11: recuperação do administrador da
  plataforma e segundo fator por código no e-mail).
- **Rodada:** 12 famílias em linha de produção (construtor → revisor adversarial → corretor), cada uma em arquivos
  próprios; 2 integradores (grupo A: portal, SUS, qualidade, PEP; grupo B: pessoas, SAE, atendimento, cadastro, rede,
  acesso). Commit só com `git commit --only -- <caminhos>`. Por memória (carga em curso), os agentes rodam só os
  testes dos seus arquivos; suíte inteira, tsc completo e verificar:tudo ficam com o orquestrador depois da carga.
- **Fica de fora (decisão):** suporte `previa`/`corrigir` (correção genérica em qualquer tabela do cliente pede desenho
  próprio; continua 409, falha fechada).
- **Agentes:** 12 construtores × 2,7 M; 12 revisores × 0,6; 12 corretores × 1,1; 2 integradores × 2,5. Soma 57,8 M ×
  1,2 = **69,4 M**; teto **90 M**.
