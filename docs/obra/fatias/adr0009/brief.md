# Brief comum: preço particular por médico, credenciamento e agenda estruturada (ADR 0009)

Lido por todos os agentes da rodada. O texto vale como está: não abra de novo este arquivo.

## Decisões do dono (prevalecem sobre a proposta do levantamento)
- **Fonte:** `docs/adr/0009-preco-particular-por-medico-e-agenda-estruturada.md`, com o levantamento em
  `docs/obra/fatias/preco-profissional.md` e o uso real em
  `docs/retorno-agente-halai/resposta-agente-172-agendas-valores-convenios.md`.
  - Leia só as seções que sua tarefa cita (`grep -n '^#'` e `sed -n`).
- **24. Não existe preço por médico em convênio.**
  - O preço de convênio vem do convênio, pela ordem atual: tabela da conta, depois o plano, depois o convênio, com
    contrato, vigência e percentuais.
  - A proposta do levantamento que permite valor por médico em convênio (seção 4) está **recusada**.
- **O médico define só o preço PARTICULAR** de consulta e exame.
  - É uma regra estruturada cuja dona é a agenda ou o profissional, por procedimento ou grupo.
  - Ela traz valor fixo, vigência, estabelecimento e prioridade; a mais específica vence.
  - Substitui os dois `valor_consulta` duplicados.
  - No particular, o cálculo da conta lê essa regra **antes** da tabela do particular.
- **Repasse ao médico:** continua separado, sobre o valor cobrado.
  - A marca da origem "consulta particular vai inteira ao médico" vira **regra de repasse**.
- **25. Atender sem credenciamento:**
  - **alerta** por padrão;
  - **bloqueio** opcional, por convênio (coluna no cadastro do convênio).
- **26.** Opção do cadastro de convênio "convênio novo credencia todos os médicos ativos".
  - **Ligada para a ProntoCardio**, por continuidade. No conector, é marcada para o cliente importado.
- **27. Texto livre da agenda transformado em regra:**
  - a regra extraída vale **logo**, como melhor estimativa;
  - o texto original fica inteiro ao lado, na tela;
  - o trecho que não se interpreta fica marcado e continua valendo pelo texto;
  - o Sincronizar extrai de novo quando o texto da origem muda.
- **Colunas próprias para o que hoje é texto:**
  - valor particular de consulta e de exame;
  - cobertura por convênio **e por subplano**, que aceita ou exclui;
  - restrições: sexo, idade, retorno e encaixe;
  - preparo.
- **Subplanos citados no texto** viram planos dentro do convênio (plano superior).
- **O texto original é guardado sem corte**, sem o limite de 2.000 caracteres.
- **API de compatibilidade (ADR 0008):** a API devolve exatamente o que a `sante-api` devolve hoje, inclusive o
  texto. Esta rodada só garante as colunas que faltam (seção 5.4 do levantamento):
  - código de origem da agenda;
  - vigência cadastrada da agenda;
  - atendimento permitido no convênio;
  - texto sem corte;
  - o "particular" padrão do hospital, como parâmetro.

## Regras do projeto que mais pesam aqui
- **Nomes de negócio** em português. Nada de nome do SPDATA ou do MV fora do mapa do conector (`conector/mapa/`).
- **DDL pelo ADR 0002, parte 2:**
  - PK, FK RESTRICT, NOT NULL, CHECK, auditoria (`criado_em`, `criado_por`, `alterado_em`, `alterado_por`),
    vigência e estabelecimento;
  - migração nova em `db/migracoes/<módulo>/<próximo número livre>_tabelas.sql` e `_chaves.sql`, só para frente;
  - linha nova em `docs/analise/rodada2/final/catalogo.tsv` para cada tabela nova;
  - `python3 -I tools/db/validar_migracoes.py` precisa passar.
- **Regra de negócio no domínio** (`packages/dominio-*`, funções puras, com teste). Nada de gatilho.
  - Só `packages/persistencia` fala com o banco. Só `conector/` lê a origem.
- **Dados reais** só como contagens. Os testes usam dados sintéticos.
- **Banco próprio por agente:** quem testa contra o banco cria um cliente de teste com o seu rótulo
  (`python3 -I tools/db/criar_cliente.py adr9_<rotulo> "..."`) e o apaga no fim. Nunca use `cliente_demo`.

## Teste de aceite
As perguntas dos pacientes da seção 6 da resposta da Hal-AI (`## 6.`, subseções Valor, Convênio e subplano, Preparo
e documentos, Restrições e vaga) viram casos de teste sobre dados sintéticos. Exemplos:
- "quanto custa a consulta particular com o médico X";
- "o médico Y atende o meu convênio Z, plano W";
- "precisa de preparo para o exame E";
- "o médico atende criança de 5 anos".

Cada caso responde pela regra estruturada e mostra o texto original ao lado.

## Saída
Resumo curto em `docs/obra/fatias/adr0009/saida/<rotulo>.md`, com o que mudou, as contagens e as pendências. Logs
longos vão para `/tmp/claude-1000/adr9/`.
