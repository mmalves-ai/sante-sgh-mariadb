# Plano de redução de tokens (dono, 25/11 23h59): no mínimo 50% a menos

## Medida do dia (medir_consumo.py, sessão da obra)

| Papel | Agentes | Total | Parte | Por agente |
|---|---:|---:|---:|---:|
| construir | 716 | 1.205 M | 56% | 1,68 M |
| corrigir | 453 | 546 M | 25% | 1,20 M |
| revisar | 417 | 169 M | 8% | 0,41 M |
| completar | 139 | 138 M | 6% | 1,00 M |
| integração (integrar, e2e, ficha) | 81 | 60 M | 3% | — |
| orquestrador | 1 | 87 M | — | 2.154 turnos |

Custo por função pronta: ~3,3 M na construção (construtor 1,7 + revisor 0,4 + corretor 1,2 quase sempre) e ~2,3 M na
rodada de completar. Desperdício medido: ~25 M em rodadas de E2E que caíram sem rodar teste; ~57 de 64 construtores
saíram sem commit com 14 agentes (disputa); o custo de um agente cresce com o número de turnos (o contexto relido a cada
turno), e os construtores usaram ~100 turnos.

## O que muda (vale para toda rodada lançada daqui em diante)

1. **Revisor que corrige** (corta ~60% do par revisar + corrigir, 33% do gasto): um agente lê o diff, procura o defeito
   real com as mesmas lentes adversariais e corrige na hora; o corretor separado só entra se o revisor-corretor não
   fechar. A independência continua: quem revisa não é quem construiu, e o E2E da integração confere de novo.
2. **Turnos curtos**: meta de 25 e fechamento aos 40 ferramentas (commit do que está pronto e devolução da pendência),
   abaixo do G6 de 60. Função grande em duas etapas fixas: domínio e API; depois tela e E2E (a etapa de completar já
   provou ~1 M por agente contra 1,7 M do construtor).
3. **Saída e leitura enxutas** no PREFIXO (já na completar-1 a 3): saída de teste filtrada, leitura por trecho,
   comandos juntos, sem reler, sem repetir prova.
4. **Nada de rodada que cai sem testar**: `tools/obra/preflight-e2e.sh` (build, API respondendo, specs carregando) antes de
   todo lote de E2E; o corretor do E2E recebe só o teste vermelho e o trecho do erro, extraídos por script.
5. **Sem retentativa de baixo rendimento**: função que voltou parcial duas vezes (dependência de outro módulo, decisão,
   peça externa) sai da fila e vai para a lista de pendências, em vez de um terceiro agente.
6. **Orquestrador**: relatório de 50 minutos por `tools/obra/relatorio-50.py` (um comando, cadência por janela); nada de
   investigação manual longa: falha de build ou de esteira vai a um agente com o erro já extraído; meta de 60% menos
   turnos por hora.
7. **Concorrência**: até 4 agentes de construção ou completar ao mesmo tempo (a disputa acima disso derruba o
   rendimento e gera perda de trabalho em arquivo compartilhado).

## Meta e medida

Custo por função pronta de ~3,3 M para ~1,5 M (−55%); cadência de ~50 M/h para ~22 M/h. Medido em cada relatório de 50
minutos pela janela do relatorio-50.py; se a qualidade cair (E2E vermelho por defeito real que a revisão deixou passar),
a regra que causou é desfeita (plano, regra 5).
