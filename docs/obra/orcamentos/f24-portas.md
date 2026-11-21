# Orçamento: f24-portas

estimativa_M: 62
teto_M: 81

- **Objetivo:** construir sobre o banco próprio as **portas que ainda respondem "aguardando modelo"**. São 36 arquivos,
  que sobraram da F2.4 e não são dívida de limpeza, e sim módulos por construir:
  - estoque, OPME e manipulação;
  - farmácia (avaliação);
  - **CCIH** e gestão da qualidade, mais a etapa 2 do incidente;
  - SADT;
  - folha (cálculo, integração e intercâmbio), eSocial, SESMT, escala realizada e autoatendimento;
  - **SAE** e escores da enfermagem;
  - especialidades, nutrição, manutenção e SUS;
  - operadora (ANS, autorização, cobrança e apoio);
  - portal médico, preços e o worker contábil.

  Sem elas, essas telas ficam em consulta, recusando com "aguardando modelo" na navegação do dono.
- **Pronto quando:**
  - `divida_f24.py --falhar-se-pendente` passa;
  - tsc e vitest de unidade de api, worker, web, contratos e núcleo passam, mais a integração dos arquivos tocados em
    cliente de teste próprio;
  - `validar_migracoes.py` dá 0 erros;
  - commit feito.
- **Ordem:**
  1. Compartilhado 1: o DDL de todos os pedidos abertos em `docs/obra/fatias/f24/saida/*.json` (folha, eSocial,
     anestesia e recuperação, SUS, processamento da folha, situações e outros).
  2. Compartilhado 2: contratos e peças comuns:
     - `hora-legada` e `SanteHora` migrados para `formatacao/hora`, e o relógio dos exames;
     - `tabelas-clinicas.gerado.ts` sem nome de origem;
     - o gravador e as consultas contábeis num pacote comum (worker);
     - a numeração `ato_cirurgico` no criar cliente;
     - o gravador do título a pagar compondo na transação da folha.
  3. 11 lotes por módulo: construtor, revisor (diff) e corretor.
  4. Conferidor.
- **Agentes por papel:**

  | Papel | Agentes | Custo por agente | Total |
  |---|---|---|---|
  | Compartilhado | 2 | 4,5 M | 9 M |
  | Construtor | 11 | 2,8 M | 30,8 M |
  | Revisor | 11 | 0,3 M | 3,3 M |
  | Corretor | cerca de 6 | 0,8 M | 4,8 M |
  | Conferidor | 1 | 3,5 M | 3,5 M |

  O construtor usa a medida da 2ª volta para porta inteira, entre 1,8 e 3,2 M.
- **Estimativa:** 51,4 × 1,2 ≈ 62 M. Teto: 81 M. `LIMITE_AGENTES` = 32.
- **Fora do escopo:** preço por médico (aguarda os itens 24 a 27 do dono). O lote de preços não o implementa.
