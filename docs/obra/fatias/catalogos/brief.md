# Brief comum dos carregadores de catálogo (F1.4)

**Projeto:** `/home/mmalves/workspace/redesante/sante-sgh`. Você escreve **um** carregador: o
`catalogos/carregadores/<fonte>.py`. Ele lê a fonte oficial já baixada em `catalogos/cache/<fonte>/` e grava
nas tabelas de destino do banco de um cliente.

## Leia (só isto)

- A sua fatia, `docs/obra/fatias/catalogos/<fonte>.md`: o DDL das tabelas de destino, as FKs e o formato dos
  arquivos.
- O orquestrador `catalogos/carregar.py`: ele chama a sua função `carregar(banco) -> dict`.
- O registro de versões `catalogos/cache/registro.tsv` (TSV sem cabeçalho: fonte, url, arquivo, bytes, sha256,
  baixado_em, versao).

## Regras

- **Ambiente:**
  - só a biblioteca padrão do Python (roda com `python3 -I`), sem `pip`;
  - grave **pelo `tools/db/sql.sh <banco>`** (SQL pela entrada padrão);
  - nunca leia nem imprima o `.env`.
- **Idempotente:** rodar duas vezes não duplica nem falha. Use
  `INSERT ... ON DUPLICATE KEY UPDATE` sobre a chave única oficial (`codigo_*`).
  - Se a tabela não tiver chave única onde precisa, **não altere o DDL**: registre na `observacao`, e o
    orquestrador ajusta centralmente.
- **Lotes** de até 1.000 linhas por `INSERT`. Escape correto de texto: aspas, barra invertida, UTF-8.
- **Codificação:** os arquivos do DATASUS são **cp1252 (superconjunto do latin-1)**; converta para UTF-8.
- **Colunas preenchidas:**
  - auditoria: `criado_em = UTC_TIMESTAMP(3)`, `versao = 1`;
  - `versao_fonte` com a versão do registro (por exemplo, a competência do SIGTAP);
  - vigência, quando a fonte trouxer.
- **FKs entre tabelas do catálogo:** carregue na ordem de dependência. Resolva os ids com
  `SELECT codigo, id` depois de gravar o pai, ou com subconsulta no `INSERT`.
- **Colunas obrigatórias** (`NOT NULL`) sem valor na fonte: use o valor de negócio correto documentado na
  fonte. Se não houver, registre na `observacao`. Não invente dado.
- **Retorno:** `{tabela: linhas_no_banco_depois_da_carga}`.

## Teste obrigatório

```sh
python3 -I catalogos/carregar.py teste_catalogos <fonte>   # 1ª carga
python3 -I catalogos/carregar.py teste_catalogos <fonte>   # 2ª carga: mesmas contagens
```

Confira as contagens contra a fonte, por exemplo 27 UFs e 5.571 municípios no IBGE, ou o número de linhas
do arquivo do SIGTAP.

- O banco `cliente_teste_catalogos` já existe, com o modelo completo.
- **Outros carregadores rodam no mesmo banco ao mesmo tempo.** Mexa só nas tabelas da sua fatia.

## Protocolo de tokens

- Leia a fatia uma vez.
- Escreva o carregador numa gravação só.
- Saídas longas, para arquivo ou com `tail`.
- Devolva só o resumo.
