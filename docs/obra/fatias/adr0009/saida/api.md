# ADR 0009, lote domínio e API (rótulo `api`)

Prova (2026-11-22): `tsc` de `apps/api`, `contratos`, `dominio-preco`, `dominio-agenda` e `dominio-repasse` ok; `eslint` e
`prettier` ok nos arquivos do lote; unidade: dominio-preco 54/54, dominio-agenda 129/129, dominio-repasse 57/57 (com
cobertura), contratos 829/829, apps/api 2149 ok (19 pulados); integração no cliente `adr9_api` (plataforma de teste
`plataforma_teste_adr9_api`, apagados no fim): `agenda-preco.int.spec.ts` 6/6 e `faturamento/porta-propria.int.spec.ts`
22/22 (o lançamento de item continua verde com a regra particular ligada antes da tabela).

## Domínio (funções puras, com teste)
- `dominio-preco/preco-particular.ts`: `regrasAplicaveis`, `compararEspecificidade` (alvo item > grupo > consulta; dono
  agenda > profissional; estabelecimento > rede; prioridade menor; confirmada > estimada; vigência mais recente; maior
  id), `escolherRegraPrecoParticular`, `resolverPreco` (particular: regra ANTES da tabela; convênio: só tabela conta >
  plano > convênio, regras ignoradas; resposta com `origem`, ids, `textoOrigemId`, `estimada`, explicação e recusa),
  `origemDaTabela`.
- `dominio-preco/credenciamento.ts`: `verificarCredenciamento` (alerta por padrão; bloqueio com
  `bloqueiaSemCredenciamento`; plano e plano superior; descredenciado vence; particular não pede),
  `deveCredenciarTodosAoCriar`.
- `dominio-agenda/estruturada.ts`: `agendaAtendeConvenio` (vínculo, exclusão do convênio ou do plano/subplano, só
  alguns planos, `dependeDoPlano`), `regrasEfetivas`/`agendaAtendePaciente` (sexo, idade, retorno, encaixe; restrição
  do item/plano/convênio sobrepõe o padrão), `preparoDoExame` (preparo, orientação, documentos, jejum). Toda resposta
  traz os textos originais e marca trecho não interpretado.
- `dominio-repasse/particular-integral.ts`: regra de repasse 100% da consulta particular sobre o valor cobrado.

## API (módulo `precos`, controlador `AgendaPrecoController`)
Rotas: `GET/POST precos-particulares`, `GET precos-particulares/calculo`, `GET/POST credenciamentos`,
`GET credenciamentos/verificacao`, `GET/PUT convenios/:id/opcoes-credenciamento`, `POST convenios/:id/credenciar-todos`,
`GET agendas/:id/estruturada`, `GET agendas/:id/respostas` (perguntas do paciente), `POST agendas/:id/coberturas |
restricoes | preparos`. Gravações pelo executor (7 operações, trilha e Idempotency-Key). Permissões novas em
`contratos/permissoes/precos.ts` (concedidas ao perfil `administrador-sistema`): `preco.regraParticular.ler|editar`,
`convenio.credenciamento.editar`, `agenda.estruturada.ler|editar`. Preço por médico em convênio é recusado
(`convenio-sem-preco-por-medico`).
- `faturamento/operacoes.ts` (`lancarItem`): na conta particular, a regra do profissional do atendimento ou da agenda da
  marcação vale antes da tabela; a memória grava `regra_preco_particular_id`, `origemPreco` e `regraEstimada`.

## Teste de aceite (seção 6)
Domínio: 6.1 (valor por médico e agenda; médico sem regra cai na tabela), 6.2 (exame por item/grupo, estimada com o
texto), 6.5 a 6.8 (SUS excluído, convênio fora, Assim exceto A60, Bradesco só Empresarial), 6.10 e 6.11 (preparo,
jejum, documento), 6.12 a 6.14 (criança de 5 anos, encaixe, sexo, retorno em 30 dias). API (integração): 6.1, 6.7/6.8,
6.10, 6.12 com o texto original íntegro (2.4 mil caracteres) ao lado.

## Pendências
1. O "particular padrão" lido do parâmetro `faturamento.fontePagadoraParticularCodigo`: o módulo monta o serviço sem
   o código (vale a única fonte particular ativa); falta ligar o resolvedor de parâmetros.
2. No `lancarItem`, "consulta" = honorário (tipo 2) de atendimento vindo de agenda; sem teste de integração do caminho
   particular com regra (precisa de conta, atendimento e marcação sintéticos).
3. "Criar convênio" do cadastro ainda não chama `credenciarTodosAtivos` quando `credencia_todos_ao_criar` (há a rota
   `POST convenios/:id/credenciar-todos`).
4. Fora do lote: `permissoes:verificar` segue VERMELHO por 4 rotas antigas sem auditoria (config/dominios e
   plataforma-onboarding), nenhuma deste lote; as 5 permissões novas passam.

## Correção após a revisão (2026-11-22)
Prova: `tsc` de `apps/api` ok; `eslint` e `prettier` ok; unidade `faturamento` e `precos` 46/46; integração no cliente
`adr9_dapi` (plataforma `plataforma_teste_adr9_dapi`, apagados no fim): `agenda-preco.int.spec.ts` +
`faturamento/porta-propria.int.spec.ts` 32/32 (4 testes novos de `lancarItem`).
- **Achado 1 (credenciamento no fluxo real), corrigido no lançamento:** `lancarItem` verifica o credenciamento do
  profissional do item (executante, ou o do atendimento) no convênio e no plano da conta (com o plano superior). Com
  bloqueio, recusa `profissional-nao-credenciado`; com alerta, devolve `alerta` e `alertaMotivo` no resultado e grava
  o aviso na memória. Marcação e abertura de atendimento ficam nos módulos agenda e atendimento, fora deste lote
  (pendência 5).
- **Achado 2 (consulta), corrigido:** "consulta" é o item faturável que o catálogo de agendamento marca como consulta
  (`item_agendavel` de tipo consulta), com ou sem marcação. O profissional é o executante do item, quando vem no
  lançamento, e a agenda da marcação só vale quando o item é do profissional dela.
- **Achado 3 (sem teste do lançamento), corrigido:** testes de integração de `lancarItem` cobrem a consulta particular
  sem marcação, que usa a regra do médico (valor, `regra_preco_particular_id`, `tabela_preco_id` nulo, `origemPreco`,
  `regraEstimada`). Cobrem também o honorário que não é consulta (vai para a tabela), a consulta de outro executante
  (usa a regra dele), o convênio com regra particular do mesmo médico (vai para a tabela, com alerta) e o convênio com
  bloqueio (recusa e, depois de credenciar, aceita). A regra da agenda no lançamento continua sem teste de
  integração, porque exige a massa de marcação. O domínio e a rota `/calcular` já a cobrem.
- **Achado 4 (decisão 26 na criação), procedente, mas não há onde ligar neste lote:** a API não tem operação de criar
  convênio (`fonte-propria.ts` só inclui plano e contato). O convênio entra pela carga ou pelo conector. Fica a
  pendência 3.
- **Achado 5 (repasse integral), procedente:** o motor de repasse já calcula sobre o valor do item pela
  `regra_repasse_item` com percentual. Basta gravar a regra a 100%. Isso é trabalho do conector e da porta de repasse,
  fora deste lote (pendência 6).

## Pendências (atualizadas)
1. O parâmetro do particular padrão (sem mudança).
2. Teste de integração da regra da agenda no lançamento, com marcação sintética.
3. Ligar `deveCredenciarTodosAoCriar` + `credenciarTodosAtivos` na operação de criar convênio, quando ela existir, e
   no conector, para o cliente importado.
4. `permissoes:verificar` (sem mudança).
5. Credenciamento na marcação (agenda) e na abertura do atendimento (atendimento), com a mesma regra do lançamento.
6. Gravar `regra_repasse_item` a 100% pela porta de repasse e pelo conector, quando a origem marca a consulta
   particular integral, e usar `repasseIntegralVale` no cálculo, com teste do repasse sobre o valor cobrado pela regra.

