# F2.4, 3ª etapa: lote p-farmacia (farmácia hospitalar no banco próprio)

## O que mudou
- **Porta própria da farmácia sem nenhuma recusa `modelo-pendente`** (`divida_f24 --modulo api/farmacia` = 0). Toda
  gravação vai pelo Executor do núcleo, com trilha no alvo gravado, evento no outbox e idempotência. Toda leitura é
  restrita ao estabelecimento da sessão.
- **Novo `gravador-dispensacao.ts`**, com as gravações da farmácia hospitalar:
  - **dispensação por horário:** `dispensacao`, um `dispensacao_item` por insumo e lote, uma `dose_dispensada` por
    item, documento de saída `documento_estoque` 'saida_paciente' com as linhas, lançamento no razão
    (`movimento_estoque`), baixa do saldo do local e do lote (relidos com trava, pela versão) e `entrega_setor` em
    trânsito. O horário guarda a dispensação (`horario_administracao.dispensacao_id`), o que recusa a segunda
    dispensação;
  - **entrega ao setor:** quem recebeu, quando, o modo e o dispositivo em `entrega_setor`; doses e itens entregues;
  - **devolução:** `devolucao_dispensacao` + item, conferida, com o documento de entrada e a volta ao saldo;
  - **cancelamento antes da entrega:** estorno do lançamento de saída (`estorno_movimento_estoque_id`), horário de
    volta à fila e, sem dose ativa, entrega estornada, dispensação cancelada e documento estornado;
  - **perda do controlado:** documento de baixa com motivo e testemunha. A testemunha com usuário vira a segunda
    conferência;
  - **dupla conferência:** `conferencia_controlado` por documento e lote;
  - **livro de controlados:** fechamento de conferência em `livro_controlado`, com o hash SHA-256 do conteúdo e a
    guarda legal;
  - **dispensação ambulatorial:** receita retida em `receita_controlada`, dispensação 'ambulatorial' e saída do lote;
  - **envio nacional:** `envio_controlado_nacional` + um item por lançamento. A receita passa a 'escriturada'.
- **Avaliação pelo horário** (`suprimentos.avaliarPrescricao`): usa a decisão por item do `gravador-avaliacao.ts`.
- **Leituras reais** no lugar das recusas: fila por horário, itens prescritos, doses do atendimento, situações,
  entregas, doses da saída, leitos, aceites, substituições, movimentos e conferências do controlado, livro fechado,
  janela de entregas e ambulatoriais.
- **Testes** no cliente `f24p_farmacia`, com massa sintética F24PF:
  - o novo `porta-propria-dispensacao.int.spec.ts` (8 casos), com o contrato de efeito e as recusas;
  - o `porta-propria.int.spec.ts`, ajustado.

  Conferência do lote: `ok`.

## Decisões pela melhor prática (para o dono ver)
1. **O controle da entrega é a `entrega_setor`.** Na borda, a porta traduz a situação para os números do contrato (7,
   8 e 9). O "documento de saída" das telas é o documento de estoque da dispensação.
2. **Um item e uma dose por lote.** Uma dose com dois lotes gera duas doses, cada uma com a etiqueta do seu lote.
3. **A dispensação tem a prescrição da primeira dose como referência.** Cada item aponta o seu item prescrito.
4. **A quantidade da dose está na unidade de estoque.**
5. **Cancelamento e devolução são coisas diferentes.**
   - O cancelamento antes da entrega é um estorno no razão. A dose volta à fila.
   - Depois da entrega, só cabe a devolução, com documento de entrada.
6. **Fechamento do livro.**
   - O fechamento oficial recusa com 503 `armazenamento-indisponivel` até a porta de armazenamento (ADR 0004) chegar à
     farmácia. Não há falta de modelo: o CHECK exige o arquivo do conteúdo.
   - O de conferência grava. A leitura devolve `conteudo` vazio, porque o conteúdo só é guardado no fechamento
     oficial. Nenhuma tela usa esse campo.
7. **Farmácia ambulatorial.**
   - Registra só controlado e antimicrobiano, com receita retida, prescritor do cadastro e validade de 30 dias (10 no
     antimicrobiano). Outro item recusa com `fora-da-escrituracao`.
   - A farmácia que dispensa é a que tem o lote com saldo, a central primeiro.
8. **O controlado por horário confere o registro do prescritor no conselho** (inscrição principal ativa).
9. **A perda grava a testemunha no documento.** Se a testemunha tiver usuário, vira também a segunda conferência.

## Pedidos (saida/p-farmacia.json)
- **Numerações:** `dispensacao`, `documento_estoque` e `devolucao_dispensacao` em `configurar_numeracoes.py`.
- **Sementes:** os tipos de movimento (consumo do paciente, devolução e perda) e os motivos de devolução do contrato.
- **Infra:** injetar a porta de armazenamento de arquivos na farmácia, para o fechamento oficial.
- **Contrato:**
  - `local` limitado a 99 em `entradas.ts`, quando é o id do local;
  - vocabulário neutro de ponta a ponta para a situação da entrega (7, 8, 9), o documento de saída (ano e mês) e a
    situação do horário (S, N).
- **Código:** o rótulo `SGH_SUP_LIVRO_CONTROLADO` em `servico.ts:658`.

## Correção da revisão (3ª etapa)
- `movimentos()` (razão do controlado, base do livro): a janela agora vai da meia-noite do dia inicial à meia-noite do dia
  seguinte ao final **no fuso do estabelecimento** (`instanteCivil`), passada como instantes, igual à fila e às doses.
  Antes a data saía do fuso do processo e era comparada como texto, e um movimento perto da meia-noite caía no dia errado.
- Teste novo em `porta-propria-dispensacao.int.spec.ts`: movimento às 23:30 locais aparece no seu dia e não no anterior
  nem no seguinte.
- `gravador-dispensacao.ts` e `porta-propria-dispensacao.int.spec.ts` são arquivos novos (não versionados): entram no commit do lote.

## Revisão (achados do diff)
- Janela de `movimentos()`: já calculada no fuso do estabelecimento (`instanteCivil(..., '00:00', fuso)` do dia inicial
  e do dia seguinte ao final). `dataLocal` só devolve o dia que a tela escolheu, desfazendo `dataDe` do serviço
  (meia-noite no fuso do processo). O teste do movimento às 23:30 locais já existe em
  `porta-propria-dispensacao.int.spec.ts`. Nada a mudar.
- `gravador-dispensacao.ts` e `porta-propria-dispensacao.int.spec.ts` são novos (`??`). Cabe ao orquestrador incluí-los
  no commit e mandar o gravador para uma revisão adversarial própria.
