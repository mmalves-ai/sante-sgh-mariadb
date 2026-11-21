# F2.4, lote 12-agenda: resultado

## O que mudou
- **Hora "HH:MM" de ponta a ponta na agenda de consultas:**
  - domínio (`tempo.ts`): `normalizarHora`, `deMinutos`, `formatarHora` devolvem "HH:MM"; `paraMinutos` e
    `duracaoMinutos` leem "HH:MM" (e ainda a hora sem os dois-pontos, para os módulos em transição);
    `duracaoHHMM` virou `duracaoEmHoras`; `hhmmValido` virou `horaValida`; `horarioJaPassou` compara por minutos;
  - grade (`grade.ts`): horários, escala e duração em "HH:MM"; intervalo ausente é `null` (sai a sentinela "0000");
    as chaves de horários existentes são comparadas já normalizadas;
  - encaixe, sessões (`serie.ts` aceita só "HH:MM"), regras do portal: comentários e contas em "HH:MM";
  - contratos (`entradas.ts`, `pedidos.ts`, `sessoes.ts`): horas "HH:MM"; intervalo da escala anulável;
  - API (`visao.ts`, `servico.ts`, `apoio.controller.ts`, `marcacoes.controller.ts`, `porta-propria.ts`,
    `porta-memoria.ts`): sai `quatroDigitos`, `duracaoDigitos` e a conversão de quatro dígitos;
  - web: `horaDoContrato` devolve "HH:MM" (pedido 3 do lote 08: cirurgia e exames já recebem "HH:MM").
- **Sim/não em booleano e duração em minutos na agenda:**
  - `incluirAgenda` recebe `duracaoMinutos`;
  - `alterarAgenda` lê e grava `{ duracaoMinutos, ativa, teleatendimento }` em número e booleano;
  - a vista da agenda (`AgendaVista`) e a resposta `versao` do detalhe seguem o mesmo formato;
  - telas `AgendasTela` e `AgendaDetalheTela` ajustadas.
- **Nomes do sistema de origem:** comentários reescritos com o termo de negócio em `vocabulario.ts`, `entradas.ts`,
  `exame.ts` (contrato e domínio), `sessoes.ts`, `estado-horario.ts`, `grade.ts`, `encaixe.ts`, `cobertura.ts`,
  `indicadores.ts`, `serie.ts` e `tempo.ts`.
- **Testes:** specs do domínio, da API (`agenda.spec`, `porta-propria.int.spec`), da web (`formato.spec`) e
  `sessoes.spec` passaram a usar "HH:MM", booleano e minutos.
- Prettier rodado só nos arquivos tocados. `porta-propria.ts` e `porta-propria.int.spec.ts` não estavam
  formatados, por isso o diff deles cresceu.

## Decisões pela melhor prática (para o dono ver)
- **Contrato da agenda aceita a hora digitada e entrega sempre "HH:MM"** (`esquemaHoraAgenda`). O portal do
  paciente (lote 23) ainda manda quatro dígitos à agenda. Um contrato estrito quebraria a marcação pelo portal até lá.
  A hora inválida continua recusada, com a mensagem de `lerHoraDigitada`. Quando o portal migrar, vira
  `esquemaHora` estrito.
- **Exames em transição:** as entradas das operações de exame (`contratos/agenda/exame.ts`) aceitam "HH:MM" ou
  quatro dígitos e entregam quatro dígitos ao módulo de exames, que ainda trabalha assim (lote 20). Sem isso, a tela
  de exames, que já manda "HH:MM", quebraria.
- **Alias `esquemaHhmm` mantido como `@deprecated`** com a regra antiga, só para o contrato do portal do médico (lote
  21) continuar compilando.
- **O campo `Relogio.hhmm` do domínio ficou com o nome.** O valor já é "HH:MM". Renomear agora quebraria o tsc dos
  lotes 20 e 23, então o pedido vai para a etapa coordenada.
- **Duração da agenda: 5 a 480 minutos no cadastro** (`esquemaDuracaoAgendaMinutos`, telas `AgendasTela` e
  `AgendaDetalheTela`), a mesma faixa da CHECK `ck_agenda_servico_duracao` e da faixa da escala. O limite de 240
  continua só na geração da grade (`DURACAO_MAXIMA`), que é outra regra. Assim, agenda importada com 241 a 480 min
  pode ser regravada pela tela.
- **Nomes de origem em identificador renomeados:** `tpAge` virou `codigoTipoAgendamento`, `canalDoTpAge` virou
  `canalDoCodigoTipoAgendamento` (contrato), `TP_AGE_OUTROS` virou `CATEGORIA_OUTROS` e `tpAgeDaMarcacao` virou
  `categoriaDaMarcacao` (domínio), com o spec. Nenhum consumidor fora do lote (o conector não usa). O comentário que
  atribuía o uso ao conector foi corrigido.
- Os sinais de texto da grade (`'S'`, `'C'`, `'T'` e outros) ficaram; a ponte `visao.ts` já os isola.

## Pedidos (12-agenda.json)
1. Lote 20: exames em "HH:MM" (relógio, tipos, portas). Depois disso, `exame.ts` passa a usar os esquemas estritos da agenda.
2. Lote 21: `portal-medico.ts` importa `esquemaHora`, e o alias `esquemaHhmm` sai.
3. Lote 23: o portal do paciente manda "HH:MM" (sai o `paraHhmm`), e `esquemaHoraAgenda` fica estrito.
4. Etapa coordenada: renomear `Relogio.hhmm` para `hora`.

## Fora do lote, visto ao testar (não causado por este lote)
- `apps/api/src/modulos/portal-medico/portal-medico.spec.ts` (2 testes): espera "14:00" e recebe "1400" de
  `portal-medico/aplicacao/servico.ts:463`. Esse caminho não usa nada que este lote mudou.
