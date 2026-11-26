# Fichas funcionais da F3: situação dos marcos

Situação em 24/11/2026, depois da rodada f3-marcos (construtor, revisão adversarial e corretor de cada marco) e do
integrador. As contagens são as da seção Aceite (ou do Resumo) de cada ficha. "Revisão (alta?)" diz se ainda há um
achado alto aberto. Um marco só é aceito com a lista mínima toda coberta (ou cada parcial e falta com destino na F8
e o motivo), o E2E verde e a revisão sem achado alto aberto (ficha da fase, `docs/fases/F3-cobertura-melhorada.md`).

| Marco | Funções | Cobertas | Parciais | Faltam | E2E | Revisão (alta?) | Aceito? |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| [F3.1 Cadastros](F3.1-cadastros.md) | 21 | 18 | 3 | 0 | integrar-1 (25/11, lote 1 do grupo A): 4 de 5 arquivos de E2E das funções verdes, não rodados: c1-025-endereco-manual; 4 funções passaram a cobertas | Não: o caso vermelho de E2E da linha 2 está na ficha | Não |
| [F3.2 Recepção e agenda](F3.2-recepcao-agenda.md) | 15 | 8 | 7 | 0 | integrar-1 (25/11, lote 1 do grupo A): 6 de 11 arquivos de E2E das funções verdes, vermelhos: c1-113-exame-sem-prontuario, c1-121-espera-prioridade, w1-05, não rodados: f32-atendimento-correcao-indicadores, m20; 4 funções passaram a cobertas | Sim: manutenção de feriado e dia não útil (02-AGE 41) | Não |
| [F3.3 Prontuário](F3.3-prontuario.md) | 35 | 20 | 15 | 0 | integrar-1 (25/11, lote 1 do grupo A): 3 de 6 arquivos de E2E das funções verdes, vermelhos: c1-076-painel-filtros-recortes, f33-grupos-resultado, não rodados: c1-115-catalogo-prescricao; 3 funções passaram a cobertas | Sim: receita sem itens estruturados (03-PEP L121) | Não |
| [F3.4 Internação e centro cirúrgico](F3.4-internacao-cc.md) | 21 | 11 | 10 | 0 | integrar-1 (25/11, lote 1 do grupo A): 4 de 9 arquivos de E2E das funções verdes, vermelhos: c1-021-operadores-unidade, f34-admissao-acidente, f34-gases-textos, f34-gasto-sala, f34-registros-internacao; 2 funções passaram a cobertas | Sim: equipe cirúrgica por função (04-CC 95) e clínica por letra nos contratos | Não |
| [F3.5 SADT](F3.5-sadt.md) | 17 | 8 | 9 | 0 | integrar-1 (25/11, lote 1 do grupo A): 3 de 10 arquivos de E2E das funções verdes, vermelhos: m47-3, não rodados: c1-077-avisos-clinicos, f35-apoio-remessa, f35-catalogo-exames, f35-respostas-formula, f35-resultado-ciclo, m26; 2 funções passaram a cobertas | Não: o alto da 2ª via foi corrigido (migração 10_SADT/40) | Não |
| [F3.6 Suprimentos](F3.6-suprimentos.md) | 19 | 13 | 6 | 0 | integrar-1 (25/11, lotes 1 e 2): 6 arquivos de E2E das funções verdes, não rodados: f36-livro-oficial; 5 funções passaram a cobertas | Sim: os dois altos da linha 7 (regra de integração ligada à prescrição; horários padrão unificados) | Não |
| [F3.7 Faturamento](F3.7-faturamento.md) | 40 | 18 | 22 | 0 | integrar-2 (25/11, lotes 1 e 2): 3 de 11 arquivos de E2E verdes; vermelhos: c2-075-pacote-composicao, f37-movimentos; não rodados: c2-020-indices, c2-035-periodos-faturamento, c2-086-apresentacao-tiss, c2-096-demonstrativo-pagamento, c2-103-receita-contabil, f37-horario-especial; 2 de 10 funções da construir-2 passaram a cobertas | Sim: marcas de texto no contrato da tela (FALTA 5) | Não |
| [F3.8 Financeiro](F3.8-financeiro.md) | 19 | 15 | 4 | 0 | integrar-1 (25/11, lotes 1 e 2): 2 arquivos de E2E das funções verdes, não rodados: c1-044-tipo-documento-receber; 1 função passou a coberta | Não | Não |
| [F3.9 Apoio](F3.9-apoio.md) | 67 | 46 | 21 | 0 | integrar-2 (25/11, lotes 1 e 2): 2 de 12 arquivos de E2E verdes; vermelhos: c2-037-pacotes-parceiro; não rodados: c2-008-same-guarda-externa, c2-023-mensagens-paciente, c2-077-apuracao-indicadores, c2-077-paineis-gerenciais, f39-alcadas-aprovacao, f39-escopo-vinculo, f39-same-guarda, f39-same-tramite, m21; 2 de 7 funções da construir-2 passaram a cobertas | Sim: corrigidos só na ficha (01-ADM L57/L59, 04-HOT L126 a L128, permissões por letra, gravações da qualidade) | Não |
| **Total** | **254** | **157** | **97** | **0** | 1 marco com E2E verde | 7 marcos com achado alto aberto | **0 de 9** |

## Fichas F7 e F8 (F78)

Situação recontada por script na integrar-1, grupo C (25/11), pelas linhas de cada ficha `F78-*.md` (coluna Fase). Colunas F7 e F8: cobertas/parciais/faltam.

| Ficha | Linhas | F7 (cob/par/falta) | F8 (cob/par/falta) | Cobertas | E2E |
| --- | ---: | ---: | ---: | ---: | --- |
| [01 Administração, segurança e BI](F78-01-administracao.md) | 10 | 0/1/1 | 2/3/3 | 2 | integrar-1 (25/11, lotes 1 e 2): 2 de 2 arquivos de E2E das funções verdes; 2 de 3 funções da construir-1 passaram a cobertas |
| [02 Cadastro, recepção e agenda](F78-02-cadastro-recepcao-agenda.md) | 19 | 1/4/0 | 6/5/3 | 7 | integrar-1 (25/11, lotes 1 e 2): 5 de 8 arquivos de E2E das funções verdes; vermelhos: c1-080-regulacao-recebidos, f78-linhas-cuidado; não rodados: c1-107-cotas-prazos; 5 de 8 funções da construir-1 passaram a cobertas |
| [03 Prontuário](F78-03-prontuario.md) | 23 | 4/4/0 | 10/3/2 | 14 | integrar-2 (25/11, lotes 1 e 2): 6 de 10 arquivos de E2E verdes; vermelhos: c2-056-prontuario-restrito, c2-090-oncologia-acompanhamento; não rodados: c2-028-documentos-exigidos, c2-042-protocolo-criterios; 6 de 10 funções da construir-2 passaram a cobertas |
| [04 Internação, centro cirúrgico e hotelaria](F78-04-internacao-cc-hotelaria.md) | 33 | 7/5/5 | 8/1/7 | 15 | integrar-1 (25/11, lotes 1 e 2): 6 de 9 arquivos de E2E das funções verdes; vermelhos: c1-065-isolamento-bloqueio-quarto, c1-131-ocorrencias-entrega; não rodados: c1-108-comunicacao-operadora; 6 de 11 funções da construir-1 passaram a cobertas |
| [05 Diagnóstico e suprimentos](F78-05-diagnostico-suprimentos.md) | 19 | 2/4/4 | 2/5/2 | 4 | integrar-1 (25/11, lotes 1 e 2): 2 de 6 arquivos de E2E das funções verdes; vermelhos: c1-032-contrato-pedido, c1-067-soroteca; não rodados: c1-083-cultura-antibiograma, c1-118-enderecamento-separacao; 2 de 9 funções da construir-1 passaram a cobertas |
| [06 Faturamento](F78-06-faturamento.md) | 24 | 4/8/3 | 2/3/4 | 6 | integrar-1 (25/11, lotes 1 e 2): 2 de 2 arquivos de E2E das funções verdes; 3 de 4 funções da construir-1 passaram a cobertas |
| [07 Financeiro e pessoas](F78-07-financeiro-pessoas.md) | 42 | 19/6/1 | 7/8/1 | 26 | integrar-2 (25/11, lotes 1 e 2): 3 de 11 arquivos de E2E verdes; vermelhos: c2-083-remuneracao-variavel, c2-115-custo-padrao; não rodados: c2-016-fluxo-aprovacao, c2-031-cobranca-bancaria, c2-045-cobranca-pix, c2-093-lancamento-automatico, c2-101-consolidacao-gerencial, c2-112-controle-orcamentario; 3 de 11 funções da construir-2 passaram a cobertas |
| [08 Operadora e integrações](F78-08-operadora-integracoes.md) | 25 | 2/15/2 | 0/2/4 | 2 | integrar-1 (25/11, lotes 1 e 2): 0 de 3 arquivos de E2E das funções verdes; vermelhos: c1-071-operadora-cadastro-complementar; não rodados: c1-036-declaracoes-ans, c1-086-reajuste-coletivo; 0 de 6 funções da construir-1 passaram a cobertas |
| [09 Completude](F78-09-completude.md) | 18 | 3/4/0 | 5/6/0 | 8 | integrar-2 (25/11, lotes 1 e 2): 3 de 8 arquivos de E2E verdes; não rodados: c2-017-licitacao, c2-032-terminologia-clinica, c2-060-controles-risco, c2-060-documento-setor, c2-084-restricao-cobertura; 3 de 7 funções da construir-2 passaram a cobertas |
| **Total** | **213** | **42/51/16** | **42/36/26** | **84** | |

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
