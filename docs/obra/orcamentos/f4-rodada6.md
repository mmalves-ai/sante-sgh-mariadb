# Orçamento: f4-rodada6

estimativa_M: 45
teto_M: 58

- **Objetivo e critério de pronto:** fechar o conector (branch `f4-conector`) para a carga da ProntoCardio.
  - `conferir-fatia-f4.sh` dá ok nas 57 fatias (hoje 20).
  - `conector.sh testes` verde (hoje 21 falhas e 8 erros, todos em testes de fatia).
  - `cobertura_conector.py --falhar-se-bloqueada` passa (hoje 8 bloqueadas).
  - L9 Sincronizar e L10 conciliação no painel, com prova.
- **Diagnóstico feito por script pelo orquestrador** (`/tmp/claude-1000/f4r6/`): as 37 fatias vermelhas se
  agrupam em causas do preparo e do motor da conferência (12 fatias), prova de não copiar (3), cadastros
  compartilhados (hospital, informação clínica da operadora) e ajustes de cada fatia.
- **Agentes por papel** (tabela da seção 6 do plano, medida nas rodadas 4 e 5):
  - compartilhado 1 (preparo e motor da conferência): 1 × 3 M;
  - compartilhado 2 (8 bloqueadas: DDL e mecanismos): 1 × 3 M;
  - verificação por script: 1 × 0,3 M;
  - corretores de 2 fatias: até 15 × 1,3 M = 19,5 M;
  - revisor adversarial do diff dos corretores: 1 × 0,6 M; corretor dos achados: 1 × 1,2 M;
  - conferidor final: 1 × 1,5 M;
  - L9 e L10: 2 × (construir 3 + revisar 0,5 + corrigir 1,2) = 9,4 M.
  - Soma 37,5 M × 1,2 = **45 M**; teto 30% acima = **58 M**.
- **Economia aplicada:** G6 (60/80 ferramentas), lotes de 2 fatias, diagnóstico por script em vez de agente,
  mudança compartilhada primeiro e em sequência, prefixo idêntico ao da rodada 5 (cache), sem retomada de workflow.

## Andamento
- **22/11, 0h10:** a rodada parou no `LIMITE_AGENTES` (32) antes do conferidor final. Gasto até aqui: **cerca de 21,6 M**
  (compartilhado 2 × 2,12 M; fatias 29 × 0,55 M; verificação 0,18 M; 1,3 M da primeira largada derrubada pela rede).
  - **Causa:** o compartilhado 2 (bloqueadas) fechou na G6 sem commit, com o índice das fatias desatualizado. O erro
    global do fatiador deixou as 57 fatias vermelhas na verificação, e o script lançou 29 lotes em vez de cerca de 10.
  - **Efeito:** os lotes saíram baratos (0,55 M cada, 34 turnos), e quase todos corrigiram a parte própria da fatia.
    O gasto ficou dentro do orçamento.
  - **Lição (vale daqui em diante):** antes de abrir lotes por fatia, o script confere os passos globais (verificador do
    mapa e fatiador). Se um deles estiver vermelho, ele corrige primeiro e só depois conta as fatias vermelhas. A trava
    de resultado também passa a olhar `ok`, além de resultado nulo.
  - Bloqueadas: de 8 para 1. O orquestrador regenerou o índice das fatias por script (`fatiar_conector.py`) e roda a
    autoconferência das 57 de novo, antes de lançar o resto.
