// Mapa de dietas por unidade e refeição (M45, etapa 5; ficha, regras 11 e 12; cap-06a §6.3, "Nutrição e dietas"):
//   - a linha de cada internado vem da ÚLTIMA prescrição válida até o horário de corte da refeição (gravada até o corte,
//     vigente na hora de servir, sem suspensão até o corte); depois do corte, a mudança na prescrição alerta a copa e o
//     mapa continua no corte;
//   - o jejum prescrito ou agendado (cirurgia: as horas antes do início e durante; exame que pede jejum: as horas antes)
//     prevalece sobre qualquer dieta;
//   - a alergia alimentar registrada no prontuário vai na linha e na etiqueta;
//   - a refeição do acompanhante só com direito legal (idade conferida pelo nascimento; a parturiente e a pessoa com
//     deficiência, declaradas);
//   - o retrato fechado tem o hash do conteúdo canônico (JCS + SHA-256): fecha exatamente o que a pessoa viu.
// Puro: sem banco (o adaptador lê; a API aplica).
import {
  type AlertaMapa,
  type BaseLegalAcompanhante,
  jcs,
  type LinhaMapa,
  type OrigemJejum,
  type Refeicao,
  sha256Hex,
  type TipoLinhaMapa,
} from '@sgh/contratos';

export type CodigoRecusaMapa =
  'sem-direito-legal' | 'antes-do-corte' | 'mapa-mudou' | 'refeicao-desconhecida' | 'acompanhante-vigente';

export class ErroMapa extends Error {
  override readonly name = 'ErroMapa';
  readonly codigo: CodigoRecusaMapa;
  constructor(codigo: CodigoRecusaMapa, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** O tipo de lançamento da prescrição (o cadastro de tipos de item) para o tipo da linha; null: não é dieta. */
export function tipoDoPlanoDieta(plano: number): Exclude<TipoLinhaMapa, 'sem-prescricao'> | null {
  switch (plano) {
    case 1:
      return 'jejum';
    case 2:
      return 'livre';
    case 3:
      return 'oral';
    case 4:
      return 'enteral';
    case 5:
      return 'parenteral';
    default:
      return null;
  }
}

/** Um item de dieta da prescrição, como o adaptador lê (instantes locais "AAAA-MM-DDTHH:MM"). */
export interface ItemDietaDoMapa {
  readonly item: number;
  readonly itemDieta: number;
  readonly prescricao: number;
  readonly plano: number;
  readonly nomeDieta: string | null;
  readonly quantidade: string | null;
  /** Quando a prescrição foi gravada (a última até o corte vale). */
  readonly gravadaEm: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string;
  /** A suspensão da prescrição ou do item (a mais cedo); null sem suspensão. */
  readonly suspensaEm: string | null;
  readonly caracteristicas: readonly { readonly nome: string; readonly resposta: string | null }[];
}

const min16 = (s: string) => s.slice(0, 16).replace(' ', 'T');

/**
 * A dieta que vale para a refeição servida em `servirEm`, como estava no instante `instante` (o corte, ou agora antes
 * do corte): gravada até o instante, vigente na hora de servir e sem suspensão até o instante. O jejum prescrito
 * prevalece; senão, a da prescrição gravada por último (e o item mais recente).
 */
export function dietaNoInstante(
  itens: readonly ItemDietaDoMapa[],
  servirEm: string,
  instante: string,
): ItemDietaDoMapa | null {
  const s = min16(servirEm);
  const i = min16(instante);
  const validos = itens.filter(
    (x) =>
      tipoDoPlanoDieta(x.plano) !== null &&
      min16(x.gravadaEm) <= i &&
      min16(x.vigenciaInicio) <= s &&
      min16(x.vigenciaFim) >= s &&
      (x.suspensaEm === null || min16(x.suspensaEm) > i),
  );
  const ordenar = (a: ItemDietaDoMapa, b: ItemDietaDoMapa) =>
    min16(b.gravadaEm).localeCompare(min16(a.gravadaEm)) || b.item - a.item;
  const jejum = validos.filter((x) => x.plano === 1).sort(ordenar);
  if (jejum[0]) return jejum[0];
  return [...validos].sort(ordenar)[0] ?? null;
}

export interface CirurgiaAgendada {
  readonly inicio: string;
  readonly duracaoMin: number;
  readonly descricao: string;
}
export interface ExameAgendado {
  readonly inicio: string;
  readonly exame: string;
  readonly descricao: string;
}

export interface RegraJejum {
  readonly horasCirurgia: number;
  readonly horasExame: number;
  /** Os códigos de exame que pedem jejum (vazio: nenhum). */
  readonly examesComJejum: ReadonlySet<string>;
}

const ms = (s: string) => Date.parse(`${min16(s)}:00Z`);

/**
 * O jejum agendado para a refeição servida em `servirEm` (regra 11): a cirurgia que começa até N horas depois (ou que
 * está acontecendo na hora de servir) e o exame que pede jejum e começa até N horas depois. A cirurgia vem primeiro.
 */
export function jejumAgendado(
  servirEm: string,
  agenda: { readonly cirurgias: readonly CirurgiaAgendada[]; readonly exames: readonly ExameAgendado[] },
  r: RegraJejum,
): { origem: OrigemJejum; descricao: string; procedimentoEm: string } | null {
  const t = ms(servirEm);
  const cirurgias = [...agenda.cirurgias].sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (const c of cirurgias) {
    const i = ms(c.inicio);
    if (t >= i - r.horasCirurgia * 3_600_000 && t <= i + Math.max(c.duracaoMin, 0) * 60_000)
      return { origem: 'cirurgia', descricao: c.descricao, procedimentoEm: min16(c.inicio) };
  }
  const exames = [...agenda.exames].sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (const e of exames) {
    if (!r.examesComJejum.has(e.exame.trim().toUpperCase())) continue;
    const i = ms(e.inicio);
    if (t >= i - r.horasExame * 3_600_000 && t <= i)
      return { origem: 'exame', descricao: e.descricao, procedimentoEm: min16(e.inicio) };
  }
  return null;
}

/** A lista de exames com jejum do parâmetro (códigos separados por vírgula). */
export function examesComJejum(texto: string | null | undefined): ReadonlySet<string> {
  return new Set(
    (texto ?? '')
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean),
  );
}

// ── Refeições e cortes ────────────────────────────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):?([0-5]\d)$/;

/** HH:MM a partir de "HHMM" ou "HH:MM"; null fora do formato. */
export function horaRefeicao(s: string | null | undefined): string | null {
  const m = HHMM.exec((s ?? '').trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Os cortes próprios do parâmetro ("2=09:30;5=15:30"): refeição → HH:MM. */
export function cortesProprios(texto: string | null | undefined): ReadonlyMap<number, string> {
  const m = new Map<number, string>();
  for (const par of (texto ?? '').split(';')) {
    const [c, h] = par.split('=');
    const hora = horaRefeicao(h);
    if (c && /^\d+$/.test(c.trim()) && hora) m.set(Number(c.trim()), hora);
  }
  return m;
}

function horaMenos(hora: string, minutos: number): string {
  const [h, m] = hora.split(':').map(Number) as [number, number];
  const t = (((h * 60 + m - minutos) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * As refeições da unidade com o horário de servir (o horário padrão da dieta oral no cadastro) e o corte (o próprio da
 * refeição no parâmetro da unidade, ou o horário menos a antecedência). Refeição sem horário fica de fora.
 */
export function refeicoesComCorte(
  cadastro: readonly { readonly codigo: number; readonly nome: string; readonly horario: string | null }[],
  antecedenciaMin: number,
  proprios: ReadonlyMap<number, string>,
): Refeicao[] {
  const r: Refeicao[] = [];
  for (const x of cadastro) {
    const horario = horaRefeicao(x.horario);
    if (!horario) continue;
    r.push({
      codigo: x.codigo,
      nome: x.nome,
      horario,
      corte: proprios.get(x.codigo) ?? horaMenos(horario, antecedenciaMin),
    });
  }
  return r.sort((a, b) => a.horario.localeCompare(b.horario));
}

/** O instante de servir e o do corte da refeição no dia (o corte depois do horário cai no dia anterior). */
export function instantesDaRefeicao(data: string, r: Refeicao): { servirEm: string; corteEm: string } {
  const servirEm = `${data}T${r.horario}`;
  if (r.corte <= r.horario) return { servirEm, corteEm: `${data}T${r.corte}` };
  const ontem = new Date(Date.parse(`${data}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { servirEm, corteEm: `${ontem}T${r.corte}` };
}

// ── Acompanhante ──────────────────────────────────────────────────────────────────────────────────

/** A base legal confere com a idade (idoso: 60 anos ou mais; criança ou adolescente: menos de 18). */
export function conferirDireitoLegal(base: BaseLegalAcompanhante, idade: number | null): void {
  if (base === 'idoso' && (idade === null || idade < 60))
    throw new ErroMapa(
      'sem-direito-legal',
      'A pessoa idosa tem direito a acompanhante a partir dos 60 anos: confira o nascimento do paciente ou a base legal.',
    );
  if (base === 'crianca-adolescente' && (idade === null || idade >= 18))
    throw new ErroMapa(
      'sem-direito-legal',
      'Criança e adolescente têm direito a acompanhante até os 17 anos: confira o nascimento do paciente ou a base legal.',
    );
}

/** A refeição do acompanhante vale no dia e na refeição (dentro do período e entre as refeições escolhidas). */
export function acompanhanteNaRefeicao(
  a: { readonly refeicoes: readonly number[]; readonly inicio: string; readonly fim: string | null },
  refeicao: number,
  data: string,
): boolean {
  return a.refeicoes.includes(refeicao) && a.inicio <= data && (a.fim === null || a.fim >= data);
}

// ── Linha, contagens, hash e alertas ──────────────────────────────────────────────────────────────

export interface InternadoDoMapa {
  readonly internacao: number;
  readonly paciente: number;
  readonly nome: string;
  readonly nascimento: string | null;
  readonly prontuario: number;
  readonly leito: { readonly bloco: string; readonly acomodacao: string; readonly leito: string };
}

export interface ContextoLinha {
  readonly servirEm: string;
  readonly corteEm: string;
  readonly agora: string;
  readonly regraJejum: RegraJejum;
  readonly refeicao: number;
  readonly data: string;
}

const descricaoDieta = (x: ItemDietaDoMapa | null) =>
  x ? [x.nomeDieta ?? 'Dieta', ...x.caracteristicas.map((c) => c.nome)].join(' · ') : 'Sem dieta prescrita';

/** A linha do internado na refeição (a dieta no corte, o jejum que prevalece, as alergias e o acompanhante). */
export function linhaDoMapa(
  i: InternadoDoMapa,
  itens: readonly ItemDietaDoMapa[],
  agenda: { readonly cirurgias: readonly CirurgiaAgendada[]; readonly exames: readonly ExameAgendado[] },
  alergiasAlimentares: readonly string[],
  acompanhante: {
    readonly id: number;
    readonly baseLegal: BaseLegalAcompanhante;
    readonly refeicoes: readonly number[];
    readonly inicio: string;
    readonly fim: string | null;
    readonly origem?: 'nutricao' | 'portaria';
  } | null,
  c: ContextoLinha,
): LinhaMapa {
  const depoisDoCorte = min16(c.agora) > min16(c.corteEm);
  const noCorte = dietaNoInstante(itens, c.servirEm, depoisDoCorte ? c.corteEm : c.agora);
  const agora = depoisDoCorte ? dietaNoInstante(itens, c.servirEm, c.agora) : noCorte;
  const mudou = depoisDoCorte && (noCorte?.itemDieta ?? null) !== (agora?.itemDieta ?? null);
  const agendado = jejumAgendado(c.servirEm, agenda, c.regraJejum);
  const tipoPrescrito = noCorte ? tipoDoPlanoDieta(noCorte.plano) : null;
  const jejum =
    tipoPrescrito === 'jejum'
      ? {
          origem: 'prescrito' as const,
          descricao: noCorte?.nomeDieta ?? 'Jejum prescrito',
          procedimentoEm: null,
        }
      : agendado;
  const tipo: TipoLinhaMapa = jejum ? 'jejum' : (tipoPrescrito ?? 'sem-prescricao');
  return {
    internacao: i.internacao,
    paciente: i.paciente,
    nome: i.nome,
    nascimento: i.nascimento,
    prontuario: i.prontuario,
    leito: i.leito,
    tipo,
    dieta: noCorte?.nomeDieta ?? null,
    itemDieta: noCorte?.itemDieta ?? null,
    item: noCorte?.item ?? null,
    caracteristicas: noCorte ? [...noCorte.caracteristicas] : [],
    quantidade: noCorte?.quantidade ?? null,
    jejum,
    alergiasAlimentares: [...new Set(alergiasAlimentares.map((a) => a.trim()).filter(Boolean))].sort(),
    acompanhante:
      acompanhante && acompanhanteNaRefeicao(acompanhante, c.refeicao, c.data)
        ? {
            id: acompanhante.id,
            baseLegal: acompanhante.baseLegal,
            refeicoes: [...acompanhante.refeicoes],
            inicio: acompanhante.inicio,
            fim: acompanhante.fim,
            ...(acompanhante.origem === 'portaria' ? { origem: 'portaria' as const } : {}),
          }
        : null,
    prescritoEm: noCorte ? min16(noCorte.gravadaEm) : null,
    mudouDepoisDoCorte: mudou,
  };
}

/** A descrição curta da dieta prescrita agora (para o alerta da copa). */
export function descricaoAgora(
  itens: readonly ItemDietaDoMapa[],
  servirEm: string,
  agora: string,
): { descricao: string; gravadaEm: string | null } {
  const x = dietaNoInstante(itens, servirEm, agora);
  return { descricao: descricaoDieta(x), gravadaEm: x ? min16(x.gravadaEm) : null };
}

export function contagensDoMapa(linhas: readonly LinhaMapa[]): Record<TipoLinhaMapa, number> {
  const c: Record<TipoLinhaMapa, number> = {
    jejum: 0,
    livre: 0,
    oral: 0,
    enteral: 0,
    parenteral: 0,
    'sem-prescricao': 0,
  };
  for (const l of linhas) c[l.tipo] += 1;
  return c;
}

/** O conteúdo canônico do mapa (só identificadores, a dieta e as restrições; sem nome nem nascimento). */
export function conteudoCanonicoMapa(linhas: readonly LinhaMapa[]): string {
  return jcs(
    [...linhas]
      .sort((a, b) => a.internacao - b.internacao)
      .map((l) => ({
        internacao: l.internacao,
        leito: `${l.leito.acomodacao}|${l.leito.leito}`,
        tipo: l.tipo,
        itemDieta: l.itemDieta,
        caracteristicas: l.caracteristicas.map((c) => `${c.nome}${c.resposta ? `=${c.resposta}` : ''}`),
        jejum: l.jejum?.origem ?? null,
        alergias: l.alergiasAlimentares,
        acompanhante: l.acompanhante !== null,
      })),
  );
}

export function hashDoMapa(linhas: readonly LinhaMapa[]): Promise<string> {
  return sha256Hex(conteudoCanonicoMapa(linhas));
}

/** O que o retrato fechado guardou de cada internado (para comparar com o que está prescrito agora). */
export interface ItemDoRetrato {
  readonly internacao: number;
  readonly tipo: TipoLinhaMapa;
  readonly itemDieta: number | null;
  readonly dieta: string | null;
  readonly caracteristicas: string | null;
  /** Para o alerta de quem saiu da unidade: o nome lido agora (se ainda houver) e o leito do fechamento. */
  readonly nome?: string | null;
  readonly leito?: { readonly bloco: string; readonly acomodacao: string; readonly leito: string } | null;
}

/** O texto do alerta de quem estava no retrato e não está mais na unidade (alta ou transferência). */
export const SAIU_DA_UNIDADE = 'Saiu da unidade (alta ou transferência): não prepare a bandeja';

/**
 * Os alertas à copa (regra 11): a prescrição que mudou depois do corte (a linha marcada) e, com o retrato fechado, o
 * internado cujo item de dieta de agora não é o do retrato, o que entrou na unidade depois do fechamento e o que estava
 * no retrato e saiu da unidade (alta ou transferência), para a copa não preparar a bandeja.
 */
export function alertasDoMapa(
  linhas: readonly LinhaMapa[],
  agoraPorInternacao: ReadonlyMap<
    number,
    { descricao: string; gravadaEm: string | null; itemDieta: number | null }
  >,
  retrato: readonly ItemDoRetrato[] | null,
): AlertaMapa[] {
  const r: AlertaMapa[] = [];
  const doRetrato = new Map((retrato ?? []).map((x) => [x.internacao, x]));
  for (const l of linhas) {
    const agora = agoraPorInternacao.get(l.internacao);
    const fechado = doRetrato.get(l.internacao);
    const antes = fechado
      ? fechado.tipo === 'sem-prescricao'
        ? 'Sem dieta prescrita'
        : [fechado.dieta ?? 'Dieta', fechado.caracteristicas].filter(Boolean).join(' · ')
      : descricaoLinha(l);
    const mudouDoRetrato =
      retrato !== null && (!fechado || (fechado.itemDieta ?? null) !== (agora?.itemDieta ?? null));
    if (l.mudouDepoisDoCorte || mudouDoRetrato)
      r.push({
        internacao: l.internacao,
        nome: l.nome,
        leito: l.leito,
        antes: fechado ? antes : retrato !== null ? 'Fora do mapa fechado' : antes,
        agora: agora?.descricao ?? 'Sem dieta prescrita',
        prescritoEm: agora?.gravadaEm ?? null,
      });
  }
  const atuais = new Set(linhas.map((l) => l.internacao));
  for (const x of retrato ?? []) {
    if (atuais.has(x.internacao)) continue;
    r.push({
      internacao: x.internacao,
      nome: x.nome ?? `Internação ${x.internacao}`,
      leito: x.leito ?? { bloco: '', acomodacao: '', leito: '' },
      antes:
        x.tipo === 'sem-prescricao'
          ? 'Sem dieta prescrita'
          : [x.dieta ?? 'Dieta', x.caracteristicas].filter(Boolean).join(' · '),
      agora: SAIU_DA_UNIDADE,
      prescritoEm: null,
    });
  }
  return r;
}

/**
 * A janela do fechamento do retrato (regra 11, "retrato no corte"): do corte até `toleranciaHoras` depois do horário
 * de servir. Antes, a prescrição ainda pode mudar; depois, o censo de agora já não é o do corte (o mapa de dias atrás
 * não fecha com os internados de hoje).
 */
export function janelaDoFechamento(
  servirEm: string,
  corteEm: string,
  toleranciaHoras: number,
): { abreEm: string; fechaEm: string } {
  const ms = Date.parse(`${servirEm}:00Z`) + Math.max(0, toleranciaHoras) * 3_600_000;
  return { abreEm: corteEm, fechaEm: new Date(ms).toISOString().slice(0, 16) };
}

function descricaoLinha(l: LinhaMapa): string {
  if (l.tipo === 'sem-prescricao') return 'Sem dieta prescrita';
  return [l.dieta ?? 'Dieta', ...l.caracteristicas.map((c) => c.nome)].join(' · ');
}

/** As características em texto para o retrato e a etiqueta. */
export function caracteristicasTexto(l: Pick<LinhaMapa, 'caracteristicas'>): string | null {
  const t = l.caracteristicas.map((c) => (c.resposta ? `${c.nome}: ${c.resposta}` : c.nome)).join(', ');
  return t === '' ? null : t.slice(0, 300);
}
