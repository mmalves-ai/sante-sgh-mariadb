# Brief comum: tela "Carga e sincronismo" e leitura direta do servidor Firebird

Orçamento: `carga-painel` (docs/obra/orcamentos/carga-painel.md, na árvore principal). Pedido do dono em 24/11/2026.

## Onde trabalhar
- **Worktree:** `/home/mmalves/workspace/redesante/sante-sgh-wt/autor-registro`, branch `conector-autor-registro`.
  - Nunca edite `/home/mmalves/workspace/redesante/sante-sgh`: a main tem uma rodada de outra sessão aberta.
  - Nunca faça push.
  - Commit só dos seus arquivos (`git add <caminhos>`, nunca `-a`). Mensagem em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Cada agente é dono dos arquivos listados na sua fatia.** Precisou mudar arquivo de outra fatia? Não mude: descreva a mudança no seu resumo final.
- **Regras do AGENTS.md valem integralmente.** Em especial:
  - regra 1: sem nome SPDATA/MV no código ou na tela; "Firebird" é tecnologia e pode;
  - regra 5: logs, pendências e respostas só com contagens e agregados, nunca valores de linha;
  - regra 8: segredos só no cofre, nunca impressos;
  - ADR 0023: nenhum nome de sistema de origem nos textos da tela.

## O que o dono pediu (aceite)
1. **Menu e seleção.** No painel técnico, um menu **"Carga e sincronismo"** (rota `/plataforma/carga`), com a seleção do **conector Firebird** do cliente (ex.: ProntoCardio).
2. **Iniciar.** Botão **Iniciar carga**, com modo **completa** ou **diferencial**:
   - o diferencial não refaz o que já entrou (linha igual pulada pelo hash);
   - tenta de novo as recusadas;
   - aplica as alteradas.
3. **Progresso animado:** a tabela sendo carregada (nome de destino, de negócio) com animação e, ao lado, a barra com o percentual.
4. **Indicador de erros:**
   - contagem de recusas/erros e barra em relação ao total;
   - **cores distintas** na barra horizontal de evolução: gravado, recusado (erro) e restante.
5. **Serviço independente da tela.** A carga roda num serviço que **não para** se a tela fechar. Ao voltar, a tela mostra o progresso atual.
6. **Pausar e retomar de onde parou.**
7. **Logs:** gravados em arquivo em segundo plano, com **download pela tela** e acessíveis por disco ao orquestrador.
8. **Configuração da origem pela tela** (produção): host, porta (3050), caminho/alias do banco, usuário e senha (no cofre), mais **Testar conexão**.

## Decisão do dono (24/11): leitura direta
- Em produção, o conector lê **direto** o servidor Firebird do hospital, em transação somente leitura (SNAPSHOT + READ, uma transação só por execução).
- Isso emenda a regra 4. Fazer o ADR `docs/adr/0010-leitura-direta-do-servidor-firebird.md`.
- Em dev a leitura direta é **simulada**:
  - container `sante-sgh-fb-prontocardio` (Firebird 3.0.14), volume `sante-sgh-fb-prontocardio-data` com a cópia da base (o orquestrador já copiou e conferiu o sha256);
  - rede interna `sante-sgh-conector-int`, alias `fb-prontocardio`, porta 3050; loopback do host em `127.0.0.1:3354`;
  - usuário só leitura `CONECTOR_LEITOR` (só SELECT, via role);
  - senhas em `/home/mmalves/workspace/redesante/sante-sgh-dados/segredos/fb-prontocardio.env` (chaves `FB_SIM_SYSDBA_SENHA`, `FB_SIM_LEITOR_USUARIO`, `FB_SIM_LEITOR_SENHA`; nunca imprimir).

## Desenho (contratos entre as fatias)

### Banco plataforma: migração nova `db/plataforma/0093_carga_sincronismo.sql`
Idempotente: `validar_migracoes.py` aplica duas vezes. Use `IF NOT EXISTS` e `DROP CONSTRAINT IF EXISTS` antes de recriar CHECK.

**`cliente_origem`:**
- `tipo IN ('firebird_arquivo','firebird_servidor')`.
- Colunas novas, NULL: `nome_exibicao VARCHAR(120)`, `servidor_host VARCHAR(255)`, `servidor_porta INT UNSIGNED`, `servidor_banco VARCHAR(500)` (caminho ou alias), `servidor_usuario VARCHAR(63)`, `senha_referencia_cofre VARCHAR(200)`, `identidade_base JSON` (ods, página, data de criação e o que mais identifique a base, sem dado de pessoa).
- `caminho_relativo`, `tamanho_bytes`, `sha256` e `pagina_bytes` passam a NULL.
- CHECK por tipo:
  - arquivo exige os campos de arquivo;
  - servidor exige host, porta de 1 a 65535, banco, usuário e referência do cofre.
- O CHECK do caminho vale só quando ele não é nulo.

**`conector_execucao`:**
- Estados novos:
  - **`pausando`**: ativo; entra no `cliente_ativo` gerado e na lista de ativos;
  - **`pausada`**: final para fins de `cliente_ativo` e `ck_..._fim`, ou seja, `concluido_em` preenchido.
- Colunas novas: `pausa_solicitada_em DATETIME(3) NULL`, `pausa_solicitada_por BIGINT UNSIGNED NULL`, `arquivo_log VARCHAR(255) NULL` (caminho relativo à pasta de logs), `modo VARCHAR(20) NULL` (`completa` ou `diferencial`).
- Ajustar a coluna gerada `cliente_ativo` e os CHECKs de estado e de fim.
- Transições novas:
  - `gravando`/`lendo`/`abrindo`/`conciliando` → `pausando` → `pausada`;
  - `pausada` → nova execução com continuação.

### Progresso ao vivo: `contadores.progresso` (JSON, gravado pelo motor a cada batimento, ≤ 15 s)
```
{ "tabela_atual": "<tabela de destino>", "tabela_origem_linhas": N, "tabela_processadas": N,
  "onda": n, "ondas": m, "tabelas_feitas": n, "tabelas_total": m,
  "linhas_total": N (soma das contagens da origem no plano), "linhas_processadas": N,
  "gravadas": N, "puladas_iguais": N, "recusadas": N, "pendencias_aviso": N,
  "recusas_por_regra": {"restricao_destino_1048": N, ...},
  "recusas_por_tabela": [{"tabela": "<destino>", "recusadas": N}, ...] (top 20),
  "atualizado_em": "ISO" }
```
- **Percentual geral** = `linhas_processadas / linhas_total` (por linhas, não por tabelas). Não vale mais a faixa 79-93 sobre tabelas.
- Na tela:
  - **barra de evolução** = gravadas + puladas_iguais (cor de sucesso), recusadas (cor de alerta) e restante (fundo);
  - **indicador de erros** = recusadas sobre linhas_total.

### Conector (Python, `conector/`)
**Origem `firebird_servidor`:**
- `Leitor` aceita DSN `host/porta:banco`, usuário e senha.
- A senha é decifrada do cofre com `PLATAFORMA_CHAVE_MESTRA`, no mesmo envelope `v1.<iv>.<tag>.<corpo>` de `continuidade.py`. No dev, sem cofre de arquivo, aceite a senha por variável de ambiente indicada na referência `env:NOME`, só fora de produção.
- Sem abridor, dm-snapshot, gstat nem exigência de `MON$READ_ONLY`.
- **Uma conexão e uma transação SNAPSHOT READ por execução** (contagem e leitura na mesma fotografia).
- A contagem por tabela é feita na mesma transação.
- `identidade_base` é gravada. A continuação entre execuções exige a mesma identidade, no lugar de sha256/mtime.

**Pausa:**
- O batimento lê `pausa_solicitada_em`.
- Se preenchido, a execução passa a `pausando` e para no próximo ponto seguro:
  - de preferência no fim da onda, depois de `_commit` e `_fim_onda`;
  - numa tabela longa, no próximo `_commit`. A tabela incompleta fica sem marca, e o hash pula o que já entrou.
- Termina em `pausada`, com `contadores.continuavel=true`.
- `enfileirar --continuar` aceita a última execução `falhou` **ou `pausada`**.

**Modos:**
- `completa`: `importar`. Se a última importação ficou `pausada`/`falhou`, a tela oferece **Retomar**, que é `--continuar`.
- `diferencial`: com importação concluída, é `sincronizar` com `CONECTOR_REPROCESSAR_RECUSADAS=1`. Sem importação concluída, é importação com `--continuar`, mais o reprocessamento das recusadas. O hash pula o que já entrou.

**Log:**
- Arquivo por execução em `CONECTOR_LOG_DIR` (dev: `/home/mmalves/workspace/redesante/sante-sgh-dados/conector-logs/<cliente>/execucao-<id>.log`, montado no container).
- Linhas com hora; mudanças de etapa; início e fim de cada tabela com lidas/gravadas/puladas/recusadas; batimento a cada minuto; recusas por regra; erros com stack.
- Sem valores de linha (regra 5).
- O caminho relativo vai para `arquivo_log`.

**Conciliação:**
- A etapa final por entidade já calcula as recusadas. O resumo vai para `contadores.progresso` e para `contadores.conciliacao_carga` (`recusadas`, `conferido=false` quando há recusadas).
- A conciliação antiga, de contagem de leitura, passa a se chamar `conciliacao_leitura`. A tela nunca mostra "0 divergentes" quando há recusa.

**Serviço sempre ligado:**
- `conector/conector.sh servico subir|parar|estado`: container nomeado `sante-sgh-conector-servico`, `--restart unless-stopped`, no laço `worker`, com rede para a origem.
  - dev: rede interna `sante-sgh-conector-int`;
  - produção: variável `CONECTOR_REDE_ORIGEM`.
- O serviço sobrevive à tela e à API. `recuperar_orfas` trata a queda.

**CLI novo:** `testar-origem <cliente>` (conecta, abre a transação, conta as tabelas e devolve JSON com versão, ods e tabelas, sem dado) e `pausar <execucao>` (grava `pausa_solicitada_em`).

### API (`apps/api/src/modulos/plataforma-onboarding/`, controller novo `carga.controller.ts`, `@Controller('plataforma/carga')`)
- Só o ator da plataforma (mesmo `administradorDaSessao`/`exigir`), CSRF da guarda global, `@AuditadoNoHandler` nas escritas e permissão declarada `config.conexao.ler` (não crie permissão nova).
- Rotas:
  - `GET conectores`: clientes, cada um com origem, tipo, nome, `definido` da senha e última execução resumida.
  - `PUT clientes/:codigo/origem-servidor`: grava host/porta/banco/usuário/nome. A senha (opcional na alteração) vai ao **cofre** (`cofreDoAmbiente`; referência `cofre:conector/<cliente>/firebird-senha`, com regex própria) e nunca volta na resposta.
  - `POST clientes/:codigo/origem-servidor/testar`: ponte para `conector.sh testar-origem`.
  - `POST clientes/:codigo/carga` com `{modo:'completa'|'diferencial'}`: enfileira conforme o desenho; 409 se já houver ativa.
  - `POST clientes/:codigo/carga/pausar`
  - `POST clientes/:codigo/carga/retomar`
  - `GET clientes/:codigo/carga`: progresso da execução ativa, ou da última, com `contadores.progresso`, estado, etapa, batimento e `batimentoAtrasado` (mais de 3 minutos sem batimento numa ativa).
  - `GET clientes/:codigo/carga/:id/log`: download `text/plain`, attachment, no-store, lido de `CONECTOR_LOG_DIR` com proteção de caminho.

### Web (`apps/web/src/modulos/plataforma/`)
- Tela nova `CargaSincronismoTela.vue` em `/plataforma/carga`.
- Componentes de `@sgh/ui`: SanteSelecao (nunca `<select>` cru), SanteBotao, SanteAlerta, SanteEstado. Cores só por tokens `var(--sgh-*)` (stylelint).
- **Seleção do conector:**
  - mostra tipo, endereço e estado;
  - painel "Configurar origem do servidor" com formulário e **Testar conexão**.
- **Ações:** Iniciar carga (completa ou diferencial), Pausar, Retomar e Baixar log.
- **Progresso:**
  - nome da tabela atual com animação discreta (pulso), respeitando `prefers-reduced-motion`;
  - barra segmentada (gravado, recusado, restante) com percentual;
  - indicador de erros com contagem e mini-barra;
  - onda N/M e tabelas feitas/total;
  - lista das tabelas com mais recusas.
- **Polling** de 2 s enquanto ativa. Ao montar, busca o progresso: reabrir a tela mostra a carga em andamento.
- **Menu:** item "Carga e sincronismo" no painel técnico, seguindo as regras do `ARVORE_MENU` e do `arvore.spec.ts` (contagem do cabeçalho, permissão técnica), mais o link na `PlataformaInicioTela`.
- i18n em `i18n-onboarding.ts` (ou arquivo próprio ligado em `pt-BR.ts`), sem nome de sistema de origem.
- Spec de tela (vitest) e e2e `@PLATAFORMA`.

## ECONOMIA (regras 15 a 24 do protocolo e do plano)
- Leia o necessário num comando só: a fatia já diz quais arquivos.
- Grave com poucos scripts ou Edits. Meta de 15 a 40 ferramentas; aviso em 60.
- Autoconferência num comando só antes de devolver.
- **Resumo final de no máximo 25 linhas:**
  - arquivos alterados;
  - o que falta;
  - mudanças pedidas a outras fatias;
  - comando de autoconferência e resultado.
- Execução pesada (pytest do conector com Firebird, vitest amplo, build) só sob `flock /home/mmalves/workspace/redesante/sante-sgh-dados/obra/pesado.lock`. A memória da VM é compartilhada com outra sessão.
