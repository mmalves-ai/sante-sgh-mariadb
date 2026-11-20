// Regras puras da agenda de sessões e recursos (M50, etapa 6; ficha, regra 11; cap-05a §5.1): as datas da série, a
// sobreposição do recurso e do paciente, a conferência do recurso (situação, complexidade, duração, faixa etária) e a
// máquina da sessão (agendada → realizada, falta ou cancelada). Sem banco: a gravação reconfere tudo sob a trava do
// recurso, na mesma transação.
import type { AcaoSessao, RecursoSessao, SituacaoSessao } from '@sgh/contratos';

export class ErroSessao extends Error {
  readonly codigo: string;
  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
    this.name = 'ErroSessao';
  }
}

export interface DataSessao {
  readonly ordem: number;
  /** "AAAA-MM-DDTHH:MM" (hora civil do estabelecimento). */
  readonly inicio: string;
  readonly fim: string;
}

export interface PedidoSerie {
  readonly inicio: string;
  readonly hora: string;
  readonly sessoes: number;
  readonly intervaloDias: number;
  readonly pularFimDeSemana: boolean;
  readonly duracaoMin: number;
}

const DIA_MS = 86_400_000;
const doisDigitos = (n: number) => String(n).padStart(2, '0');

function diaUtc(data: string): number {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(a, m - 1, d);
  const x = new Date(t);
  if (x.getUTCFullYear() !== a || x.getUTCMonth() !== m - 1 || x.getUTCDate() !== d)
    throw new ErroSessao('data-invalida', `Data inexistente: ${data}.`);
  return t;
}

function textoData(t: number): string {
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${doisDigitos(x.getUTCMonth() + 1)}-${doisDigitos(x.getUTCDate())}`;
}

/** Soma minutos a "AAAA-MM-DDTHH:MM" (relógio civil, sem fuso). */
export function somarMinutos(instante: string, minutos: number): string {
  const [d, h] = instante.split('T') as [string, string];
  const t = diaUtc(d) + (Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) + minutos) * 60_000;
  const x = new Date(t);
  return `${textoData(t)}T${doisDigitos(x.getUTCHours())}:${doisDigitos(x.getUTCMinutes())}`;
}

/**
 * As datas da série: a primeira no dia e hora pedidos e cada seguinte `intervaloDias` depois da anterior; com
 * `pularFimDeSemana`, a que cair no sábado ou no domingo vai para a segunda (e a seguinte conta dela).
 */
export function datasDaSerie(p: PedidoSerie): DataSessao[] {
  if (!Number.isInteger(p.sessoes) || p.sessoes < 1)
    throw new ErroSessao('serie-vazia', 'A série precisa de ao menos uma sessão.');
  if (!/^([01]\d|2[0-3])[0-5]\d$/.test(p.hora))
    throw new ErroSessao('hora-invalida', 'Hora no formato HHMM.');
  const hora = `${p.hora.slice(0, 2)}:${p.hora.slice(2, 4)}`;
  const r: DataSessao[] = [];
  let dia = diaUtc(p.inicio);
  for (let ordem = 1; ordem <= p.sessoes; ordem++) {
    if (p.pularFimDeSemana) {
      const semana = new Date(dia).getUTCDay();
      if (semana === 6) dia += 2 * DIA_MS;
      else if (semana === 0) dia += DIA_MS;
    }
    const inicio = `${textoData(dia)}T${hora}`;
    r.push({ ordem, inicio, fim: somarMinutos(inicio, p.duracaoMin) });
    dia += p.intervaloDias * DIA_MS;
  }
  return r;
}

/** Os dois intervalos [início, fim) se sobrepõem? (texto "AAAA-MM-DDTHH:MM" compara na ordem do tempo). */
export function sobrepoe(a: { inicio: string; fim: string }, b: { inicio: string; fim: string }): boolean {
  return a.inicio < b.fim && b.inicio < a.fim;
}

export interface OcupacaoSessao {
  readonly inicio: string;
  readonly fim: string;
}

/** Para cada data da série, o que a impede: o recurso ocupado (primeiro) ou o paciente em outra sessão. */
export function conflitosDaSerie(
  datas: readonly DataSessao[],
  doRecurso: readonly OcupacaoSessao[],
  doPaciente: readonly OcupacaoSessao[],
): (DataSessao & { conflito: 'recurso' | 'paciente' | null })[] {
  return datas.map((d) => ({
    ...d,
    conflito: doRecurso.some((o) => sobrepoe(d, o))
      ? 'recurso'
      : doPaciente.some((o) => sobrepoe(d, o))
        ? 'paciente'
        : null,
  }));
}

/** Idade em anos completos no dia (null sem nascimento). */
export function idadeEmAnos(nascimento: string | null, dia: string): number | null {
  if (!nascimento) return null;
  const [an, mn, dn] = nascimento.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [a, m, d] = dia.slice(0, 10).split('-').map(Number) as [number, number, number];
  return a - an - (m < mn || (m === mn && d < dn) ? 1 : 0);
}

/**
 * O recurso aceita a sessão? Ativo (e a agenda dele também), a complexidade e a duração do domínio (0 no recurso =
 * todas) e a faixa etária (sem faixa = qualquer idade; sem nascimento no cadastro, a faixa não se confere).
 */
export function conferirRecurso(
  r: Pick<RecursoSessao, 'ativo' | 'complexidade' | 'duracao' | 'faixa' | 'identificacao'>,
  s: { complexidade: number; duracao: number; idade: number | null },
): void {
  if (!r.ativo)
    throw new ErroSessao(
      'recurso-inativo',
      `${r.identificacao}: cadeira ou sala inativa (ou a agenda dela).`,
    );
  if (r.complexidade !== 0 && r.complexidade !== s.complexidade)
    throw new ErroSessao(
      'complexidade-nao-aceita',
      `${r.identificacao} não aceita sessões desta complexidade: escolha outra cadeira ou sala.`,
    );
  if (r.duracao !== 0 && r.duracao !== s.duracao)
    throw new ErroSessao(
      'duracao-nao-aceita',
      `${r.identificacao} não aceita sessões desta duração: escolha outra cadeira ou sala.`,
    );
  if (r.faixa && s.idade !== null && (s.idade < r.faixa.de || s.idade > r.faixa.ate))
    throw new ErroSessao(
      'fora-da-faixa-etaria',
      `${r.identificacao} atende de ${r.faixa.de} a ${r.faixa.ate} anos; o paciente tem ${s.idade}.`,
    );
}

/**
 * A faixa etária gravada no recurso (AGCADEIRA.FAIXA_INICIAL/FINAL): a faixa padrão 0–99 e a vazia (0–0, a linha "não
 * informado") valem como "sem limite".
 */
export function faixaDoRecurso(de: number | null, ate: number | null): { de: number; ate: number } | null {
  const a = de ?? 0;
  const b = ate ?? 99;
  if (b <= 0 || (a <= 0 && b >= 99) || b < a) return null;
  return { de: a, ate: b };
}

/** A situação nova da sessão pela ação; recusa o que não vale (a sessão que já não está agendada, a falta futura). */
export function transicaoSessao(
  atual: SituacaoSessao,
  acao: AcaoSessao,
  inicio: string,
  agora: string,
): SituacaoSessao {
  if (atual !== 'agendada')
    throw new ErroSessao('sessao-encerrada', 'A sessão já foi registrada (realizada, falta ou cancelada).');
  if (acao === 'realizar' || acao === 'falta') {
    if (inicio.slice(0, 10) > agora.slice(0, 10))
      throw new ErroSessao(
        'sessao-futura',
        acao === 'realizar'
          ? 'Só se registra como realizada a sessão de hoje ou de antes.'
          : 'Só se registra a falta da sessão de hoje ou de antes.',
      );
    return acao === 'realizar' ? 'realizada' : 'falta';
  }
  return 'cancelada';
}

/** As sessões que `cancelar-restantes` cancela: esta e as seguintes da série ainda agendadas. */
export function restantesDaSerie<T extends { ordem: number; situacao: SituacaoSessao }>(
  serie: readonly T[],
  ordem: number,
): T[] {
  return serie.filter((s) => s.ordem >= ordem && s.situacao === 'agendada');
}
