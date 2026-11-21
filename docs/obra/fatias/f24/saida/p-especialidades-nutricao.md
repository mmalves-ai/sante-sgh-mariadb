# F2.4, 3ª etapa, lote p-especialidades-nutricao

Cliente de teste: `f24p_especialidadesnutricao`. Pedidos em `p-especialidades-nutricao.json`.

## O que mudou

### Nutrição (`nutricao/porta-propria.ts`): 8 de 9 gravações ligadas, com as leituras

Todas as gravações passam pelo Executor, com a trilha. As leituras ficam restritas ao estabelecimento.

- **Acompanhamento diário da meta** (`acompanhamento_terapia_nutricional`).
  - O banco aceita um acompanhamento ativo por meta e por dia.
  - Na retificação, o registro do dia fica `retificado` e o novo aponta para ele por `substitui_id`, com o motivo.
  - Um segundo registro do mesmo dia sem a correção é recusado por inteiro, com `acompanhamento-do-dia`.
- **Serviço social** (`registro_social`): o registro grava as vulnerabilidades e os encaminhamentos em JSON, sem repetição.
  - A barreira social vai para `barreira_alta`.
  - O adendo é uma linha `adendo` ligada ao registro original.
  - Leituras: `sociais` e `ultimosSociais`. O último registro ignora os adendos e os registros corrigidos.
- **Correção** (`correcao_registro_nutricao`): cada registro aceita uma correção só (`registro-ja-corrigido`).
  - O acompanhamento corrigido passa a `retificado` ou `estornado`. O registro social passa a `retificado`, `estornado`
    ou `encerrado`.
  - `correcoes` informa os registros inativos e os substitutos.
  - `internacaoDoRegistro` passou a cobrir também o acompanhamento e o registro social.
- **Avaliação farmacêutica da nutrição parenteral (NPT)** (`avaliacao_nutricao_parenteral`): uma por formulação, só
  para meta parenteral.
- **Refeição do acompanhante** (`plano_refeicao_acompanhante` e as refeições): uma vigente por internação.
  - A alteração devolve como o plano estava e troca só as refeições que mudaram.
  - Leituras: `acompanhantes`, `acompanhante` e `acompanhantesVigentes`.
- **Histórico da ordem do lactário** (`preparo_lactario_evento`), pela mesma gravação da nutrição.

### Especialidades (`especialidades/porta-propria.ts`): 8 de 17 gravações ligadas

- **Recém-nascido** (`registro_nascimento`), pela internação da mãe.
  - O nascimento é numerado dentro do atendimento e ligado ao partograma, quando ele existe.
  - O registro grava e lê a reanimação e a observação.
- **Ordem do lactário**: um preparo por paciente em `preparo_lactario`, com número e lote, e uma porção por horário em
  `preparo_lactario_item`.
  - Fluxo: registrar, conferir por outra pessoa, alterar (devolve como estava), cancelar (cancela também as porções),
    emitir a etiqueta e gravar o histórico.
  - Leituras: `ordensDoDia`, `ordem` e `alteracoesOrdens`.
- **Cadastros da oftalmologia:** acuidade visual e graduação vêm de `acuidade_visual` e `graduacao_oftalmologica`.

### Testes

- Integração: 18 testes, todos verdes, no cliente próprio.
  - Nutrição: acompanhamento com retificação, NPT, serviço social com adendo e estorno, e acompanhante.
  - Especialidades: recém-nascido e o ciclo do lactário, com as recusas e a separação entre estabelecimentos.
- Specs de unidade dos dois módulos: 38 testes, todos verdes.
- `tsc` da API: nenhum erro nestes arquivos.
- `eslint`: limpo.

## Decisões pela melhor prática (para o dono ver)

1. **Fórmula do lactário pelo cadastro.** A fórmula digitada precisa existir em `formula_lactea` do estabelecimento,
   pelo nome ou pelo código. Se não existir, a gravação é recusada com `formula-nao-cadastrada`, porque o modelo exige a
   chave para o cadastro.
2. **Manipulador do preparo.** É o colaborador ligado ao usuário da sessão. Sem esse cadastro, a gravação é recusada
   com `sem-cadastro-colaborador`.
3. **Horários das porções.** Uma porção num horário anterior ao da hora do preparo vale para o dia seguinte. A porção
   que passar da validade é recusada com `porcao-fora-da-validade`, antes de chegar à restrição do banco.
4. **Lote do preparo.** O banco exige o lote. Quando a tela não o informa, o lote vira `L<número do preparo>`.
5. **Conferência do lactário.** Quem prepara não confere: a comparação é feita pelo id do usuário (`criado_por`), não
   pelo login.
6. **Histórico do lactário em JSON.** O texto da tela é gravado como texto JSON, sem perda, e a leitura devolve o
   texto como veio.
7. **Responsável da barreira social.** Na tela, é um texto livre, não um usuário do cadastro. Ele vai junto da descrição
   da barreira.
8. **Correção da triagem e da meta.** Fica registrada só em `correcao_registro_nutricao`, a fonte da inatividade
   lida por `correcoes`. A situação da linha de origem não muda, para não esconder essas linhas das leituras atuais.
9. **Retificação do acompanhamento na mesma transação.** O registro do dia é marcado antes de o novo entrar, por causa
   do índice único do dia. Se a correção não vier na mesma gravação, tudo volta.

## Pedidos (detalhe no `.json`)

- **DDL `plano_refeicao_acompanhante_evento`** (nova): o histórico de alteração da refeição do acompanhante.
  - Até ela existir, a alteração do plano recusa com `modelo-pendente` e nada é gravado.
- **DDL do exame oftalmológico consolidado:**
  - `exame_oftalmologico_item`, com o tipo de exame e o resultado de até 500 caracteres;
  - os alertas, em `exame_oftalmologico.alertas`;
  - a acuidade do cadastro, em `exame_oftalmologico_valor`;
  - o tipo `avaliacao` na carga.
- **DDL `protocolo_quimioterapia_droga`:** o fármaco pelo nome genérico, a unidade da dose e a administração, com a
  carga das vias de uso.
- **Contrato do ciclo oncológico:** o diagnóstico e a intenção, que o `tratamento_oncologico` exige.
- **Carga do `criar_cliente`:** o tipo de barreira social, a acuidade visual e a graduação.

## O que falta (segue com `modelo-pendente`)

- **Especialidades:**
  - o exame oftalmológico;
  - a publicação do protocolo;
  - o ciclo e as operações que dependem dele: validação, ligação e desligamento da prescrição, evento, revogação,
    andamento e ajuste.

  As leituras correspondentes voltam vazias, porque nada foi gravado por esta porta.
- **Nutrição:** o histórico de alteração da refeição do acompanhante.

## Correção pelos achados da revisão (3ª etapa)
- **Lactário, dupla checagem:** a conferência recusa (`ordem-nao-conferivel`) também quem alterou o conteúdo atual da
  ordem (autor das porções vigentes, refeitas a cada alteração, ou de um evento `alterado` no histórico) e a sessão sem
  usuário. Teste de integração com um terceiro usuário: B altera a ordem de A, nem A nem B conferem, C confere.
- **Lactário, etiqueta de ordem cancelada:** `marcarEtiqueta` recusa com `ordem-cancelada` (porta própria e porta em
  memória). O controlador já barrava antes (`exigirOrdemNaoCancelada`); a recusa na porta fecha a corrida entre a
  leitura e a gravação.
- **Lactário, quem cancelou:** passa a vir do evento `cancelado` do histórico (gravado na mesma transação do
  cancelamento, com usuário obrigatório), e não de `alterado_por`. Teste: alteração posterior não troca o autor.
  Decisão: sem coluna nova; o evento já é o registro auditado do cancelamento.
- **Refeição do acompanhante:** a refeição que sai deixou de ser `DELETE` físico; é exclusão lógica pelo Executor
  (`excluido_em`, `excluido_por`, versão e trilha), e a que volta reativa a mesma linha (chave única plano + refeição).
  Observação: `tx.excluir` do núcleo é exclusão física (com trilha), por isso não foi usado aqui.
