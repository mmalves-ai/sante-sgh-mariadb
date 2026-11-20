# sante-sgh

Sistema hospitalar sobre **banco próprio em MariaDB 12.3**, construído a partir do modelo base do
`new-sgh`, com **conector diferencial** para os hospitais que vêm do SPDATA.

- Decisão de fundo: [docs/adr/0001](docs/adr/0001-banco-proprio-e-virada-por-conector-diferencial.md)
- Roteiro de construção: [docs/fases/](docs/fases/README.md) (F0 a F8)
- Estado da obra: [docs/ESTADO.md](docs/ESTADO.md)
- Regras para pessoas e IA: [AGENTS.md](AGENTS.md)

---

## Referência: banco Oracle com o dump TSTMV (ambiente de teste do MV)

O MV serve **só como referência de recursos** (ADR 0001). **Desde 2026-11-20, o Oracle tem só a estrutura**
(8.674 tabelas, zero linhas): foi reimportado com `CONTENT=METADATA_ONLY` (`dump/import-metadados.par`). Os metadados exportados estão em `referencias/mv-tabelas.tsv`.

Container Oracle para inspecionar o export `TSTMV_FULL_20261013_01.dmp`: Data Pump FULL, Oracle
12.1.0.2, banco `cdbtst1`, feito pelo usuário `MV_EXPORT` em 13/10/2026. É um ambiente completo do
Soul MV (esquemas `DBAMV`, `DBAPS`, `DBAPORTAL`, `DBADW`, `MVBIKE`, `MVINTEGRA`…), com 417 usuários e
9.216 tabelas.

### O que tem aqui

| Item | O que é |
|---|---|
| `docker-compose.yml` | Container `sante-sgh-oracle`, imagem `gvenzl/oracle-free:23.9-slim` (Oracle 23ai Free), só em `127.0.0.1:1521`, volume `sante-sgh-oracle-data` |
| `.env` | Senha do `SYSTEM` (`ORACLE_SENHA`) e porta. Permissão 600. Nunca copie para um repositório |
| `dump/TSTMV_FULL_20261013_01.dmp.sha256` | Hash do dump completo (5,96 GB). **A cópia do `.dmp` foi apagada em 2026-11-20** por decisão do dono (ADR 0002, item 16). O original ficou no cache do VMware |
| `dump/ddl.sql` | DDL extraído do dump, **sem** `CREATE/ALTER USER` e com as credenciais de *database link* removidas |
| `dump/import.par`, `dump/import.log` | Parâmetros e log do import |
| `scripts/criar_tablespaces.sql` | Cria os 21 tablespaces de aplicação com os nomes originais (rodar antes do import) |

**Origem do dump.** O dump completo veio do cache de arrastar e soltar do VMware
(`~/.cache/vmware/drag_and_drop/qgmEo4/`). Hash SHA-256: `0dff49a5…6eda9419a`. A cópia de 15 MB que
estava em outro repositório é um arquivo truncado e não serve.

### Conexão

| Campo | Valor |
|---|---|
| Host e porta | `127.0.0.1:1521` |
| Serviço | `FREEPDB1` (o PDB onde o dump foi importado) |
| Usuário | `SYSTEM` (os usuários do MV vêm com as senhas originais do dump) |
| Senha | `ORACLE_SENHA` do `.env` |

```sh
cd /home/mmalves/workspace/redesante/sante-sgh
docker compose up -d       # sobe (os dados ficam no volume)
docker compose down        # para, sem apagar os dados
docker exec -it sante-sgh-oracle bash -c 'sqlplus system/$ORACLE_PASSWORD@//localhost/FREEPDB1'
```

### Refazer do zero

```sh
docker compose down -v && docker compose up -d     # apaga o volume e recria o banco vazio
# quando ficar healthy:
docker exec sante-sgh-oracle bash -c 'sqlplus -s system/$ORACLE_PASSWORD@//localhost/FREEPDB1 <<EOF
create or replace directory DUMP_DIR as '"'"'/opt/oracle/dump'"'"';
@/opt/oracle/dump/criar_tablespaces.sql
EOF'
docker exec -d sante-sgh-oracle bash -c 'impdp system/$ORACLE_PASSWORD@//localhost/FREEPDB1 parfile=/opt/oracle/dump/import.par'
```

### Limites do Oracle Free

- Sem `parallel` no Data Pump: o import roda em um único processo.
- Limite de **12 GB de dados de usuário**. Se o import estourar esse limite, troque para uma imagem
  Oracle 19c EE.
- Erros esperados no log: tablespaces "already exists" (criados antes, de propósito), `ALTER USER SYS`
  e objetos que dependem de recursos do Enterprise Edition ou de dblinks para o ambiente de origem.

### Regras

- **Dados reais.** O dump traz usuários com nome de funcionários e, provavelmente, dados de pacientes.
  Nada sai desta cópia para código, testes, logs, commits ou documentos, a não ser contagens e agregados.
- **Só loopback.** Não publique a porta para a rede.
