# Conferência das portas da F2.4 (3ª etapa)

Data: 2026-11-21. Cliente de teste: `f24p_conferir`.

## Pedidos pequenos aplicados

- **Numerações** (`tools/db/configurar_numeracoes.py`), pedidos de `p-farmacia` e `p-qualidade-ccih`: entraram
  `dispensacao`, `documento_estoque`, `devolucao_dispensacao`, `surto_infeccao` e `caso_infeccao`. Sem elas, a
  dispensação, a devolução, a perda e o registro de surto recusavam com `sequencia-nao-configurada`.
- **Trilha do fechamento do livro de controlados** (`p-farmacia`): o rótulo passou a ser `livro_controlado`, a tabela
  onde a linha é gravada. Mudou em `farmacia/servico.ts` e no texto da auditoria do controller.
- **Local de estoque da farmácia** (`p-farmacia`): o contrato limitava o local a 99. Agora é um id positivo, como os
  outros ids.
- **Massa da folha** (`p-folha`): o sexo sintético reaproveita a sigla `I` que já existe, e o CBO sintético é garantido
  pela própria massa. A massa da avaliação ganha vínculo e categoria sintéticos quando o catálogo está vazio.
- **Massa da operadora e dos preços:** país, UF e município sintéticos garantidos. Num cliente novo, o catálogo do IBGE
  está vazio, e as suítes falhavam com `municipio_ibge_id` nulo e `uf-invalida`.

## Verificações (colhidas)

| Verificação | Resultado |
|---|---|
| tsc: api (padrão, migrado, login), worker, web, contratos, núcleo e ui | 0 erros |
| vitest de unidade: api, worker, núcleo e contratos | verde |
| integração da API: 32 arquivos tocados, 254 testes | verde |
| `validar_migracoes.py` | ok |
| `contar-legado.sh` | 0 imports |
| `divida_f24.py --falhar-se-pendente` | **falha: 24 arquivos de modelo-pendente** |

## Dívida que sobra

São 24 arquivos, todos de construção de porta ou de DDL pedido. Nada disso cabe numa correção pequena. O detalhe está
nos `p-*.json`.

| Grupo | Arquivos | O que falta |
|---|---|---|
| Qualidade | `apoio-propria`, `porta-ccih-propria`, `porta-gestao-propria`, `porta-propria`, `seguranca.controller` | DDL da CCIH e da gestão, depois as portas |
| Pessoas | `autoatendimento`, `banco-apoio`, `escala/porta-realizado-propria`, `esocial`, `folha/porta-calculo-propria`, `sesmt` | Repasse na public-api, ficha estruturada do eSocial, cálculo da folha e gravadores para o autoatendimento |
| Operadora | `apoio-banco`, `apoio-porta-propria`, `autorizacao-porta-propria` | Armazenamento de arquivos (ADR 0004) e a busca da autorização pela senha |
| Suprimentos | `opme-porta-propria`, `manipulacao-porta-propria`, `operacoes` | Rodada de OPME e manipulação |
| Outros | enfermagem/SAE, especialidades, manutenção, nutrição, preços, SADT, SUS | Portas e DDL nos `p-*.json` |
