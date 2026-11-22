# ADR 0009, lote domínio e API, volta 3 (continuação depois da queda de rede)

## O que mudou
- **Repasse integral no cálculo da API (pendência 2):** `repasse/servico.ts` carrega, na data do cálculo, as regras
  integrais da consulta particular (`INTEGRAL-PART-%`, 100% do cobrado) e o grupo de faturamento dos procedimentos
  pela nova operação `integraisParticular` da porta (própria e em memória). As regras integrais saem de `todasRegras`.
- **Decisão 26 só para quem atende:** `TIPOS_PROFISSIONAL_CREDENCIAVEIS` no domínio. O credenciamento em massa
  (criar convênio e credenciar todos) não credencia administrativo nem assistencial.
- **Particular padrão (pendência 4):** o segundo particular ativo só é criado com o parâmetro
  `faturamento.fontePagadoraParticularCodigo` definido (recusa `particular-padrao-ambiguo`).
- **PUT com versão** para cobertura, restrição e preparo da agenda: `PUT /api/agendas/:id/coberturas/:regra`,
  `restricoes/:regra` e `preparos/:regra`. Permissão `agenda.estruturada.editar`, auditados pelo executor. Recusas:
  `regra-inexistente` (outra agenda) e conflito de versão. O vínculo com o texto original fica.
- **Procedimento extra na porta própria (pendência 10):** recusa a requisição de laboratório
  (`requisicao-sem-extra`), igual à porta em memória.
- **Marcação no servidor (decisão 25):** já recusava pelo `conferirCredenciamentoNoFluxo` (commit 713a936). O teste
  cobre o alerta e o bloqueio.

## Testes (cliente adr9c_api, dados sintéticos)
- `precos/agenda-preco.int.spec.ts`: 21 de 21. Inclui POST /convenios com e sem credenciaTodosAoCriar, o alerta e o
  bloqueio na marcação e na abertura, o particular padrão pelo parâmetro, o PUT com versão, a pendência 10
  (lançamento pela regra particular e a recusa da requisição de laboratório) e a pendência 7 (marcação sintética).
- `repasse/porta-propria.int.spec.ts`: 6 de 6. `persistencia/agenda-preco/porta.int.spec.ts`: 8 de 8.
- Unidade `apps/api`: 2149 aprovados e 19 pulados (325 arquivos). `dominio-preco`: 54 de 54.
- tsc, eslint e `permissoes:verificar` verdes.

## Pendências
- Não há teste ponta a ponta de `agenda.agendarConsulta` recusando pela rota HTTP. A conferência é a mesma função,
  testada direto.
- O prettier reformatou `repasse/porta-propria.ts` e o `.int.spec.ts` dele, que estavam fora do padrão. O diff desses
  arquivos fica maior que a mudança.
