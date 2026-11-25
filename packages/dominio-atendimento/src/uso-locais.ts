// Uso da configuração dos locais de atendimento (02-REC linha 34) pela fila do consultório e pela recepção, sem banco:
//   - para onde um local encaminha: a lista configurada (só destinos ativos da mesma recepção); sem lista configurada,
//     os outros locais ativos da mesma recepção; local que não encaminha, nenhum;
//   - quais locais o usuário vê na fila: os locais em que ele atua ou que opera, mais os que esses locais consultam;
//     usuário sem vínculo nenhum vê todos os ativos (o cadastro ainda não o restringiu);
//   - o local está aberto agora: pela semana de funcionamento (localAberto), com a hora em que abre ou fecha, para o
//     aviso na tela (aviso, não trava: quem decide atender fora do horário é o local).
import { type FaixaHorarioLocal, localAberto } from './locais-atendimento.js';

/** O local como o uso da configuração precisa. */
export interface LocalConfigurado {
  readonly id: number;
  readonly recepcao: number;
  readonly ativo: boolean;
  readonly permiteEncaminhamento: boolean;
}

/** Destinos de encaminhamento que valem para o local de origem, em ordem de id. */
export function destinosDeEncaminhamento(
  origem: number,
  configurados: readonly number[],
  locais: readonly LocalConfigurado[],
): number[] {
  const o = locais.find((l) => l.id === origem);
  if (!o || !o.permiteEncaminhamento) return [];
  const validos = locais.filter((l) => l.ativo && l.recepcao === o.recepcao && l.id !== origem);
  const lista = configurados.length ? validos.filter((l) => configurados.includes(l.id)) : validos;
  return lista.map((l) => l.id).sort((a, b) => a - b);
}

/** O encaminhamento de `origem` para `destino` é permitido pela configuração? */
export function encaminhamentoPermitido(
  origem: number,
  destino: number,
  configurados: readonly number[],
  locais: readonly LocalConfigurado[],
): boolean {
  return destinosDeEncaminhamento(origem, configurados, locais).includes(destino);
}

/** Vínculo do usuário com um local (atua nele, opera ou os dois). */
export interface VinculoDoUsuario {
  readonly local: number;
  readonly atuaNoLocal: boolean;
  readonly podeOperar: boolean;
}

/** Locais que o usuário vê na fila, em ordem de id (só ativos). */
export function locaisVisiveisAoUsuario(
  vinculos: readonly VinculoDoUsuario[],
  visibilidade: readonly { readonly local: number; readonly consultado: number }[],
  locais: readonly Pick<LocalConfigurado, 'id' | 'ativo'>[],
): number[] {
  const ativos = locais.filter((l) => l.ativo).map((l) => l.id);
  const meus = vinculos.filter((v) => v.atuaNoLocal || v.podeOperar).map((v) => v.local);
  if (meus.length === 0) return [...ativos].sort((a, b) => a - b);
  const vistos = new Set<number>(meus);
  for (const v of visibilidade) if (meus.includes(v.local)) vistos.add(v.consultado);
  return ativos.filter((id) => vistos.has(id)).sort((a, b) => a - b);
}

/** Situação do horário do local num instante local (AAAA-MM-DDTHH:MM...). */
export interface HorarioAgora {
  readonly aberto: boolean;
  /** Sem semana configurada: o local não tem horário (sempre aberto, sem aviso). */
  readonly semHorario: boolean;
  /** Fechado: a próxima abertura hoje (HH:MM), ou null se não abre mais hoje. */
  readonly abreAs: string | null;
  /** Aberto: quando a faixa atual fecha (HH:MM). */
  readonly fechaAs: string | null;
}

/** Dia da semana do calendário (1 domingo a 7 sábado) de uma data AAAA-MM-DD. */
export function diaDaSemana(data: string): number {
  const [a, m, d] = data.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay() + 1;
}

export function horarioDoLocalAgora(
  faixas: readonly FaixaHorarioLocal[],
  instanteLocal: string,
  diaNaoUtil: boolean,
): HorarioAgora {
  if (faixas.length === 0) return { aberto: true, semHorario: true, abreAs: null, fechaAs: null };
  const dia = diaDaSemana(instanteLocal);
  const hora = instanteLocal.slice(11, 16);
  const doDia = faixas
    .filter((f) => (diaNaoUtil ? f.diaNaoUtil : !f.diaNaoUtil && f.diaSemana === dia))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  if (localAberto(faixas, dia, diaNaoUtil, hora)) {
    const atual = doDia.find((f) => hora >= f.inicio && hora < f.fim);
    return { aberto: true, semHorario: false, abreAs: null, fechaAs: atual?.fim ?? null };
  }
  const proxima = doDia.find((f) => f.inicio > hora);
  return { aberto: false, semHorario: false, abreAs: proxima?.inicio ?? null, fechaAs: null };
}
