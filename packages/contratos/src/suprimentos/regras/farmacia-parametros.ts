// Parâmetros da integração prescrição × estoque (F3.6, 05-SUP linha 7): a regra que diz qual local atende a prescrição
// de cada escopo (centro de custo, setor ou unidade), em que momento e de que forma, e a grade de horários padrão de
// cada frequência. Regras puras: a API confere antes de gravar e a tela confere na hora, com as mesmas mensagens.
import { recusa, type RecusaSuprimentos } from './recusa.js';

export const TIPOS_INTEGRACAO = ['requisicao_automatica', 'dispensacao_direta', 'sem_integracao'] as const;
export const MOMENTOS_INTEGRACAO = [
  'na_prescricao',
  'na_liberacao_farmaceutica',
  'no_aprazamento',
  'antes_do_horario',
] as const;
export const FORMAS_DISPENSACAO = ['dose_individualizada', 'dose_unitaria', 'dose_coletiva', 'kit'] as const;

export interface RegraIntegracaoConferida {
  readonly centroCusto: number | null;
  readonly setor: number | null;
  readonly unidade: number | null;
  readonly grupo: number | null;
  readonly subgrupo: number | null;
  readonly item: number | null;
  readonly localAtendente: number;
  readonly localSubstituto: number | null;
  readonly tipoIntegracao: (typeof TIPOS_INTEGRACAO)[number];
  readonly momento: (typeof MOMENTOS_INTEGRACAO)[number];
  readonly antecedenciaMinutos: number | null;
  readonly geraManipulacao: boolean;
}

/** As recusas da regra de integração (vazio: pode gravar). */
export function conferirRegraIntegracao(r: RegraIntegracaoConferida): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (r.centroCusto === null && r.setor === null && r.unidade === null)
    out.push(
      recusa('escopo-obrigatorio', 'Diga a quem a regra vale: centro de custo, setor ou unidade.', [
        'centroCusto',
        'setor',
        'unidade',
      ]),
    );
  if (r.localSubstituto !== null && r.localSubstituto === r.localAtendente)
    out.push(
      recusa('mesmo-local', 'O local substituto tem de ser outro que não o que atende.', ['localSubstituto']),
    );
  if (r.momento === 'antes_do_horario' && !(r.antecedenciaMinutos && r.antecedenciaMinutos > 0))
    out.push(
      recusa('antecedencia-obrigatoria', 'Antes do horário: informe a antecedência em minutos.', [
        'antecedenciaMinutos',
      ]),
    );
  if (r.momento !== 'antes_do_horario' && r.antecedenciaMinutos !== null)
    out.push(
      recusa('antecedencia-sem-uso', 'A antecedência só vale para o momento "antes do horário".', [
        'antecedenciaMinutos',
      ]),
    );
  if (r.item !== null && (r.grupo !== null || r.subgrupo !== null))
    out.push(
      recusa(
        'item-e-grupo',
        'A exceção por item não se combina com grupo ou subgrupo: escolha um dos dois.',
        ['item'],
      ),
    );
  if (r.subgrupo !== null && r.grupo === null)
    out.push(recusa('subgrupo-sem-grupo', 'Escolha o grupo do subgrupo.', ['grupo']));
  if (r.tipoIntegracao === 'sem_integracao' && r.geraManipulacao)
    out.push(
      recusa('manipulacao-sem-integracao', 'Sem integração não há requisição para gerar a manipulação.', [
        'geraManipulacao',
      ]),
    );
  return out;
}

/** A chave do escopo e dos filtros: duas regras ativas com a mesma chave e a mesma prioridade são ambíguas. */
export const chaveRegraIntegracao = (
  r: Pick<RegraIntegracaoConferida, 'centroCusto' | 'setor' | 'unidade' | 'grupo' | 'subgrupo' | 'item'> & {
    tipoItem: number | null;
    prioridade: number;
  },
): string =>
  [r.centroCusto, r.setor, r.unidade, r.tipoItem, r.grupo, r.subgrupo, r.item, r.prioridade]
    .map((x) => x ?? '-')
    .join('|');

export interface HorarioPadraoConferido {
  /** HH:MM */
  readonly hora: string;
  /** Dias da semana de 1 (domingo) a 7; vazio ou ausente = todos (a grade padrão unificada é diária: sem dias). */
  readonly dias?: readonly number[];
}

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/**
 * A grade de horários de uma frequência: ao menos um horário, até 48, sem horário repetido, dias de 1 a 7 sem
 * repetição e, quando a frequência diz quantas doses por dia, a grade tem esse número de horários.
 */
export function conferirHorariosPadrao(
  horarios: readonly HorarioPadraoConferido[],
  dosesPorDia: number | null,
): RecusaSuprimentos[] {
  const out: RecusaSuprimentos[] = [];
  if (horarios.length === 0) return [recusa('sem-horario', 'Informe ao menos um horário.', ['horarios'])];
  if (horarios.length > 48)
    out.push(recusa('horarios-demais', 'No máximo 48 horários por dia.', ['horarios']));
  horarios.forEach((h, i) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h.hora))
      out.push(
        recusa('hora-invalida', `Horário ${i + 1}: use HH:MM, de 00:00 a 23:59.`, [`horarios.${i}.hora`]),
      );
    const dias = h.dias ?? [];
    if (dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7) || new Set(dias).size !== dias.length)
      out.push(
        recusa('dia-invalido', `Horário ${i + 1}: dias de 1 (domingo) a 7, sem repetir.`, [
          `horarios.${i}.dias`,
        ]),
      );
  });
  const vistos = new Set<number>();
  horarios.forEach((h, i) => {
    const m = minutos(h.hora);
    if (vistos.has(m))
      out.push(
        recusa('horario-repetido', `O horário ${h.hora} aparece mais de uma vez.`, [`horarios.${i}.hora`]),
      );
    vistos.add(m);
  });
  if (dosesPorDia !== null && dosesPorDia > 0 && horarios.length !== dosesPorDia)
    out.push(
      recusa(
        'doses-da-frequencia',
        `A frequência tem ${dosesPorDia} dose(s) por dia: a grade precisa desse número.`,
        ['horarios'],
      ),
    );
  return out;
}

// ── A grade padrão unificada (05-SUP linha 7) ─────────────────────────────────────────────────────────────────────────
// A grade de horários padrão é uma só para a farmácia e para o aprazamento da enfermagem: por grade de horário da
// unidade (nula = o estabelecimento todo) e por NÚMERO DE DOSES AO DIA. A frequência entra como escopo pelo número de
// doses que ela dá ao dia (o declarado, ou o que o intervalo divide o dia sem sobra); a frequência que não dá número
// de doses (se necessário, a critério, intervalo que não fecha o dia) não tem grade padrão.

/** O número de doses ao dia que a frequência dá à grade padrão, ou null quando ela não tem grade. */
export function dosesDaFrequencia(f: {
  readonly dosesPorDia: number | null;
  readonly intervaloMinutos: number | null;
}): number | null {
  const valido = (n: number) => Number.isInteger(n) && n >= 1 && n <= 48;
  if (f.dosesPorDia !== null && f.dosesPorDia > 0) return valido(f.dosesPorDia) ? f.dosesPorDia : null;
  const i = f.intervaloMinutos;
  if (i === null || i <= 0 || 1_440 % i !== 0) return null;
  return valido(1_440 / i) ? 1_440 / i : null;
}

/**
 * A grade padrão de uma frequência: a frequência precisa dar o número de doses ao dia (é a chave da grade que o
 * aprazamento lê) e a grade tem exatamente esse número de horários, sem repetir.
 */
export function conferirGradePadrao(
  horarios: readonly HorarioPadraoConferido[],
  doses: number | null,
): RecusaSuprimentos[] {
  if (doses === null)
    return [
      recusa(
        'frequencia-sem-doses',
        'A grade padrão é por número de doses ao dia: escolha uma frequência que diga quantas doses dá por dia.',
        ['frequencia'],
      ),
    ];
  return conferirHorariosPadrao(horarios, doses);
}

/** O texto gravado dos dias (nulo = todos os dias). */
export const diasParaTexto = (dias: readonly number[]): string | null =>
  dias.length === 0 || dias.length === 7 ? null : [...dias].sort((a, b) => a - b).join(',');

export const diasDoTexto = (t: string | null): number[] =>
  t
    ? t
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isInteger(x))
    : [];

/** O atendimento e o item prescrito, para escolher a regra vigente. */
export interface ContextoIntegracao {
  readonly centroCusto: number | null;
  readonly setor: number | null;
  readonly unidade: number | null;
  readonly tipoItem: number | null;
  readonly grupo: number | null;
  readonly subgrupo: number | null;
  readonly item: number;
}

export interface RegraCandidata extends RegraIntegracaoConferida {
  readonly regra: number;
  readonly tipoItem: number | null;
  readonly prioridade: number;
  readonly ativo: boolean;
}

/**
 * A especificidade de uma regra que atende o contexto: primeiro o filtro do item (item > subgrupo > grupo > tipo de
 * item > nenhum), depois o escopo (setor > unidade > centro de custo). Nulo quando a regra não atende.
 */
export function especificidadeRegra(r: RegraCandidata, c: ContextoIntegracao): readonly number[] | null {
  const pares: [number | null, number | null][] = [
    [r.centroCusto, c.centroCusto],
    [r.setor, c.setor],
    [r.unidade, c.unidade],
    [r.tipoItem, c.tipoItem],
    [r.grupo, c.grupo],
    [r.subgrupo, c.subgrupo],
    [r.item, c.item],
  ];
  if (!r.ativo || pares.some(([regra, ctx]) => regra !== null && regra !== ctx)) return null;
  const filtro =
    r.item !== null ? 4 : r.subgrupo !== null ? 3 : r.grupo !== null ? 2 : r.tipoItem !== null ? 1 : 0;
  const escopo = r.setor !== null ? 3 : r.unidade !== null ? 2 : r.centroCusto !== null ? 1 : 0;
  return [filtro, escopo];
}

/**
 * A regra vigente para o item no atendimento: a mais específica vence; no empate, a de menor número de prioridade
 * (1 vem antes de 999); persistindo o empate, a regra mais antiga (menor id), para a escolha ser sempre a mesma.
 * Nulo quando nenhuma regra ativa atende: o item segue sem integração automática.
 */
export function regraVigente<R extends RegraCandidata>(
  regras: readonly R[],
  c: ContextoIntegracao,
): R | null {
  let melhor: { r: R; chave: readonly number[] } | null = null;
  for (const r of regras) {
    const e = especificidadeRegra(r, c);
    if (!e) continue;
    const chave = [...e, -r.prioridade, -r.regra];
    if (!melhor || compararChaves(chave, melhor.chave) > 0) melhor = { r, chave };
  }
  return melhor?.r ?? null;
}

function compararChaves(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

/** O que a regra decide para uma dose: se vai ao estoque, de qual local e a partir de quando. */
export interface DecisaoIntegracao {
  readonly integraEstoque: boolean;
  /** O local que atende; o substituto quando o atendente não tem saldo; nulo sem saldo em nenhum. */
  readonly local: number | null;
  readonly usouSubstituto: boolean;
  /** O instante em que a requisição ou a dose entra na fila; nulo quando depende de um evento (liberação, aprazamento). */
  readonly liberarEm: Date | null;
}

export function decidirIntegracao(
  r: RegraCandidata | null,
  o: { temSaldo: (local: number) => boolean; prescritoEm: Date; horarioDose: Date | null },
): DecisaoIntegracao {
  if (!r || r.tipoIntegracao === 'sem_integracao')
    return { integraEstoque: false, local: null, usouSubstituto: false, liberarEm: null };
  const noAtendente = o.temSaldo(r.localAtendente);
  const substituto = !noAtendente && r.localSubstituto !== null && o.temSaldo(r.localSubstituto);
  const local = noAtendente ? r.localAtendente : substituto ? r.localSubstituto : null;
  const liberarEm =
    r.momento === 'na_prescricao'
      ? o.prescritoEm
      : r.momento === 'antes_do_horario' && o.horarioDose
        ? new Date(o.horarioDose.getTime() - (r.antecedenciaMinutos ?? 0) * 60_000)
        : null;
  return { integraEstoque: true, local, usouSubstituto: substituto, liberarEm };
}

// ── A regra aplicada às doses da prescrição (F3.6-04, 05-SUP linha 7) ───────────────────────────────────────────────
// A prescrição e o aprazamento chamam estas funções para cada item com produto de estoque: a regra vigente decide se a
// dose vai ao estoque, o local que a atende e o instante em que ela entra na fila da farmácia. O que não depende do
// relógio da prescrição (liberação do farmacêutico, aprazamento da enfermagem) fica à espera do evento.

/** Os eventos que liberam a dose depois da prescrição. */
export const EVENTOS_LIBERACAO_DOSE = ['liberacao_farmaceutica', 'aprazamento'] as const;
export type EventoLiberacaoDose = (typeof EVENTOS_LIBERACAO_DOSE)[number];

export interface DoseDecidida extends DecisaoIntegracao {
  readonly horario: Date;
}

/**
 * A decisão de cada dose (horário) do item: uma só regra vale para o item inteiro (a vigente no contexto), e cada
 * dose recebe o local e o instante de liberação. Sem regra que atenda, devolve regra nula e nenhuma dose decidida: o
 * item segue sem integração automática.
 */
export function decidirDoses<R extends RegraCandidata>(
  regras: readonly R[],
  c: ContextoIntegracao,
  o: { temSaldo: (local: number) => boolean; prescritoEm: Date; horarios: readonly Date[] },
): { regra: R | null; doses: DoseDecidida[] } {
  const regra = regraVigente(regras, c);
  if (!regra) return { regra: null, doses: [] };
  return {
    regra,
    doses: o.horarios.map((horario) => ({
      horario,
      ...decidirIntegracao(regra, { temSaldo: o.temSaldo, prescritoEm: o.prescritoEm, horarioDose: horario }),
    })),
  };
}

/**
 * O instante de liberação depois de um evento. A liberação do farmacêutico libera a dose da regra "na liberação
 * farmacêutica"; o aprazamento libera a da regra "no aprazamento" e recalcula a da regra "antes do horário" (o horário
 * mudou). A primeira liberação por evento vale: repetir o evento não a adia. Nos demais casos o instante não muda.
 */
export function liberacaoPorEvento(
  r: { readonly momento: string; readonly antecedenciaMinutos: number | null },
  atual: Date | null,
  evento: EventoLiberacaoDose,
  o: { quando: Date; horarioDose: Date },
): Date | null {
  if (evento === 'liberacao_farmaceutica')
    return r.momento === 'na_liberacao_farmaceutica' ? (atual ?? o.quando) : atual;
  if (r.momento === 'no_aprazamento') return atual ?? o.quando;
  if (r.momento === 'antes_do_horario')
    return new Date(o.horarioDose.getTime() - (r.antecedenciaMinutos ?? 0) * 60_000);
  return atual;
}

export const SITUACOES_DOSE_INTEGRADA = ['fora', 'sem_saldo', 'aguardando', 'liberada'] as const;

/**
 * Onde a dose está para a farmácia: fora (a regra diz sem integração), sem saldo (nem o local que atende nem o
 * substituto têm o item), aguardando (o evento ou o instante de liberação ainda não chegou) ou liberada.
 */
export function situacaoDoseIntegrada(
  d: { readonly integraEstoque: boolean; readonly local: number | null; readonly liberarEm: Date | null },
  agora: Date,
): (typeof SITUACOES_DOSE_INTEGRADA)[number] {
  if (!d.integraEstoque) return 'fora';
  if (d.local === null) return 'sem_saldo';
  if (d.liberarEm === null || d.liberarEm.getTime() > agora.getTime()) return 'aguardando';
  return 'liberada';
}
