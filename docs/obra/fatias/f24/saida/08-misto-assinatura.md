# F2.4, lote 08-misto-assinatura (2ª volta)

## O que mudou
- **Assinatura:** o PDF grava sempre `arquivo.versao_objeto` (coluna do 00_NUCLEO/21). Saíram a detecção da coluna e a recusa.
- **Recepção:** o dispositivo do tipo painel de TV de setor liga-se a `painel_tv` (`dispositivo_recepcao.painel_tv_id`).
  - A escolha é pela ordem (`portalOrdem`) entre os painéis ativos do estabelecimento.
  - A leitura devolve a ordem.
  - Recusas: `painel-tv-so-no-tipo`, `painel-tv-inexistente` e `painel-tv-ambiguo`.
- **Portaria:** a passagem pela catraca grava `evento_acesso_portaria` ligado ao `terminal_acesso`.
  - A chave do evento no terminal é única: o reenvio devolve o mesmo evento, com `repetido`. A corrida pela UNIQUE também.
  - O evento guarda o crachá lido, a visita mais recente da etiqueta e o resultado (`liberado`/`negado` ↔ `permitido`/`recusado`).
  - Quando a avaliação manda, fecha a visita, com a origem da saída na trilha.
- **Portal do médico:**
  - religar o profissional depois de desligar ou encerrar funciona: a UNIQUE é só da conta vigente;
  - cada ato do hospital sobre a conta grava `ato_conta_portal_profissional_externo`;
  - `atosConta` lê esse histórico.
- **Hora:** o contrato das entradas de exame usa `esquemaHora` (estrito `"HH:MM"`).
  - `hora-legada.ts` **continua**: o contrato de exame não era o único uso. O `SanteHora.vue` (`packages/ui`) usa
    `classificarHora`, `formatarHoraLegada` e `paraHhmm`, e aparece em cerca de 20 telas da web.
  - A troca do componente e das telas que gravam o valor dele é de outros lotes: vai como pedido.
- **Portaria, leitura:** `eventos(c, teto)` lê `evento_acesso_portaria` pelos terminais e pontos de acesso do
  estabelecimento, do mais novo para o mais antigo, limitado pelo teto (1 a 500). O painel de terminais deixa de
  mostrar a lista vazia. O teste de integração grava uma passagem, lê de volta e confere que outro estabelecimento não a
  vê.
- **Onda 2:** a "regra 15" saiu do contrato e do domínio de configuração, com os testes.
  - Ela listava as tabelas do outro sistema que o novo nunca grava, mais as exceções.
  - É regra de coexistência, que não vale no banco próprio (AGENTS.md).
  - Nada a chamava fora dos testes.
- **`dist` dos domínios** (cadastro, config e organização): recompilados. Os `.d.ts` antigos traziam comentários que o
  `src` já não tem.
- **Testes:** recepção, portaria e portal do médico ganharam casos positivos. As limpezas apagam as linhas novas antes
  das linhas-mãe.

## Decisões pela melhor prática (para o dono ver)
1. O painel de TV é escolhido pela **ordem**, como no contrato atual, e nunca por adivinhação. A ordem repetida entre
   os painéis ativos recusa com `painel-tv-ambiguo`.
2. A catraca guarda a **visita mais recente** do crachá, aberta ou não. A avaliação, no domínio, decide se ela vale.
   `usuario_id` fica nulo, porque é o operador da liberação manual.
3. A regra 15 da onda 2 foi **apagada**, e não renomeada: o conceito, "não gravar a tabela que o gatilho do outro
   sistema grava", não existe no produto.

## Pedidos (detalhe em 08-misto-assinatura.json)
- **Troca coordenada do `SanteHora.vue` para a hora neutra:** depois dela, `hora-legada.ts` sai.
- **Troca coordenada do relógio de quatro dígitos:** `relogioNoFuso` e `civil().hhmm`, com cerca de 195 usos em 30
  arquivos de outros lotes.
- **Porta a escrever, sem DDL a pedir:** especialidades (17 operações), nutrição (8), manutenção (9), SUS (18), cargas
  de preço (5). A estrutura já existe no banco.
  - **SUS:** isto responde ao "pedido ao lote" do `ddl-aplicado-v2`. Tudo já está no 13_SUS: `critica_sus` por conta,
    com detalhe e justificativa; `remessa_*` com `chave_objeto` e `versao_objeto`; a faixa de AIH com órgão emissor,
    data de liberação e motivo; `retorno_sus_item` com o tratamento.
- **Preços:** os campos do contrato do convênio sem coluna (linha 909) precisam ser listados e pedidos.
- **Portal do médico:** falta decidir onde fica a senha da conta do portal, para `trocarSenha`.
