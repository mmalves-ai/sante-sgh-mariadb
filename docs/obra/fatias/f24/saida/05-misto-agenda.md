# F2.4, 2ª volta, lote 05-misto-agenda (agenda, cirurgia, enfermagem, patrimônio)

## O que mudou
- **Declarações compiladas (`dist/*.d.ts`) da agenda, da enfermagem e do patrimônio:** o código-fonte já estava limpo
  desde a 1ª volta; os `.d.ts` eram de uma compilação antiga. Recompilados (`tsc -p packages/<pacote>/tsconfig.lib.json`,
  com `contratos` antes). Os 11 arquivos `dist` da fatia saíram da dívida (nome de origem e hora de quatro dígitos).
  O `dist/` não vai ao git.
- **Enfermagem, `porta-propria.ts` (zerado):**
  - a infusão contínua grava também a retomada (`infusao_retomada`) e a troca de bolsa (`infusao_troca_bolsa`), que o
    CHECK do evento do horário passou a aceitar. O mapa cobre todo o vocabulário do contrato (`satisfies`), e um
    evento desconhecido é recusado com `evento-infusao-invalido`;
  - a resposta de extensão do formulário grava em `registro_assistencial_extensao` (sinal vital, mapa corporal ou
    anexo), ligada a um registro assistencial do mesmo estabelecimento e paciente. O reenvio da mesma chave atualiza a
    resposta, sem duplicar. Sem o registro: recusa `registro-inexistente`.
- **Patrimônio, `porta-propria.ts` (zerado):**
  - **cálculo da depreciação:** cabeçalho em `calculo_depreciacao` (rodada, bens calculados e ignorados, total) e as
    cotas em `cota_depreciacao` ligadas a ele. O segundo cálculo da competência é recusado (`ja-calculado`), também
    pela chave única `vigente_chave`;
  - **estorno do cálculo:** marca o cálculo como estornado (quem, quando, motivo, origem) e exclui as cotas dele; o
    acumulado e o recálculo leem só as vigentes, e o recálculo abre a rodada seguinte. Recusa se houver ajuste de
    valor vigente com marco na competência ou depois;
  - **ajuste de valor do bem e estorno:** gravam em `ajuste_valor_bem`, com a trava da versão do bem (a versão sobe);
    o laudo tem de estar anexado ao bem; o estorno é um só (`ja-estornado`);
  - **leituras** que devolviam vazio: cálculos, cotas, estornos, ajustes e o marco do último ajuste vigente (fora a
    reavaliação) na lista de bens da competência;
  - **lotes contábeis liberados** do patrimônio (`lote_contabil`) entram na conferência do estorno e do ajuste; a
    conta da perda por recuperabilidade é a do grupo do bem;
  - **responsável e doador:** o doador e a data do termo de doação gravam no bem; o responsável é o usuário achado
    pelo login ou pelo nome exato.
- **Testes:** `patrimonio.int.spec.ts` (calcula, recusa o segundo, estorna, recalcula na rodada 2), `ajustes.int.spec.ts`
  (impedimento, ajuste, versão vencida, marco nas competências seguintes, estorno, segundo estorno recusado),
  `enfermagem/porta-propria.int.spec.ts` (retomada, troca de bolsa, evento desconhecido, extensão sem registro). A
  limpeza da massa do patrimônio apaga também ajustes, laudos, cotas e cálculos.

## Decisões pela melhor prática (para o dono ver)
1. O estorno do cálculo **exclui** as cotas (exclusão lógica, com trilha) em vez de mantê-las vigentes: assim o
   acumulado, o "já tem cota" e o recálculo não precisam saber de rodadas.
2. A cota guarda a taxa anual derivada da vida útil (`1200 / meses`); a leitura deriva a vida útil de volta e lê o
   centro, o coeficiente e o residual do bem atual (pedido de DDL de prioridade baixa para guardar o retrato).
3. O responsável pelo bem é um usuário. Enquanto o contrato traz texto, a porta aceita o login ou o nome exato e recusa
   o inexistente e o ambíguo (pedido de contrato).
4. A conta da perda por recuperabilidade "configurada" é a do grupo do bem (`grupo_bem.reducao_recuperavel_conta_contabil_id`).
5. "Lote exportado" é o `lote_contabil` do módulo patrimônio na situação `liberado`, na competência da data.

## Pedidos (ver 05-misto-agenda.json)
- Controlador da enfermagem: a anotação offline manda `registro: 0` à extensão; precisa gravar o registro antes.
- Contrato do patrimônio: responsável pelo id do usuário.
- DDL (baixa): retrato do cálculo na cota.

## O que falta neste lote (não feito nesta volta)
- `apps/api/src/modulos/cirurgia/operacoes.ts:75` e `porta-propria.ts:143,156`: implementar `cirurgia.registrarCirurgia`
  sobre `ato_cirurgico` (+ `classificacao_asa_id`, pressão, pulso), `ato_cirurgico_procedimento` (+ especialidade),
  `ato_cirurgico_dispositivo` e `participante_cirurgia`; depois apagar `OPERACOES_CIRURGIA_PENDENTES` e `modeloPendente`.
- `apps/api/src/modulos/cirurgia/anestesia-porta-propria.ts:9,55,65`: gravador da anestesia (12 métodos: APA, ficha,
  versão, lançamento, encerramento, passagem, lacuna, adendo, SRPA).
- `apps/api/src/modulos/cirurgia/bloco-seguro-porta-propria.ts:9,57,67`: gravador do checklist e do rastreio (9 métodos).
  A chave de idempotência da requisição já chega ao `gravarSgh` da cirurgia (`porta-propria.ts`); dá para seguir o mesmo molde.
- `apps/api/src/modulos/enfermagem/escores-porta-propria.ts:22,171` (sites 1584, 1587, 1823, 1826, 1861-1879, 1938):
  decisão e retificação da profilaxia de TEV (`profilaxia_tev_decisao`), retificação e inativação do evento do TRR
  (`acionamento_resposta_rapida_evento`), lesão de pele (7 métodos sobre `lesao_pele_paciente`/`lesao_pele_avaliacao`)
  e meta/checklist do protocolo (`inclusao_protocolo_evento`).
- `apps/api/src/modulos/enfermagem/sae-porta-propria.ts:19,88` (sites 545-563): atividade prescrita pelo enfermeiro
  (prescrever, suspender, checar, estornar), terminologia licenciada por estabelecimento, receita do enfermeiro
  (`protocolo_receita_enfermagem`) e a inativação dela. Conferir antes se a atividade e a terminologia já têm tabela.

## 2ª volta: responsável pelo bem restrito ao estabelecimento
- `patrimonio/porta-propria.ts` (`responsavelPeloNome`): a busca por login ou nome exato passou a exigir vínculo
  vigente em `usuario_estabelecimento` com o estabelecimento da sessão (mesmo filtro do login). Homônimo de outra
  unidade não liga o bem nem causa `responsavel-ambiguo`.
- Teste: `massa.spec-util.ts` vincula o usuário de patrimônio ao estabelecimento e o aceitante só à outra unidade;
  `patrimonio.int.spec.ts` confere que o login de outra unidade é recusado com `responsavel-inexistente`.
- Decisão: a busca continua numa leitura antes do `gravar` (a operação recebe o id já resolvido). Mover para dentro
  da transação exigiria mudar as operações; o pedido de contrato já registrado (responsável pelo id, escolhido numa
  lista) resolve isso de vez.

## 3ª volta (2ª volta da obra): cirurgia ligada ao modelo
- **Registro do ato cirúrgico (`operacoes.ts`, `porta-propria.ts`):** `cirurgia.registrarCirurgia` virou operação do
  Executor. Grava `ato_cirurgico` (realizado, tempos de sala, anestesia e incisão, com a virada da meia-noite; ASA,
  pressão e pulso; porte e classe de contaminação pelo cadastro), `ato_cirurgico_procedimento` (o primeiro é o
  principal, com a especialidade e a técnica), `participante_cirurgia` (a equipe pela função do cadastro, ligada ao
  procedimento) e `ato_cirurgico_dispositivo` (tubo, antimicrobiano, sonda, cateter, punção). Recusa o agendamento de
  outra internação ou já registrado e os tempos inválidos. `OPERACOES_CIRURGIA_PENDENTES` e `modeloPendente` saíram.
- **Anestesia (`anestesia-porta-propria.ts`):** `gravarSgh` grava pelo Executor (trilha e idempotência na mesma
  transação). Os 13 métodos do gravador estão ligados: APA (uma linha por versão; a versão vista trava;
  pendências do agendamento resolvidas ou reabertas), ficha aberta pelo agendamento (o tipo de anestesia vem do ato ou
  do agendamento), versão com marco e encerramento, lançamentos por parte (sinal, via e unidade pelo cadastro;
  fluido e perda vão ao balanço hídrico aberto do atendimento), fim do lançamento, passagem, lacuna, assinatura com o
  resumo criptográfico, adendo, e a recuperação pós-anestésica (registro com a série de avaliações; admissão e alta
  com destino e motivo).
  - A leitura da ficha passou a achar a ficha aberta pelo agendamento antes do ato. Ela traz agora passagens, lacunas,
    adendos, quem assinou e o resumo. A APA lê os critérios de Lee, as comorbidades, as medicações, o plano e o jejum.
- **Cirurgia segura e rastreio (`bloco-seguro-porta-propria.ts`):** os 11 métodos estão ligados.
  - Checklist aberto pelo agendamento, pelo modelo ativo do estabelecimento.
  - Confirmação por item do momento: o item corrigido substitui a resposta, e a versão do checklist sobe.
  - Conclusão do momento pelo profissional da sessão, ligando o ato do mesmo atendimento, sala e dia.
  - Exceção da urgência: dispensa o checklist com a justificativa.
  - Movimento no bloco: na saída, o local é o de onde o paciente sai. O código do painel da família é gravado, e o
    estado do agendamento muda na mesma transação.
  - Leitura do destino da saída.
- **Reenvio:** o reenvio da mesma chave do pedido (APA, lançamentos, passagem, lacuna, adendo, SRPA, confirmação,
  movimento) devolve o que foi gravado, por `idempotencia_operacao`, sem gravar de novo.
- **Testes (`cirurgia/porta-propria.int.spec.ts`, 15 verdes no cliente `f24_05mistoagenda`):**
  - registro do ato: linhas, equipe, dispositivo, trilha, segundo registro recusado, tempos inválidos;
  - anestesia ponta a ponta: APA, reenvio, versão vencida, ficha, lançamento e reenvio, marco, versão vencida, lacuna,
    encerramento, assinatura, adendo, SRPA com versão vencida e alta, situações;
  - cirurgia segura e rastreio: abrir, confirmar e reenvio, concluir o momento, mover com código, reenvio, versão
    vencida.

### Decisões pela melhor prática (para o dono ver)
1. A **versão da APA** é a ordem da avaliação no agendamento, com uma linha por versão. A coluna `versao` continua só
   como trava otimista.
2. O **fim da anestesia sem o marco** é o momento do encerramento, nunca antes do início registrado. O modelo exige o
   fim na ficha encerrada.
3. A **alta da recuperação** atinge os critérios com o escore de Aldrete 9 ou mais. Abaixo disso, ou com destino UTI,
   o motivo é obrigatório (`srpa-motivo-destino`), como manda o CHECK do modelo.
4. **Fluido e perda** vão ao balanço hídrico só quando há balanço aberto do atendimento na janela do momento. Sem ele,
   não vão e não contam, e a ficha continua gravada.
5. A **confirmação e a conclusão do checklist** exigem o profissional. Quando a tela não manda, vale o vínculo vigente
   do usuário no estabelecimento; sem vínculo, recusa `sem-registro-profissional`.
6. Na **saída do bloco** sem local novo, o movimento guarda o local de onde o paciente sai, porque o local é
   obrigatório no modelo.

### Pedidos novos (ver 05-misto-agenda.json)
- DDL do jejum por tipo na APA.
- DDL dos sinais vitais e da versão da regra de alta na avaliação da recuperação.
- CHECK da náusea e vômito na alta da recuperação.
- DDL do procedimento no lançamento da ficha (baixa).
- Numeração `ato_cirurgico` e setor da sala na criação do cliente.

### O que ainda falta neste lote
- **`enfermagem/escores-porta-propria.ts:22,171` (13 gravações).** As tabelas existem
  (`profilaxia_tev_decisao` + `profilaxia_tev_avaliacao`, `acionamento_resposta_rapida_evento`, `lesao_pele_paciente`
  e `lesao_pele_avaliacao`, `inclusao_protocolo_evento`). Falta ligar:
  - `decidirProfilaxia` e `retificarProfilaxia`, pela avaliação ligada ao escore. A decisão
    'prescrita'/'nao-prescrita'/'anulada' tem de ser mapeada para 'aceita'/'recusada' mais a retificação.
  - `retificarEventoTrr` e `inativarTrr` da origem 'evento'. A chegada e o desfecho hoje vão às colunas do
    acionamento: é preciso passar a gravá-los como evento versionado e ajustar a leitura.
  - Os 7 métodos da lesão de pele.
  - A meta e o item do checklist do protocolo. O CHECK do evento da inclusão não tem esses fatos: conferir o DDL
    aplicado.
- **`enfermagem/sae-porta-propria.ts:19,88`:** a atividade prescrita pelo enfermeiro, a terminologia licenciada por
  estabelecimento e a receita do enfermeiro (`protocolo_receita_enfermagem`).
- **Pedido aberto:** a anotação offline do `enfermagem.controller` grava com registro 0.
