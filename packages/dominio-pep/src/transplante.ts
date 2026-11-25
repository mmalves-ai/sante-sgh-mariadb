// Doação e transplante de órgãos no prontuário (03-PEP L145): o registro clínico do doador (avaliação, antibióticos,
// consentimento, captação e preservação de cada órgão), o receptor inscrito por órgão, o destino de cada órgão do
// doador a cada receptor e o acompanhamento do receptor depois do transplante. Regras puras, sem banco.
// Base legal: Lei 9.434/1997 (a retirada de órgãos de pessoa falecida depende da autorização do cônjuge ou de parente
// maior de idade, por escrito; a doação em vida é do próprio doador) e Decreto 9.175/2017 (diagnóstico de morte
// encefálica antes da retirada; notificação compulsória à central estadual de transplantes; comissão intra-hospitalar).
// A notificação à central e a inscrição na lista estadual ficam no módulo do SUS; aqui é o registro clínico.

export interface FalhaTransplante {
  readonly codigo: string;
  readonly mensagem: string;
}

export const TIPOS_DOADOR_ORGAO = ['falecido', 'vivo'] as const;
export type TipoDoadorOrgao = (typeof TIPOS_DOADOR_ORGAO)[number];
export const CONSENTIMENTOS_DOACAO = ['pendente', 'autorizado', 'recusado', 'nao_se_aplica'] as const;
export type ConsentimentoDoacao = (typeof CONSENTIMENTOS_DOACAO)[number];
export const SITUACOES_DOADOR_ORGAO = [
  'em_avaliacao',
  'apto',
  'inapto',
  'captado',
  'nao_captado',
  'cancelado',
] as const;
export type SituacaoDoadorOrgao = (typeof SITUACOES_DOADOR_ORGAO)[number];
export const TIPOS_PERFUSAO = ['aortica', 'portal', 'aortica_portal', 'outra'] as const;
export const SITUACOES_RECEPTOR = [
  'ativo',
  'semiativo',
  'suspenso',
  'transplantado',
  'removido',
  'obito',
] as const;
export type SituacaoReceptor = (typeof SITUACOES_RECEPTOR)[number];
export const TIPOS_DIALISE = ['hemodialise', 'dialise_peritoneal', 'nenhuma'] as const;
export const SITUACOES_DESTINO_ORGAO = [
  'ofertado',
  'aceito',
  'recusado',
  'transplantado',
  'descartado',
] as const;
export type SituacaoDestinoOrgao = (typeof SITUACOES_DESTINO_ORGAO)[number];
export const TIPOS_ACOMPANHAMENTO_TRANSPLANTE = [
  'sintoma',
  'sinal',
  'achado_exame',
  'intercorrencia',
  'suspeita_rejeicao',
] as const;
export type TipoAcompanhamentoTransplante = (typeof TIPOS_ACOMPANHAMENTO_TRANSPLANTE)[number];

/** Tolerância para relógios fora de sincronia (data "agora" vinda da estação). */
const TOLERANCIA_MS = 5 * 60_000;
const futura = (d: Date | null, agora: Date) => d !== null && d.getTime() > agora.getTime() + TOLERANCIA_MS;
const vazio = (s: string | null | undefined) => !s || !s.trim();
const f = (codigo: string, mensagem: string): FalhaTransplante => ({ codigo, mensagem });

// ---------------------------------------------------------------- doador

export interface DadosDoadorOrgao {
  readonly tipo: TipoDoadorOrgao;
  readonly situacao: SituacaoDoadorOrgao;
  readonly consentimento: ConsentimentoDoacao;
  readonly consentimentoEm: Date | null;
  readonly responsavelConsentimento: string | null;
  readonly parentescoId: number | null;
  readonly morteEncefalicaEm: Date | null;
  readonly captacaoEm: Date | null;
  readonly procedimentoInicioEm: Date | null;
  readonly procedimentoFimEm: Date | null;
  readonly clampeamentoEm: Date | null;
  readonly saturacao: number | null;
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  readonly teveParadaCardiaca: boolean;
  readonly paradaDescricao: string | null;
}

/** Falhas do registro do doador como um todo (inclusão ou alteração). */
export function conferirDoadorOrgao(d: DadosDoadorOrgao, agora: Date): FalhaTransplante[] {
  const r: FalhaTransplante[] = [];
  if (d.tipo === 'falecido') {
    if (d.consentimento === 'nao_se_aplica')
      r.push(
        f(
          'consentimento-familia-obrigatorio',
          'Doador falecido: a retirada depende da autorização da família (pendente, autorizada ou recusada).',
        ),
      );
    if (
      (d.consentimento === 'autorizado' || d.consentimento === 'recusado') &&
      (vazio(d.responsavelConsentimento) || d.parentescoId === null)
    )
      r.push(
        f(
          'responsavel-consentimento',
          'Informe quem respondeu pela família (nome e parentesco) na autorização ou na recusa.',
        ),
      );
  } else {
    if (d.consentimento !== 'nao_se_aplica' && d.consentimento !== 'autorizado')
      r.push(
        f(
          'consentimento-doador-vivo',
          'Doador vivo: a autorização é do próprio doador (autorizado) ou não se aplica à família.',
        ),
      );
    if (d.morteEncefalicaEm !== null)
      r.push(f('morte-encefalica-doador-vivo', 'Doador vivo não tem protocolo de morte encefálica.'));
  }
  if ((d.consentimento === 'autorizado' || d.consentimento === 'recusado') && d.consentimentoEm === null)
    r.push(f('consentimento-sem-data', 'Informe a data e a hora da resposta da família.'));
  if (d.situacao === 'captado') {
    if (d.captacaoEm === null) r.push(f('captacao-sem-data', 'Informe a data e a hora da captação.'));
    if (d.tipo === 'falecido') {
      if (d.consentimento !== 'autorizado')
        r.push(
          f('captacao-sem-consentimento', 'Sem a autorização da família, os órgãos não podem ser captados.'),
        );
      if (d.morteEncefalicaEm === null)
        r.push(
          f(
            'captacao-sem-morte-encefalica',
            'A captação de doador falecido exige o protocolo de morte encefálica concluído.',
          ),
        );
    }
  }
  if (d.morteEncefalicaEm && d.captacaoEm && d.captacaoEm < d.morteEncefalicaEm)
    r.push(
      f(
        'captacao-antes-morte-encefalica',
        'A captação não pode ser anterior à conclusão do protocolo de morte encefálica.',
      ),
    );
  if (d.procedimentoInicioEm && d.procedimentoFimEm && d.procedimentoFimEm < d.procedimentoInicioEm)
    r.push(f('procedimento-periodo', 'O fim do procedimento não pode ser anterior ao início.'));
  if (
    d.clampeamentoEm &&
    ((d.procedimentoInicioEm && d.clampeamentoEm < d.procedimentoInicioEm) ||
      (d.procedimentoFimEm && d.clampeamentoEm > d.procedimentoFimEm))
  )
    r.push(f('clampeamento-fora-do-procedimento', 'O clampeamento da aorta fica dentro do procedimento.'));
  if (d.saturacao !== null && (d.saturacao < 0 || d.saturacao > 100))
    r.push(f('saturacao-invalida', 'A saturação de oxigênio vai de 0 a 100%.'));
  if (d.pesoKg !== null && (d.pesoKg <= 0 || d.pesoKg > 400))
    r.push(f('peso-invalido', 'Peso fora da faixa possível (até 400 kg).'));
  if (d.alturaCm !== null && (d.alturaCm <= 0 || d.alturaCm > 260))
    r.push(f('altura-invalida', 'Altura fora da faixa possível (até 260 cm).'));
  if (d.teveParadaCardiaca && vazio(d.paradaDescricao))
    r.push(f('parada-sem-descricao', 'Descreva a parada cardíaca (duração e manobras).'));
  if ([d.morteEncefalicaEm, d.consentimentoEm, d.captacaoEm].some((x) => futura(x, agora)))
    r.push(f('data-futura', 'Morte encefálica, consentimento e captação não podem estar no futuro.'));
  return r;
}

const PASSOS_DOADOR: Readonly<Record<SituacaoDoadorOrgao, readonly SituacaoDoadorOrgao[]>> = {
  em_avaliacao: ['apto', 'inapto', 'cancelado'],
  apto: ['captado', 'nao_captado', 'inapto', 'cancelado'],
  inapto: ['apto', 'cancelado'],
  captado: [],
  nao_captado: [],
  cancelado: [],
};

/** A situação do doador só segue os passos da avaliação; captado, não captado e cancelado encerram. */
export function conferirTransicaoDoador(
  de: SituacaoDoadorOrgao,
  para: SituacaoDoadorOrgao,
): FalhaTransplante | null {
  if (de === para) return null;
  return PASSOS_DOADOR[de].includes(para)
    ? null
    : f('transicao-doador', `A doação ${de.replace('_', ' ')} não pode passar a ${para.replace('_', ' ')}.`);
}
export const doadorEncerrado = (s: SituacaoDoadorOrgao) => PASSOS_DOADOR[s].length === 0;

/** Pendências que a tela mostra (não impedem gravar): notificação à central e autorização da família. */
export function pendenciasDoador(d: {
  readonly tipo: TipoDoadorOrgao;
  readonly situacao: SituacaoDoadorOrgao;
  readonly consentimento: ConsentimentoDoacao;
  readonly morteEncefalicaEm: Date | null;
  readonly registroCentral: string | null;
}): FalhaTransplante[] {
  const r: FalhaTransplante[] = [];
  if (doadorEncerrado(d.situacao)) return r;
  if (d.tipo === 'falecido' && d.morteEncefalicaEm && vazio(d.registroCentral))
    r.push(
      f(
        'notificar-central',
        'Morte encefálica confirmada: a notificação à central estadual é compulsória (Decreto 9.175/2017).',
      ),
    );
  if (d.tipo === 'falecido' && d.situacao === 'apto' && d.consentimento === 'pendente')
    r.push(f('entrevista-familiar', 'Doador apto com a entrevista familiar pendente.'));
  return r;
}

// ---------------------------------------------------------------- antibiótico e preservação

export function conferirAntibioticoDoador(
  a: { readonly descricao: string; readonly inicio: string; readonly fim: string | null },
  hoje: string,
): FalhaTransplante[] {
  const r: FalhaTransplante[] = [];
  if (vazio(a.descricao)) r.push(f('antibiotico-sem-descricao', 'Informe o antibiótico.'));
  if (a.inicio > hoje) r.push(f('antibiotico-futuro', 'O início do antibiótico não pode estar no futuro.'));
  if (a.fim !== null && a.fim < a.inicio)
    r.push(f('antibiotico-periodo', 'O fim do antibiótico não pode ser anterior ao início.'));
  return r;
}

export function conferirPreservacao(
  p: {
    readonly situacaoDoador: SituacaoDoadorOrgao;
    readonly aplicadaEm: Date;
    readonly validade: string | null;
    readonly volumeMl: number | null;
    readonly procedimentoInicioEm: Date | null;
    readonly nomeSolucao: string;
  },
  agora: Date,
): FalhaTransplante[] {
  const r: FalhaTransplante[] = [];
  if (p.situacaoDoador !== 'apto' && p.situacaoDoador !== 'captado')
    r.push(f('doador-sem-captacao', 'A solução de preservação só vale para doador apto ou captado.'));
  if (vazio(p.nomeSolucao)) r.push(f('solucao-sem-nome', 'Informe a solução de preservação.'));
  if (p.volumeMl !== null && p.volumeMl <= 0) r.push(f('volume-invalido', 'O volume é maior que zero.'));
  if (futura(p.aplicadaEm, agora)) r.push(f('data-futura', 'A aplicação não pode estar no futuro.'));
  if (p.procedimentoInicioEm && p.aplicadaEm < p.procedimentoInicioEm)
    r.push(f('preservacao-antes-procedimento', 'A solução é aplicada depois do início do procedimento.'));
  if (p.validade !== null && p.validade < p.aplicadaEm.toISOString().slice(0, 10))
    r.push(f('solucao-vencida', 'A solução estava vencida na aplicação.'));
  return r;
}

// ---------------------------------------------------------------- receptor

export function conferirReceptor(
  x: {
    readonly cadastradoEm: string;
    readonly apto: boolean;
    readonly motivoAptidao: string | null;
  },
  hoje: string,
): FalhaTransplante[] {
  const r: FalhaTransplante[] = [];
  if (x.cadastradoEm > hoje) r.push(f('cadastro-futuro', 'A inscrição não pode estar no futuro.'));
  if (!x.apto && vazio(x.motivoAptidao))
    r.push(f('motivo-inaptidao', 'Informe o motivo de o receptor estar inapto agora.'));
  return r;
}

const ATIVAS: readonly SituacaoReceptor[] = ['ativo', 'semiativo', 'suspenso'];
export const receptorNaLista = (s: SituacaoReceptor) => ATIVAS.includes(s);

/** Ativo, semiativo e suspenso trocam entre si e saem da lista; o transplante só chega pelo destino do órgão. */
export function conferirTransicaoReceptor(
  de: SituacaoReceptor,
  para: SituacaoReceptor,
  peloDestino = false,
): FalhaTransplante | null {
  if (de === para) return null;
  if (!receptorNaLista(de))
    return f('receptor-fora-da-lista', 'A inscrição já saiu da lista e não muda mais de situação.');
  if (para === 'transplantado' && !peloDestino)
    return f(
      'transplante-pelo-destino',
      'O transplante se registra no destino do órgão do doador (o receptor muda junto).',
    );
  return null;
}

// ---------------------------------------------------------------- destino do órgão a um receptor

export function conferirDestino(d: {
  readonly pacienteDoador: number;
  readonly pacienteReceptor: number;
  readonly orgao: number;
  readonly orgaoDoReceptor: number;
  readonly situacaoDoador: SituacaoDoadorOrgao;
  readonly tipoDoador: TipoDoadorOrgao;
  readonly situacaoReceptor: SituacaoReceptor;
  readonly doadorVivoParente: boolean;
  readonly parentescoId: number | null;
}): FalhaTransplante[] {
  const r: FalhaTransplante[] = [];
  if (d.pacienteDoador === d.pacienteReceptor)
    r.push(f('doador-e-receptor', 'Doador e receptor são a mesma pessoa.'));
  if (d.orgao !== d.orgaoDoReceptor)
    r.push(f('orgao-diferente-da-inscricao', 'O receptor está inscrito para outro órgão.'));
  if (d.situacaoDoador !== 'apto' && d.situacaoDoador !== 'captado')
    r.push(f('doador-nao-apto', 'Só o doador apto ou captado oferta órgãos.'));
  if (!receptorNaLista(d.situacaoReceptor))
    r.push(f('receptor-fora-da-lista', 'O receptor não está mais na lista.'));
  if (d.doadorVivoParente && d.tipoDoador !== 'vivo')
    r.push(f('parente-so-doador-vivo', 'Doador aparentado é só doador vivo.'));
  if (d.doadorVivoParente && d.parentescoId === null)
    r.push(f('parentesco-obrigatorio', 'Informe o parentesco do doador vivo com o receptor.'));
  return r;
}

const PASSOS_DESTINO: Readonly<Record<SituacaoDestinoOrgao, readonly SituacaoDestinoOrgao[]>> = {
  ofertado: ['aceito', 'recusado', 'descartado'],
  aceito: ['transplantado', 'recusado', 'descartado'],
  recusado: [],
  transplantado: [],
  descartado: [],
};

/** O transplante exige o órgão aceito, o doador captado e o receptor ainda na lista. */
export function conferirTransicaoDestino(
  de: SituacaoDestinoOrgao,
  para: SituacaoDestinoOrgao,
  contexto: { readonly situacaoDoador: SituacaoDoadorOrgao; readonly situacaoReceptor: SituacaoReceptor },
): FalhaTransplante[] {
  if (de === para) return [];
  if (!PASSOS_DESTINO[de].includes(para))
    return [f('transicao-destino', `O órgão ${de} não pode passar a ${para}.`)];
  const r: FalhaTransplante[] = [];
  if (para === 'transplantado') {
    if (contexto.situacaoDoador !== 'captado')
      r.push(f('transplante-sem-captacao', 'O transplante exige a captação registrada no doador.'));
    if (!receptorNaLista(contexto.situacaoReceptor))
      r.push(f('receptor-fora-da-lista', 'O receptor não está mais na lista.'));
  }
  return r;
}

// ---------------------------------------------------------------- acompanhamento depois do transplante

export function conferirAcompanhamento(
  a: {
    readonly situacaoReceptor: SituacaoReceptor;
    readonly transplantadoEm: string | null;
    readonly observadoEm: string;
    readonly descricao: string;
  },
  hoje: string,
): FalhaTransplante[] {
  const r: FalhaTransplante[] = [];
  if (a.situacaoReceptor !== 'transplantado' || a.transplantadoEm === null)
    r.push(f('receptor-sem-transplante', 'O acompanhamento é do receptor já transplantado.'));
  else if (a.observadoEm < a.transplantadoEm)
    r.push(f('antes-do-transplante', 'A observação não pode ser anterior ao transplante.'));
  if (a.observadoEm > hoje) r.push(f('observacao-futura', 'A observação não pode estar no futuro.'));
  if (vazio(a.descricao)) r.push(f('acompanhamento-sem-descricao', 'Descreva o que foi observado.'));
  return r;
}

/** A suspeita de rejeição e a intercorrência pedem a atenção da equipe de transplante (destaque na tela). */
export const acompanhamentoEmDestaque = (tipo: TipoAcompanhamentoTransplante) =>
  tipo === 'suspeita_rejeicao' || tipo === 'intercorrencia';

/** Dias desde o transplante (dia do transplante = 0), para a linha do acompanhamento. */
export function diasDoTransplante(transplantadoEm: string, observadoEm: string): number {
  return Math.round(
    (Date.parse(`${observadoEm}T00:00:00Z`) - Date.parse(`${transplantadoEm}T00:00:00Z`)) / 86_400_000,
  );
}
