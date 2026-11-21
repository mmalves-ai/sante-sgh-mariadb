# F2.4 lote 21-misto-farmacia

## O que mudou
- **Hora do dia `HH:MM` de ponta a ponta:**
  - na telemedicina: contrato, porta própria e de memória, serviço, telas e testes. `civilNoFuso` devolve `hora`.
    `instanteNoFuso` recusa fora de `HH:MM` pelo `horaParaMinutos`. A entrada da porta usa `esquemaHora`. O
    domínio já esperava `HH:MM`, e o serviço mandava `HHMM`;
  - no pedido de cirurgia do portal do médico: o contrato usa `esquemaHora`, a tela lê com `lerHoraDigitada` e a
    edição devolve `HH:MM`;
  - no worker do censo: `diaEHoraLocal` devolve `HH:MM`, que é o que o motor de internação espera.
- **Farmácia:**
  - a pendência de revisão médica grava o parecer `revisao_medica` (o DDL já foi aplicado). A decisão final altera
    essa mesma linha, porque o par avaliação + item é único, e o cabeçalho fica em avaliação enquanto houver pendência;
  - as gravações e as leituras principais que ainda não têm escrita no banco próprio recusam com 409 `modelo-pendente`
    (dívida contada): fila e dispensação por horário, entrega, devolução, cancelamento, controlado, livro,
    ambulatorial e envio nacional. As leituras deixaram de devolver lista vazia;
  - os alvos da trilha usam as tabelas próprias, como `dispensacao`, `dispensacao_item`, `documento_estoque`,
    `avaliacao_farmaceutica` e `movimento_estoque`.
- **Portal do médico:**
  - a troca do e-mail grava em `troca_email_conta_portal`: pedido, cancelamento, confirmação e as duas leituras;
  - a notificação do crítico grava em `aviso_valor_critico_tentativa`, uma por aviso e conta, e tem leitura por conta.
    **Ela só grava se o cliente tiver o canal `portal_medico_externo`, cuja semente ainda não existe** (pedido abaixo).
    Sem ele, cada aviso recusa com `canal-inexistente`: o ciclo segue para o próximo aviso, devolve a recusa em
    `recusas` (só ids e código) e a vigia a registra no log. Nada é marcado como notificado;
  - a troca de senha segue recusando com `modelo-pendente` (depende do provedor de identidade).
- **Worker de integração:** a falta do padrão de troca passa a recusar com o código `padrao-troca-ausente`. A estrutura
  existe; o que falta é o cadastro.
- **Comentários do contrato da teleconsulta:** saíram os nomes de origem.
- **Testes:**
  - farmácia: revisão médica num teste próprio (pendência, cabeçalho em avaliação, decisão final na mesma linha) e
    recusa das leituras pendentes, verde no cliente `f24_21mistofarmacia`;
  - portal: a recusa `canal-inexistente` volta em `recusas`, sem notificar nem enviar;
  - portal: troca do e-mail e notificação;
  - censo: fixtures em `HH:MM`.

## Decisões pela melhor prática (para o dono ver)
1. **`revisao_medica` não fecha o item nem a avaliação.** O item é decidido de novo depois da revisão do médico, na
   mesma linha (trava e versão relida). A revisão fica na trilha. A avaliação só conclui sem pendência de revisão e
   com parecer final em cada item vigente.
2. **Pendência continua `modelo-pendente`.** Um código novo esconderia a dívida do verificador. Por isso as leituras
   pendentes recusam (409) em vez de mostrar fila ou livro vazios como se fossem reais.
3. **Envio sem nome de fornecedor no banco:** o `halai` da tela é gravado como `plataforma`, e a porta traduz nos dois
   sentidos.
4. **Resultado da notificação do crítico:**
   - mensagem deixada no portal: `recado`, porque o envio não confirma a leitura e a ciência é registrada à parte;
   - envio desligado: `sem_resposta`, com o motivo na observação.

   O canal é `canal_notificacao.codigo = 'portal_medico_externo'`. Sem ele, a gravação recusa com `canal-inexistente`.

## Pedidos (saida/21-misto-farmacia.json)
- **DDL:**
  - `conta_portal_profissional_externo`: UNIQUE só do profissional vigente, para destravar "religar";
  - tabela nova do histórico de atos da conta do médico externo (`atosConta`).
- **Código:** a contabilização do worker deve usar a escrita da porta da API (lote 14) por um pacote comum. Até lá,
  `ler` e `gravar` do worker seguem recusando com `modelo-pendente`.
- **Lote próprio da farmácia hospitalar:**
  - contrato neutro da dispensação por horário;
  - dispensação, entrega, devolução e cancelamento;
  - conferência e perda do controlado;
  - dispensação ambulatorial;
  - envio nacional;
  - fechamento do livro, com o armazém de arquivos (ADR 0004).
- **Semente (segurança do paciente, etapa compartilhada):** `canal_notificacao` `portal_medico_externo`. Sem ela, a
  notificação do crítico ao médico externo não grava em nenhum cliente.
- **Teste pendente:** a gravação de uma tentativa real da notificação. Ele depende da massa de resultado de exame e
  aviso crítico (lote da SADT) e da semente do canal.
