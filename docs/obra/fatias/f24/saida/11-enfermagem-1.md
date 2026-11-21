# F2.4, lote 11-enfermagem-1: resultado parcial (rodada 2)

## O que mudou
- **Nome de origem (zerado):** o alvo da trilha de auditoria nos controladores usa as tabelas do modelo próprio:
  `internacao`, `horario_administracao`, `atendimento` e `requisicao_transfusao`. O comentário do vínculo profissional
  em `sae-servico.ts` foi reescrito, e os specs vizinhos foram ajustados.
- **Vocabulário antigo (zerado), de ponta a ponta:** a hora de corte do balanço hídrico agora trafega como `HH:MM`
  (`07:00`) no contrato, na API (controlador e porta em memória), na tela `BalancoTela.vue` e no spec. Os comentários
  do domínio também foram atualizados.
- **Modelo pendente, resolvido sobre estrutura que já existia:**
  - **Balanço hídrico:**
    - o ganho da checagem entra no fechamento ligado a `horario_administracao_id`, uma vez só (sem isso, a gravação é
      recusada com `balanco-mudou`);
    - o lançamento manual guarda `chave_ato`: o reenvio devolve o lançamento já gravado, e a chave usada por outra
      pessoa ou em outro atendimento é recusada.
  - **Transfusão:**
    - a alteração da requisição guarda a versão anterior em `requisicao_transfusao_versao`, com o motivo;
    - o adendo dos sinais grava em `ato_transfusional_adendo`, e a medida original não muda;
    - as leituras das versões e dos adendos passaram a vir do banco;
    - o início do ato pela checagem do horário do hemocomponente usa a mesma função do início pela tela
      (`iniciarAtoTransfusional`), na transação da checagem.
  - **Beira do leito:**
    - cadastro, alteração (com motivo), inativação, exclusão (recusada quando há leituras ligadas) e sincronismo do
      aparelho, além da leitura do aparelho autorizado;
    - registro do conflito de sincronização (um por chave) e a resolução dele;
    - eventos da infusão contínua (início, pausa, velocidade e fim) no evento do horário, e a leitura deles.
  - Testes de integração novos e ajustados para cada item acima, no cliente `f24_11enfermagem1`. A limpeza dos dados
    de teste agora apaga as versões e os adendos.

- **Rodada 2 (correções dos achados):**
  - a trilha de leitura da lista e do item de hemoterapia usa o alvo `prescricao_item`, coerente com o id gravado (o id
    do item da prescrição, e não o da requisição);
  - a exclusão do aparelho da beira do leito volta a ver as checagens dele: o resumo é calculado com `TRIM` no banco, o
    identificador vai aparado ao evento e a checagem do hemocomponente feita no aparelho grava o canal `beira_leito` e
    o aparelho no evento do horário (o início do ato recebe o aparelho).
- **Rodada 2 (modelo pendente ligado às tabelas que já existiam), escores:**
  - reavaliação programada (`reavaliacao_escala`): programar, dispensar, ler; o NEWS2 grava as reavaliações por
    mudança de quadro e o escore cumpre as pendentes devidas; o estorno do escore reabre a cumprida por ele numa linha
    nova (cumprida pelo escore válido seguinte ou pendente);
  - classificação de pacientes, Fugulin e NAS (`classificacao_paciente`): uma válida por instrumento, turno e
    internação, leitura por unidade, dia e turno, estorno com o motivo;
  - índice da UTI, APACHE II e SOFA (`indice_gravidade_uti`): registro, validação, estorno, leitura do paciente e do
    período;
  - adendo da checagem da contenção (`contencao_paciente_avaliacao_adendo`), só do autor, lido junto da checagem;
  - protocolo gerenciado do internado: inclusão (uma aberta por tipo e atendimento), encerramento e inativação por
    engano;
  - ficha da PCR por versão (`parada_cardiorrespiratoria_ficha`), com a correção justificada da finalizada e a
    inativação, e a leitura das versões.
  - Testes de integração novos para cada item, no cliente `f24_11enfermagem1`.

## Decisões pela melhor prática (para o dono ver)
- **Aparelho da beira do leito:** o banco guarda só o resumo SHA-256 de `estabelecimento:identificador`, nunca o
  identificador.
- **Exclusão do aparelho:** as checagens feitas nele são contadas pelo mesmo resumo, calculado sobre o identificador
  gravado no evento.
- **Chave do ato no balanço:** uma chave com mais de 80 caracteres é guardada pelo resumo dela, nunca truncada, para
  não haver colisão.
- **Alteração da requisição:**
  - o prazo continua sendo calculado pelo tipo de transfusão, e não é digitado;
  - a troca de hemocomponente com bolsa reservada é recusada com `requisicao-com-reserva`.
- **Conflito de sincronização:** quando o aparelho é exigido no lote, o conflito de um aparelho não autorizado é
  recusado com `aparelho-nao-autorizado`.

- **Reavaliação de escala que falta no cadastro:** o NEWS2 nunca é recusado por ela; o pedido fica na fila de saída
  (`enfermagem.reavaliacao.sem-cadastro`) para o administrador carregar a escala.
- **Chave da reavaliação:** paciente, escala e chave da tela; a que passa de 80 caracteres vira o resumo SHA-256.
- **Mortalidade estimada do índice da UTI:** guardada em percentual com duas casas (a coluna é DECIMAL(5,2)), o que
  preserva a fração de quatro casas da tela. A impressão da configuração usada vai junto das variáveis
  (`{valores, configuracao}`), para a tela saber se a configuração mudou.
- **Tipo do estorno (estorno ou invalidação):** lido da trilha da gravação, como o motivo do estorno do escore.
- **Versão do instrumento da classificação:** vai à trilha da gravação.
- **Inativação por engano do protocolo:** não muda a inclusão (fica visível com o evento `descarte` e o motivo); a
  saída é o encerramento (evento `saida`, situação `encerrado`).
- **Ficha da PCR:** os campos chegam em JSON e o JSON inválido é recusado (`dados-invalidos`); unidade e UTI saem da
  ocupação do leito na hora do acionamento.

## Pedidos e o que falta (veja `11-enfermagem-1.json`)
- **DDL:**
  - ampliar o CHECK de `horario_administracao_evento.evento` com a retomada e a troca de bolsa da infusão;
  - criar a estrutura da resposta de extensão do formulário;
  - ampliar o CHECK do evento da inclusão no protocolo com a meta e o item do checklist;
  - lesão de pele: a ficha em texto longo, a foto e a inativação;
  - evento do TRR versionado (retificação e inativação da chegada e do desfecho).
- **Ainda com `modelo-pendente`:**
  - `escores-porta-propria.ts`: profilaxia de TEV (decisão e retificação, falta decidir o encaixe na avaliação), lesão
    de pele (7), retificação e inativação do evento do TRR, meta e checklist do protocolo;
  - `sae-porta-propria.ts`: 7 operações (desenho sobre a prescrição, a terminologia e a receita).
- **Nome do legado no controlador da transfusão:** `transfusao.controller.ts` ainda usa nomes `SGH_SADT_HEMO_*` como
  tabela da trilha (o verificador não aponta; a porta os traduz).
