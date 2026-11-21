# F2.4, lote 01-pessoas-1 (pessoas: cargos, escala, folha, eSocial, avaliação, autoatendimento)

## O que mudou
- **Cargos e salários** (`cargos/porta-propria.ts`): a faixa salarial e o quadro de vagas aprovado deixaram de recusar com
  `modelo-pendente` e passaram a gravar no modelo.
  - Faixa: inclusão, nova versão, situação e exclusão lógica em `faixa_salarial`, usando as colunas de vigência e versão
    da etapa compartilhada.
  - Quadro de vagas: as mesmas operações em `quadro_vaga`.
  - A leitura das vagas devolvia lista vazia e agora lê a tabela.
  - As dependências de faixa e vaga são recontadas dentro da transação.
  - `quadro_vaga` e `perfil_cargo_rh` entraram nas dependências do cargo, que o teste confere contra o
    `information_schema`.
  - Teste de integração: dois casos novos (faixa e quadro), com versão, recusa por repetição, situação, exclusão e
    isolamento por estabelecimento. Resultado: 17 de 17 no cliente `f24_01pessoas1`.
- **Escala** (`escala/porta-escala-propria.ts`): a cobertura mínima por turno é gravada na criação e na alteração, nas
  colunas `cobertura_minima_*` da escala, e é lida de volta. Com isso, `coberturaRegistrada` vale `true` e a publicação
  passa a conferir o furo.
- **Textos:**
  - os comentários de `banco-apoio.ts`, `servico-esocial.ts` e `tipos-folha.ts` não usam mais o vocabulário antigo;
  - os descritivos de auditoria de `integracao.controller.ts` e `pessoas.controller.ts` trazem os termos de negócio no
    lugar das tabelas de origem.
- **Massa de teste** (`avaliacao/massa.spec-util.ts`): a ocupação do CBO (Classificação Brasileira de Ocupações)
  passou a ser sintética e própria. O cliente de teste novo não tem o catálogo do CBO, porque o CBO não tem carregador
  em `catalogos/`. Com isso, os testes de integração do autoatendimento e da avaliação rodam no `f24_01pessoas1`
  (15 de 15).
- **Autoconferência:** a dívida caiu de 15 para 9 arquivos do lote. Os testes vizinhos estão verdes, com 245
  testes passando. O único erro de tsc está em `acesso/identidade/porta-identidade-propria.ts`, que é de fora do lote.

- **Rodada de correção:**
  - Cargos: a faixa nova só entra na tabela salarial **vigente já começada** que cobre a data da faixa (antes aceitava
    rascunho e tabela futura e a faixa voltava inativa, escondida da versão, da situação e da duplicidade). Teste novo
    com a tabela futura.
  - Autoatendimento: o **atestado** está ligado (`atestado_colaborador`, com o CID pelo catálogo CID-10 e o anexo em
    `arquivo`); toda leitura grava o acesso em `atestado_colaborador_acesso`, e o CID só sai a quem pede para vê-lo.
    A solicitação diz `temAtestado`. Teste novo (6 de 6).
  - Realizado do plantão: a **tarifa por tipo** é incluída (`valor_hora_plantao.tipo_plantao`); a origem do realizado
    e o motivo da recusa ficam no plantão (`fonte_realizado`, `motivo_recusa_realizado`) e voltam na leitura.

## Decisões pela melhor prática (para o dono ver)
1. **Na faixa salarial, o "nível" do contrato é o degrau numérico do modelo.** Um nível em texto, como "I" ou "A", é
   recusado com `faixa-nivel-invalido`. O contrato precisa mudar (ver os pedidos).
2. **A faixa nova vai para a tabela salarial do estabelecimento que vale na data.** A vigente tem prioridade sobre o
   rascunho, e a tabela encerrada não recebe faixa. Sem tabela na data, a recusa é `tabela-salarial-ausente`.
3. **A versão nova da faixa e da vaga encerra a anterior na véspera.**
   - O motivo é obrigatório, como pede o CHECK do banco.
   - Só a versão atual pode ser versionada: sem fim próprio, ativa e sem sucessora. Qualquer outra recusa com
     `desatualizado`.
4. **Faixa e vaga só são excluídas sem nada ligado.** Não pode haver versão anterior nem posterior, e a faixa não pode
   estar em uso no histórico salarial. A exclusão é lógica e guarda o retrato na trilha.
5. **A faixa só entra na tabela vigente em vigor hoje e na data da faixa.** Rascunho e tabela futura não recebem
   faixa por aqui (são preparadas no fluxo da tabela salarial), porque a faixa só conta na tabela vigente já começada.
6. **CID do atestado só pelo catálogo CID-10 carregado** (`cid-inexistente` fora dele); o atestado é um por solicitação
   (`atestado-repetido`) e só na solicitação do tipo atestado (`atestado-fora-do-tipo`).
7. **A vaga do quadro exige um centro de custo ativo do próprio estabelecimento.** Fora disso, a recusa é
   `centro-custo-inexistente`.

## Pedidos (em `01-pessoas-1.json`)
- **DDL:** o pedido f22 03-07, da integração da folha com o financeiro, não foi aplicado nem recusado.
- **Contrato:** o nível da faixa deve passar a ser numérico.
- **Teste de outro lote:** em `aplicacao/escala.int.spec.ts`, `coberturaRegistrada` passou a valer `true`.
- **Auxiliar compartilhado:** `modeloPendente` em `banco-apoio.ts` continua, porque outros lotes ainda o usam.

## O que falta neste lote
O DDL de todos os itens abaixo já existe (`15_RH/05_tabelas.sql`). O que falta é o trabalho de porta.
- **Autoatendimento:**
  - o efeito da aprovação no ponto, nas férias e no cadastro.
- **Avaliação:**
  - competências e a ligação delas ao cargo (`competencia_avaliacao`, `cargo_competencia`);
  - abertura e correção da avaliação, ciência e quem finalizou, nas colunas novas de `avaliacao_desempenho`;
  - o motivo da situação do ciclo;
  - o PDI, em `plano_desenvolvimento`.
- **Realizado do plantão:**
  - o lançamento no repasse e o estorno, nas colunas de repasse do `plantao` e em `lancamento_repasse`.
- **eSocial:** os parâmetros do empregador, a ficha do vínculo, o lote ao coletor, a operação dos eventos de tabela e a
  conferência gravada.
- **Folha:**
  - as 19 leituras e a gravação do cálculo (`processamento_folha*`, `parametro_folha`, `fechamento_periodo_folha`,
    `obrigacao_fechamento`);
  - os pendentes de `porta-folha-propria.ts`.
- **Integração da folha:** depende do DDL 03-07.
