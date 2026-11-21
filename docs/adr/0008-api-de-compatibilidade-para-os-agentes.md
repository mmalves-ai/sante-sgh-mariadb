# ADR 0008: API de compatibilidade para os agentes de IA (comutação do Firebird para o MariaDB)

- **Data:** 2026-11-21
- **Situação:** aceita (decisão do dono, no chat da obra)

## Contexto

Os agentes de IA da Hal-AI (marcação de consultas e exames, atendimento e Squads de gestão) consomem hoje a
**`sante-api`** (`../sante-api`, Node, versão 0.30.1, lendo o Firebird do sistema de origem).

O contrato tem cerca de 60 rotas:
- **Marcação:** `/consultas/*` (catálogo, disponibilidade, valor, agendamentos, cancelar, remarcar), `/exames/*`
  (disponibilidade, valor, cobertura, agendamentos), `/convenios`, `/medicos`, `/pacientes`, `/agendamentos`;
- **Gestão:** `/gestao/*` (agenda, internação, faturamento, glosa, receita, TISS, produção e outras), cerca de 37 rotas;
- **Auditoria e ações:** `/auditoria/*` e `/acoes/*`.

A documentação dela está em `../sante-api/documentation/API.md`, com o OpenAPI em `src/openapi*.js`. Os pedidos da
Hal-AI estão em `../../hal-ai/halai-newux/docs/pedido-sante-api-*.md` e `brief-api-sgh-superficie.md`.

Muito do que a marcação usa está em **texto livre** na origem: valor particular de consulta e exame, convênios e
subplanos aceitos, restrições. O agente lê esse texto nas observações da agenda.

## Decisão

1. **Uma API de compatibilidade servida do MariaDB** substitui a `sante-api` na virada de cada cliente.
   - **Mesmas rotas, mesmos parâmetros, mesmo formato e os mesmos dados** para o mesmo estado do hospital.
   - Os agentes não percebem a troca: não reimportam API e não mudam prompt.
   - A comutação é por cliente: a configuração aponta a origem (Firebird) ou o banco novo, e há caminho de volta.
2. **Igualdade provada por teste, não declarada.**
   - Um conjunto de pedidos gravados cobre todas as rotas e os casos de borda: agenda inexistente, lotada,
     convênio/subplano não aceito, valor ausente, paciente sem cadastro.
   - Cada pedido roda na `sante-api` (sobre a cópia da origem) e na API de compatibilidade (sobre o banco novo carregado
     pelo conector, a partir da mesma cópia).
   - As respostas têm de ser iguais campo a campo. Só a ordem é normalizada, onde a rota não promete ordem.
   - As diferenças ficam num relatório.
   - Esse teste é o critério de aceite da comutação.
3. **Dado estruturado no banco novo, texto preservado.**
   - Valores de agenda (particular de consulta e de exame, por agenda e profissional, com vigência), cobertura por
     convênio **e por subplano**, restrições e preparo ganham **colunas e tabelas próprias** (decisão do dono).
   - O texto original de cada observação fica guardado ao lado, como origem.
   - Onde a `sante-api` devolve hoje o texto, a compatibilidade devolve o **mesmo texto**.
   - Os campos estruturados entram só como **acréscimo opcional**, que não quebra nenhum agente (padrão Hal-AI §10).
4. **Melhorias pedidas pela Hal-AI**, como distinguir "agenda inexistente" de "lotada" e dar o motivo do 409, entram
   **só como acréscimo** e documentadas no OpenAPI. Nada que o agente usa hoje muda.
5. **O conector escreve, a compatibilidade lê.** A API de compatibilidade só lê o banco novo, exceto as rotas de
   marcação, que gravam pelo Executor do domínio, com a mesma regra da tela. Nada volta a gravar no Firebird.

## Consequências e pré-requisitos

- O levantamento do uso real vem de duas fontes:
  - o pedido ao agente de marcação: `docs/obra/pedidos/pedido-halai-uso-agendas-valores.md`, com a resposta trazida
    pelo dono;
  - o levantamento do preço por médico: `docs/obra/fatias/preco-profissional.md`.
- Para comparar, é preciso **uma cópia da origem posterior às correções** que o hospital fez nas observações (valores
  particulares e subplanos). A cópia local é anterior.
- A construção vem depois da carga da ProntoCardio e entra na F5 (homologação e virada):
  - módulo próprio no `apps/api`, com prefixo de rota configurável;
  - os pedidos gravados versionados em `tools/compatibilidade/`;
  - o relatório de igualdade como prova.
- A `sante-api` é **fonte de contrato e de regra, só leitura**: o código dela não é copiado. As regras que ela
  aplica sobre o texto livre (casamento de nome, ordem do nome da agenda, particular por hospital) são lidas e
  reescritas sobre os dados estruturados, com teste.
