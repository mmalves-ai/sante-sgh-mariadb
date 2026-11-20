# Brief comum da modelagem física (F1.3)

**Projeto:** `/home/mmalves/workspace/redesante/sante-sgh`, sistema hospitalar sobre **MariaDB 12.3
próprio**. Você escreve o **DDL** das tabelas do seu lote.

## Leia (só isto)

1. **Sua fatia:** `docs/obra/fatias/ddl/<lote>.md`. Para cada tabela, ela traz o catálogo e as colunas das
   tabelas de origem: MV e SPDATA, no formato `coluna:tipo`; `!` marca coluna obrigatória na origem.
2. **Convenções:** `docs/adr/0002-decisoes-do-dono-e-principios-do-modelo.md`, **parte 2** (tabela de
   convenções). Leia com `sed -n '/Parte 2/,/Consequências/p'`.
3. **Exemplo canônico:** `db/migracoes/00_NUCLEO/00_nucleo_tabelas.sql` e `00_nucleo_chaves.sql`. Siga o
   mesmo formato.
4. **Para FKs,** consulte `docs/obra/fatias/ddl/catalogo-compacto.tsv` (tabela, módulo, tipo) **só por
   grep**. Ele tem 3.500 tabelas; não leia inteiro. As tabelas-eixo mais usadas estão em
   `docs/obra/fatias/ddl/nucleo-hubs.txt` (259 nomes, pode ler).
5. **Contratos do `new-sgh`** (Zod, os campos que as **telas existentes** usam): os caminhos estão no
   cabeçalho da fatia. Use **grep** pelo conceito (ex.: `grep -rn "nomeSocial\|cns" .../contratos/src/cadastro`).
   Não leia pastas inteiras.

## O que cada tabela precisa ter

As colunas vêm de três fontes, com **nomes próprios em português**:

1. **Os dados de negócio das origens** (MV e SPDATA) que fazem sentido.
   - Traduza: `CD_PACIENTE` vira `paciente_id`, `DT_NASCIMENTO` vira `data_nascimento`, `SN_ATIVO` vira
     `ativo BOOLEAN`.
   - Junte o que as duas origens têm. **Onde o MV traz mais, siga o MV.**
2. **Os campos que as telas do `new-sgh` usam,** encontrados por grep nos contratos.
3. **As melhores práticas do mercado** (o dono pede "melhor que a soma dos dois"): obrigatoriedades
   (`NOT NULL`), unicidade (`UNIQUE`), `CHECK` de situação e de faixa de valor, chaves.

**Não copie os erros do SPDATA:**
- nada de vínculo por nome (ex.: agenda por nome+CRM) — use sempre FK por `id`;
- nada de sentinela (data 1899, S/N, HHMM, 'NI');
- nada de coluna sem dono.

**Estrutura de cada tabela:**
- `id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY`, primeira coluna;
- as 5 colunas de auditoria (`criado_em`, `criado_por`, `alterado_em`, `alterado_por`, `versao`) em
  **toda** tabela;
- `excluido_em` e `excluido_por` em tabela `principal`, `item` e `vinculo`;
- `origem` (com CHECK) em tabela `principal` e `item`.

**`estabelecimento_id BIGINT UNSIGNED NOT NULL`** (FK para `estabelecimento`) em tabela **operacional**:
movimento, documento, cadastro que varia por unidade. Fica fora de domínio da rede, de catálogo público e
de tabela filha cujo pai já tem.

**Por tipo de tabela:**

| tipo | O que leva |
|---|---|
| `item` | FK obrigatória para o pai, mais `sequencia SMALLINT UNSIGNED` ou equivalente, com `UNIQUE (pai_id, sequencia)` |
| `historico` | `<tabela>_id` (FK), `operacao` (CHECK `inclusao`, `alteracao`, `exclusao`), `dados JSON`, `ocorrido_em`, `usuario_id` |
| `dominio` | `codigo VARCHAR(30) NOT NULL UNIQUE`, `descricao VARCHAR(150) NOT NULL`, `ativo BOOLEAN NOT NULL DEFAULT TRUE`, mais os atributos específicos |
| `catalogo_publico` | `codigo_<padrao>` com `UNIQUE`, `descricao`, `vigencia_inicio`, `vigencia_fim`, `versao_fonte VARCHAR(30)` |
| `vinculo` | FKs das duas pontas, `UNIQUE` do par (e vigência, se houver) |

**COMMENT:**
- na tabela: a descrição do catálogo;
- nas colunas cujo nome não basta.

**Proibido:**
- prefixos crípticos (`cd_`, `sn_`, `tp_`, `ds_`, `dt_`, `nr_`, `qt_`, `vl_`, `nm_`, `hr_`, `fl_`, `st_`);
- as palavras mv, soul, spdata;
- `ENUM`;
- `TRIGGER`;
- `FLOAT` para dinheiro;
- `ON DELETE CASCADE` em dado clínico ou financeiro.

## Arquivos de saída (só os dois do seu lote)

**`db/migracoes/<pasta>/<k>_tabelas.sql`:**
- `CREATE TABLE` de **todas** as tabelas do lote;
- com PK, UNIQUE, CHECK, KEY e COMMENT;
- **sem** `FOREIGN KEY`.

**`db/migracoes/<pasta>/<k>_chaves.sql`:**
- `ALTER TABLE ... ADD CONSTRAINT fk_<tabela>_<coluna> FOREIGN KEY (...) REFERENCES <tabela> (id) ON DELETE RESTRICT`
  para **toda** coluna `*_id` que aponta para tabela própria;
- o alvo tem de existir no `catalogo-compacto.tsv` ou ser um destes do núcleo: `trilha_auditoria`,
  `sequencia_negocio`, `arquivo`, `pendencia`, `integracao_mensagem`;
- **não** faça FK para `criado_por`, `alterado_por` e `excluido_por` (são do mecanismo de auditoria);
- se o alvo natural não existir no catálogo, **não invente tabela**: use o alvo mais próximo que exista, ou
  deixe a coluna e registre na `observacao`.

## Autoconferência obrigatória (antes de devolver)

```sh
tools/db/sql.sh -e "drop database if exists r_<lote>; create database r_<lote>"
tools/db/sql.sh r_<lote> --force < db/migracoes/<pasta>/<k>_tabelas.sql   # tem de sair sem erro
tools/db/sql.sh r_<lote> -N -e "select count(*) from information_schema.tables where table_schema='r_<lote>'"
tools/db/sql.sh -e "drop database r_<lote>"
```

No nome do banco, troque `-` por `_` (ex.: `r_06_pep_01`).

Corrija até zerar os erros. O número de tabelas criadas tem de ser igual ao da fatia. **Nunca imprima o
conteúdo do `.env`.**

## Protocolo de tokens

- Leia a fatia **uma vez**.
- Escreva cada arquivo **de uma vez**, numa única gravação, e não linha a linha.
- Grep pontual nos contratos e no catálogo.
- Devolva **só o resumo** pedido.
