# F2.4, 3ª etapa: contratos e código comum (v4)

Aplica os pedidos de contrato e de código compartilhado de `p-*.json`. A prova é a seguinte:
- tsc com 0 erros em contratos, api e worker;
- vue-tsc com 0 erros em web e ui;
- vitest verde em api (13 arquivos, 82 testes), web (11 arquivos, 56 testes) e contratos (4 arquivos, 30 testes);
- os testes de integração do estoque, do SADT e do repasse passam no cliente `f24_06mistosuprimentos` (3 arquivos, 23 testes).

O verificador de dívida passou de 24 para 23 arquivos: saiu o `operadora/apoio-banco.ts`.

## O que mudou

### Estoque: o documento passa a ser chamado pelo id, de ponta a ponta

- **Contrato:** as entradas `registrarSaida.requisicao`, `registrarDevolucao.saida`, `reporKit.saida` e `desconsolidarDocumento.documento` passam a receber o **id**:
  - `documento_estoque` para a saída;
  - `requisicao_material` para a requisição;
  - `nota_entrada` para a nota.

  Antes elas recebiam a chave `{ano, mes, doc}`, que foi removida das entradas (`esquemaChaveDocumento`). As respostas continuam trazendo a chave lida, para mostrar na tela, junto com o `id`.
- **API:** `documentoPelaChave` virou `documentoPorId`, que lê por id e estabelecimento, com trava. Também mudaram:
  - a requisição atendida e a nota desconsolidada passam a ser lidas pelo id;
  - o controlador de `requisicoes/atender` recebe o id e o procura na fila;
  - a porta em memória segue o mesmo contrato.
- **Movimento direto na porta em memória** (pedido de arquivo): devolve o documento como `id`, e o atendimento em campo próprio.
- **OPME:** a saída do consumo (`opme-respostas`) passa a trazer o `id` do documento, e a devolução do OPME manda esse `id`.
- **Web:** `DocumentoTela` desconsolida pelo `id` do documento lido, e `RequisicoesTela` atende pelo `id` da requisição.
- **Testes:** `suprimentos.spec`, `porta-propria-estoque.int.spec` e `opme-telas.spec`.

### SADT

- **Gravação direta `registrarOrcamento` retirada** de `GravadorSghSadt` (porta, porta própria e memória). Ninguém a chamava, e o orçamento nasce pela operação `sadt.criarOrcamento`. O teste de integração "o que falta no modelo" passou a conferir a recusa com `criarProtocoloPortal`.
- **Autocadastro do médico externo:** passa a pedir o **CPF**. O contrato `esquemaAutocadastroMedico.cpf` tira a máscara e confere os dígitos verificadores. O CPF segue para a porta (`registrarAutocadastro({ cpf })`) e entrou na tela `PortalMedicoCadastroTela` e no i18n. A porta própria continua recusando pelo motivo que falta (senha e segundo fator), e o texto do motivo deixou de citar o CPF.

### Repasse: gravador para a escala

O `public-api` do repasse passa a exportar `gravadorEventoRepasse(tx)` e `TABELAS_EVENTO_REPASSE` (`lancamento_repasse`), no mesmo padrão de `gravadorTituloPagar`:
- `incluir` lança com origem `plantao`, com as mesmas validações de `repasse.lancarEvento`: contrato, evento ativo e favorecido vigente;
- `estornar({ lancamento, data, competencia, justificativa, valor? })` lança o valor negativo ligado ao original. Sem `valor`, estorna o saldo ainda não estornado. Recusa `original-inexistente` e `estorno-excede`.

### Operadora

O `modulo.ts` deixou de usar `modeloPendente`. Quando a porta da autorização é montada sem a busca pela senha, a resposta agora é 503 `porta-indisponivel`. O `modeloPendente` do `apoio-banco.ts` foi apagado, porque não tinha mais quem o usasse.

### Oncologia

O contrato `esquemaRegistrarCicloOncologico` e o tipo `NovoCicloOncologico` ganharam `diagnostico` (id de `diagnostico_oncologico`) e `intencao` (id de `intencao_tratamento_oncologico`), os dois opcionais.

### Numerações

`tools/db/configurar_numeracoes.py` ganhou `nota_entrada`, `pedido_compra` e `requisicao_material`, que o estoque usa. As numerações da CCIH e da farmácia já estavam na lista.

## Decisões pela melhor prática (para o dono ver)

- **Documento do estoque pelo id.** Ano, mês e número continuam só na leitura, como número de negócio. Na nota, o id é o da `nota_entrada`.
- **`registrarOrcamento` direto do SADT retirado, em vez de mudar a entrada.** O orçamento com os exames já tem a operação própria.
- **Diagnóstico e intenção do ciclo opcionais no contrato.** A exigência fica na porta (recusa `tratamento-sem-diagnostico`) só quando o ciclo abre um tratamento. Os ciclos seguintes usam o tratamento aberto, e a tela atual não quebra.
- **CPF do autocadastro conferido no contrato**, com o mesmo cálculo de `validacao/cpf.ts`.

## O que falta (pedidos que seguem abertos)

1. **SADT, contrato das 10 operações** (`OPERACOES_SADT_PENDENTES`): o exame passa a ser `{ id, versao inteira }`, o setor executante substitui prestador e local, e os retratos saem. A mudança vai do contrato à web, à memória e à porta própria. Pede um lote próprio, com dois agentes: um para contrato e web, outro para a porta.
2. **Ligar o gravador do repasse** em `pessoas/escala/porta-realizado-propria.ts`:
   - `podeGravar` e `executar` de `repasse.lancarEvento`;
   - `estornarRealizado`, `ligarEstorno` e `desfazerEstorno`;
   - as colunas `plantao.lancamento_repasse_id` e `estorno_lancamento_repasse_id`.

   É trabalho do lote de pessoas.
3. **Oncologia:** a porta própria precisa criar o `tratamento_oncologico` com diagnóstico e intenção, e a tela precisa escolher os dois, o que pede as leituras dos diagnósticos do paciente e das intenções. É trabalho do lote de especialidades.
4. **Contratos não aplicados nesta etapa:**
   - estoque: o resto do vocabulário (destino, origem, situação do pedido, tipo de compra, vencedor e tipos do usuário);
   - farmácia: situação da entrega, documento de saída e checagem por nome;
   - eSocial: ficha estruturada;
   - SESMT: registro de proteção por tipo mais id;
   - CCIH: versão vista no consumo de álcool, `manterDispositivo` e desfazer retirada;
   - portal médico: `trocarSenha` com a política de reuso.
5. **Composição do autoatendimento:** os gravadores de ponto, férias e cadastro sobre a mesma `TxOperacao`.
