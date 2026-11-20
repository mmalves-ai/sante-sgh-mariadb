// "Quem está de plantão agora" e o acionamento do sobreaviso (M52.3; ficha do M52, seção 8, regra 10: responde no
// instante, inclui o sobreaviso com o tempo de chegada, trata o plantão que atravessa a meia-noite no fuso
// America/Sao_Paulo e registra o acionamento). Os instantes são de relógio local (D-FUSO-52): o plantão das 19 h às 7 h
// é um intervalo só, que termina no dia seguinte; às 2 h ele está em curso e começou "ontem". O domínio não lê o relógio:
// quem chama passa o instante (a API converte o agora para Brasília com `instanteEmBrasilia`).
import { OK, recusar, type Conferencia } from './plantao.js';
import { instanteDeMinuto, minutoLocal, type Intervalo } from './tempo.js';

/** O instante local de Brasília (`AAAA-MM-DDTHH:MM`) de um `Date` (o relógio de quem chama). */
export function instanteEmBrasilia(d: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}

/** O plantão está em curso no instante: começou e ainda não acabou (o fim é aberto: às 7 h o noturno já acabou). */
export function emCursoNoInstante(p: Intervalo, instante: string): boolean {
  const t = minutoLocal(instante);
  return minutoLocal(p.inicio) <= t && t < minutoLocal(p.fim);
}

/** O plantão em curso começou num dia anterior ao do instante (atravessou a meia-noite). */
export function comecouAntesDoDia(p: Intervalo, instante: string): boolean {
  return p.inicio.slice(0, 10) < instante.slice(0, 10);
}

/**
 * A janela de busca do índice por início (SGH_IDX_PES_PLANTAO_INICIO): nenhum plantão passa de 24 h (D-DUR-52), então
 * quem está em curso começou nas 24 h antes do instante.
 */
export function janelaDoInstante(instante: string): { readonly inicioDesde: string; readonly ate: string } {
  const t = minutoLocal(instante);
  return { inicioDesde: instanteDeMinuto(t - 24 * 60), ate: instanteDeMinuto(t + 1) };
}

export interface PlantaoDoInstante extends Intervalo {
  readonly id: number;
  readonly tipo: string;
  readonly situacao: string;
}

/** Ordem da resposta: presencial e diarista primeiro, depois o sobreaviso; dentro, pelo início e pelo ID. */
const ORDEM_TIPO: Readonly<Record<string, number>> = { presencial: 0, diarista: 1, sobreaviso: 2 };

export function plantoesNoInstante<T extends PlantaoDoInstante>(lidos: readonly T[], instante: string): T[] {
  return lidos
    .filter((p) => p.situacao === 'previsto' && emCursoNoInstante(p, instante))
    .sort(
      (a, b) =>
        (ORDEM_TIPO[a.tipo] ?? 9) - (ORDEM_TIPO[b.tipo] ?? 9) ||
        minutoLocal(a.inicio) - minutoLocal(b.inicio) ||
        a.id - b.id,
    );
}

// ── Acionamento do sobreaviso ─────────────────────────────────────────────────────────────────────────────────

export interface SobreavisoParaAcionar extends Intervalo {
  readonly tipo: string;
  readonly situacao: string;
  readonly chegadaMin: number | null;
  readonly estadoEscala: string;
}

/**
 * Pode acionar: o plantão é sobreaviso, previsto, da escala publicada, em curso agora e sem outro acionamento em aberto
 * (D-ACION-52.3). O prazo de chegada é o instante do acionamento mais o tempo de chegada do sobreaviso.
 */
export function conferirAcionamento(
  p: SobreavisoParaAcionar,
  agora: string,
  abertos: number,
): Conferencia & { readonly prazoChegada?: string } {
  if (p.tipo !== 'sobreaviso') return recusar('nao-e-sobreaviso', 'Só o plantão de sobreaviso é acionado.');
  if (p.situacao !== 'previsto') return recusar('plantao-cancelado', 'O plantão está cancelado.');
  if (p.estadoEscala !== 'publicada')
    return recusar('escala-em-rascunho', 'A escala ainda não foi publicada: o sobreaviso não vale.');
  if (!emCursoNoInstante(p, agora))
    return recusar(
      'fora-do-sobreaviso',
      'O sobreaviso não está em curso agora: confira o horário do plantão.',
    );
  if (abertos > 0)
    return recusar('ja-acionado', 'Este sobreaviso já foi acionado e o profissional está a caminho.');
  return { ok: true, prazoChegada: prazoDeChegada(agora, p.chegadaMin ?? 0) };
}

export function prazoDeChegada(acionadoEm: string, chegadaMin: number): string {
  return instanteDeMinuto(minutoLocal(acionadoEm) + chegadaMin);
}

/**
 * O instante da chegada a partir só da hora informada (`HH:MM`): no dia do acionamento ou, quando a hora é anterior à
 * do acionamento, no dia seguinte (o sobreaviso acionado às 23h50 que chega às 00h20).
 */
export function instanteDaChegada(acionadoEm: string, hora: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!m) throw new Error(`Hora inválida: ${hora}`);
  const acionado = minutoLocal(acionadoEm);
  const doDia = acionado - (((acionado % 1440) + 1440) % 1440);
  const naHora = doDia + Number(m[1]) * 60 + Number(m[2]);
  return instanteDeMinuto(naHora < acionado ? naHora + 1440 : naHora);
}

/** A chegada vem depois do acionamento e não no futuro; o atraso é chegar depois do prazo. */
export function conferirChegada(
  a: { readonly situacao: string; readonly acionadoEm: string },
  chegouEm: string,
  agora: string,
): Conferencia {
  if (a.situacao !== 'acionado')
    return recusar(
      'acionamento-encerrado',
      'O acionamento já foi encerrado (chegada registrada ou cancelado).',
    );
  if (minutoLocal(chegouEm) < minutoLocal(a.acionadoEm))
    return recusar('chegada-antes', 'A chegada não pode ser antes do acionamento.');
  if (minutoLocal(chegouEm) > minutoLocal(agora))
    return recusar('chegada-futura', 'A chegada não pode estar no futuro.');
  return OK;
}

/** Atrasado: chegou depois do prazo, ou o prazo passou e a chegada ainda não foi registrada. */
export function atrasado(
  a: { readonly situacao: string; readonly prazoChegada: string; readonly chegouEm: string | null },
  agora: string,
): boolean {
  if (a.situacao === 'cancelado') return false;
  const prazo = minutoLocal(a.prazoChegada);
  if (a.chegouEm) return minutoLocal(a.chegouEm) > prazo;
  return minutoLocal(agora) > prazo;
}
