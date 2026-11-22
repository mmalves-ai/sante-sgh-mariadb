# ADR 0009, lote conector: mapa, extrator do texto da agenda e Sincronizar

Rótulo `conector`.

**Prova:**
- `verificar_mapa` ok;
- `conferir-fatia-f4.sh` ok em L6-03 (agenda de consultas), L6-04 (agenda de exames) e L5-06 (convênio);
- `test_estrutura_agenda.py` 13/13, com a parte de banco rodando no container;
- suíte `conector/conector.sh testes`: 1221 testes ok (10 pulados, 2 falhas esperadas, as mesmas de antes).

## O que mudou

| Arquivo | O quê |
|---|---|
| `conector/mapa/declarado/colunas.d/L6-03.tsv` | `REAGENDA.ID` → `agenda_servico.codigo_origem`; `PERINI`/`PERFIN` → `agenda_servico.vigencia_inicio/fim` (vigência cadastrada, API de compatibilidade) |
| `conector/mapa/declarado/colunas.d/L6-04.tsv` | `SIAGENDA.ID` → `agenda_servico.codigo_origem` |
| `conector/mapa/declarado/colunas.d/L5-06.tsv` | `TBCONVEN.PERMITE_ATEND` → `fonte_pagadora.codigo_permissao_atendimento`; literal `=1` → `credencia_todos_ao_criar` (decisão 26, cliente importado) |
| `conector/sante_conector/estrutura_agenda.py` | Extrator puro (versão `conector-1`), com os formatos da seção 2 e posições em caracteres (base 0, fim exclusivo) |
| `conector/sante_conector/estruturar.py` | Grava o texto inteiro, as regras estimadas, os trechos e os subplanos; diferencial por hash (Sincronizar) |
| `conector/sante_conector/motor.py` | Chama `estruturar.executar` depois da carga do mapa. Uma falha vira a pendência `agenda:estruturar_texto_falhou:alta` e não derruba a carga |
| `conector/testes/test_estrutura_agenda.py` | Textos sintéticos de cada formato; aceite e Sincronizar num banco descartável |
| `docs/obra/fatias/f4/*` | Fatias regeneradas pelo `fatiar_conector.py`: o DDL do modelo mudou, e o `--conferir` acusava 25 arquivos fora do gerado |

### Regras do extrator

- **Preço:** só "VALOR DA/DE CONSULTA PARTICULAR" vira `regra_preco_particular`, com a agenda como dona, alvo
  consulta, situação estimada e vigência a partir da data da carga.
  - A fonte particular é a única de tipo particular. Na falta dela, a única chamada "PARTICULAR".
  - Ficam não interpretados, com motivo: parcelas, exame sem item, procedimento citado e valor para paciente de
    convênio (decisão 24).
  - A forma de pagamento vira trecho não interpretado.
- **Cobertura:** o convênio é achado pelo nome, sem acento e sem espaço.
  - Um nome que só começa o de uma fonte vale para todas as fontes da marca.
  - Um nome que começa pelo nome de uma fonte e traz mais, ou cuja primeira palavra é a de uma única fonte, é
    subplano dela: vira um plano dentro do convênio.
  - Um nome sem cadastro fica como trecho não interpretado.
- **Restrição e preparo:** como descrito no cabeçalho do extrator.
- **Sincronizar:** o hash do texto decide.
  - Texto igual: nada muda.
  - Texto mudou: as estimadas saem por exclusão lógica e o texto é extraído de novo. A confirmada fica, é contada como
    `confirmadas_a_rever` e não ganha estimada repetida.

## Contagens (testes, só dados sintéticos)

- 3 textos, nenhuma falha.
- Regras: 1 preço, 4 coberturas (uma delas com subplano criado), 1 restrição e 2 preparos (jejum de 8 horas).
- Segunda execução: 3 textos iguais, nada gravado.
- Texto alterado: 4 estimadas retiradas, 1 confirmada mantida e preço novo de 300,00.

## Pendências

1. **`FCCODCON.VLR_CONSULTA` do particular → `regra_preco_particular`:** não mapeado.
   - Na carga, a fonte entra com tipo presumido `outro`, então o conector não sabe qual é a particular.
   - Gravar para toda fonte criaria preço por médico em convênio, o que a decisão 24 recusa.
   - Caminho: uma carga condicional pelo nome ou tipo da fonte, ou um destino provisório lido pelo `estruturar`.
2. **`TBCONVEN.VLR_CONSULTA_MEDICO='T'` → `regra_repasse_item` 100%:** não mapeado, porque precisa do item ou grupo de
   consulta do cliente.
3. **Valor de exame sem item:** fica não interpretado.
   - O lote do domínio precisa decidir o alvo "atendimento padrão da agenda" para exame, ou a ligação com o item
     agendável.
4. **Ligação agenda → profissional pelo nome** (seção 5.3, item 5 do levantamento): não feita.
5. **Medição na cópia real:** ainda não rodou. Quando rodar, entram só contagens de interpretados e não interpretados.
