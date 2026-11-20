// Vocabulário da cirurgia segura e do rastreio no bloco (ficha do M46, etapa 2; regras 1, 2 e 5; cap-05a §5.5):
//   - o checklist de cirurgia segura da OMS (2009) no protocolo do Ministério da Saúde de 2013 (RDC 36/2013), em três
//     momentos: antes da indução anestésica, antes da incisão (a "pausa cirúrgica", o time-out) e antes de o paciente
//     sair da sala; cada item com a resposta, quem confirmou e a hora; conduzido pelo circulante. A lista é versionada
//     (LISTA_CHECKLIST_V1): a troca de itens pela comissão (NSP) é uma versão nova, sem mudar código;
//   - o rastreio do paciente no bloco pelos locais e tipos de movimentação do cadastro do bloco (5 locais e 5 tipos, só
//     leitura; o banco recusa alterar), e as etapas do painel para familiares (só o código anônimo, a etapa e o horário;
//     nunca o nome nem o procedimento, regra 5).
// Os rótulos aqui são de produto (ADR 0023): sem nome de tabela nem de sistema.

// ── Checklist de cirurgia segura ────────────────────────────────────────────────────────────────────────────────

export const MOMENTOS_CHECKLIST = [
  { codigo: 'inducao', rotulo: 'Antes da indução anestésica', curto: 'Entrada' },
  { codigo: 'incisao', rotulo: 'Antes da incisão (pausa cirúrgica)', curto: 'Pausa cirúrgica' },
  { codigo: 'saida', rotulo: 'Antes de o paciente sair da sala', curto: 'Saída' },
] as const;
export type MomentoChecklist = (typeof MOMENTOS_CHECKLIST)[number]['codigo'];
export const CODIGOS_MOMENTO_CHECKLIST = MOMENTOS_CHECKLIST.map((m) => m.codigo) as [
  MomentoChecklist,
  ...MomentoChecklist[],
];

export const RESPOSTAS_CHECKLIST = [
  { codigo: 'sim', rotulo: 'Sim' },
  { codigo: 'nao', rotulo: 'Não' },
  { codigo: 'na', rotulo: 'Não se aplica' },
] as const;
export type RespostaChecklist = (typeof RESPOSTAS_CHECKLIST)[number]['codigo'];

/**
 * Como o item se responde:
 *   - `confirmacao`: só "sim" conclui o momento (o item tem de ser feito);
 *   - `confirmacaoOuNa`: "sim" ou "não se aplica";
 *   - `pergunta`: "sim" ou "não" (a resposta é a informação; a que pede ação exige a observação).
 */
export type TipoItemChecklist = 'confirmacao' | 'confirmacaoOuNa' | 'pergunta';

export interface ItemChecklist {
  readonly codigo: string;
  readonly momento: MomentoChecklist;
  readonly rotulo: string;
  readonly tipo: TipoItemChecklist;
  /** A resposta que exige a observação (o que foi feito ou providenciado). */
  readonly observacaoSe?: RespostaChecklist;
  /** A resposta que é um alerta de segurança (aparece em destaque no quadro do bloco). */
  readonly alertaSe?: RespostaChecklist;
}

export interface ListaChecklist {
  readonly versao: number;
  readonly fonte: string;
  readonly itens: readonly ItemChecklist[];
}

/** Lista de verificação da OMS (2009) adotada pelo protocolo de cirurgia segura do Ministério da Saúde (2013). */
export const LISTA_CHECKLIST_V1: ListaChecklist = {
  versao: 1,
  fonte:
    'Lista de verificação de segurança cirúrgica da OMS (2009); protocolo de cirurgia segura do Ministério da Saúde (2013)',
  itens: [
    {
      codigo: 'identidade',
      momento: 'inducao',
      rotulo: 'Paciente confirmou identidade, sítio cirúrgico, procedimento e consentimento',
      tipo: 'confirmacao',
    },
    {
      codigo: 'sitioDemarcado',
      momento: 'inducao',
      rotulo: 'Sítio cirúrgico demarcado',
      tipo: 'confirmacaoOuNa',
    },
    {
      codigo: 'verificacaoAnestesica',
      momento: 'inducao',
      rotulo: 'Verificação de segurança anestésica concluída (equipamentos e medicamentos)',
      tipo: 'confirmacao',
    },
    {
      codigo: 'oximetro',
      momento: 'inducao',
      rotulo: 'Oxímetro de pulso no paciente e funcionando',
      tipo: 'confirmacao',
    },
    {
      codigo: 'alergiaConhecida',
      momento: 'inducao',
      rotulo: 'O paciente tem alergia conhecida?',
      tipo: 'pergunta',
      observacaoSe: 'sim',
      alertaSe: 'sim',
    },
    {
      codigo: 'viaAereaDificil',
      momento: 'inducao',
      rotulo: 'Via aérea difícil ou risco de aspiração? (se sim, equipamento e assistência disponíveis)',
      tipo: 'pergunta',
      observacaoSe: 'sim',
      alertaSe: 'sim',
    },
    {
      codigo: 'riscoSangramento',
      momento: 'inducao',
      rotulo:
        'Risco de perda sanguínea acima de 500 ml (7 ml/kg em crianças)? (se sim, acesso venoso e fluidos planejados)',
      tipo: 'pergunta',
      observacaoSe: 'sim',
      alertaSe: 'sim',
    },
    {
      codigo: 'equipeApresentada',
      momento: 'incisao',
      rotulo: 'Todos os membros da equipe se apresentaram pelo nome e pela função',
      tipo: 'confirmacao',
    },
    {
      codigo: 'confirmacaoVerbal',
      momento: 'incisao',
      rotulo: 'Cirurgião, anestesista e enfermagem confirmam em voz alta paciente, sítio e procedimento',
      tipo: 'confirmacao',
    },
    {
      codigo: 'antibioticoProfilatico',
      momento: 'incisao',
      rotulo: 'Antibiótico profilático administrado nos últimos 60 minutos',
      tipo: 'confirmacaoOuNa',
    },
    {
      codigo: 'eventosCriticosCirurgiao',
      momento: 'incisao',
      rotulo: 'Cirurgião revisou as etapas críticas, a duração e a perda sanguínea prevista',
      tipo: 'confirmacao',
    },
    {
      codigo: 'eventosCriticosAnestesia',
      momento: 'incisao',
      rotulo: 'Anestesista revisou as preocupações específicas do paciente',
      tipo: 'confirmacao',
    },
    {
      codigo: 'esterilizacaoConfirmada',
      momento: 'incisao',
      rotulo: 'Enfermagem confirmou a esterilização (indicadores) e o funcionamento dos equipamentos',
      tipo: 'confirmacao',
    },
    {
      codigo: 'imagensExpostas',
      momento: 'incisao',
      rotulo: 'Imagens essenciais expostas na sala',
      tipo: 'confirmacaoOuNa',
    },
    {
      codigo: 'procedimentoRegistrado',
      momento: 'saida',
      rotulo: 'Nome do procedimento realizado confirmado em voz alta',
      tipo: 'confirmacao',
    },
    {
      codigo: 'contagemCorreta',
      momento: 'saida',
      rotulo: 'Contagem de instrumentais, compressas e agulhas correta',
      tipo: 'confirmacaoOuNa',
    },
    {
      codigo: 'amostrasIdentificadas',
      momento: 'saida',
      rotulo: 'Amostras identificadas com o nome do paciente',
      tipo: 'confirmacaoOuNa',
    },
    {
      codigo: 'problemasEquipamento',
      momento: 'saida',
      rotulo: 'Houve problema com equipamento a resolver?',
      tipo: 'pergunta',
      observacaoSe: 'sim',
      alertaSe: 'sim',
    },
    {
      codigo: 'recuperacaoRevisada',
      momento: 'saida',
      rotulo: 'Cirurgião, anestesista e enfermagem revisaram as preocupações para a recuperação',
      tipo: 'confirmacao',
    },
  ],
};

/** As listas conhecidas (a gravada no checklist manda; a nova vale para os checklists abertos depois da troca). */
export const LISTAS_CHECKLIST: readonly ListaChecklist[] = [LISTA_CHECKLIST_V1];
export const LISTA_CHECKLIST_VIGENTE = LISTA_CHECKLIST_V1;

export function listaChecklist(versao: number): ListaChecklist | undefined {
  return LISTAS_CHECKLIST.find((l) => l.versao === versao);
}

export const SITUACOES_CHECKLIST = ['aberto', 'concluido'] as const;
export type SituacaoChecklist = (typeof SITUACOES_CHECKLIST)[number];

// ── Rastreio no bloco ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Locais do bloco (os IDs do cadastro do bloco, só leitura). O rótulo de produto e a etapa do painel para familiares
 * de cada um; o nome lido do banco aparece na tela de administração.
 */
export const LOCAIS_BLOCO = [
  { id: 1, codigo: 'preOperatorio', rotulo: 'Pré-operatório', etapa: 'preparo' },
  { id: 2, codigo: 'espera', rotulo: 'Sala de espera', etapa: 'aguardando' },
  { id: 3, codigo: 'sala', rotulo: 'Sala cirúrgica', etapa: 'cirurgia' },
  { id: 4, codigo: 'srpa', rotulo: 'Recuperação pós-anestésica', etapa: 'recuperacao' },
  { id: 5, codigo: 'outros', rotulo: 'Outro local do bloco', etapa: 'noBloco' },
] as const;
export type IdLocalBloco = (typeof LOCAIS_BLOCO)[number]['id'];
export const ID_LOCAL_SALA = 3;
export const ID_LOCAL_SRPA = 4;

/** Tipos de movimentação (os IDs do cadastro do bloco, só leitura). */
export const TIPOS_MOVIMENTO_BLOCO = [
  { id: 1, codigo: 'admissao', rotulo: 'Entrada no bloco' },
  { id: 2, codigo: 'transferencia', rotulo: 'Mudança de local' },
  { id: 3, codigo: 'alta', rotulo: 'Saída do bloco' },
  { id: 4, codigo: 'readmissao', rotulo: 'Retorno ao bloco' },
  { id: 5, codigo: 'cancelamentoAlta', rotulo: 'Saída do bloco desfeita' },
] as const;
export type TipoMovimentoBloco = (typeof TIPOS_MOVIMENTO_BLOCO)[number]['codigo'];
export const CODIGOS_MOVIMENTO_BLOCO = TIPOS_MOVIMENTO_BLOCO.map((t) => t.codigo) as [
  TipoMovimentoBloco,
  ...TipoMovimentoBloco[],
];

export function idDoMovimento(t: TipoMovimentoBloco): number {
  return TIPOS_MOVIMENTO_BLOCO.find((x) => x.codigo === t)!.id;
}
export function movimentoDoId(id: number): TipoMovimentoBloco | null {
  return TIPOS_MOVIMENTO_BLOCO.find((x) => x.id === id)?.codigo ?? null;
}

export const DESTINOS_SAIDA_BLOCO = [
  { codigo: 'unidade', rotulo: 'Unidade de internação' },
  { codigo: 'uti', rotulo: 'Terapia intensiva' },
  { codigo: 'domicilio', rotulo: 'Alta para casa' },
  { codigo: 'outro', rotulo: 'Outro destino' },
] as const;
export type DestinoSaidaBloco = (typeof DESTINOS_SAIDA_BLOCO)[number]['codigo'];

/** Etapas do painel para familiares (regra 5: o código anônimo, a etapa e o horário). */
export const ETAPAS_PAINEL_FAMILIA = [
  { codigo: 'preparo', rotulo: 'Em preparo' },
  { codigo: 'aguardando', rotulo: 'Aguardando a cirurgia' },
  { codigo: 'cirurgia', rotulo: 'Em cirurgia' },
  { codigo: 'recuperacao', rotulo: 'Em recuperação' },
  { codigo: 'noBloco', rotulo: 'No centro cirúrgico' },
  { codigo: 'saiu', rotulo: 'Saiu do centro cirúrgico' },
] as const;
export type EtapaPainelFamilia = (typeof ETAPAS_PAINEL_FAMILIA)[number]['codigo'];

/** Por quanto tempo o código continua no painel depois da saída do bloco (minutos). */
export const PAINEL_FAMILIA_SAIDA_VISIVEL_MIN = 120;
/** Validade do código do painel (regra: um dia; vence no fim do dia da entrada no bloco). */
export const PAINEL_CODIGO_VALIDADE = 'fim-do-dia' as const;
/** Releitura do painel para familiares (a ficha pede propagação abaixo de 2 s). */
export const PAINEL_FAMILIA_RELEITURA_MS = 1_000;
/** Cancelar a saída do bloco só logo depois dela (engano de clique): minutos. */
export const CANCELAR_SAIDA_ATE_MIN = 60;

// ── Recusas ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const RECUSAS_BLOCO_SEGURO = [
  'checklist-item-desconhecido',
  'checklist-resposta-invalida',
  'checklist-observacao-obrigatoria',
  'checklist-momento-concluido',
  'checklist-momento-fora-de-ordem',
  'checklist-itens-pendentes',
  'checklist-mudou',
  'checklist-horario-fora-de-ordem',
  'checklist-agendamento-fechado',
  'incisao-sem-timeout',
  'incisao-antes-do-timeout',
  'excecao-so-urgencia',
  'excecao-ja-registrada',
  'excecao-timeout-concluido',
  'excecao-sem-motivo',
  'rastreio-mudou',
  'rastreio-movimento-invalido',
  'rastreio-mesmo-local',
  'rastreio-local-desconhecido',
  'rastreio-sala-obrigatoria',
  'rastreio-horario-fora-de-ordem',
  'rastreio-cancelamento-vencido',
  'bloco-horario-futuro',
  'chave-reutilizada',
] as const;
export type RecusaBlocoSeguro = (typeof RECUSAS_BLOCO_SEGURO)[number];
