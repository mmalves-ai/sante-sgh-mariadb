# RETOMADA: pausa graciosa de 2026-11-20, 19:25 (troca da conta da LLM)

Leia este arquivo primeiro. Depois, `docs/ESTADO.md` e o `AGENTS.md`, com o protocolo de tokens obrigatório.

## O que está pronto (em commit local)

| Item | Onde | Prova |
|---|---|---|
| ADR 0001 (banco próprio, conector, virada) e ADR 0002 (decisões do dono e convenções do DDL) | `docs/adr/` | Aceitos |
| Análise cruzada MV × SPDATA × `new-sgh` (rodadas 1 e 2) | `docs/analise/`, `docs/analise/rodada2/final/` | 3.500 tabelas próprias; destino para 8.867 do MV e 1.503 do SPDATA |
| **DDL das 3.500 tabelas** (F1.3) | `db/migracoes/` (176 arquivos) | `python3 -I tools/db/validar_migracoes.py`: 0 erros, 13.503 FKs. Conferência em `docs/obra/conferencia-modelo.md` |
| Banco de controle da plataforma e comando **criar novo cliente** | `db/plataforma/`, `tools/db/criar_cliente.py` | Cria o banco completo (3.505 tabelas) em cerca de 1 min |
| Modelo base do `new-sgh` (commit `d3f8b5d`) sem o legado (F0.2) | `apps/`, `packages/`, `tools/` | `docs/obra/inventario-modelo-base.md` |
| Dependências instaladas, sem o driver do Firebird | `node_modules` (420 MB) | `./pnpm install` sem erro |
| Baixador das fontes oficiais | `catalogos/baixar.py` | Cache em `catalogos/cache/` (fora do git) |
| **Carregadores IBGE, BCB e CID-10** | `catalogos/carregadores/{ibge,bcb,cid10}.py`, `catalogos/carregar.py` | Testados duas vezes no `cliente_teste_catalogos`, com contagens iguais: 27 UFs, 5.571 municípios, 471 bancos, 15.407 termos da CID-10 |
| Dados do MV apagados | Oracle só com a estrutura (8.674 tabelas, zero linhas); cópia do `.dmp` removida | ADR 0002, item 16 |

## O que ficou pela metade (parado de propósito, sem perda)

Os workflows só retomam do cache na mesma sessão. Na nova sessão, **relance do zero**: os briefs estão prontos
e são baratos.

1. **Carregador do SIGTAP** (F1.4).
   - O agente estava escrevendo e nenhum arquivo foi gravado.
   - Brief: `docs/obra/fatias/catalogos/brief.md`. Fatia: `docs/obra/fatias/catalogos/sigtap.md`.
   - Os CIDs já estão em `termo_terminologia` (terminologia `cid10`), para `procedimento_sigtap_cid`.
   - A CBO do arquivo `tb_ocupacao` vai para `ocupacao_cbo`.
   - Teste: `python3 -I catalogos/carregar.py teste_catalogos sigtap`, duas vezes.
2. **F2.1, `packages/nucleo` sobre o MariaDB.**
   - Não começou de fato: o acréscimo do driver ao `package.json` foi desfeito.
   - Brief: `docs/obra/fatias/f2-nucleo/brief.md`. Plano: `docs/obra/passagens/F2-plano.md`.
   - Relançar com o workflow de 3 etapas: construir, revisar adversarialmente e corrigir.

## Pendências pequenas

- `topografia_tumor` ficou com 0 linhas na carga da CID-10. A CID-O no ZIP do DATASUS só traz morfologia; é
  preciso buscar a fonte da topografia.
- **Push ao GitHub:** o token precisa da permissão **Workflows (Read and write)**, por causa de
  `.github/workflows/ci.yml` vindo do `new-sgh`. Depois, rode `git push origin main` (a regra exata já está
  liberada nas permissões do Claude Code). O falso positivo do Semgrep já foi liberado no GitHub.
- 72 tabelas principais de módulos operacionais sem `estabelecimento_id`: são filhas de quem já tem. Revisar
  por módulo na F2.
- 31 scripts do `package.json` ainda citam o legado ou o Firebird. Limpar na F2.2.

## Ambiente em pé (não pare)

| Serviço | Endereço | Observação |
|---|---|---|
| `sante-sgh-mariadb` | `127.0.0.1:3410` | Bancos: `plataforma`, `cliente_teste_catalogos` |
| `sante-sgh-oracle` | `127.0.0.1:1521/FREEPDB1` | Só a estrutura do MV, para referência |

- **Disco:** 148 GB livres em 19:25. O vigia (`tools/obra/vigia-disco.sh 130`) foi parado na pausa; religue
  em segundo plano ao retomar.
- **Commits locais ainda não enviados:** veja com `git log --oneline origin/main..main`.

## Primeiro passo da próxima sessão

1. Avise: "Rodando sob o protocolo de otimização de tokens e reports periódicos".
2. Religue o vigia de disco.
3. Relance em paralelo o carregador do SIGTAP e a F2.1. Use o cabeçalho "Orquestrando com otimização do uso
   de tokens" e reporte a cada 50 minutos.
