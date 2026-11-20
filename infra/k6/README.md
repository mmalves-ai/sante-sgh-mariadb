# infra/k6 (M09)

Cenários de carga do k6 rodados por `./pnpm k6 -- <cenario>` (imagem `grafana/k6:2.3.0` com digest, sem
instalar nada na VM), sempre contra a API local (127.0.0.1:3300) e a cópia de dev; nunca contra o
`sante-firebird` nem nada externo (o script recusa `BASE` fora do loopback).

- `carga-somada.js`: "carga nominal somada" (até 400 usuários: login, abrir ficha e listas), "consulta
  pesada" (relatório de período) e "painéis automáticos" (a cada 5 s), ao mesmo tempo. O runner
  (`tools/verificadores/src/k6.ts`) sobe a API e o worker com telemetria, reproduz a carga do legado na
  cópia (leituras das operações-chave, marcadas como `legado-simulado` no MON$) antes e durante o k6, mede o
  tempo dessas operações e a transação mais longa do novo pelo coletor `MON$`, e grava o resumo agregado.
- Rodar com a trava do E2E (portas 3300/5300 compartilhadas):
  `flock <e2e.lock> ./pnpm k6 -- carga-somada` (variáveis: `USUARIOS`, `SUBIDA`, `PATAMAR`, `PAINEIS`).
- `cadastro-busca.js` (M11): a busca de paciente real (o mesmo serviço da tela) por nome, nome da mãe,
  telefone e CPF, com a carga do legado simulada ao mesmo tempo; limiar p95 < 500 ms por jornada. O termo é
  montado dentro da API a partir do paciente sorteado (`/api/carga/busca`, só em dev, responde só `n`). A
  API do k6 lê a cópia pela porta do cadastro (`ACESSO_FONTE_DEV=copia`, só leitura). Resultado em
  `docs/marcos/M11/carga-cadastro-busca.json`. Com o `pnpm dev` de outra pessoa na 3300, use outra porta:
  `K6_API_PORTA=3391 flock <e2e.lock> ./pnpm k6 -- cadastro-busca`.
- `prescricao.js` (M24): a prescrição real (o mesmo serviço da tela) sorteada entre as mais recentes: a lista
  do atendimento e a prescrição aberta com itens, horários e prova; limiar p95 < 2 s por jornada (cap-14 §14.5).
  A API do k6 lê a cópia (`ACESSO_FONTE_DEV=copia`, só leitura); a gravação não entra (executor só de leitura na
  cópia compartilhada). Resultado em `docs/marcos/M24/carga-prescricao.json`:
  `K6_API_PORTA=3424 flock <e2e.lock> ./pnpm k6 -- prescricao`.
- `checagem.js` (M25): as leituras da beira do leito sobre a prescrição real sorteada (a linha do tempo do turno
  da unidade p95 < 1 s, os horários do paciente no tablet < 500 ms, a releitura do horário antes de checar
  < 100 ms e o histórico do horário < 300 ms), com a janela em torno do primeiro horário da prescrição (a cópia não
  tem horários do dia). A checagem (gravação) é medida no teste de integração na cópia, em transação desfeita
  (D-K6-25). Resultado em `docs/marcos/M25/carga-checagem.json`:
  `K6_API_PORTA=3425 flock <e2e.lock> ./pnpm k6 -- checagem`.
- `carga-nominal.js` (M27): a carga nominal da Fase 2, até 400 usuários somados nos perfis (médico: a fila de
  trabalho, o prontuário e a prescrição; recepção: a fila de senhas, a fila de trabalho com as guias e a pauta;
  diagnóstico: setor e liberação; leitos: o painel; entrada: login), com os SLOs do cap-14 §14.5 como limiares e a
  carga do legado simulada pelo runner. Resultado em `docs/marcos/M27/carga-nominal.json`:
  `K6_API_PORTA=3427 flock <e2e.lock> flock <copia.lock> ./pnpm k6 -- carga-nominal`.
- `pico-recepcao.js` (M27): a abertura do ambulatório (subida em 20 s até 150 guichês lendo a fila de senhas, a fila
  da recepção com as guias e o supervisor; < 1 s). Resultado em `docs/marcos/M27/carga-pico-recepcao.json`.
- `troca-plantao.js` (M27): a passagem do turno (120 médicos abrindo a fila "Meus pacientes" e, de cada paciente, o
  prontuário e a prescrição; fila e prontuário < 1,5 s, prescrição < 2 s). Resultado em
  `docs/marcos/M27/carga-troca-plantao.json`. A checagem à beira do leito tem cenário próprio (`checagem.js`, M25).
- `pico-recepcao-gravacao.js` (M39; revisão): o pico da recepção COM GRAVAÇÃO, só na homologação (`AMBIENTE=homolog`,
  DP-15). Cada guichê (uma conta de carga por guichê) abre, emite a senha no balcão, chama a próxima, cadastra o
  paciente que chegou (nome, CPF e nascimento sintéticos gerados no roteiro) e abre o atendimento pela senha chamada;
  emitir e chamar p95 < 1 s, cadastrar e abrir p95 < 2 s, cada jornada com o contador próprio. O runner
  (`k6-homologacao-cli.ts`) recusa o cenário em dev e ci, com `ACESSO_FONTE_DEV=copia` e nas portas 3351/3352 das
  cópias de dev; na homologação ele não sobe API nem simula o outro sistema (lá ele é o de verdade) e roda o k6 contra
  `K6_BASE`, com `K6_LOGINS`, `K6_SENHA` (do cofre; só pelo ambiente, nunca na linha de comando), `RECEPCAO`, `LOCAL`,
  `GERADOR`, `CEP` e `ATENDIMENTO` (JSON com os campos fixos da abertura). Resultado em
  `docs/marcos/M39/carga-pico-recepcao-gravacao.json`. O ensaio do roteiro no desenvolvimento roda o k6 em Docker
  direto contra a API com a massa sintética em memória (BASE de loopback, a conta `SINT.CARGA`), sem banco.
