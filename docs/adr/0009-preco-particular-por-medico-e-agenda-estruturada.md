# ADR 0009: preço particular por médico, credenciamento e agenda estruturada

- **Data:** 2026-11-21
- **Situação:** aceita (decisões do dono, itens 24 a 27, no chat da obra)
- **Fontes:**
  - `docs/obra/fatias/preco-profissional.md`: levantamento na origem, só contagens;
  - `docs/retorno-agente-halai/resposta-agente-172-agendas-valores-convenios.md`: como o agente de marcação usa hoje
    agendas, valores e convênios, com nomes anonimizados.

## Decisões

- **Preço da conta de convênio:** quem define é **o convênio**.
  - A ordem atual do cálculo vale: tabela da conta, depois o plano, depois o convênio, aplicando contrato, vigência e
    percentuais.
  - **24. Não há preço por médico em convênio.**
- **O médico define só o preço PARTICULAR** (consulta e exame), que pode diferir entre médicos da mesma área.
  - A regra estruturada de preço particular tem como dona a agenda ou o profissional.
  - Ela vale por procedimento ou grupo, com valor fixo, vigência, estabelecimento e prioridade, e a mais específica
    vence.
  - Ela substitui os dois `valor_consulta` duplicados.
  - No particular, o cálculo da conta lê essa regra antes da tabela do particular.
- **O repasse ao médico** continua separado, sobre o valor cobrado.
  - A marca da origem "consulta particular vai inteira ao médico" vira regra de repasse.
- **25. Atender sem credenciamento:**
  - **alerta** por padrão;
  - **bloqueio** opcional, por convênio.
- **26. "Convênio novo credencia todos os médicos ativos":** opção do cadastro de convênio.
  - Fica **ligada para a ProntoCardio**, por continuidade.
- **27. Texto livre da agenda transformado em regra:**
  - a regra extraída vale **logo**, como melhor estimativa, com o texto original inteiro ao lado na tela;
  - só o trecho que não der para interpretar fica marcado e continua funcionando pelo texto;
  - o Sincronizar extrai de novo quando o texto da origem muda.
- **Colunas próprias para o que hoje é texto** (dono): valor particular de consulta e de exame, cobertura por convênio
  **e por subplano** (aceita ou exclui), restrições (sexo, idade, retorno, encaixe) e preparo.
  - Os subplanos citados no texto viram planos dentro do convênio (plano superior).
  - O texto original é guardado sem corte (fim do limite de 2.000 caracteres).
- **API de compatibilidade (ADR 0008):** devolve exatamente o que a `sante-api` devolve hoje, inclusive o texto.
  - O mapa campo a campo está no levantamento.
  - Faltam 4 colunas e 1 parâmetro: código de origem da agenda, vigência cadastrada da agenda, atendimento permitido
    no convênio, o texto sem corte e o "particular" padrão do hospital.

## Execução

Depois da rodada 5 do conector e das portas da F2.4, que editam os mesmos arquivos, e **antes da carga completa da
ProntoCardio**:
1. modelo;
2. mapa e extração do texto no conector;
3. cálculo do particular no domínio;
4. telas de agenda e preço mostrando a regra e o texto.

As perguntas dos pacientes do item 6 da resposta da Hal-AI viram o teste de aceite.
