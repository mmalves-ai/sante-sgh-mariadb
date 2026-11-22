# Formato do arquivo de edição dos catálogos licenciados

ADR 0006 (item 3) e ADR 0007: o catálogo licenciado padrão (Brasíndice, Simpro, CBHPM, base de CEP) vive no
**espelho padrão da base** (`tools/db/espelho.py`), versionado por edição, e chega a todo cliente pelo "criar cliente"
ou por `tools/db/espelho.py atualizar`. Nunca entra pelo conector nem direto no banco de um cliente. O preço próprio
do hospital (tabela negociada) é dado do cliente e entra pelo conector.

Carga de uma edição (só no espelho):

```
python3 -I catalogos/licenciados/carregar.py <fonte> <edicao> <arquivo.csv> --vigencia AAAA-MM-DD \
        [--espelho BANCO] [--publicacao AAAA-MM-DD] [--completa] [--valor-uco N] [--valor-filme N]
```

## Regras comuns

- CSV separado por `;`, UTF-8 (com ou sem BOM), primeira linha com os **nomes das colunas** abaixo (minúsculas, em
  qualquer ordem). Coluna fora da lista ou obrigatória ausente: o arquivo inteiro é recusado.
- Decimal com vírgula (`12,50`, `1.234,50`) ou ponto (`12.50`). Vazio = sem valor.
- Linha inválida não entra; o resultado conta por motivo e número da linha (nunca o conteúdo). Código repetido no
  mesmo arquivo: a segunda é recusada (`codigo_repetido`).
- A mesma edição carregada de novo atualiza (idempotente). Edição nova fecha a vigência da anterior na véspera da
  `--vigencia` e guarda a edição em `edicao_espelho` (nome do arquivo e SHA-256).
- O arquivo nativo de cada fornecedor (layout do contrato de licença) é convertido para este formato por um
  adaptador da fonte, escrito quando o arquivo real da licença estiver disponível; o carregador e o espelho não mudam.

## brasindice, simpro (preço de mat/med por edição)

Destino: `fonte_referencia_matmed`, `edicao_referencia_matmed`, `item_referencia_matmed`, `preco_referencia_matmed`.

| coluna | obrigatória | conteúdo |
|---|---|---|
| codigo | sim | código do item na publicação (até 20) |
| descricao | sim | até 250 |
| tipo_produto | sim | medicamento, material, solucao, dieta, opme, outro |
| apresentacao, nome_laboratorio | não | até 150 |
| codigo_medicamento, codigo_apresentacao, codigo_laboratorio, codigo_tuss | não | até 10 |
| codigo_ean | não | até 14 |
| registro_anvisa | não | até 20 |
| quantidade_embalagem, fator_divisao | não | decimal > 0 |
| preco_fabrica, preco_maximo_consumidor | um dos dois | decimal >= 0, unitário |
| aliquota_icms, valor_ipi | não | decimal >= 0 |
| tipo_alteracao | não | inclusao, alteracao_preco, alteracao_cadastro, exclusao (exclusao: item descontinuado) |

`--completa`: o arquivo é a lista inteira da fonte; item ausente fica `descontinuado` (o preço das edições anteriores
continua no histórico).

## cbhpm (honorários por edição)

Destino: `tabela_referencia_procedimento` (a edição; `--valor-uco` e `--valor-filme` dão o valor da unidade de custo
operacional e do metro quadrado de filme) e `tabela_referencia_procedimento_item`.

| coluna | obrigatória | conteúdo |
|---|---|---|
| codigo | sim | código do procedimento na edição (até 15) |
| descricao | sim | até 500 |
| porte | não | porte publicado (ex.: 3B, até 5) |
| quantidade_porte, quantidade_uco, quantidade_filme_m2, valor_procedimento | não | decimal >= 0 |
| numero_auxiliares | não | inteiro >= 0 (vazio = 0) |
| porte_anestesico | não | inteiro de 0 a 8 |
| incidencia | não | até 10 |

## cep (base de endereçamento)

Destino: `logradouro_cep` e `bairro`. Exige os catálogos oficiais de município e UF no espelho
(`catalogos/carregar.py --espelho BANCO ibge`); CEP de município ou UF ausente não entra e é contado nos avisos.

| coluna | obrigatória | conteúdo |
|---|---|---|
| cep | sim | 8 dígitos (traço e ponto não contam) |
| codigo_ibge_municipio | sim | 7 dígitos |
| uf | sim | sigla |
| tipo_cep | não | logradouro (padrão), localidade, grande_usuario, caixa_postal, unidade_operacional |
| logradouro, complemento | não | até 200 |
| logradouro_abreviado | não | até 100 |
| numero_inicial, numero_final | não | inteiros (final >= inicial) |
| lado | não | par, impar, ambos |
| nome_unidade | não | até 150 |
| codigo_bairro, bairro | os dois ou nenhum | código do bairro na base postal (até 12) e nome (até 100) |
| cep_anterior | não | 8 dígitos |

`--completa`: CEP ausente do arquivo fica inativo, com a vigência fechada.

Arquivos de exemplo, 100% fictícios, em `catalogos/licenciados/sintetico/` (usados pelo teste
`catalogos/licenciados/test_licenciados.py`).
