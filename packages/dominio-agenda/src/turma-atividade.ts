// Agenda de grupos e turmas (02-AGE linha 50): atividade coletiva com vários pacientes (grupo terapêutico, educação em
// saúde, reabilitação). Regras puras, sem banco; a porta própria lê o estado, chama estas decisões e grava.
//   - cadastro da turma e da escala semanal coerentes (vagas, período, idade, acompanhante, horário, vigência);
//   - geração dos encontros a partir da escala no período pedido, dentro do período da turma e da vigência da escala,
//     sem feriado (a não ser que a escala inclua feriado) e sem repetir encontro já gerado;
//   - inscrição com conferência de idade, sexo, indicação profissional, fonte pagadora aceita e limite por fonte, e
//     vaga: sem vaga, entra na espera com a posição (ou no encaixe, quando pedido e há vaga de encaixe);
//   - desligamento com motivo e promoção automática do primeiro da espera para a vaga liberada;
//   - presença só em encontro já iniciado e não cancelado, de participante inscrito ou ativo; falta justificada exige
//     a justificativa. Nada se apaga: o encontro cancelado fica com o motivo e a participação desligada com a data.

export const SITUACOES_ENCONTRO = ['previsto', 'realizado', 'cancelado'] as const;
export type SituacaoEncontro = (typeof SITUACOES_ENCONTRO)[number];
export const SITUACOES_PARTICIPANTE = [
  'em_espera',
  'inscrito',
  'ativo',
  'concluido',
  'desistente',
  'desligado',
] as const;
export type SituacaoParticipante = (typeof SITUACOES_PARTICIPANTE)[number];
export const SITUACOES_PRESENCA = ['presente', 'falta', 'falta_justificada'] as const;
export type SituacaoPresenca = (typeof SITUACOES_PRESENCA)[number];
export const SAIDAS_PARTICIPANTE = ['concluido', 'desistente', 'desligado'] as const;
export type SaidaParticipante = (typeof SAIDAS_PARTICIPANTE)[number];

/** Participação que ocupa vaga. */
export const OCUPA_VAGA: readonly SituacaoParticipante[] = ['inscrito', 'ativo'];
/** Teto de dias de uma geração de encontros (um ano). */
export const TETO_DIAS_GERACAO = 366;

export interface RecusaTurma {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campo?: string;
}
const r = (codigo: string, mensagem: string, campo?: string): RecusaTurma =>
  campo ? { codigo, mensagem, campo } : { codigo, mensagem };

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export interface DadosTurma {
  readonly codigo: string;
  readonly descricao: string;
  readonly dataInicio: string;
  readonly dataFim: string | null;
  readonly vagas: number;
  readonly vagasEncaixe: number;
  readonly exigeAcompanhante: boolean;
  readonly permiteAcompanhante: boolean;
  readonly exigeIndicacaoMedica: boolean;
  readonly idadeMinimaAnos: number | null;
  readonly idadeMaximaAnos: number | null;
  readonly profissionais: readonly { readonly profissional: number; readonly principal: boolean }[];
  readonly fontes: readonly {
    readonly fontePagadora: number;
    readonly plano: number | null;
    readonly limite: number | null;
  }[];
}

/** Cadastro da turma coerente (o banco confere de novo pelos CHECK). */
export function validarTurma(t: DadosTurma): RecusaTurma | null {
  if (!t.codigo.trim()) return r('turma-sem-codigo', 'Informe o código da turma.', 'codigo');
  if (!t.descricao.trim()) return r('turma-sem-descricao', 'Informe a descrição da turma.', 'descricao');
  if (!DATA.test(t.dataInicio))
    return r('turma-sem-inicio', 'Informe a data de início da turma.', 'dataInicio');
  if (t.dataFim !== null && t.dataFim < t.dataInicio)
    return r('turma-periodo-invertido', 'O fim da turma não pode ser antes do início.', 'dataFim');
  if (!Number.isInteger(t.vagas) || t.vagas < 1)
    return r('turma-sem-vagas', 'A turma precisa de pelo menos uma vaga.', 'vagas');
  if (!Number.isInteger(t.vagasEncaixe) || t.vagasEncaixe < 0)
    return r('turma-encaixe-invalido', 'As vagas de encaixe não podem ser negativas.', 'vagasEncaixe');
  if (t.idadeMinimaAnos !== null && t.idadeMaximaAnos !== null && t.idadeMaximaAnos < t.idadeMinimaAnos)
    return r('turma-idade-invertida', 'A idade máxima não pode ser menor que a mínima.', 'idadeMaximaAnos');
  if (t.exigeAcompanhante && !t.permiteAcompanhante)
    return r(
      'turma-acompanhante-incoerente',
      'A turma que exige acompanhante precisa permitir acompanhante.',
      'permiteAcompanhante',
    );
  if (t.profissionais.length === 0)
    return r(
      'turma-sem-profissional',
      'Informe ao menos um profissional que conduz a turma.',
      'profissionais',
    );
  if (t.profissionais.filter((p) => p.principal).length !== 1)
    return r(
      'turma-responsavel',
      'Marque exatamente um profissional como responsável pela turma.',
      'profissionais',
    );
  if (new Set(t.profissionais.map((p) => p.profissional)).size !== t.profissionais.length)
    return r('turma-profissional-repetido', 'O mesmo profissional aparece duas vezes.', 'profissionais');
  if (new Set(t.fontes.map((f) => `${f.fontePagadora}-${f.plano ?? ''}`)).size !== t.fontes.length)
    return r('turma-fonte-repetida', 'A mesma fonte pagadora e plano aparecem duas vezes.', 'fontes');
  if (t.fontes.some((f) => f.limite !== null && (!Number.isInteger(f.limite) || f.limite < 1)))
    return r('turma-limite-fonte', 'O limite por fonte pagadora precisa ser de pelo menos um.', 'fontes');
  return null;
}

export interface EscalaTurma {
  readonly id?: number | undefined;
  /** 1 = domingo ... 7 = sábado. */
  readonly diaSemana: number;
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly inclusiveFeriado: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

export function validarEscala(e: EscalaTurma): RecusaTurma | null {
  if (!Number.isInteger(e.diaSemana) || e.diaSemana < 1 || e.diaSemana > 7)
    return r('escala-dia-invalido', 'Escolha o dia da semana.', 'diaSemana');
  if (!HORA.test(e.horaInicio) || !HORA.test(e.horaFim))
    return r('escala-hora-invalida', 'Informe as horas no formato HH:MM.', 'horaInicio');
  if (e.horaFim <= e.horaInicio)
    return r('escala-horario-invertido', 'O fim do encontro precisa ser depois do início.', 'horaFim');
  if (!DATA.test(e.vigenciaInicio))
    return r('escala-sem-vigencia', 'Informe o início da vigência da escala.', 'vigenciaInicio');
  if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
    return r('escala-vigencia-invertida', 'O fim da vigência não pode ser antes do início.', 'vigenciaFim');
  return null;
}

/** Dia sem expediente (dia inteiro, ou a faixa de horas, fim exclusivo). */
export interface DiaSemExpedienteTurma {
  readonly data: string;
  readonly horaInicio?: string | null;
  readonly horaFim?: string | null;
}

export interface EncontroGerado {
  readonly escala: number | null;
  readonly data: string;
  readonly horaInicio: string;
  readonly horaFim: string;
}

const somarDias = (d: string, n: number): string => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** 1 = domingo ... 7 = sábado. */
export const diaDaSemana = (d: string): number => new Date(`${d}T00:00:00Z`).getUTCDay() + 1;

/** Dias entre duas datas (b - a). */
const diasEntre = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function bateFeriado(f: readonly DiaSemExpedienteTurma[], data: string, ini: string, fim: string): boolean {
  return f.some(
    (x) => x.data === data && (!x.horaInicio || !x.horaFim || (ini < x.horaFim && fim > x.horaInicio)),
  );
}

export interface PedidoGeracao {
  readonly de: string;
  readonly ate: string;
  readonly turma: { readonly dataInicio: string; readonly dataFim: string | null; readonly ativo: boolean };
  readonly escalas: readonly EscalaTurma[];
  readonly feriados: readonly DiaSemExpedienteTurma[];
  /** Encontros que já existem (data e hora de início), não gerados de novo. */
  readonly existentes: readonly { readonly data: string; readonly horaInicio: string }[];
}

export type ResultadoGeracao =
  | {
      readonly ok: true;
      readonly encontros: EncontroGerado[];
      readonly existentes: number;
      readonly feriados: number;
    }
  | ({ readonly ok: false } & RecusaTurma);

/** Encontros da escala no período (dentro da turma e da vigência), sem feriado e sem repetir os existentes. */
export function gerarEncontros(p: PedidoGeracao): ResultadoGeracao {
  if (!DATA.test(p.de) || !DATA.test(p.ate) || p.ate < p.de)
    return { ok: false, ...r('geracao-periodo-invalido', 'Informe um período válido.', 'de') };
  if (diasEntre(p.de, p.ate) >= TETO_DIAS_GERACAO)
    return {
      ok: false,
      ...r('geracao-periodo-longo', 'Gere os encontros de no máximo um ano por vez.', 'ate'),
    };
  if (!p.turma.ativo) return { ok: false, ...r('turma-inativa', 'A turma está inativa.') };
  const ativas = p.escalas.filter((e) => e.ativo);
  if (ativas.length === 0)
    return { ok: false, ...r('turma-sem-escala', 'Cadastre a escala semanal antes de gerar os encontros.') };
  const de = p.de < p.turma.dataInicio ? p.turma.dataInicio : p.de;
  const ate = p.turma.dataFim !== null && p.turma.dataFim < p.ate ? p.turma.dataFim : p.ate;
  const ja = new Set(p.existentes.map((x) => `${x.data} ${x.horaInicio}`));
  const encontros: EncontroGerado[] = [];
  let existentes = 0;
  let feriados = 0;
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    const ds = diaDaSemana(d);
    for (const e of ativas) {
      if (e.diaSemana !== ds || d < e.vigenciaInicio || (e.vigenciaFim !== null && d > e.vigenciaFim))
        continue;
      if (ja.has(`${d} ${e.horaInicio}`)) {
        existentes++;
        continue;
      }
      if (!e.inclusiveFeriado && bateFeriado(p.feriados, d, e.horaInicio, e.horaFim)) {
        feriados++;
        continue;
      }
      ja.add(`${d} ${e.horaInicio}`);
      encontros.push({ escala: e.id ?? null, data: d, horaInicio: e.horaInicio, horaFim: e.horaFim });
    }
  }
  return { ok: true, encontros, existentes, feriados };
}

/** Idade em anos completos na data (nulo sem nascimento). */
export function idadeNaTurma(nascimento: string | null, data: string): number | null {
  if (!nascimento || !DATA.test(nascimento)) return null;
  let anos = Number(data.slice(0, 4)) - Number(nascimento.slice(0, 4));
  if (data.slice(5) < nascimento.slice(5)) anos--;
  return anos;
}

export interface RegrasInscricao {
  readonly ativo: boolean;
  readonly dataFim: string | null;
  readonly vagas: number;
  readonly vagasEncaixe: number;
  readonly idadeMinimaAnos: number | null;
  readonly idadeMaximaAnos: number | null;
  /** Nulo: aberta a todos. */
  readonly sexo: number | null;
  readonly exigeIndicacaoMedica: boolean;
  readonly exigeAcompanhante: boolean;
}

export interface PedidoInscricao {
  readonly hoje: string;
  readonly turma: RegrasInscricao;
  readonly paciente: { readonly nascimento: string | null; readonly sexo: number | null };
  readonly fontePagadora: number;
  readonly plano: number | null;
  readonly indicacaoProfissional: number | null;
  readonly acompanhanteInformado: boolean;
  readonly encaixe: boolean;
  /** Fontes aceitas pela turma (vazio: todas) com as participações que já ocupam vaga por fonte. */
  readonly fontes: readonly {
    readonly fontePagadora: number;
    readonly plano: number | null;
    readonly limite: number | null;
    readonly usadas: number;
  }[];
  /** Participações que ocupam vaga (inscrito e ativo). */
  readonly ocupadas: number;
  /** Maior posição na espera hoje (0: ninguém). */
  readonly ultimaPosicaoEspera: number;
}

export type DecisaoInscricao =
  | {
      readonly ok: true;
      readonly situacao: 'inscrito' | 'em_espera';
      readonly posicaoEspera: number | null;
      readonly encaixe: boolean;
      readonly alertas: string[];
    }
  | ({ readonly ok: false } & RecusaTurma);

/** Confere a inscrição: elegibilidade (recusa) e vaga (inscreve, encaixa ou põe na espera). */
export function decidirInscricao(p: PedidoInscricao): DecisaoInscricao {
  const t = p.turma;
  const nao = (codigo: string, mensagem: string, campo?: string): DecisaoInscricao => ({
    ok: false,
    ...r(codigo, mensagem, campo),
  });
  if (!t.ativo) return nao('turma-inativa', 'A turma está inativa: não recebe inscrições.');
  if (t.dataFim !== null && t.dataFim < p.hoje)
    return nao('turma-encerrada', 'A turma já terminou: não recebe inscrições.');
  const idade = idadeNaTurma(p.paciente.nascimento, p.hoje);
  if (t.idadeMinimaAnos !== null || t.idadeMaximaAnos !== null) {
    if (idade === null)
      return nao(
        'paciente-sem-nascimento',
        'A turma tem faixa de idade: informe a data de nascimento no cadastro do paciente.',
      );
    if (
      (t.idadeMinimaAnos !== null && idade < t.idadeMinimaAnos) ||
      (t.idadeMaximaAnos !== null && idade > t.idadeMaximaAnos)
    )
      return nao(
        'idade-fora-da-turma',
        `A turma aceita de ${t.idadeMinimaAnos ?? 0} a ${t.idadeMaximaAnos ?? '—'} anos; o paciente tem ${idade}.`,
      );
  }
  if (t.sexo !== null && p.paciente.sexo !== t.sexo)
    return nao('sexo-fora-da-turma', 'O sexo do paciente não é o aceito pela turma.');
  if (t.exigeIndicacaoMedica && p.indicacaoProfissional === null)
    return nao(
      'indicacao-obrigatoria',
      'A turma exige indicação: informe o profissional que indicou.',
      'indicacaoProfissional',
    );
  if (t.exigeAcompanhante && !p.acompanhanteInformado)
    return nao(
      'acompanhante-obrigatorio',
      'A turma exige acompanhante: confirme o acompanhante.',
      'acompanhante',
    );
  if (p.fontes.length > 0) {
    const aceita =
      p.fontes.find((f) => f.fontePagadora === p.fontePagadora && f.plano !== null && f.plano === p.plano) ??
      p.fontes.find((f) => f.fontePagadora === p.fontePagadora && f.plano === null);
    if (!aceita)
      return nao(
        'fonte-nao-aceita',
        'A fonte pagadora (ou o plano) não é aceita nesta turma.',
        'fontePagadora',
      );
    if (aceita.limite !== null && aceita.usadas >= aceita.limite)
      return nao(
        'limite-da-fonte',
        `A fonte pagadora já tem ${aceita.usadas} de ${aceita.limite} participantes nesta turma.`,
        'fontePagadora',
      );
  }
  const alertas: string[] = [];
  if (p.ocupadas < t.vagas)
    return { ok: true, situacao: 'inscrito', posicaoEspera: null, encaixe: false, alertas };
  if (p.encaixe && p.ocupadas < t.vagas + t.vagasEncaixe) {
    alertas.push(`Inscrito em vaga de encaixe (${p.ocupadas + 1 - t.vagas} de ${t.vagasEncaixe}).`);
    return { ok: true, situacao: 'inscrito', posicaoEspera: null, encaixe: true, alertas };
  }
  const posicao = p.ultimaPosicaoEspera + 1;
  alertas.push(`Turma sem vaga: paciente na espera, posição ${posicao}.`);
  return { ok: true, situacao: 'em_espera', posicaoEspera: posicao, encaixe: false, alertas };
}

/** Saída da participação (conclusão, desistência, desligamento): motivo obrigatório fora da conclusão. */
export function decidirSaida(
  atual: SituacaoParticipante,
  saida: SaidaParticipante,
  motivo: string | null,
): RecusaTurma | null {
  if (atual === 'concluido' || atual === 'desistente' || atual === 'desligado')
    return r('participacao-encerrada', 'A participação já foi encerrada.');
  if (saida === 'concluido' && atual === 'em_espera')
    return r('espera-nao-conclui', 'Quem está na espera não conclui a turma: registre a desistência.');
  if (saida !== 'concluido' && !motivo?.trim())
    return r('saida-sem-motivo', 'Informe o motivo da saída.', 'motivo');
  return null;
}

/** Quem sobe da espera quando abre vaga: a menor posição. */
export function proximoDaEspera<T extends { readonly id: number; readonly posicaoEspera: number | null }>(
  espera: readonly T[],
): T | null {
  const lista = espera
    .filter((x) => x.posicaoEspera !== null)
    .sort((a, b) => a.posicaoEspera! - b.posicaoEspera! || a.id - b.id);
  return lista[0] ?? null;
}

export interface PedidoPresenca {
  readonly encontro: { readonly situacao: SituacaoEncontro; readonly inicio: Date };
  readonly agora: Date;
  readonly participante: { readonly situacao: SituacaoParticipante };
  readonly situacao: SituacaoPresenca;
  readonly justificativa: string | null;
  readonly acompanhantePresente: boolean;
  readonly permiteAcompanhante: boolean;
}

/** Presença: encontro iniciado e não cancelado, participante na turma, justificativa na falta justificada. */
export function validarPresenca(p: PedidoPresenca): RecusaTurma | null {
  if (p.encontro.situacao === 'cancelado')
    return r('encontro-cancelado', 'O encontro foi cancelado: não recebe presença.');
  if (p.encontro.inicio.getTime() > p.agora.getTime())
    return r('encontro-futuro', 'A presença só é registrada depois do início do encontro.');
  if (!OCUPA_VAGA.includes(p.participante.situacao))
    return r(
      'participante-fora',
      'O paciente não está inscrito nesta turma (espera ou participação encerrada).',
    );
  if (p.situacao === 'falta_justificada' && !p.justificativa?.trim())
    return r('falta-sem-justificativa', 'Informe a justificativa da falta.', 'justificativa');
  if (p.acompanhantePresente && !p.permiteAcompanhante)
    return r('acompanhante-nao-permitido', 'A turma não permite acompanhante.');
  return null;
}

/** Cancelamento do encontro: só o previsto, com motivo. */
export function validarCancelamentoEncontro(
  situacao: SituacaoEncontro,
  motivo: string | null,
): RecusaTurma | null {
  if (situacao === 'realizado')
    return r('encontro-realizado', 'O encontro já foi realizado: não se cancela.');
  if (situacao === 'cancelado') return r('encontro-ja-cancelado', 'O encontro já está cancelado.');
  if (!motivo?.trim()) return r('cancelamento-sem-motivo', 'Informe o motivo do cancelamento.', 'motivo');
  return null;
}

/** Frequência da participação (presentes sobre encontros com presença registrada), em %; nula sem registro. */
export function frequencia(presencas: readonly SituacaoPresenca[]): number | null {
  if (presencas.length === 0) return null;
  return Math.round((presencas.filter((x) => x === 'presente').length * 100) / presencas.length);
}
