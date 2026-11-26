# Fichas funcionais da F3: situação dos marcos

Situação em 24/11/2026, depois da rodada f3-marcos (construtor, revisão adversarial e corretor de cada marco) e do
integrador. As contagens são as da seção Aceite (ou do Resumo) de cada ficha. "Revisão (alta?)" diz se ainda há um
achado alto aberto. Um marco só é aceito com a lista mínima toda coberta (ou cada parcial e falta com destino na F8
e o motivo), o E2E verde e a revisão sem achado alto aberto (ficha da fase, `docs/fases/F3-cobertura-melhorada.md`).

| Marco | Funções | Cobertas | Parciais | Faltam | E2E | Revisão (alta?) | Aceito? |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| [F3.1 Cadastros](F3.1-cadastros.md) | 21 | 19 | 2 | 0 | integrar-3 (26/11, grupo C, funções da construir-3 e E2E do lote final, commit e8a7bd44): 1 de 1 arquivos de E2E verdes; 1 de 1 funções da construir-2 e da construir-3 cobertas | Não: o caso vermelho de E2E da linha 2 está na ficha | Não |
| [F3.2 Recepção e agenda](F3.2-recepcao-agenda.md) | 15 | 9 | 6 | 0 | integrar-3 (26/11, lotes 1 e 2 do grupo B): 3 de 6 arquivos de E2E verdes; vermelhos: f32-atendimento-correcao-indicadores, w1-05; não rodados: c1-101-sem-prontuario; 1 de 3 funções da construir-2 passaram a cobertas | Sim: manutenção de feriado e dia não útil (02-AGE 41) | Não |
| [F3.3 Prontuário](F3.3-prontuario.md) | 35 | 27 | 8 | 0 | integrar-3 (26/11, grupo C, funções da construir-3 e E2E do lote final, commit e8a7bd44): 5 de 7 arquivos de E2E verdes; não rodados: f35-respostas-formula, m45-1; 5 de 6 funções da construir-2 e da construir-3 cobertas | Sim: receita sem itens estruturados (03-PEP L121) | Não |
| [F3.4 Internação e centro cirúrgico](F3.4-internacao-cc.md) | 21 | 14 | 7 | 0 | integrar-3 (26/11, grupo C, funções da construir-3 e E2E do lote final, commit e8a7bd44): 3 de 4 arquivos de E2E verdes; não rodados: c3-013-regulacao-depara; 3 de 4 funções da construir-2 e da construir-3 cobertas | Sim: equipe cirúrgica por função (04-CC 95) e clínica por letra nos contratos | Não |
| [F3.5 SADT](F3.5-sadt.md) | 17 | 10 | 7 | 0 | integrar-3 (26/11, E2E do lote 3, commit 1b0e84f6, sobre o lote final): 4 de 8 arquivos de E2E verdes; não rodados: f35-apoio-remessa, f35-mapa-lote, f35-pedido-conta, f35-pedido-recoleta; 2 de 7 funções da construir-2 e da construir-3 cobertas | Não: o alto da 2ª via foi corrigido (migração 10_SADT/40) | Não |
| [F3.6 Suprimentos](F3.6-suprimentos.md) | 19 | 15 | 4 | 0 | integrar-3 (26/11, grupo C, funções da construir-3 e E2E do lote final, commit e8a7bd44): 2 de 5 arquivos de E2E verdes; vermelhos: c2-038-recebimento-nf, c2-052-cadastro-fornecedor, f36; 2 de 5 funções da construir-2 e da construir-3 cobertas | Sim: os dois altos da linha 7 (regra de integração ligada à prescrição; horários padrão unificados) | Não |
| [F3.7 Faturamento](F3.7-faturamento.md) | 40 | 23 | 17 | 0 | integrar-3 (26/11, grupo C, funções da construir-3 e E2E do lote final, commit e8a7bd44): 6 de 8 arquivos de E2E verdes; vermelhos: c3-001-simulador-reajuste; não rodados: c1-135-preferencias-faturista; 5 de 8 funções da construir-2 e da construir-3 cobertas | Sim: marcas de texto no contrato da tela (FALTA 5) | Não |
| [F3.8 Financeiro](F3.8-financeiro.md) | 19 | 16 | 3 | 0 | integrar-3 (26/11, lote 1 do grupo A; o lote 2 não gerou resultado): 1 de 3 arquivos de E2E verdes; não rodados: c1-026-conta-credor-profissional, f38-pagamento-eletronico; 1 de 2 funções da construir-2 passaram a cobertas | Não | Não |
| [F3.9 Apoio](F3.9-apoio.md) | 67 | 50 | 17 | 0 | integrar-3 (26/11, grupo C, funções da construir-3 e E2E do lote final, commit e8a7bd44): 5 de 6 arquivos de E2E verdes; não rodados: c3-007-elegibilidade-do-atendimento; 4 de 5 funções da construir-2 e da construir-3 cobertas | Sim: corrigidos só na ficha (01-ADM L57/L59, 04-HOT L126 a L128, permissões por letra, gravações da qualidade) | Não |
| **Total** | **254** | **183** | **71** | **0** | 1 marco com E2E verde | 7 marcos com achado alto aberto | **0 de 9** |

## Fichas F7 e F8 (F78)

Situação recontada por script na integrar-1, grupo C (25/11), pelas linhas de cada ficha `F78-*.md` (coluna Fase). Colunas F7 e F8: cobertas/parciais/faltam.

| Ficha | Linhas | F7 (cob/par/falta) | F8 (cob/par/falta) | Cobertas | E2E |
| --- | ---: | ---: | ---: | ---: | --- |
| [01 Administração, segurança e BI](F78-01-administracao.md) | 10 | 0/2/0 | 7/1/0 | 7 | integrar-3 (26/11, E2E do lote 5, commit 3eafcdc2, sobre o lote 3 e o lote final): 2 de 4 arquivos de E2E verdes; vermelhos: c2-025-kit-implantacao, c2-053-central-comando; 3 de 5 funções da construir-2 e da construir-3 cobertas |
| [02 Cadastro, recepção e agenda](F78-02-cadastro-recepcao-agenda.md) | 19 | 2/3/0 | 8/5/1 | 10 | integrar-3 (26/11, E2E do lote 6, commit 29d8b485, sobre os lotes 5, 3 e final): 2 de 5 arquivos de E2E verdes; vermelhos: c1-107-cotas-prazos, c2-040-contato-ativo, c2-067-turmas; 2 de 6 funções da construir-2 e da construir-3 cobertas |
| [03 Prontuário](F78-03-prontuario.md) | 23 | 5/3/0 | 14/1/0 | 19 | integrar-3 (26/11, E2E do lote 6, commit 29d8b485, sobre os lotes 5, 3 e final): 5 de 5 arquivos de E2E verdes; 5 de 5 funções da construir-2 e da construir-3 cobertas |
| [04 Internação, centro cirúrgico e hotelaria](F78-04-internacao-cc-hotelaria.md) | 33 | 13/4/0 | 15/1/0 | 28 | integrar-3 (26/11, E2E do lote 3, commit 1b0e84f6, sobre o lote final): 11 de 12 arquivos de E2E verdes; vermelhos: c2-089-corretiva-externa; 10 de 12 funções da construir-2 e da construir-3 cobertas |
| [05 Diagnóstico e suprimentos](F78-05-diagnostico-suprimentos.md) | 19 | 7/3/0 | 5/4/0 | 12 | integrar-3 (26/11, grupo C, funções da construir-3 e E2E do lote final, commit e8a7bd44): 8 de 8 arquivos de E2E verdes; 8 de 8 funções da construir-2 e da construir-3 cobertas |
| [06 Faturamento](F78-06-faturamento.md) | 24 | 9/6/0 | 7/2/0 | 16 | integrar-3 (26/11, E2E do lote 5, commit 3eafcdc2, sobre o lote 3 e o lote final): 3 de 6 arquivos de E2E verdes; vermelhos: c2-100-fixo-minimo-repasse, c2-106-variavel-faixa; não rodados: c1-051-configuracao-sus; 3 de 6 funções da construir-2 e da construir-3 cobertas |
| [07 Financeiro e pessoas](F78-07-financeiro-pessoas.md) | 42 | 21/5/0 | 8/8/0 | 29 | integrar-3 (26/11, E2E do lote 5, commit 3eafcdc2, sobre o lote 3 e o lote final): 3 de 7 arquivos de E2E verdes; vermelhos: c1-129-orcamento-estatistico, c2-083-remuneracao-variavel, c2-115-custo-padrao; não rodados: c3-023-lalur-irpj-csll; 3 de 7 funções da construir-2 e da construir-3 cobertas |
| [08 Operadora e integrações](F78-08-operadora-integracoes.md) | 25 | 8/11/0 | 2/4/0 | 10 | integrar-3 (26/11, E2E do lote 5, commit 3eafcdc2, sobre o lote 3 e o lote final): 6 de 12 arquivos de E2E verdes; vermelhos: c1-018-catraca-colaborador, c2-095-comercial-operadora, c2-102-programas-saude, c2-120-remuneracao-prestador; não rodados: c1-086-reajuste-coletivo, c3-027-portais-operadora; 6 de 12 funções da construir-2 e da construir-3 cobertas |
| [09 Completude](F78-09-completude.md) | 18 | 3/4/0 | 9/2/0 | 12 | integrar-3 (26/11, E2E do lote 3, commit 1b0e84f6, sobre o lote final): 4 de 5 arquivos de E2E verdes; não rodados: f31-demografia-paciente; 4 de 5 funções da construir-2 e da construir-3 cobertas |
| **Total** | **213** | **68/41/0** | **75/28/1** | **143** | |

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
