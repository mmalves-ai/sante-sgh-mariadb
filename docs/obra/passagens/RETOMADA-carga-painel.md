# RETOMADA da obra carga-painel (pausada em 24/11/2026, 17h51, para troca de conta da LLM)

## Estado
- Worktree `sante-sgh-wt/autor-registro`, branch `conector-autor-registro`, a partir de `bdc3bc88`.
- **Feito, com commit, revisado adversarialmente e corrigido:**

  | Fatia | O quê |
  |---|---|
  | S1 | migração `db/plataforma/0093`, contratos, estados pausando/pausada, interface `origem.py` |
  | I1 | Firebird simulado em `infra/firebird-simulado`, ADR 0010 e regra 4 |
  | B-origem | leitura direta pelo servidor |
  | B-motor | progresso ao vivo, pausa, log, modos e serviço |
  | B-api | rotas `plataforma/carga` |
  | B-web | tela `/plataforma/carga` e menu |

- **Faltava só o integrador.** Ele tinha começado (12 ferramentas):
  - subiu o container `sante-sgh-fb-prontocardio`, que segue no ar, saudável, em 127.0.0.1:3354 e no alias `fb-prontocardio` da rede interna;
  - deixou **sem commit** uma edição em `conector/conector.sh` (rede interna e senha para `testar-origem` e `pausar`). Cópia em `sante-sgh-dados/obra/carga-painel/integrador-parcial.patch`.
- **Não aplicado ainda:**
  - migração 0093 no banco `plataforma` real;
  - serviço do conector;
  - painel de teste 3311/5311;
  - carga.
- A execução 17 da ProntoCardio continua órfã em "gravando". O serviço a marca como "falhou" ao subir.

## Como retomar
1. Na mesma sessão: `Workflow({scriptPath: <script original>, resumeFromRunId: "wf_fea30e83-5a9"})`. Reaproveita as 17 chamadas prontas e roda só o integrador.
2. Em sessão nova: `Workflow({scriptPath: "/home/mmalves/workspace/redesante/sante-sgh-dados/obra/carga-painel/continuar-integrador.js"})`. É só o integrador, com o quadro das fatias embutido. Os resultados completos de cada fatia estão em `sante-sgh-dados/obra/carga-painel/resultados-fatias.json`.
3. Gasto até a pausa: cerca de 9,5 M de 27 M (teto de 35 M). O integrador está orçado em 3,5 M.

## Combinações com as outras sessões
- **"Sessão de Construção"** (orquestradora da main):
  - faz commits contínuos na main na 2ª volta da F3;
  - eu faço merge normal do branch na main, sem rebase, e aviso;
  - o push é dela, no fim da rodada.
- **Migrações do `cliente_prontocardio`:** ficam comigo, todas juntas, antes de religar a carga. Ele não tem as migrações da main de 24/11.
- **Carga da ProntoCardio:** é minha. Ninguém mais a religa.

## Depois da tela
- **Recusas da carga:** 12,4 M linhas próprias em 242 tabelas e 24 M em cascata. Lista em `sante-sgh-dados/obra/recusas-distintas-2026-11-24.tsv`.
- **Causas principais:**
  - registro clínico sem login do autor (precedente: `06_PEP/40_tabelas.sql:7`);
  - alta médica sem profissional;
  - catálogos não ligados;
  - lote vazio;
  - trilhas adiadas.
- **Defeito de conferência:** a conciliação antiga dizia "0 divergentes" com recusas.
