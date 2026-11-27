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

## Recusas da carga, fase 2 (fechada em 26/11/2026, noite)

- **Commits no branch `conector-autor-registro`:** de `e5749bb1` a `5d9e1ad4`.
  - Lote R (decisões por item).
  - K1, K1b e K2: modelo e catálogos.
  - P0 a P7: mapa.
  - C1: motor.
  - T, T2 e V: suíte do conector e conciliação.
  - Lotes A, AF e AT: API, telas e testes.
  - Merge da `origin/main` 5ffc5dbf.
- **Prova:**
  - suíte do conector com 1471 testes OK (12 pulados, 2 falhas esperadas);
  - `verificar_mapa` ok;
  - `provar_migrado` ok, com 70 casos;
  - specs de domínio e de integração das API tocadas verdes;
  - a esteira (ci-sim) vai no sha entregue à Sessão de Construção.
- **A execução 24 da ProntoCardio continua PAUSADA.** Nada foi aplicado no `cliente_prontocardio`. O reprocessamento é pela tela "Carga e sincronismo" (diferencial com "reprocessar recusadas"), na ordem do plano §8, com a TBCABTRILHA (~2,7 h) sozinha.
  - Primeira execução com `CONECTOR_RESSEMEAR=brasindice:0`.

### Pendências escritas (não fechadas nesta fase)
1. **Conciliação de fatias sintéticas:** 41 de 68 conciliam. As 27 restantes já divergiam antes da fase 2 (lista e erros em `sante-sgh-dados/obra/recusas/construcao/V-conciliacao.txt`). Exemplos: L5-02, L5-04, L6-01..04, L6-10/11/13/14, L7-02/04/08, L8-01/02/04/05 (KeyError 'NOME' em `leitor.py:144`), exemplo_l9, exemplo_r5.
2. **`fatiar_conector --conferir`:** acusa L8-16, L8-17 e `indice.tsv` diferentes do gerado. Já acusava antes.
3. **Decisões clínicas a revisar:**
   - PRSITUACAOCHECAGEM 'Salvo' (1 de 14 rótulos) segue sem par e é recusado;
   - PRSITDOCUMENTOASSINADO 'Não verificado' e 'Indeterminado' foram para 'assinado';
   - L6-17 CHSITUACAO '=~aguardando', CHOCORRENCIA '=~emergencial' e CHCRITICIDADE '=~critica' ainda não passaram pela regra do pedido 67;
   - PRTPTCLE: 'final' e 'autoriza_procedimento' pelo nome.
4. **Agenda cirúrgica 'nao_informada' sem sala, início ou duração:** continua recusada (4025) pelo `ck_agendamento_cirurgico_sala`. Para decidir: isentar a 'nao_informada'.
5. **Ruído de pendências:**
   - SIRESPAD: 6 `pai_inexistente` por linha;
   - GELANPAC: `valor_presumido` do local adotado;
   - concorrente `senao` sem apagar `catalogo_codigo_inexistente`.
6. **Lote sem validade:**
   - o lote mandado pela tela nos movimentos liberados passa pela conferência com uma validade de comparação (`VALIDADE_DE_CONFERENCIA`);
   - a transferência para setor assistencial libera o lote;
   - o uso no setor é recusado.
7. **Medição completa do R9** (vias `ref:` anuláveis com pai pendente): parcial em `construcao/T-correcao/medicao-R9-parcial.tsv`.
8. **Leitura de rótulos de domínio da origem:** a V4 usou um isql próprio (só NOME/DESCRICAO de tabela de situação). Falta criar um modo de rótulos no `origem-contagem.sh`.
9. **Fica visível como recusa:**
   - R7 e R11 (não provados);
   - CBO por edição, DCB e TUSS 18/19/20/22 (sem arquivo oficial no cache);
   - contas externas sem atendimento;
   - TBMEDSOL divergentes.
10. **`01_SIS/95_kit_implantacao_tabelas.sql`:** 60 erros no `validar_migracoes`. Vêm da main e são da Sessão de Construção.

### Espelho do Brasíndice do cliente (27/11/2026, autorizado pelo dono)
- **Ressemeadura:** `semear-espelho pc-20261019.fdb --espelho cliente_prontocardio --ressemear brasindice:0` deixou a edição "0" com só 566 preços. A origem tem 3.446 linhas nessa edição, com 2.880 códigos repetidos, e o comando apagou 155.593 preços que vinham do espelho padrão. Resultado: 153.816 itens do Brasíndice ficaram sem preço.
  - O mesmo comando semeou o Simpro: 2.535 edições, 360.698 linhas e 709 recusadas.
- **Reparo, só com inserção:**
  - os 155.593 preços da edição "0" foram reinseridos a partir do espelho padrão, com os mesmos ids (`INSERT IGNORE`, numa transação);
  - os 566 preços da origem ficaram como histórico, com a vigência de 2014-03-07, contra 2000-03-01 no espelho.
- **Conferido:**
  - nenhum item do Brasíndice sem preço;
  - nenhum preço nem item do espelho ausente no cliente;
  - 18 itens com situação ou descrição atualizadas pela origem.
- **Lição:** não usar `--ressemear` numa edição adotada do espelho padrão, porque a edição da origem pode ser menor que a adotada. **Pendência de motor:** o `_ressemear` só pode trocar os preços quando a origem tiver ao menos o que a edição adotada tem; senão, deve recusar com aviso.
