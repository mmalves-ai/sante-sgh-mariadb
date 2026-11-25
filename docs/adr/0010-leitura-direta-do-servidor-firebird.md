# ADR 0010: leitura direta do servidor Firebird do hospital

- **Data:** 2026-11-24
- **Situação:** aceita (decisão do dono, 24/11/2026, pedido da tela "Carga e sincronismo")
- **Emenda:** a regra 4 do `AGENTS.md` e a parte do ADR 0001 que previa ler só imagens restauradas.
- **Fontes:** `docs/obra/fatias/carga-painel/brief.md`; prova em `infra/firebird-simulado/conferir.sh`.

## Contexto

Até aqui o conector lia só **imagens**: cópias da base Firebird restauradas em container sem rede de saída e em
somente leitura. Em produção isso obriga o hospital a gerar e transferir uma cópia a cada carga ou sincronismo. O
dono pediu a carga e o sincronismo pela tela, com o conector lendo o servidor do hospital.

## Decisão

1. **Em produção, o conector pode ler direto o servidor Firebird do hospital** (origem `firebird_servidor`: host,
   porta, banco ou alias, usuário e referência da senha no cofre).
2. **Somente leitura em três camadas**, todas obrigatórias:
   - **usuário só leitura** criado pelo hospital, com uma role que tem só `SELECT` nas tabelas e views de usuário;
     no Firebird 3 não há role padrão, e o conector conecta já com a role;
   - **transação somente leitura**: uma conexão e **uma** transação `SNAPSHOT` + `READ` por execução; a contagem
     por tabela e a leitura saem da mesma fotografia;
   - **nenhum comando de escrita** no código do conector para a origem (sem DDL, DML, `gfix`, `gstat` ou
     abridor); `MON$READ_ONLY` não é exigido, porque o servidor está vivo.
3. **Nunca grava na origem.** A senha fica no cofre de segredos (nunca no banco nem em log), e logs e pendências
   seguem só com contagens e agregados (regra 5).
4. **Identidade da base:** cada execução grava a identidade da base (ODS, tamanho de página, data de criação e o
   que mais a identifique, sem dado de pessoa). A continuação entre execuções exige a mesma identidade, no lugar do
   sha256 e da data do arquivo usados para imagens.
5. **Imagens continuam permitidas** (origem `firebird_arquivo`), com as mesmas regras de antes.

## Desenvolvimento

A leitura direta é **simulada** em `infra/firebird-simulado/`:
- container `sante-sgh-fb-prontocardio` (Firebird 3.0.14) sobre a cópia da base no volume
  `sante-sgh-fb-prontocardio-data`, sem `gfix read_only` (simula servidor em uso);
- rede interna `sante-sgh-conector-int` (alias `fb-prontocardio`, porta 3050) e loopback do host em
  `127.0.0.1:3354`, por uma rede sem NAT de saída;
- usuário só leitura com a role `LEITURA`; a prova (`conferir.sh`) mostra `SELECT` aceito e `CREATE TABLE`,
  `INSERT`, `DELETE` e leitura sem a role recusados.

As cópias compartilhadas do `banco-dev` (`redesante-fb-pc`, `redesante-fb-pc2`) e o `sante-firebird` seguem
intocadas.

## Consequências

- O hospital precisa liberar a porta do Firebird para a máquina do conector e criar o usuário e a role só leitura.
- Uma transação `SNAPSHOT` longa segura versões antigas no servidor do hospital (a "garbage collection" espera o
  fim dela). A carga completa deve ser agendada fora do pico; o sincronismo diferencial é curto.
- A pausa encerra a transação; a retomada abre outra fotografia, e o hash por linha evita regravar o que já
  entrou.

## Continuidade entre origens com a mesma base (2026-11-24)

Quando a origem de um cliente muda de forma sem mudar de base (a cópia do arquivo passa a ser lida pelo servidor
Firebird, ou o servidor troca de endereço), o administrador declara em `cliente_origem.continua_de_origem_id`
(plataforma 0094, `plataforma.declarar_continuidade`, com evento `origem_continua_de` no cliente) qual origem anterior
a nova continua. Só com essa declaração a continuação de uma importação aproveita as marcas de tabela concluída das
execuções da origem anterior (regra 6 do `continuar.py`), aceitando o resumo da imagem dela como o da mesma base. Se
as duas origens têm identidade técnica comparável (ODS, tamanho de página, data de criação), ela precisa bater: prova
que difere recusa a herança, e a carga relê tudo como antes. Sem campo comum para comparar, vale a declaração, que
fica registrada no evento com a situação `sem_prova`. Sem declaração, nada muda. No diferencial, o bloco de 10 mil ids
cujo resumo e contagem batem com o guardado em `conector_bloco`, e cujas linhas estão todas carregadas com o mesmo
hash e sem recusa aberta, é pulado inteiro (`CONECTOR_SALTO_BLOCOS`, ligado por padrão); qualquer dúvida desce linha a
linha.
