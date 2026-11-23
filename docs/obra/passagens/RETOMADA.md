# RETOMADA (2026-11-22, 22h40): carga real da ProntoCardio para o dono navegar

**Ao ouvir "retomar", siga esta ordem:**

1. Leia este arquivo e o `AGENTS.md` (em especial "Orquestração com orçamento", a regra 5 e a regra 8).
2. Avise o dono: "Rodando sob o protocolo de otimização de tokens e reports periódicos". Ligue:
   - o vigia de disco: `tools/obra/vigia-disco.sh 130`, em segundo plano;
   - o vigia de memória v2 (abaixo);
   - o relatório de 50 minutos (processo abaixo);
   - **primeiro:** um relatório padrão logo no começo, com o estado do incidente.
3. Siga a seção **INCIDENTE** e depois a **fila**, a partir do primeiro item não feito.
4. **Toda resposta em português** (diretriz do projeto, dono, 23/11).

## Economia de tokens na sessão nova (obrigatório, AGENTS.md e plano-orquestracao.md)

- **Guardião G1 a G6 sempre** (tools/obra/guardiao.py). Workflow com:
  - `// ORCAMENTO: <id>` e `docs/obra/orcamentos/<id>.md` (com `estimativa_M` e `teto_M` = estimativa + 30%);
  - PREFIXO idêntico, com o brief colado e "ECONOMIA (regras";
  - `LIMITE_AGENTES` e o invólucro `chamar()`.
  - Agente avulso com `ORCAMENTO: <id>` na primeira linha.
  - Modelo de script: o da rodada conta-itens-3, na pasta workflows/scripts da sessão anterior. Copie a estrutura,
    troque o BRIEF.
- **Orçamento é meu** (o dono não aprova).
  - Ao fechar a rodada, meça com `python3 -I tools/obra/medir_consumo.py <pasta da sessão>` e registre em
    docs/obra/consumo.md o estimado e o gasto.
  - Passou do teto: pare, ache a causa, otimize.
- **Sessão do orquestrador curta:**
  - a anterior passou de 1.950 turnos (76 M);
  - durante a carga longa, não fique conversando: vigia em script, relatório só no cron, leitura só por script com
    saída curta;
  - ao passar de cerca de 150 turnos, grave a passagem e peça ao dono para abrir chat novo.
- **Todos os agentes usam o Opus;** a economia vem só da estrutura:
  - fatia pequena, saída em arquivo, revisor só do diff;
  - prova longa (diag-cadeia de 50 min) fica com o ORQUESTRADOR em segundo plano, nunca dentro do agente (estoura o
    G6).
- **Qualidade não se troca por economia:** revisão adversarial, verificação por script e conferência final sempre.

## Relatórios periódicos (obrigatório, dono)

- **Agendamento:** CronCreate com `recurring: false`, para daqui a 50 minutos (minuto fora de :00 e :30), com o
  prompt EXATO abaixo. Cada relatório agenda o seguinte ao terminar. O agendamento morre com a sessão: na sessão nova,
  agende de novo logo no começo.
- **Prompt exato:**

  > Relatório de 50 minutos da obra sante-sgh. Formato OBRIGATÓRIO do dono (memória formato-relatorio-50min): tabelas
  > 1) Feito: recurso | início | término; 2) Em execução: recurso | início | término previsto | completude %; 3) Por
  > fazer: recurso | início previsto (data/hora) | tamanho % do total; 4) Completude total % e término previsto.
  > Depois bullets: status da otimização do consumo (meça com python3 -I tools/obra/medir_consumo.py <pasta da
  > sessão>; gasto x orçamento, por papel, % da linha de base); achados, reparos e funções feitas na onda; o que já
  > funciona para testar no browser (URL e caminho); comentários gerais. Cabeçalho "Orquestrando com otimização do
  > uso de tokens" se houver subagentes. Siglas da saúde explicadas. Ao terminar, agende o próximo com CronCreate
  > one-shot para daqui a 50 minutos com este mesmo prompt.

- **Pasta da sessão para o medir_consumo:** `/home/mmalves/.claude/projects/-home-mmalves-workspace-redesante-sante-sgh/<id
  da sessão>` (a da sessão nova; a desta noite era a04c305e-fa76-41e3-b357-d645839b9e20).
- **Conteúdo que o dono cobra:**
  - linha de previsão para navegar na ProntoCardio no topo;
  - tarefas em termos da área hospitalar;
  - siglas explicadas no primeiro uso (TISS, TUSS, OPME, glosa, repasse...);
  - números medidos, nunca estimados sem dizer;
  - falhas relatadas como são (inclusive minhas, como a carga parada sem eu ver);
  - URL do painel `https://<ip>:5310` (login `admin`) e do Adminer `https://<ip>:5320`; confira o IP com
    `ip -4 addr show ens33` (DHCP: já foi .101, .104 e 192.168.1.75).
- **Vigia da carga** (ligar junto com a carga):
  - log a cada 5 min em `sante-sgh-dados/obra/progresso-carga.log`;
  - alarme de parada só quando estado, etapa, percentual e contagem ficam iguais e a CPU do worker fica abaixo de 5%
    por 15 min (a releitura do que já entrou não cresce a contagem e dava alarme falso);
  - não use COUNT(*) em conector_origem a cada 5 min: pesa (tabela de dezenas de milhões);
  - use MAX(id) e o `batimento_em` da execução, e acuse também VM parada (relógio andou muito mais que o batimento).

## Regras que o dono reforçou

- **Orçamento é meu:** estimo em `docs/obra/orcamentos/<id>.md`, meço com `tools/obra/medir_consumo.py` e presto
  contas no relatório.
  - O guardião G1 a G6 vale sempre.
  - Todos os agentes usam o Opus; a economia vem só da estrutura.
- **Sessão curta:** grave esta passagem a cada bloco.
  - A sessão de 21 e 22/11 passou de 1.500 turnos e custou de 11 a 13 M de tokens lidos por hora só no orquestrador.
- **Execução pesada uma de cada vez:**
  - `flock sante-sgh-dados/obra/pesado.lock <comando>`, com no máximo 4 gravadores nas medições;
  - a VM caiu por memória em 22/11, com três medições juntas.
- **Logs e scripts em `sante-sgh-dados/obra/`,** nunca no `/tmp`, que some no reinício.
- **Nunca copie o `.env`.** Edite no lugar e nunca imprima valores.
- **Importação é continuidade:** a importação nunca regrava uma linha já vista, nem recusada.
  - Correção de mapa depois da carga: passada com `CONECTOR_SO=<tabelas>` e `CONECTOR_REPROCESSAR_RECUSADAS=1`.
- **Liberação:** só depois que eu mesmo conferir a conciliação e as telas populadas. Depois, aviso no chat e e-mail
  por `python3 -I tools/obra/avisar_dono.py`, só com contagens.

## Ambiente (depois dos reinícios de 22/11)

- **IP da VM por DHCP:** já foi 192.168.0.104, 192.168.0.101 (rede fixa) e 192.168.1.75.
  - O certificado `certs/servidor-vm.crt`, emitido pela CA `certs/ca-sgh-vm.crt` que o dono instalou, cobre os três.
  - O `DEV_ENDERECOS` do `.env` tem os três.
- **Painel:**
  - API: `API_PORTA=3310 API_MODULOS=todos node apps/api/dist/main.js`, com o Node 24 do nvm;
  - web: `set -a; . ./.env; set +a; vite preview --config apps/web/vite.config.ts` (porta 5310, HTTPS);
  - login do dono: `admin`, com a senha que ele trocou em 21/11.
- **Adminer:** `https://<ip>:5320`, em `infra/gestao`, com Caddy e o certificado da CA local.
- **Vigia de memória v2:**
  - abaixo de 6 GB livres, para os containers do conector que não são a carga;
  - abaixo de 2,5 GB, para também a carga;
  - log em `sante-sgh-dados/obra/vigia-memoria.log`.

## Estado da carga real

- **Execução 8,** iniciada em 22/11 às 21h55:
  - cliente `prontocardio` recriado do zero;
  - roda a partir do worktree `../sante-sgh-wt/velocidade`, commit 96cb876, uma cópia estável do código;
  - `CONECTOR_GRAVADORES=4` e `CONECTOR_ADIAR=TBCABTRILHA,TBLANTRILHASGH` (trilhas de auditoria na 2ª passada).
  - Progresso em `sante-sgh-dados/obra/progresso-carga.log`.
  - Previsão (refeita em 23/11, 1h40, pela contagem por tabela em `imagem_tabela`): 165 milhões de linhas mapeadas,
    menos 50 milhões das trilhas adiadas = 115 milhões; ritmo medido de 6,4 milhões/h; fim por volta de 23/11, entre
    15h e 18h. Decisão: não reiniciar (a divisão por faixas só vale na primeira carga).
- **Correções feitas depois de 96cb876 e que a carga não tem:** C8 (contatos), L6-04 e L5-05 (identidade),
  reprocessar recusadas, testes. Estão na main até a6205c2.
- **Prova da cadeia** (`tools/obra/diag-cadeia.sh` sob o flock, 1 gravador): disparada às 22h32, log em
  `sante-sgh-dados/obra/logs/diag-final.log` e resultado em `sante-sgh-dados/obra/lib/diag-cadeia/`. Toda entidade
  principal tem de mostrar gravados > 0 e recusa só justificada.

## ESTADO EM 23/11, 12h10 (sessão 34c8458c encerrada por tamanho: cerca de 470 turnos). COMECE POR AQUI.

**Ao retomar:** relatório de 50 min (CronCreate), vigia de alarme (`grep -E 'ALARME|FIM'` no progresso-carga.log) e:

1. **Rodada `ids-bigint` (PRIMEIRA, grave):** o espelho (tools/db/espelho.py, BASE_LOCAL = 10^12, desde f45fafbc
   de 21/11) põe todo item PRÓPRIO do hospital nas tabelas de catálogo com id >= 10^12, mas 64 arquivos de
   packages/contratos usam `id = z.number().int().positive().max(2_147_483_647)`. Toda gravação que referencie item
   próprio é recusada com entrada-invalida. Medido em 23/11 12h05 na ProntoCardio (só contagens): 43 tabelas com
   AUTO_INCREMENT >= 10^12, item_referencia_matmed com 713.571 linhas acima de 10^12; espelho com MAX id 707.188.
   Correção decidida pelo orquestrador: o contrato aceita id BIGINT até Number.MAX_SAFE_INTEGER (convenção do DDL:
   BIGINT UNSIGNED), sem mudar o BASE_LOCAL (mudar exigiria refazer a carga). Conferir também a web (parse de id),
   a API (parâmetros de rota `:id` com ParseInt/regex de 9 ou 10 dígitos) e o worker. Prova: teste HTTP com id
   10^12 + 1 em pelo menos admissão (cidPrincipal), conta (item faturável) e estoque. Orçamento a fazer
   (docs/obra/orcamentos/ids-bigint.md); construtor como mudança compartilhada (2,5 a 4,5 M), revisor, conferidor.
2. **Teste de integração da internação desatualizado:** apps/api/src/modulos/adt/porta-propria.int.spec.ts (10 de 12
   falham) e 2 do nir-porta-propria.int.spec.ts. Causas: a entrada manda `caraterTiss` e `caraterAdmissao`, que o
   esquema de internar (packages/contratos/src/internacao/adt.ts ~250) não tem mais, e `cidPrincipal` com id 10^12
   (item 1). Os .int.spec não rodam na esteira: considerar rodar `testes:integracao` periodicamente na VM.
3. **Esteira do GitHub: VERDE pela primeira vez em 23/11, 14h05** (a36d5e7c, execução 45216627979, os 6 passos).
   Regra do dono (AGENTS.md, regra 9): todo push só depois de `flock sante-sgh-dados/obra/pesado.lock
   tools/obra/ci-sim.sh <commit>` com `RESULTADO: VERDE` (cerca de 35 min; copie o script para fora do worktree antes
   de rodar, como em sante-sgh-dados/obra/ci-sim-run.sh, porque ele recria o worktree ../sante-sgh-wt/ci-sim).
   Conferir a esteira pela API (curl com o token GITHUB do .env; não há gh).
4. **E2E W0-07 do NIR** (apps/web/e2e/w007-nir-crud.spec.ts, reescrito para o cancelamento) não rodou: o Playwright
   não subiu o webServer em 240 s na VM. Investigar.
5. **Depois da carga (execução 11):** aplicar no cliente_prontocardio as migrações 00_NUCLEO/24 (trilha encadeada,
   SBIS-16) e 07_INT/24 (NIR; antes contar pedido_leito de origem 'sistema' cancelado ou rejeitado e reserva_leito
   'cancelada' de origem 'sistema'), rodar `tools/db/semear-acesso.ts prontocardio` e reiniciar a API.
6. **Painel:** API e web sobem à mão (não voltam no reinício): comandos na seção Ambiente; depois de qualquer
   criar_cliente, rodar o semear-acesso do cliente e reiniciar a API (ela guarda os estabelecimentos ao subir).
   O dono entra em https://<ip>:5310/entrar (cliente demo, "Estabelecimento principal", opção do administrador da
   plataforma); só dizer "pode entrar" depois de testar GET /api/estabelecimentos e a recusa 401 de senha errada.
7. **Processos em segundo plano que morrem no reinício:** vigia-memoria.sh, vigia-disco.sh 130, vigia-carga.sh 11,
   `tools/obra/despejar-base.sh --laco` (autorizado pelo dono em 23/11), API e web.
- **Regras reforçadas hoje:** não fazer push com rodada aberta na mesma árvore (o push leva os commits pela metade);
  o verificar:tudo (10 min) fica com o orquestrador em segundo plano, nunca dentro do conferidor (estoura o G6);
  agentes usam ./pnpm exec, nunca npx.
- **Feito hoje:** SBIS-16 e SBIS-26 cumpridas (matriz sem lacuna); NIR com cancelamento em vez de exclusão física
  (decisão do dono) e nenhuma tabela clínica com DELETE em nenhum papel; esteira com Gotenberg; verificar:tudo verde.
  Consumo em docs/obra/consumo.md.

## ESTADO EM 23/11, 10h30 (sessão 34c8458c): incidente RESOLVIDO, recarga em curso

- **MariaDB:** o dicionário do InnoDB estava corrompido (CREATE e DROP falhavam; .ibd sumidos). Por decisão do dono,
  o compose usa o volume novo `sante-sgh-mariadb-data-2` (commit f5f9fa84); o velho `sante-sgh-mariadb-data` (23 GB)
  fica guardado e só se apaga com novo OK. Restaurados de `sante-sgh-dados/backup/`: plataforma, espelho e o usuário
  dono_leitura. Os 10 clientes de teste foram recriados (`sante-sgh-dados/obra/recriar-clientes-teste.sh`).
  NÃO trazidos: f4r4_*, cm_*, cmbanco_*, conector_ctl_cm* e cliente_cm*/cliente_nucleo_d (bancos de prova; refazer
  pelas provas se precisar).
- **Despejo:** `tools/obra/despejar-base.sh` (458e951d). O laço diário (--laco, apaga com mais de 7 dias) foi barrado
  pelo modo automático: perguntar ao dono se liga.
- **Vigias** (scripts em `sante-sgh-dados/obra/`): vigia-memoria.sh (v2 recriado), vigia-disco (tools/obra),
  vigia-carga.sh <execução> (log em progresso-carga.log; ALARME e FIM).
- **Recarga:** execução 11, iniciada 23/11 10h22, worktree `velocidade` com a main até c8d4b742 juntada (suíte do
  conector 1.342 verde), `CONECTOR_GRAVADORES=3`, trilhas adiadas. Log: `sante-sgh-dados/obra/logs/worker-e11.log`.
  Previsão: cerca de 18 h (perto de 24/11, 4h a 6h). Antes do congelamento a execução 10 estava em 90% (onda 161/218).
- **Esteira do GitHub:** nunca ficou verde. 7ab0c11b sobe o Gotenberg na esteira e pula o teste das capturas
  (fora do git). Sobram SBIS-16 e SBIS-26: rodada `sbis-16-26` (workflow wf_ef17244e-bae, orçamento 10 M, teto 13 M).
  Ao terminar: medir com medir_consumo.py e registrar em consumo.md; conferir a esteira pela API do GitHub
  (curl com o token GITHUB do .env; não há gh na VM).

## INCIDENTE (23/11, 9h30): MariaDB de desenvolvimento corrompido. COMECE POR AQUI.

**Estado em 23/11, 9h45 (sessão encerrada a pedido do dono para recomeçar em contexto limpo):**

- **O que houve:** das 5h20 às 9h25 nada rodou na VM, sem reinício (uptime 18 h). Os crons de relatório não
  dispararam e o kernel registrou falta de CPU ("rcu ... OOM is now expected behavior"). Ao voltar, o MariaDB
  (container `sante-sgh-mariadb`, volume `sante-sgh-mariadb-data`) passou a ler páginas inválidas ("Space id and page
  no stored in the page ... should be").
  - Tabelas afetadas: conector_ctl_prontocardio (conector_origem, pendencia, conector_bloco),
    cliente_prontocardio (conta_hospitalar_item e outras), cliente_nucleo_d, conector_ctl_nucleo_d e
    nucleo_d_plataforma.
- **A corrupção alcança o dicionário interno do InnoDB, ou seja, a instância inteira:**
  - DROP DATABASE dos 5 bancos acima falha com 1034 "Index ... is corrupt" (o dono autorizou o DROP em 23/11);
  - num banco NOVO (`zz_teste_drop`, criado por mim como teste e que ficou com a tabela `t`), CREATE TABLE com FK
    falha com errno 126 "Index is corrupted", e o log diz "Cannot save table statistics ... Data structure
    corruption";
  - ou seja, há páginas ruins no espaço do sistema ou no `mysql.innodb_table_stats`/`innodb_index_stats`. Nenhum
    cliente novo pode ser criado nesta instância como está.
- **Íntegros pelo CHECK TABLE** (leitura): `plataforma` (6 tabelas; login do dono `admin`) e `espelho` (29 tabelas
  com dados). Os outros bancos (cliente_f22_o*, cliente_demo, cliente_teste_*, cm_repacagd, cmbanco, f4r4_*) não foram
  conferidos.
- **Carga parada:** o container do worker da execução 10 foi parado; a execução 10 ficou com estado "gravando" na
  tabela conector_execucao da plataforma (marcar como falhou ao retomar). Nenhum container do conector rodando.
  Vigias de disco e de memória: PARADOS (a sessão acabou).

**Diagnóstico da causa (feito em 23/11, 9h50, só leitura):**
- Kernel: `watchdog: BUG: soft lockup - CPU#14 stuck for 13511s! [vmtoolsd]` às 9h26: a VM ficou 3h45 sem CPU do
  hipervisor (VMware), das 5h21 às 9h26. Causa do lado do HOST (suspensão/hibernação/economia de energia, snapshot,
  disco do host cheio ou travado, host sem memória). A VM foi reiniciada às 9h32 (o dono foi perguntado se foi ele).
- MariaDB com durabilidade máxima: innodb_doublewrite=ON, innodb_flush_log_at_trx_commit=1, O_DIRECT,
  checksum full_crc32. A corrupção vem de escrita confirmada e perdida/embaralhada pelo disco virtual, não da
  configuração. Explicado ao dono (o Firebird também corromperia; nunca teve essa carga num congelamento).
- Pedido ao dono, do lado do host: sem suspensão/hibernação durante carga, sem snapshot durante carga, disco do host
  com espaço e interno, olhar o vmware.log da VM por volta de 5h20 ("suspend", "stun", "disk full", "sleep").
- Do nosso lado (a fazer): despejo diário de `plataforma` e `espelho` fora do volume do MariaDB; carga com 3
  gravadores; vigia de VM parada (diferença entre relógio e batimento).
- **Estrago provavelmente menor:** depois do reinício, CREATE TABLE com FK funciona (zz_teste_drop.f2 criada), mas o
  log diz "Cannot save table statistics ... Data structure corruption": o dano está em `mysql.innodb_table_stats` e
  `mysql.innodb_index_stats` (só estatísticas, reconstruíveis) e nos bancos de teste quentes. O DROP falha porque
  apaga as estatísticas. Tente nesta ordem, antes de pensar em recriar o volume: (1) mariadb-dump de plataforma e
  espelho para sante-sgh-dados/backup/; (2) recriar as duas tabelas de estatística (CREATE ... LIKE em tabela nova,
  RENAME, DROP da velha; ou mariadb-upgrade/script oficial) com `innodb_stats_persistent` desligado se preciso;
  (3) DROP dos 5 bancos de teste (autorizado) e de zz_teste_drop; (4) se ainda falhar, innodb_force_recovery para
  despejar e, só com OK explícito do dono, recriar o volume.

**Próximos passos, em ordem:**

1. **Investigar a causa da parada das 5h20** (pedido do dono: "identifique o que houve para que não ocorra mais").
   Leitura só: `journalctl -k --since "2026-11-23 05:00" --until "2026-11-23 09:40"`, `journalctl --since ...` (procure
   suspend, vmtoolsd, "hung task", "blocked for more than", I/O error, ext4, sda, oom-killer, memória), `last -x`,
   `/var/log/syslog`, os .crash em /var/crash (antigravity-ide e chrome, de 9h26). Pistas: às 5h09 a memória livre
   caiu a 7 GB com swap de 13 GB em uso, carga com 4 gravadores (cerca de 30 GB de RSS no coordenador) mais a prova
   diag-cadeia, mais IDE e Chrome; kworker de writeback a 84% de CPU às 9h26. Hipóteses: falta de memória com swap
   e escrita travada no disco virtual; pausa ou snapshot da VM no host (VMware: vmtoolsd); disco do host cheio ou lento.
   Registre a conclusão em docs/obra/consumo.md ou num achado próprio e na memória execucao-pesada-serializada.
2. **Recuperar o MariaDB (decisão do dono para o passo destrutivo):**
   a. Despejar (mariadb-dump, só para arquivo em sante-sgh-dados/, nunca no git) o que precisa sobreviver: `plataforma`
      e `espelho`, e o que mais o dono quiser; os bancos cliente_* de teste e os de prova podem ser recriados pelos
      scripts (tools/db/criar_cliente.py, semente do espelho por tools/db/espelho.py).
   b. Com o OK explícito do dono: parar o container, recriar o volume `sante-sgh-mariadb-data` (apagar volume é ação
      irreversível, regra 9) ou tentar antes `innodb_force_recovery` para despejar; subir e restaurar.
   c. Reaplicar migrações (validar_migracoes) e conferir.
3. **Prova da rodada conta-itens-3** (interrompida pela suspensão): `flock .../pesado.lock env CONECTOR_GRAVADORES=1
   tools/obra/diag-cadeia.sh`; esperado FCLANEXT restricao_destino_1048 perto de 0 (era 6.776) e
   conta_hospitalar_item acima de 18.241; TBMATMED 20.000 gravados (já provado na conta-itens-2).
4. **Recarga da ProntoCardio do zero** (o dono já autorizou recriar o cliente de teste):
   - juntar a main no worktree `../sante-sgh-wt/velocidade` (hoje em 3e3a5c78 = main até ba82516c + correção do
     deadlock; faltam da main: conta-itens-2 e conta-itens-3, commits 6805f08b a 760ee049, e as migrações 12_FAT/33 e
     12_FAT/34), suíte verde lá;
   - recriar o cliente: o comando exato da execução 8 está no transcrito; resumo: apagar cliente/execuções/origem do
     cliente `prontocardio` na plataforma, `python3 -I tools/db/criar_cliente.py prontocardio "ProntoCardio (teste com
     a carga da cópia de 19/10/2026)" --origem conector_spdata --json`, `conector/conector.sh vincular prontocardio
     pc-20261019.fdb`, `conector/conector.sh enfileirar prontocardio importar` e, do worktree,
     `CONECTOR_GRAVADORES=4 CONECTOR_ADIAR=TBCABTRILHA,TBLANTRILHASGH setsid nohup conector/conector.sh worker >
     sante-sgh-dados/obra/logs/worker-eN.log 2>&1 &`;
   - por causa do incidente: considerar 3 gravadores e nenhuma prova pesada junto da carga;
   - vigias: `tools/obra/vigia-disco.sh 130`; vigia de memória v2; vigia da carga com alarme de parada (estado, etapa,
     percentual e CPU do worker iguais por 15 min); relatório de 50 minutos por CronCreate;
   - tamanho: 115 milhões de linhas mapeadas (sem as trilhas), cerca de 6,4 milhões/h: cerca de 18 h.
5. **Conferência e aviso ao dono** (fila abaixo, item 3), depois a 2ª passada das trilhas.

**Decisões do dono desta noite:** respostas sempre em português; DROP dos 5 bancos de teste autorizado; recarga do zero
autorizada; investigar a causa da parada.

**Decisões do orquestrador desta noite** (registradas nos orçamentos em docs/obra/orcamentos/):
- glosa só com motivo (conta-itens);
- material e medicamento pela proposta B (conta-itens-3);
- plano genérico na menor fonte, com pendência (plano-conta; um plano por fonte fica para depois de medir o uso);
- não reiniciar a carga por velocidade.

**Pendências técnicas abertas:**
- plano genérico ligado a 38 fontes;
- personalização do hospital sobre item licenciado sem destino;
- FCCODCON da L8-01 (expectativa sintética antiga);
- leitor tools/obra/cobertura_conector.py frágil com CHECK em várias linhas;
- sondas GLOSADO x VLR_PG e FCINTEGRPA sem data;
- tela web sem grupoAto;
- historico_mescla_migracao com ON DUPLICATE pode dar 1213 entre gravadores (teórico).

## Execução 9 (23/11, 3h05)

- A execução 8 parou na onda 49 de 208 (cerca de 30 milhões de linhas): deadlock 1213 num gravador (UPDATE de
  lancamento_repasse) e o coordenador esperando para sempre os outros (SIGTERM ignorado). Marcada como falhou.
- **Execução 9** continua a 8 (a importação pula o que já entrou): worktree `velocidade` com a main até ba82516c
  (C8, C10, C11, C12, conferidor) mais 914f3f15 (SIGKILL), `CONECTOR_GRAVADORES=1`, `CONECTOR_REPROCESSAR_RECUSADAS=1`,
  trilhas adiadas. Log do worker em sante-sgh-dados/obra/logs/worker-e9.log.
- Rodada `deadlock-paralelo` (agente em worktree isolado) corrige a causa; depois: parar a 9, juntar a correção no
  `velocidade` e continuar com 4 gravadores.
- A rodada `conta-itens-2` (material na conta, grupo de ato com DDL novo) entra pela passada de correção no fim.
- **Mapa antigo na ProntoCardio (conferidor conta-itens-2, 23/11):** as execuções 8 e 9 rodam no `velocidade` SEM
  ce084c18 (ATO de TBREPGER e TBPACTHM como grupo de ato) e SEM 6805f08b/c3be2be6 (TBMATMED licenciado ligado ao
  espelho, TBREFMEMTUSS sem filtro de licença). O hash da linha cobre só os bytes da origem: na passada seguinte essas
  linhas ficam "iguais" e são puladas. Caminho decidido, por tabela:
  - TBMATMED e TBREFMEMTUSS de tabela licenciada foram RECUSADAS (`licenca_nao_comprovada`): voltam com
    `CONECTOR_REPROCESSAR_RECUSADAS=1` (já ligado na 9), desde que o código novo esteja no worktree e o espelho do
    Brasíndice/Simpro esteja semeado no cliente (sem ele: `espelho_nao_carregado`, alta).
  - TBREPGER e TBPACTHM foram GRAVADAS com `funcao_equipe_cobranca_id` = id de TBGRAUPARTPROC e `grupo_ato_id` NULL:
    o reprocesso não corrige (a reaplicação só grava as colunas do mapa novo e deixa a função antiga). Caminho:
    **recarga limpa** do cliente (criar novo cliente pelo painel e importar) antes de usar o repasse; nunca reusar
    as regras de repasse e os itens inclusos do pacote desta carga. Prova na recarga: contagem de
    `regra_repasse_item` com `grupo_ato_id` preenchido contra TBREPGER.ATO<>0 lidas.

## Fila

1. Prova da cadeia (23/11, 0h25, depois de dac241fb, que corrigiu o NUMERO numérico que derrubava a carga de pacientes):
   as três etapas estão ok. Achado: plano (TBTIPPLANO, 1048) recusado derruba em cascata contas (FCCTAEXT, RECONTAS),
   itens (FCLANEXT) e produção de repasse (FCINTEGRPA). Rodada `plano-conta` (orçamento 4 M, teto 5,2 M) com um agente
   corretor em 23/11 0h30: feita (20c4b234, contas 618 -> 3.790 no recorte). Sobra na rodada `conta-itens` (workflow
   wf_8d5cc7ad-e3e, 23/11 1h35): feita em e3b0745c (C11, produção de repasse pela função titular), f76c7b99 (C12,
   glosa só com motivo), 677b7316 (conferidor) e ba82516c (teste); suíte 1308 verde; prova diag-cadeia disparada às
   1h50 (log sante-sgh-dados/obra/logs/diag-ci.log). NÃO edite conector/ enquanto ela roda (código montado ao vivo).
   Sobra para a rodada seguinte (depois da prova):
   - material e medicamento na conta (FCLANEXT TIPO 4 -> item faturável): bloqueado pela checagem de licença do
     ADR 0006(3); o item próprio do hospital tem de entrar ativo; decidir o caminho sem trazer licenciado pelo conector;
   - TBREPGER.ATO e TBPACTHM.ATO são grupo de ato: DDL novo regra_repasse_item.grupo_ato_id (12_FAT) + domínio do
     repasse lendo o grupo; depois L8-06 linha 45 e L8-03 linha 205 por ref:TBTABATO;
   - plano genérico ligado a 38 fontes vira 1 plano na menor fonte: medir quantas contas usam os 2 planos antes de
     decidir por um plano por fonte;
   - sondas pendentes (negadas pelo classificador do modo automático para o agente): GLOSADO x VLR_PG<VALOR_C/MOTGLO
     e FCINTEGRPA sem data de integração; script em scratchpad/sonda/sonda2.py (pode ter sumido).
   Lista da passada de correção: TBTIPPLANO, TBTIPPLCONV, RICADINT, RIPREINT, FCCTAEXT, FCCTAAUD, FCDIAEXT, FCGUIAS,
   FCRECIBO, RECONTAS, FCFAIPAC, FCCTAEXT_FCTISSLOTEPROT, FCIRREGULARID, FCLANEXT, FCCTRLANCIHA, FCINTEGRPA,
   FCLANEXTSEQITEM, REPROEXT, RIPROEXT, SILANEXA (+ a lista do item 2). Os 32 destinos zerados sem origem no mapa são tabelas do produto sem fonte (não são perda).
2. Ao fim da execução 8:
   - juntar a main no worktree `velocidade` (ou rodar da main);
   - fazer a passada `CONECTOR_SO` com `CONECTOR_REPROCESSAR_RECUSADAS=1`, com a lista do conferidor da cadeia-mapa-2:
     TBMEDSOL, FAMEDSOL, TBMEDSOLWEBCAD, REPACAGD, SIPACAGD, REPACAGD_EXCLUSAO, SICADATE, RICADPAC, FCCTAEXT, RECONTAS,
     MFCONPAG, GECADNFS, SDGECADNFS, TBCBOPRO, TBCBOPRO_TBCONVEN, TBCBOPRO_TBUNIDAD, TBMEDESP, TBUSUCPL, TBPRESER,
     FCCODCON, REAGENDA, SIAGENDA, TBAGEBAN, TBCTABAN, TBBANCOS, MFBORDER, MFCTAUSU, TBCTRMEM, TBMATMED, TBVLRMEM,
     TBPERMEM, TBREFMEMTUSS, FCREFUND, TBPROCTO, mais TBTIPPLANO, FCLANEXT, FCINTEGRPA e o que a rodada `plano-conta`
     devolver.
3. **Minha conferência:**
   - conciliação por entidade, com o relatório L10 vermelho só no que for justificado;
   - telas populadas: agenda e marcações, médico por convênio, preço particular, repasse, contas, guias, glosa,
     autorização, RH, estoque, financeiro, prontuário.
   - Depois, aviso no chat e e-mail.
4. **2ª passada:** trilhas de auditoria. Antes, corrigir as 6,8 milhões de recusas por CHECK em `evento_auditoria`
   vistas na execução 7.
5. **Pendências abertas:**
   - TBTIPPLANO;
   - MFCONPAG 1048;
   - prova do GECADNFS em dado real;
   - a faixa de CEP deve vir do catálogo licenciado de CEP;
   - L6-04 com C9 nas recusas sintéticas planejadas (`CONECTOR_RECUSA_LIMITE_PERCENTUAL`) e esperados do SIAGENDA;
   - L8-01 com FCCODCON `valor_fora_do_dominio`;
   - TBMEDSOL: medir as colisões `adocao_por_valor_presumido`.
6. **Depois da liberação:**
   - esteira do GitHub, etapa 2: ponta a ponta, segurança, SBIS-16 e SBIS-26, mais a decisão do dono sobre as
     capturas do sistema antigo;
   - push;
   - os 16 módulos grandes (F3);
   - F5, F7 e F8;
   - etiquetas, 2FA por e-mail e login também por e-mail;
   - API de compatibilidade com os agentes Hal-AI.
