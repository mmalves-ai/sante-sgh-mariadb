# ADR 0009, lote dominio-api: correção dos 4 achados da revisão (2026-11-22)

Prova: `tsc` de `apps/api` e dos domínios ok; `eslint` e `prettier` ok; unidade `dominio-repasse` e `dominio-preco`
116/116 e `apps/api` (repasse, agenda, precos, faturamento, atendimento) 105/105; integração no cliente `adr9_dapi`
(criado e apagado no fim): repasse, agenda, atendimento e agenda-preco 53/53 (4 arquivos).

- **Achado 1 (alta), corrigido: repasse integral fora do particular.** `integraisParticular` junta `fonte_pagadora`
  e exige `tipo = 'particular'`. No domínio, `regraRepasseParticularIntegral` recusa fonte que não seja particular
  (`tipoFonte`), a regra leva `fonteParticular` e `repasseIntegralVale` exige a fonte particular na regra e no item.
  `calcularItem` recebe `fontesParticulares` (OpcoesCalculo; a porta devolve). O teste de integração usa uma fonte
  particular e tem o caso negativo: a marca INTEGRAL-PART numa operadora não vale, segue a regra comum.
- **Achado 2 (média), corrigido: plano nulo na marcação.** A marcação não traz o plano; a conferência passa
  `planoDesconhecido: true`. No domínio, com plano desconhecido, o credenciamento vigente em qualquer plano do
  convênio dá só alerta (nunca bloqueio). Sem nenhum credenciamento, o bloqueio pedido pelo convênio continua.
  A abertura do atendimento confere o plano exato com o plano superior. Receber o plano na própria marcação exige
  mudar o contrato da agenda e a tela: pendência.
- **Achado 3 (média), corrigido: exame de outra agenda.** `regraParticularDoItem` só marca `exame` quando o item
  agendável de exame está em `agenda_item_agendavel` da agenda da marcação ou é o item da marcação
  (`marcacao_horario.item_agendavel_id` ou `marcacao_horario_item`). Teste: o exame que a agenda não oferece cai na
  tabela (100); ligado à agenda, leva a regra "exame" (95).
- **Achado 4 (média), corrigido: fluxos reais.** Novos testes de integração em `agenda/porta-propria.int.spec.ts`
  (`agenda.encaixar`: alerta no resultado; bloqueio recusa sem gravar marcação; credenciado só no plano, só alerta;
  credenciado no convênio, sem alerta) e `atendimento/porta-propria.int.spec.ts` (`atendimento.abrirAtendimento`:
  alerta; bloqueio recusa sem gravar atendimento; credenciado no plano superior abre o subplano sem alerta). O teste
  auxiliar de `agenda-preco.int.spec.ts` foi renomeado e ganhou o caso de plano desconhecido.

## Pendências
- O plano do paciente na marcação da agenda (contrato `esquemaAgendarConsulta`/`esquemaEncaixar` e tela).
- A prévia `precoDoAtendimento` não calcula o alvo "exame" (só consulta); fica igual ao lançamento só para consulta.
- Os clientes de teste `f22_o1` e `f22_o3` estão sem as migrações do ADR 0009 (coluna `bloqueia_sem_credenciamento`):
  os testes passam com `SGH_CLIENTE_TESTE` num cliente novo.
