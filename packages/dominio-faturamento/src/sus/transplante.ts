// Transplante para a central estadual (F8, 06-SUS linha 65): notificação de potencial doador e inscrição de receptor.
// Norma: Lei 9.434/1997, Decreto 9.175/2017, Portaria de Consolidação MS 4/2017 e Resolução CFM 2.173/2017 (protocolo
// de morte encefálica). O hospital (pela comissão intra-hospitalar de doação, obrigatória em hospital com UTI) notifica
// todo potencial doador e inscreve o receptor no sistema da central estadual, que não publica leiaute de importação: o
// sistema registra, gera a ficha e o arquivo de conferência e guarda o protocolo que a central devolve, sem integração
// automática. Regras puras:
//   - notificação: o protocolo de morte encefálica (só no doador por morte encefálica) termina depois de começar; a
//     abordagem familiar vem depois da conclusão do protocolo; o encerramento pede o desfecho, coerente com o
//     consentimento (doação efetivada pede o consentimento e ao menos um órgão; recusa familiar pede a abordagem e a
//     família que não consentiu); situação só avança (notificada → em avaliação → encerrada; cancelada antes do fim);
//   - inscrição: uma inscrição em lista (ativa, semiativa ou suspensa) por paciente e órgão no estabelecimento; a
//     mudança de aptidão e a saída da lista (removida, óbito, suspensa) pedem o motivo; transplantado pede a data, não
//     anterior à inscrição; a saída da lista é a "exclusão" enviada à central (nada apagado: a inscrição fica com a
//     situação final e o histórico guarda a operação);
//   - histórico: cada mudança da inscrição vira uma linha (inclusão, alteração, exclusão) pendente de envio até o
//     operador marcar o envio à central;
//   - arquivo de conferência (CSV, separador ponto e vírgula) das inscrições, para conferir com a lista da central.
// Modelo: `inscricao_transplante` (+ `_historico`) é o registro do hospital na central; `receptor_transplante` (PEP) é o
// acompanhamento clínico do receptor (diálise, preservação do órgão, evolução pós-transplante) e fica como está: as duas
// tabelas têm papéis distintos (uma é o vínculo administrativo com a central, a outra o seguimento assistencial).

export interface ProblemaTransplante {
  readonly campo: string;
  readonly mensagem: string;
}

export const TIPOS_DOADOR = ['morte_encefalica', 'coracao_parado'] as const;
export type TipoDoador = (typeof TIPOS_DOADOR)[number];

export const DESFECHOS_DOACAO = [
  'doacao_efetivada',
  'recusa_familiar',
  'contraindicacao_medica',
  'parada_cardiaca',
  'morte_encefalica_nao_confirmada',
  'outro',
] as const;
export type DesfechoDoacao = (typeof DESFECHOS_DOACAO)[number];

export const SITUACOES_NOTIFICACAO = ['notificada', 'em_avaliacao', 'encerrada', 'cancelada'] as const;
export type SituacaoNotificacao = (typeof SITUACOES_NOTIFICACAO)[number];

export const SITUACOES_INSCRICAO = [
  'ativa',
  'semiativa',
  'suspensa',
  'transplantado',
  'removida',
  'obito',
] as const;
export type SituacaoInscricao = (typeof SITUACOES_INSCRICAO)[number];
/** Situações em que o paciente está na lista (uma por paciente e órgão). */
export const SITUACOES_EM_LISTA: readonly SituacaoInscricao[] = ['ativa', 'semiativa', 'suspensa'];
/** Situações finais: a inscrição sai da lista e não volta (nova inscrição, se for o caso). */
export const SITUACOES_FINAIS: readonly SituacaoInscricao[] = ['transplantado', 'removida', 'obito'];
export const PRIORIDADES_INSCRICAO = ['normal', 'urgente', 'prioridade_especial'] as const;
export type PrioridadeInscricao = (typeof PRIORIDADES_INSCRICAO)[number];

export interface DadosNotificacaoDoador {
  readonly tipoDoador: TipoDoador;
  readonly notificadoEm: string;
  readonly obitoEm: string | null;
  readonly protocoloInicioEm: string | null;
  readonly protocoloFimEm: string | null;
  readonly abordagemFamiliarEm: string | null;
  readonly familiaConsentiu: boolean | null;
  readonly orgaosDoados: readonly string[];
  readonly desfecho: DesfechoDoacao | null;
  readonly desfechoEm: string | null;
  readonly situacao: SituacaoNotificacao;
}

const instante = (v: string | null): number | null => {
  if (v === null) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/** Critica a notificação inteira (inclusão ou alteração); lista vazia: pode gravar. */
export function conferirNotificacaoDoador(d: DadosNotificacaoDoador): ProblemaTransplante[] {
  const p: ProblemaTransplante[] = [];
  const ini = instante(d.protocoloInicioEm);
  const fim = instante(d.protocoloFimEm);
  const abordagem = instante(d.abordagemFamiliarEm);
  const notificado = instante(d.notificadoEm);
  if (notificado === null)
    p.push({ campo: 'notificadoEm', mensagem: 'Informe quando a central foi notificada.' });
  if (d.tipoDoador === 'coracao_parado' && (ini !== null || fim !== null))
    p.push({
      campo: 'protocoloInicioEm',
      mensagem: 'O protocolo de morte encefálica só se aplica ao doador por morte encefálica.',
    });
  if (fim !== null && ini === null)
    p.push({ campo: 'protocoloInicioEm', mensagem: 'Informe a abertura do protocolo antes da conclusão.' });
  if (ini !== null && fim !== null && fim < ini)
    p.push({ campo: 'protocoloFimEm', mensagem: 'A conclusão do protocolo é anterior à abertura.' });
  if (d.tipoDoador === 'morte_encefalica' && abordagem !== null && (fim === null || abordagem < fim))
    p.push({
      campo: 'abordagemFamiliarEm',
      mensagem: 'A abordagem familiar vem depois da conclusão do protocolo de morte encefálica.',
    });
  if (d.familiaConsentiu !== null && abordagem === null)
    p.push({
      campo: 'familiaConsentiu',
      mensagem: 'Registre a abordagem familiar antes da resposta da família.',
    });
  if (d.orgaosDoados.length && d.desfecho !== 'doacao_efetivada')
    p.push({ campo: 'orgaosDoados', mensagem: 'Os órgãos doados só se registram com a doação efetivada.' });
  if (new Set(d.orgaosDoados).size !== d.orgaosDoados.length)
    p.push({ campo: 'orgaosDoados', mensagem: 'O mesmo órgão foi marcado duas vezes.' });
  if (d.desfecho !== null && d.desfechoEm === null)
    p.push({ campo: 'desfechoEm', mensagem: 'Informe quando o desfecho aconteceu.' });
  if (d.desfecho === null && d.desfechoEm !== null)
    p.push({ campo: 'desfecho', mensagem: 'Informe o desfecho da data registrada.' });
  if (d.desfecho === 'doacao_efetivada') {
    if (d.familiaConsentiu !== true)
      p.push({ campo: 'familiaConsentiu', mensagem: 'A doação efetivada pede o consentimento da família.' });
    if (!d.orgaosDoados.length)
      p.push({ campo: 'orgaosDoados', mensagem: 'Marque ao menos um órgão doado.' });
  }
  if (d.desfecho === 'recusa_familiar' && d.familiaConsentiu !== false)
    p.push({
      campo: 'familiaConsentiu',
      mensagem: 'A recusa familiar pede a abordagem com a família que não consentiu.',
    });
  if (d.desfecho === 'morte_encefalica_nao_confirmada' && d.tipoDoador !== 'morte_encefalica')
    p.push({ campo: 'desfecho', mensagem: 'Este desfecho só vale para o doador por morte encefálica.' });
  if (d.situacao === 'encerrada' && d.desfecho === null)
    p.push({ campo: 'desfecho', mensagem: 'O encerramento pede o desfecho.' });
  if (d.situacao !== 'encerrada' && d.desfecho !== null)
    p.push({ campo: 'situacao', mensagem: 'Com o desfecho registrado, a notificação fica encerrada.' });
  const desfechoEm = instante(d.desfechoEm);
  if (desfechoEm !== null && notificado !== null && desfechoEm < notificado)
    p.push({ campo: 'desfechoEm', mensagem: 'O desfecho é anterior à notificação.' });
  return p;
}

const ORDEM_NOTIFICACAO: Record<SituacaoNotificacao, number> = {
  notificada: 0,
  em_avaliacao: 1,
  encerrada: 2,
  cancelada: 2,
};

/** A situação só avança; encerrada e cancelada são finais. */
export function conferirTransicaoNotificacao(
  de: SituacaoNotificacao,
  para: SituacaoNotificacao,
): ProblemaTransplante[] {
  if (de === para) return [];
  if (de === 'encerrada' || de === 'cancelada')
    return [{ campo: 'situacao', mensagem: 'A notificação já foi encerrada ou cancelada.' }];
  if (ORDEM_NOTIFICACAO[para] < ORDEM_NOTIFICACAO[de])
    return [{ campo: 'situacao', mensagem: 'A situação da notificação não volta atrás.' }];
  return [];
}

export interface DadosInscricao {
  readonly dataInscricao: string;
  readonly situacao: SituacaoInscricao;
  readonly apto: boolean;
  readonly motivo: string | null;
  readonly dataTransplante: string | null;
}

export interface InscricaoGravada extends DadosInscricao {
  readonly id: number;
  readonly paciente: number;
  readonly orgao: number;
}

export type OperacaoHistorico = 'inclusao' | 'alteracao' | 'exclusao';

export interface ResultadoInscricao {
  readonly problemas: ProblemaTransplante[];
  /** A operação que vai ao histórico (e à central). */
  readonly operacao: OperacaoHistorico;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Critica a inclusão (`atual` null) ou a alteração da inscrição; `outras` são as inscrições do mesmo paciente e órgão no
 * estabelecimento (a própria fica de fora).
 */
export function conferirInscricao(
  nova: DadosInscricao,
  atual: DadosInscricao | null,
  outras: readonly Pick<InscricaoGravada, 'id' | 'situacao'>[],
): ResultadoInscricao {
  const p: ProblemaTransplante[] = [];
  if (!DIA.test(nova.dataInscricao))
    p.push({ campo: 'dataInscricao', mensagem: 'Informe a data da inscrição.' });
  if (atual === null && !SITUACOES_EM_LISTA.includes(nova.situacao))
    p.push({
      campo: 'situacao',
      mensagem: 'A inscrição nova entra na lista (ativa, semiativa ou suspensa).',
    });
  if (atual !== null && SITUACOES_FINAIS.includes(atual.situacao))
    p.push({
      campo: 'situacao',
      mensagem: 'A inscrição saiu da lista (transplantado, removida ou óbito): faça uma nova inscrição.',
    });
  if (
    SITUACOES_EM_LISTA.includes(nova.situacao) &&
    outras.some((o) => SITUACOES_EM_LISTA.includes(o.situacao))
  )
    p.push({ campo: 'orgao', mensagem: 'O paciente já está na lista deste órgão neste estabelecimento.' });
  const mudouAptidao = atual !== null && atual.apto !== nova.apto;
  const saiu = ['removida', 'obito', 'suspensa'].includes(nova.situacao) && atual?.situacao !== nova.situacao;
  if ((mudouAptidao || saiu || (atual === null && !nova.apto)) && !nova.motivo?.trim())
    p.push({ campo: 'motivo', mensagem: 'Informe o motivo da mudança de aptidão ou da saída da lista.' });
  if (nova.situacao === 'transplantado' && nova.dataTransplante === null)
    p.push({ campo: 'dataTransplante', mensagem: 'Informe a data do transplante.' });
  if (nova.situacao !== 'transplantado' && nova.dataTransplante !== null)
    p.push({
      campo: 'dataTransplante',
      mensagem: 'A data do transplante só vale para o paciente transplantado.',
    });
  if (nova.dataTransplante !== null && nova.dataTransplante < nova.dataInscricao)
    p.push({ campo: 'dataTransplante', mensagem: 'A data do transplante é anterior à inscrição.' });
  const operacao: OperacaoHistorico =
    atual === null ? 'inclusao' : SITUACOES_FINAIS.includes(nova.situacao) ? 'exclusao' : 'alteracao';
  return { problemas: p, operacao };
}

export interface LinhaConferenciaInscricao {
  readonly prontuario: string;
  readonly paciente: string;
  readonly cns: string | null;
  readonly orgao: string;
  readonly dataInscricao: string;
  readonly situacao: string;
  readonly prioridade: string;
  readonly apto: boolean;
  readonly numeroCentral: string | null;
  readonly pendenteEnvio: boolean;
}

const CABECALHO_CONFERENCIA = [
  'prontuario',
  'paciente',
  'cns',
  'orgao',
  'data_inscricao',
  'situacao',
  'prioridade',
  'apto',
  'numero_central',
  'pendente_envio',
];

const celula = (v: string): string => {
  // Sem fórmula no editor de planilha (=, +, -, @ no início) e com aspas quando houver separador, aspas ou quebra.
  const seguro = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

/** Arquivo de conferência das inscrições (CSV com ponto e vírgula, UTF-8), na ordem recebida. */
export function csvConferenciaInscricoes(linhas: readonly LinhaConferenciaInscricao[]): string {
  const corpo = linhas.map((l) =>
    [
      l.prontuario,
      l.paciente,
      l.cns ?? '',
      l.orgao,
      l.dataInscricao,
      l.situacao,
      l.prioridade,
      l.apto ? 'sim' : 'nao',
      l.numeroCentral ?? '',
      l.pendenteEnvio ? 'sim' : 'nao',
    ]
      .map(celula)
      .join(';'),
  );
  return [CABECALHO_CONFERENCIA.join(';'), ...corpo].join('\r\n') + '\r\n';
}
