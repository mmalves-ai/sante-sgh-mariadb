# RETOMADA (2026-11-22, 22h40): carga real da ProntoCardio para o dono navegar

**Ao ouvir "retomar", siga esta ordem:**

1. Leia este arquivo e o `AGENTS.md` (em especial "Orquestração com orçamento", a regra 5 e a regra 8).
2. Avise o dono: "Rodando sob o protocolo de otimização de tokens e reports periódicos". Ligue:
   - o vigia de disco: `tools/obra/vigia-disco.sh 130`, em segundo plano;
   - o vigia de memória v2 (abaixo);
   - o relatório de 50 minutos: formato da memória `formato-relatorio-50min`, com CronCreate one-shot.
3. Siga a **fila** abaixo, a partir do primeiro item não feito.

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

## Execução 9 (23/11, 3h05)

- A execução 8 parou na onda 49 de 208 (cerca de 30 milhões de linhas): deadlock 1213 num gravador (UPDATE de
  lancamento_repasse) e o coordenador esperando para sempre os outros (SIGTERM ignorado). Marcada como falhou.
- **Execução 9** continua a 8 (a importação pula o que já entrou): worktree `velocidade` com a main até ba82516c
  (C8, C10, C11, C12, conferidor) mais 914f3f15 (SIGKILL), `CONECTOR_GRAVADORES=1`, `CONECTOR_REPROCESSAR_RECUSADAS=1`,
  trilhas adiadas. Log do worker em sante-sgh-dados/obra/logs/worker-e9.log.
- Rodada `deadlock-paralelo` (agente em worktree isolado) corrige a causa; depois: parar a 9, juntar a correção no
  `velocidade` e continuar com 4 gravadores.
- A rodada `conta-itens-2` (material na conta, grupo de ato com DDL novo) entra pela passada de correção no fim.

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
