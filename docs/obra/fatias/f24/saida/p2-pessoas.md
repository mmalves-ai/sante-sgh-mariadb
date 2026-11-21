# F2.4, 3ª etapa, lote p2-pessoas

## O que mudou
- **Plantão realizado no repasse** (`pessoas/escala/porta-realizado-propria.ts`): o arquivo ficou sem nenhum
  `modelo-pendente`.
  - `executar('repasse.lancarEvento')` é a operação própria do Executor `pessoas.realizado.lancar_repasse`. Ela grava em
    `plantao` e `lancamento_repasse`, com a trilha na mesma transação.
  - **Origem `plantao`:**
    - trava os plantões do estabelecimento e confere cada realizado: aprovado, com valor, ainda não lançado, prestador
      (cooperado, PJ ou terceiro) do mesmo profissional, dentro da competência, e a soma igual ao valor;
    - inclui o lançamento pelo `gravadorEventoRepasse` do repasse, com as mesmas validações de evento e favorecido;
    - liga cada plantão ao lançamento (`lancamento_repasse_id`, `lancado_por_usuario_id`).
  - **Origem `estorno`:** só aceita quando há realizado estornado daquele lançamento que espera o negativo com esse
    valor. O negativo sai pelo gravador do repasse, que recusa o que passa do original.
  - **Estorno no plantão:**
    - `estornarRealizado` grava `estornado_em`, `estornado_por_usuario_id` e `motivo_estorno`;
    - `ligarEstorno` liga o negativo, que precisa estornar o lançamento deste plantão e não estar ligado a outro;
    - `desfazerEstorno` só desfaz enquanto o negativo não está ligado;
    - `estornoLancado` acha o negativo já lançado e não ligado (conciliação).
  - **Leitura:** devolve o `lancamento`, o `lancadoPor` e o `estorno` (situação `estornado`). O relatório de aprovados
    não traz mais o estornado.
- **Teste de integração** (`aplicacao/escala.int.spec.ts`, cliente `f24q_pessoas`): 6 de 6, mais 2 ignorados pelo
  catálogo.
  - **Caso novo de efeito no banco:** lança 2 plantões e confere a linha de `lancamento_repasse`, a ligação, a trilha
    da operação e as recusas (soma divergente, já lançado, sem estorno pendente, negativo repetido, outro
    estabelecimento). Depois estorna, lança o negativo e concilia, liga e confere que não se desfaz mais.
  - **Dois casos antigos corrigidos:** a cobertura mínima e a tarifa por tipo já gravavam, mas o teste ainda esperava
    `modelo-pendente`.
- **Conferência:** `tsc` da API sem erro nos arquivos de pessoas (os 3 erros que sobram são de
  `suprimentos/opme-porta-propria.int.spec.ts`, de outro lote). Specs de unidade de pessoas: 307 de 307. O eslint
  está limpo.

## Decisões pela melhor prática (para o dono ver)
1. **Lançamento e ligação dos plantões na mesma transação.** Não sobra lançamento sem plantão, nem plantão marcado
   sem lançamento.
2. **O negativo do estorno é ligado pela ação do estorno, como o serviço já faz em 3 passos.** O realizado que
   recebe o negativo é achado pelo lançamento original, pelo valor e pela justificativa padrão do serviço. Quando
   não há realizado estornado à espera, a operação recusa o negativo, em vez de aceitar estorno avulso por esta porta.
3. **O realizado estornado sai do relatório de aprovados,** mas continua com o valor e o lançamento na leitura.

## O que falta (pedidos em `p2-pessoas.json`)
| Arquivo | Situação |
|---|---|
| `folha/porta-calculo-propria.ts:13,101,248` | Processamento da folha, férias, rescisão e obrigações: 37 operações. É um lote próprio. |
| `esocial/porta-esocial-propria.ts:38,111,117` | Troca do contrato da ficha (de cifrada para estruturada), mais a decisão do dono |
| `sesmt/porta-sesmt-propria.ts:239` | Contrato do registro de proteção por tipo e id |
| `autoatendimento/porta-propria.ts:17` | Gravadores do ponto, das férias e do cadastro sobre a mesma transação |
| `banco-apoio.ts:95` | O auxiliar sai quando os dois usuários acima saírem |
