# ADR 0009, volta 2, lote TELAS (apps/web)

## O que mudou (pendência 8 da conferência e pendências de tela da volta 2 do modelo)
- **Nomes no lugar dos ids:** `AgendaEstruturadaPainel` lê os nomes do contrato (`conveniosAceitos`, `fontePagadoraNome`,
  `planoNome`, `planoSuperiorNome`, `profissionalNome`, `estabelecimentoNome`) por `nomesDaAgenda`
  (`agenda/estruturada-edicao.ts`); os mapas das props só completam o que faltar. Cabeçalho com agenda, profissional e
  estabelecimento. `CredenciamentoConvenios`: profissional, convênio, plano e estabelecimento pelo nome; na inclusão,
  convênio (ficha do profissional) e plano escolhidos pelo nome (lista de convênios e planos do contrato); no convênio,
  o profissional continua pelo código (não há lista de profissionais por nome nesta tela).
- **Edição de cobertura, restrição e preparo** (`RegraEstruturadaForm.vue`, permissão `agenda.estruturada.editar`):
  cobertura por convênio e por plano/subplano (aceita ou exclui), restrição (sexo, idade, retorno, encaixe; vazio herda
  da agenda) e preparo (tipo, descrição, jejum), com vigência e texto de origem opcional. Escolher o texto de origem o
  destaca ao lado (o trecho não interpretado continua em `<mark>`). A regra incluída entra confirmada. Rotas
  `POST /api/agendas/:id/{coberturas,restricoes,preparos}` (o id vai na URL). Montagem e validação puras em
  `estruturada-edicao.ts`.
- **Alvo `exame`** no `RegraPrecoForm` (só com dono agenda; troca para consulta se o dono mudar).
- **Criar convênio** (`precos/componentes/NovoConvenioForm.vue`, na lista de convênios, permissão
  `convenio.contrato.editar`): código, nome, tipo, registro na ANS, "bloquear sem credenciamento" e "credenciar todos os
  profissionais ativos" com a data de início; corpo igual ao `esquemaConvenioNovo` do lote API (`POST /api/convenios`);
  o particular não aceita as opções de credenciamento; a mensagem mostra quantos foram credenciados.
- **Marcação:** `AlertaCredenciamentoMarcacao` na `MarcarTela` (verificação `GET /api/credenciamentos/verificacao`
  com o profissional da agenda, o convênio e a data da vaga): alerta deixa marcar; bloqueio desabilita o botão Marcar;
  sem a conferência, só um aviso.
- `ROTAS_PENDENTES_API` vazia: toda URL do cliente existe no controller (teste de contrato ampliado com as rotas novas).

## Prova
- `vitest` de agenda, cadastro, precos e atendimento: 8 arquivos, 72/72 (spec novo `estruturada-edicao.spec.ts`: 14).
- `vue-tsc` do `apps/web`: 0 erros. `eslint`, `prettier --check` e `stylelint` dos arquivos tocados: ok.

## Pendências
- Revisão (PUT com versão) de cobertura, restrição e preparo: a API só tem inclusão; a tela só inclui.
- Marcação: a tela supõe que o `codigo` do convênio nas opções da agenda é o id da fonte pagadora; a recusa por
  bloqueio na gravação da marcação é do servidor.
- Credenciamento pelo convênio: escolher o profissional pelo nome pede uma lista de profissionais na tela.

## Volta de correção (achados da revisão)
- Cobertura: a escolha do convênio passou a vir do cadastro de convênios ativos do hospital (`listarConvenios('',
  'ativos')`, a mesma consulta da tela de preços), somado aos aceitos pela agenda, sem repetir. Restrição e preparo
  continuam com os aceitos. Teste novo: cobertura de um convênio fora da lista da agenda.
- Decisão 25 na `MarcarTela`: dois testes montam a tela inteira (opções e busca de paciente simuladas, sintéticas):
  com "bloqueio" o botão Marcar fica desabilitado; com "alerta" o aviso aparece e o botão fica livre. Conferido por
  mutação: sem a condição `efeitoCredenciamento !== 'bloqueio'`, o teste falha. O caso do componente foi renomeado
  para não prometer o botão. A seleção de convênio da marcação ganhou `data-testid="marcar-convenio"`.
- `vitest` de agenda, precos e cadastro: 6 arquivos, 60/60 (`estruturada-edicao.spec.ts`: 17). `vue-tsc`, `eslint` e
  `prettier`: ok. O erro não tratado (`nextSibling`) em `estruturada-telas.spec.ts` já existia antes desta volta.
