# F2.4, 3ª etapa: lote p-sadt (porta do SADT, isto é, Serviço de Apoio Diagnóstico e Terapêutico, sobre o banco próprio)

Resultado: 16 das 19 leituras e 3 das 6 gravações estão construídas. A leitura no portal também passou a gravar. Restam 3 leituras, 3 gravações e as 10 operações, todas como pedido em `p-sadt.json`. O arquivo ainda tem `modelo-pendente`, e a recusa explícita continua só onde falta estrutura ou contrato.

## O que mudou (`apps/api/src/modulos/sadt/porta-propria.ts`)
- **Bancada:**
  - `digitacao` monta os analitos do exame com:
    - a faixa de referência vigente, escolhida da mais específica para a geral: a do sexo do paciente antes da de ambos, a com idade antes da sem idade e a faixa etária mais estreita antes da larga; só então a mais recente (a pediátrica vence a geral mais nova). A referência guardada no resultado vem antes da do cadastro;
    - as respostas-padrão do grupo;
    - o valor crítico vigente: o da unidade vale antes do da rede, e o do exame antes do geral;
    - os valores digitados, as variáveis de fórmula, as observações, os modelos de resultado vigentes, o laudo diagnóstico, as grandezas do laudo e o bloqueio depois de liberado.
  - `conferencia` e `filaLiberacao` mostram os valores com a referência e o desvio para baixo ou para cima, quem digitou, o crítico e as versões retificadas (`resultado_exame_versao`). Cada versão traz quantas leituras houve antes dela.
- **Laudo para emitir:** `laudoParaEmitir` reúne exames de um paciente só, do estabelecimento. Traz o convênio, quem liberou, os valores e o texto do laudo (o laudo assinado ou, sem ele, o texto do resultado, mais a conclusão).
- **Recepção do setor:**
  - `requisicoes` lista os atendimentos do dia, com a requisição lançada no setor, o solicitante, a guia e a contagem de exames;
  - `atendimento` e `atendimentosPorNumero` buscam pelo id ou pelo número da recepção. A versão do atendimento e a do paciente servem à trava otimista.
- **Orçamento do diagnóstico:**
  - `orcamentos` e `orcamento` leem o orçamento particular com itens de exame;
  - `marcarOrcamentoConvertido` passa o orçamento para `realizado`, com o atendimento e a data local. Antes confere o estabelecimento, a situação e se o paciente é o mesmo. A segunda conversão é recusada.
- **Apoio:** `apoio` traz:
  - os setores executantes, como prestadores;
  - o catálogo, com o material e o recipiente padrão;
  - os kits, os recipientes e os convênios ativos.
- **Parâmetros:** `parametros` lê as chaves `sadt.*`, cada uma com o valor que vale para a sessão.
- **Indicadores:** `indicadores` agrega no banco o tempo de atendimento (TAT, *turnaround time*) em três trechos: do pedido à liberação, do pedido à coleta e da coleta à liberação. Cada média traz quantos exames entraram nela. Traz também o pendente há mais de 24 h, contado pela hora do estabelecimento, e a visualização no portal.
- **Portal de resultados:**
  - `laudosPortalDoPaciente`, `laudosPortalDoMedico` e `laudoPortal` leem `liberacao_resultado_portal`, só o que está vigente e dentro do prazo;
  - `registrarLeitura`, com origem portal, grava todo acesso em `acesso_resultado_portal` e soma `visualizacoes`; só a primeira abertura marca `primeira_visualizacao_em`. Publicação retirada ou vencida (`disponivel_ate`) não abre. Sem publicação vigente, a gravação é recusada com `resultado-nao-publicado`.
- **Autocadastro do médico externo:**
  - `autocadastros` lê `pedido_vinculo_profissional_externo`, com a situação da conta. Os candidatos são os profissionais com a mesma inscrição;
  - `decidirAutocadastro` recusa com motivo. A aprovação liga o pedido ao profissional com a mesma inscrição e cria ou ativa `conta_portal_profissional_externo`.
- **Testes:** `porta-propria.int.spec.ts` ganhou 5 casos novos, e os 9 passam no cliente `f24p_sadt`. Também mudou o `infra/parametros-sem-segredo.int.spec.ts`, que antes travava a recusa e agora confere que nenhuma credencial vai na resposta.

## Decisões pela melhor prática (para o dono ver)
1. **Prestador é o setor executante** (`setor_diagnostico`). O setor do exame no apoio é o executante padrão do estabelecimento (`exame_setor_executante`). Sem esse cadastro, vale o tipo de serviço do catálogo.
2. **Orçamento do diagnóstico = orçamento particular com itens `exame`.**
   - O item liga ao exame pelo item faturável ou, sem ele, pelo código do exame na descrição (ligação frágil; ver pedido `exame_id` no item). O item que não casa com exame nenhum continua na lista com a descrição e o valor do próprio item e o código do exame vazio (não identificado), para a soma dos itens bater com o total.
   - O ato é o do primeiro exame.
   - Na tela, `realizado` aparece como convertido, e `expirado` ou validade vencida aparece como vencido. `cancelado` e `recusado` não entram na lista.
3. **O solicitante no portal do médico é o profissional do cadastro** (`requisicao_exame.solicitante_profissional_id`). Por isso a aprovação do autocadastro exige um profissional com a mesma inscrição (conselho, UF e número). O login da conta criada é o e-mail do pedido. Se esse login já existir, a aprovação é recusada (`login-em-uso`).
4. **Todo acesso pelo portal fica no registro de acessos** (auditoria de acesso a dado de saúde, LGPD); a primeira abertura só marca a publicação.
6. **Laudo para emitir só com laudo assinado** (`assinado`, `emitido`, `retificado`, como no portal). Exame com laudo em rascunho ou aguardando revisão é recusado (`laudo-nao-assinado`), sem cair para o texto do resultado.
7. **Conversão do orçamento:** só orçamento com item de exame; vencido pela data (validade antes de hoje no fuso do estabelecimento) recusa com `orcamento-indisponivel`; o **rascunho converte**, porque no setor o orçamento é feito e aceito no balcão e a conversão registra o aceite (`aceito_em`).
5. **Parâmetros sem campo oculto:** o modelo não guarda segredo em parâmetro (o segredo vai ao cofre), então `ocultos` sai vazio. Uma chave `sadt.<setor>.*` só aparece no próprio setor.

## Pedidos (`p-sadt.json`)
- **DDL `protocolo_acesso_portal`:** guarda o resumo do protocolo, as tentativas e o bloqueio. Destrava `acessoPorProtocolo`, `criarProtocoloPortal` e a parte do paciente em `acessoPorId` e em `registrarTentativaPortal`.
- **Credencial do médico externo:** a senha (resumo) e o segredo do segundo fator. Podem ser colunas no pedido e na conta ou ir ao provedor de identidade, e essa escolha é **decisão do dono**. Destrava `acessoDoMedico`, `registrarAutocadastro` e a parte do médico em `acessoPorId` e em `registrarTentativaPortal`.
- **CPF no autocadastro:** a coluna é NOT NULL no modelo, e a entrada do portal não pede o CPF. Pede-se a troca de ponta a ponta.
- **Contrato novo das 10 operações** (`OPERACOES_SADT_PENDENTES`): o exame pelo id e pela versão, e o setor executante no lugar de prestador e local. Pede lote próprio.
- **`registrarOrcamento`:** a entrada traz só a quantidade de itens. Pede-se trocar por itens ou retirar a gravação em favor da operação.
- **DDL `orcamento_particular_item.exame_id`** (FK para `exame`, opcional): liga o item ao exame sem depender do item faturável nem do código na descrição.
