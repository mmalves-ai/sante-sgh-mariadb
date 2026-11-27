# Fichas funcionais da F3: situação dos marcos

Situação em 24/11/2026, depois da rodada f3-marcos (construtor, revisão adversarial e corretor de cada marco) e do
integrador. As contagens são as da seção Aceite (ou do Resumo) de cada ficha. "Revisão (alta?)" diz se ainda há um
achado alto aberto. Um marco só é aceito com a lista mínima toda coberta (ou cada parcial e falta com destino na F8
e o motivo), o E2E verde e a revisão sem achado alto aberto (ficha da fase, `docs/fases/F3-cobertura-melhorada.md`).

| Marco | Funções | Cobertas | Parciais | Faltam | E2E | Revisão (alta?) | Aceito? |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| [F3.1 Cadastros](F3.1-cadastros.md) | 21 | 21 | 0 | 0 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 0 de 1 funções Parciais com E2E verde viraram Coberta | Não: o caso vermelho de E2E da linha 2 está na ficha | Não |
| [F3.2 Recepção e agenda](F3.2-recepcao-agenda.md) | 15 | 12 | 3 | 0 | integrar-3 (26/11, lotes 1 e 2 do grupo B): 3 de 6 arquivos de E2E verdes; vermelhos: f32-atendimento-correcao-indicadores, w1-05; não rodados: c1-101-sem-prontuario; 1 de 3 funções da construir-2 passaram a cobertas | Sim: manutenção de feriado e dia não útil (02-AGE 41) | Não |
| [F3.3 Prontuário](F3.3-prontuario.md) | 35 | 33 | 2 | 0 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 1 de 4 funções Parciais com E2E verde viraram Coberta | Sim: receita sem itens estruturados (03-PEP L121) | Não |
| [F3.4 Internação e centro cirúrgico](F3.4-internacao-cc.md) | 21 | 21 | 0 | 0 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 4 de 5 funções Parciais com E2E verde viraram Coberta | Sim: equipe cirúrgica por função (04-CC 95) e clínica por letra nos contratos | Não |
| [F3.5 SADT](F3.5-sadt.md) | 17 | 16 | 1 | 0 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 1 de 4 funções Parciais com E2E verde viraram Coberta | Não: o alto da 2ª via foi corrigido (migração 10_SADT/40) | Não |
| [F3.6 Suprimentos](F3.6-suprimentos.md) | 19 | 19 | 0 | 0 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 2 de 3 funções Parciais com E2E verde viraram Coberta | Sim: os dois altos da linha 7 (regra de integração ligada à prescrição; horários padrão unificados) | Não |
| [F3.7 Faturamento](F3.7-faturamento.md) | 40 | 37 | 3 | 0 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 6 de 11 funções Parciais com E2E verde viraram Coberta | Sim: marcas de texto no contrato da tela (FALTA 5) | Não |
| [F3.8 Financeiro](F3.8-financeiro.md) | 19 | 18 | 1 | 0 | integrar-3 (26/11, lote 1 do grupo A; o lote 2 não gerou resultado): 1 de 3 arquivos de E2E verdes; não rodados: c1-026-conta-credor-profissional, f38-pagamento-eletronico; 1 de 2 funções da construir-2 passaram a cobertas | Não | Não |
| [F3.9 Apoio](F3.9-apoio.md) | 67 | 62 | 5 | 0 | integrar-3 (26/11, grupo C, funções da construir-3 e E2E do lote final, commit e8a7bd44): 5 de 6 arquivos de E2E verdes; não rodados: c3-007-elegibilidade-do-atendimento; 4 de 5 funções da construir-2 e da construir-3 cobertas | Sim: corrigidos só na ficha (01-ADM L57/L59, 04-HOT L126 a L128, permissões por letra, gravações da qualidade) | Não |
| **Total** | **254** | **239** | **15** | **0** | 1 marco com E2E verde | 7 marcos com achado alto aberto | **0 de 9** |

## Fichas F7 e F8 (F78)

Situação recontada por script na integrar-1, grupo C (25/11), pelas linhas de cada ficha `F78-*.md` (coluna Fase). Colunas F7 e F8: cobertas/parciais/faltam.

| Ficha | Linhas | F7 (cob/par/falta) | F8 (cob/par/falta) | Cobertas | E2E |
| --- | ---: | ---: | ---: | ---: | --- |
| [01 Administração, segurança e BI](F78-01-administracao.md) | 10 | 1/1/0 | 8/0/0 | 9 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 1 de 1 funções Parciais com E2E verde viraram Coberta |
| [02 Cadastro, recepção e agenda](F78-02-cadastro-recepcao-agenda.md) | 19 | 4/1/0 | 13/1/0 | 17 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 3 de 4 funções Parciais com E2E verde viraram Coberta |
| [03 Prontuário](F78-03-prontuario.md) | 23 | 8/0/0 | 15/0/0 | 23 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 2 de 4 funções Parciais com E2E verde viraram Coberta |
| [04 Internação, centro cirúrgico e hotelaria](F78-04-internacao-cc-hotelaria.md) | 33 | 17/0/0 | 16/0/0 | 33 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 3 de 4 funções Parciais com E2E verde viraram Coberta |
| [05 Diagnóstico e suprimentos](F78-05-diagnostico-suprimentos.md) | 19 | 10/0/0 | 9/0/0 | 19 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 3 de 5 funções Parciais com E2E verde viraram Coberta |
| [06 Faturamento](F78-06-faturamento.md) | 24 | 13/2/0 | 9/0/0 | 22 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 0 de 5 funções Parciais com E2E verde viraram Coberta |
| [07 Financeiro e pessoas](F78-07-financeiro-pessoas.md) | 42 | 24/2/0 | 16/0/0 | 40 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 8 de 10 funções Parciais com E2E verde viraram Coberta |
| [08 Operadora e integrações](F78-08-operadora-integracoes.md) | 25 | 16/3/0 | 6/0/0 | 22 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 3 de 7 funções Parciais com E2E verde viraram Coberta |
| [09 Completude](F78-09-completude.md) | 18 | 6/1/0 | 10/1/0 | 16 | integrar-4 (26/11, E2E dos lotes 1 e 2, commits 1b196ec7 e c1eec038): 1 de 5 funções Parciais com E2E verde viraram Coberta |
| **Total** | **213** | **99/10/0** | **102/2/0** | **201** | |

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
