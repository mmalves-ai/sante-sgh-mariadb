# Ligação da ferramenta de BI ao data mart pseudonimizado

Função 01-ADM L115 (F8): análise ad hoc, com tabela dinâmica, cubo e filtros salvos pelo usuário.

## Decisão

- A análise ad hoc é feita **na ferramenta de BI do cliente**, sobre o data mart pseudonimizado.
  - Serve qualquer ferramenta que leia SQLite: Metabase, Superset, Power BI por ODBC, DuckDB ou planilha por ODBC.
  - A tabela dinâmica, o cubo e os filtros salvos ficam na ferramenta de BI.
- **O produto não guarda análises.** É a minimização da LGPD (art. 6º, III): a análise salva é da ferramenta.
  - As tabelas `analise_salva` e `analise_salva_permissao` ficam sem uso enquanto o dono não pedir o contrário.
- O BI **nunca** lê o banco do cliente (MariaDB). Lê só os arquivos do data mart, que não têm dado de pessoa:
  - o paciente e a internação aparecem como pseudônimo HMAC;
  - o nascimento vira faixa etária;
  - não há nome, documento, contato, endereço nem texto clínico.

## Carga

- O `worker` carrega o data mart **uma vez por dia**, por estabelecimento, a partir das 2 h no fuso do estabelecimento.
  - O serviço é o `datamart-carga`. Em dev e em CI, só liga com `DATAMART_CARGA_DIARIA=ligado`.
- Cada carga fica registrada em `carga_data_mart`, com a situação, as linhas e a mensagem sem valores de dados.
- Cada dimensão e cada fato carregado fica em `carga_data_mart_etapa`, com as linhas e o tempo.
- A falha também fica registrada e não se repete no mesmo dia. A carga do dia seguinte tenta de novo.
- Antes de publicar, cada arquivo passa pelo verificador do data mart, que recusa coluna identificadora.
- Os arquivos ficam em `DATA_MART_DIR`:
  - um por estabelecimento (`<código>.sqlite`);
  - o da Rede (`rede.sqlite`), só com os estabelecimentos que têm o BI da Rede liberado.

## Como ligar a ferramenta de BI (só leitura)

1. **Usuário do sistema operacional só para o BI.** Crie um usuário próprio, por exemplo `bi_leitura`.
   - Ele entra no grupo que lê a pasta do data mart.
   - A pasta fica com o modo `0750`, e os arquivos com `0440`.
   - O dono da pasta é o usuário do `worker`. O `bi_leitura` não tem escrita.
2. **Conexão em somente leitura.** A ferramenta abre o arquivo com o modo de leitura do SQLite:
   - URI `file:/caminho/do/data-mart/<código>.sqlite?mode=ro`;
   - no ODBC, a opção `ReadOnly=1`.

   Mesmo com um erro de permissão no disco, a conexão recusa a gravação.
3. **Conferência antes de ligar.** O `conferirLigacaoBi` (`tools/verificadores/src/datamart-bi.ts`) abre o arquivo
   como a ferramenta o veria e recusa:
   - coluna identificadora;
   - arquivo sem o registro da carga.

   O `pnpm datamart:verificar` faz a mesma conferência sobre toda a pasta.
4. **Atualização.** A carga publica o arquivo novo por troca atômica (renomeia o temporário).
   - A ferramenta de BI relê o arquivo na próxima consulta.
   - Agende a atualização do BI depois das 2 h, no fuso do estabelecimento.

## Provas

| O que prova | Onde |
|---|---|
| A ferramenta de BI faz a tabela dinâmica, não consegue gravar e recusa arquivo com dado de pessoa | `tools/verificadores/src/lgpd/datamart-bi-leitura.spec.ts` |
| O data mart sai sem dado de pessoa | `tools/verificadores/src/lgpd/datamart-sem-dado-pessoal.spec.ts` |
| A carga devida uma vez por dia, as etapas e a situação | `packages/dominio-relatorio/src/datamart-registro.spec.ts` |
| O registro em `carga_data_mart` e `carga_data_mart_etapa`, com a trilha, uma vez por dia e com a falha registrada | `apps/worker/src/datamart-carga-propria.int.spec.ts` |

## Pendência

O carregador do `worker` ainda recusa a carga, porque faltam as leituras do data mart no banco próprio:

- o movimento da internação em vocabulário neutro;
- as leituras agregadas por estabelecimento.

Até elas existirem, a rotina registra cada dia uma carga com situação `falhou` e a mensagem dessa recusa.
