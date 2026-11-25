# Fichas funcionais da F3: situação dos marcos

Situação em 24/11/2026, depois da rodada f3-marcos (construtor, revisão adversarial e corretor de cada marco) e do
integrador. As contagens são as da seção Aceite (ou do Resumo) de cada ficha. "Revisão (alta?)" diz se ainda há um
achado alto aberto. Um marco só é aceito com a lista mínima toda coberta (ou cada parcial e falta com destino na F8
e o motivo), o E2E verde e a revisão sem achado alto aberto (ficha da fase, `docs/fases/F3-cobertura-melhorada.md`).

| Marco | Funções | Cobertas | Parciais | Faltam | E2E | Revisão (alta?) | Aceito? |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| [F3.1 Cadastros](F3.1-cadastros.md) | 21 | 14 | 7 | 0 | E2E das funções rodados em 25/11 (lotes 1 e 2, commits 08563660 e 794b92c9): 16 arquivos, 31 testes, 30 verdes; vermelho só f31-regra-campo-abertura (linha 2, tempo esgotado no login) | Não: o caso vermelho de E2E da linha 2 está na ficha | Não |
| [F3.2 Recepção e agenda](F3.2-recepcao-agenda.md) | 15 | 4 | 11 | 0 | E2E das fatias rodados em 25/11 (lotes 1 e 2): f32-atendimento-correcao-indicadores 0 de 2, w1-05 0 de 5, m20 1 de 3, f32-valores-habituais 0 de 2 verdes (param na tela de impressos e na herança); f32-estrutura-recepcao, recepcao e f32-locais-atendimento não rodados | Sim: manutenção de feriado e dia não útil (02-AGE 41) | Não |
| [F3.3 Prontuário](F3.3-prontuario.md) | 35 | 17 | 18 | 0 | Óbito e preceptoria verdes (commit 2328d71b); provas das fatias F3.3-1 a 6 não rodadas (memória) | Sim: receita sem itens estruturados (03-PEP L121) | Não |
| [F3.4 Internação e centro cirúrgico](F3.4-internacao-cc.md) | 22 | 9 | 13 | 0 | @M18 e pré-internação não terminaram (fila da trava pesada) | Sim: equipe cirúrgica por função (04-CC 95) e clínica por letra nos contratos | Não |
| [F3.5 SADT](F3.5-sadt.md) | 17 | 6 | 11 | 0 | 7 de 16 arquivos de E2E verdes (vermelhos: f35-pedido-recoleta, f35-resultado-ciclo, m26, m47-3; não rodados: f35-apoio-remessa, f35-interfaces-equipamento, f35-laudo-estruturado, f35-laudo-redacao, f35-posto-coleta) (integrador, 25/11) | Não: o alto da 2ª via foi corrigido (migração 10_SADT/40) | Não |
| [F3.6 Suprimentos](F3.6-suprimentos.md) | 19 | 8 | 11 | 0 | Integrador 25/11: f36-item-cadastro, f36-local-escopo, f36-separacao, f36-livro-oficial e f36-kit-requisicao verdes; f36.spec.ts 1 de 2 (parâmetros da integração, linha 7, vermelho) | Sim: os dois altos da linha 7 (regra de integração ligada à prescrição; horários padrão unificados) | Não |
| [F3.7 Faturamento](F3.7-faturamento.md) | 40 | 7 | 33 | 0 | @F3.7 e @M31 escritos, não rodados; tsc do marco limpo; 10 contratos de efeito verdes, 6 vermelhos (integrador C, 24/11) | Sim: marcas de texto no contrato da tela (FALTA 5) | Não |
| [F3.8 Financeiro](F3.8-financeiro.md) | 19 | 10 | 9 | 0 | 10 de 13 arquivos de E2E verdes (vermelhos ou não rodados: f38-depara-contabil, f38-financeiro, f38-reinf-eventos) (integrador, 24/11, commit 87854931); tsc e vue-tsc do financeiro limpos | Não | Não |
| [F3.9 Apoio](F3.9-apoio.md) | 67 | 39 | 28 | 0 | @M53.8 não rodado; tsc do marco limpo; 6 contratos de efeito verdes, 6 vermelhos (integrador C, 24/11) | Sim: corrigidos só na ficha (01-ADM L57/L59, 04-HOT L126 a L128, permissões por letra, gravações da qualidade) | Não |
| **Total** | **255** | **114** | **141** | **0** | 1 marco com E2E verde | 7 marcos com achado alto aberto | **0 de 9** |

## Integração (24/11)

- `ciclo_competencia_fonte_pagadora` (F3.7, migração 12_FAT/92) entrou no catálogo. `validar_migracoes.py`: 3.700
  tabelas, 0 erros, 0 gatilhos.
- Artefatos gerados de novo: privilégios por módulo, listas de implantação, imutabilidade e instalação.
- `tiss.spec.ts` lê o resumo pela competência `AAAA-MM`: 10 de 10 verdes.
- Quatro arquivos novos da rodada entraram no `apps/api/tsconfig.migrado.json`: a pré-internação, o gravador dos
  parâmetros da farmácia, a integração da farmácia e o adiantamento.
- **Não rodados:** o tsc dos 157 arquivos de API e pacotes da rodada (`apps/api/tsconfig.f3int-tmp.json`), o
  vue-tsc dos 30 arquivos da web e os E2E. O livre da VM ficou entre 2 e 7 GB das 08h47 às 09h02 por causa da carga
  da ProntoCardio, abaixo dos 10 GB que a trava exige, e a espera passou de 8 minutos.
- Nenhum conflito nos arquivos compartilhados: sem marcadores de conflito e sem entrada repetida no tsconfig migrado.

## O que fica para a próxima rodada

As listas exatas estão na seção Aceite de cada ficha. Em resumo:

- **E2E:** rodar um por vez por `tools/obra/e2e-vm.sh`, com `--grep` @F3.1, @F3.2 (recepção), @M18, @M26, @F3.6,
  @F3.8 e @M53.8. O @F3.7 ainda precisa ser escrito.
- **Achados altos:**
  - F3.1: linha 20;
  - F3.2: 02-AGE 41;
  - F3.3: L121;
  - F3.4: 04-CC 95 e a clínica por id;
  - F3.6: linha 7;
  - F3.7: marcas de texto;
  - F3.9: os quatro grupos de gravação no banco próprio.
- **Testes de integração** listados pelos corretores da F3.1, da F3.7 e da F3.8.
