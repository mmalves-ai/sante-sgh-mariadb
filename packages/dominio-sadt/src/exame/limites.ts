// Limites do pedido de exame (F8, 05-SADT linha 6): cota por período (por exame ou setor executante, com fonte
// pagadora, unidade e setor solicitante), intervalo mínimo entre pedidos do mesmo exame ou de exames incompatíveis
// (inclusive a repetição proibida no mesmo dia) e bloqueio pelo último resultado do paciente. É outra regra além da
// restrição clínica (restricoes/pedido.ts): aquela olha o paciente e a hora; esta olha o uso e o histórico.
// Regra pura: a aplicação lê o cadastro e as contagens, chama estas funções e grava o que elas decidem.
//
// Melhorias sobre o fluxo comum de mercado: a tela vê todos os limites na hora (antes de gravar), com o uso da cota
// ("8 de 10 no mês"); o mesmo pedido com dois exames incompatíveis é pego antes de gravar; quem libera a exceção fica
// registrado no item, com a justificativa, e o pedido nunca passa calado por dado que falta.

export type AcaoLimite = 'bloquear' | 'alertar' | 'exigir_justificativa';
export type TipoLimite = 'cota' | 'intervalo' | 'ultimo_resultado';
export type PeriodoCota = 'dia' | 'semana' | 'mes' | 'competencia';

export interface CotaExame {
  readonly id: number;
  readonly exame: number | null;
  readonly setor: number | null;
  readonly fontePagadora: number | null;
  readonly unidade: number | null;
  readonly setorSolicitante: number | null;
  readonly periodo: PeriodoCota;
  readonly quantidadeMaxima: number | null;
  /** Fatia máxima (0 a 100) do período que a fonte pagadora da cota pode ocupar no exame ou no setor. */
  readonly percentualLimite: number | null;
  /** Avisa e deixa passar, em vez de bloquear. */
  readonly permiteExceder: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** O uso já gravado no período da cota (a aplicação conta pela janela de janelaDaCota). */
export interface UsoDaCota {
  /** Pedidos no alvo da cota (exame ou setor) que casam com todos os filtros da cota. */
  readonly usados: number;
  /** Pedidos no mesmo alvo e período, de todas as fontes pagadoras (base do percentual). */
  readonly totalDoAlvo: number;
}

export interface IntervaloRepeticao {
  readonly id: number;
  readonly exame: number;
  /** O exame que não pode vir junto ou antes do intervalo (o próprio exame para a repetição). */
  readonly conflitante: number;
  readonly fontePagadora: number | null;
  readonly intervaloMinimoHoras: number;
  readonly mesmoDia: boolean;
  readonly acao: AcaoLimite;
  readonly mensagem: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export type OperadorResultado =
  'igual' | 'diferente' | 'maior' | 'maior_igual' | 'menor' | 'menor_igual' | 'entre' | 'contem';

export interface BloqueioPorResultado {
  readonly id: number;
  /** O exame pedido que a regra bloqueia. */
  readonly exame: number;
  /** O exame de onde vem o resultado avaliado (nulo: o próprio exame pedido). */
  readonly exameAvaliado: number | null;
  readonly analito: number;
  readonly operador: OperadorResultado;
  /** O valor de comparação; no "entre", "mínimo;máximo". */
  readonly valor: string;
  readonly janelaDias: number;
  readonly acao: AcaoLimite;
  readonly mensagem: string | null;
}

/** Um resultado liberado do paciente (o mais recente de cada exame e analito basta). */
export interface ResultadoAnterior {
  readonly exame: number;
  readonly analito: number;
  readonly valorTexto: string | null;
  readonly valorNumerico: number | null;
  /** Data (AAAA-MM-DD) da liberação. */
  readonly data: string;
}

/** Um pedido anterior do paciente, com data e hora na hora do estabelecimento. */
export interface PedidoAnterior {
  readonly exame: number;
  readonly fontePagadora: number | null;
  /** AAAA-MM-DD HH:MM. */
  readonly em: string;
}

/** O pedido de um exame, como a regra dos limites o enxerga. */
export interface ItemAvaliado {
  readonly exame: number;
  readonly setor: number;
  readonly fontePagadora: number | null;
  readonly unidade: number | null;
  readonly setorSolicitante: number | null;
  /** AAAA-MM-DD e HH:MM do pedido. */
  readonly data: string;
  readonly hora: string;
}

export interface LimiteAcionado {
  readonly tipo: TipoLimite;
  readonly regra: number;
  readonly exame: number;
  readonly acao: AcaoLimite;
  readonly mensagem: string;
}

export class RecusaLimite extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const vigente = (inicio: string, fim: string | null, data: string) =>
  inicio <= data && (fim === null || data <= fim);
const diaUtc = (d: string) => new Date(`${d}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const minutos = (em: string) => Date.parse(`${em.slice(0, 10)}T${em.slice(11, 16) || '00:00'}:00Z`) / 60_000;

/** A janela (AAAA-MM-DD, inclusive) do período da cota que contém a data: semana de segunda a domingo. */
export function janelaDaCota(periodo: PeriodoCota, data: string): { inicio: string; fim: string } {
  const d = diaUtc(data);
  if (periodo === 'dia') return { inicio: data, fim: data };
  if (periodo === 'semana') {
    const recuo = (d.getUTCDay() + 6) % 7;
    const ini = new Date(d.getTime() - recuo * 86_400_000);
    return { inicio: iso(ini), fim: iso(new Date(ini.getTime() + 6 * 86_400_000)) };
  }
  const ini = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12));
  const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
  return { inicio: iso(ini), fim: iso(fim) };
}

const NOME_PERIODO: Record<PeriodoCota, string> = {
  dia: 'no dia',
  semana: 'na semana',
  mes: 'no mês',
  competencia: 'na competência',
};

/** A cota vale para o item (alvo, filtros e vigência). */
export function cotaValePara(c: CotaExame, i: ItemAvaliado): boolean {
  if (!vigente(c.vigenciaInicio, c.vigenciaFim, i.data)) return false;
  if (c.exame !== null ? c.exame !== i.exame : c.setor !== i.setor) return false;
  if (c.exame !== null && c.setor !== null && c.setor !== i.setor) return false;
  if (c.fontePagadora !== null && c.fontePagadora !== i.fontePagadora) return false;
  if (c.unidade !== null && c.unidade !== i.unidade) return false;
  if (c.setorSolicitante !== null && c.setorSolicitante !== i.setorSolicitante) return false;
  return true;
}

/**
 * As cotas estouradas pelo item. `noPedido` é quantos itens do mesmo pedido já caíram na cota antes deste (o pedido
 * com três unidades do mesmo exame conta três). Cota sem limite numérico nem percentual não existe (CHECK do banco).
 */
export function cotasAcionadas(
  cotas: readonly CotaExame[],
  i: ItemAvaliado,
  usoDe: (cota: number) => UsoDaCota,
  noPedido: (cota: number) => number = () => 0,
): LimiteAcionado[] {
  const saida: LimiteAcionado[] = [];
  for (const c of cotas) {
    if (!cotaValePara(c, i)) continue;
    const u = usoDe(c.id);
    const ja = noPedido(c.id);
    const depois = u.usados + ja + 1;
    const partes: string[] = [];
    if (c.quantidadeMaxima !== null && depois > c.quantidadeMaxima)
      partes.push(`cota de ${c.quantidadeMaxima} ${NOME_PERIODO[c.periodo]} (${u.usados + ja} já pedidos)`);
    if (c.percentualLimite !== null) {
      const total = u.totalDoAlvo + ja + 1;
      const fatia = (depois / total) * 100;
      // A fatia só se mede com base suficiente: abaixo de 10 pedidos no período o percentual não decide sozinho.
      if (total >= 10 && fatia > c.percentualLimite)
        partes.push(
          `fatia de ${c.percentualLimite}% ${NOME_PERIODO[c.periodo]} (ficaria em ${fatia.toFixed(1)}%)`,
        );
    }
    if (!partes.length) continue;
    saida.push({
      tipo: 'cota',
      regra: c.id,
      exame: i.exame,
      acao: c.permiteExceder ? 'alertar' : 'bloquear',
      mensagem: `Cota do exame esgotada: ${partes.join('; ')}.`,
    });
  }
  return saida;
}

/**
 * Os intervalos violados pelo item, contra os pedidos anteriores do paciente e os outros itens do mesmo pedido. A regra
 * vale nos dois sentidos (exame e conflitante); "mesmo dia" pega qualquer pedido da mesma data.
 */
export function intervalosAcionados(
  regras: readonly IntervaloRepeticao[],
  i: ItemAvaliado,
  anteriores: readonly PedidoAnterior[],
  outrosDoPedido: readonly number[],
): LimiteAcionado[] {
  const saida: LimiteAcionado[] = [];
  const agora = minutos(`${i.data} ${i.hora}`);
  for (const r of regras) {
    if (!vigente(r.vigenciaInicio, r.vigenciaFim, i.data)) continue;
    if (r.fontePagadora !== null && r.fontePagadora !== i.fontePagadora) continue;
    const par = r.exame === i.exame ? r.conflitante : r.conflitante === i.exame ? r.exame : null;
    if (par === null) continue;
    let motivo: string | null = null;
    if (outrosDoPedido.includes(par)) motivo = 'no mesmo pedido';
    for (const a of anteriores) {
      if (motivo) break;
      if (a.exame !== par) continue;
      if (r.mesmoDia && a.em.slice(0, 10) === i.data) motivo = 'no mesmo dia';
      else if (r.intervaloMinimoHoras > 0) {
        const h = (agora - minutos(a.em)) / 60;
        if (h >= 0 && h < r.intervaloMinimoHoras)
          motivo = `há ${Math.floor(h)} h (mínimo de ${r.intervaloMinimoHoras} h)`;
      }
    }
    if (!motivo) continue;
    const repeticao = r.exame === r.conflitante;
    saida.push({
      tipo: 'intervalo',
      regra: r.id,
      exame: i.exame,
      acao: r.acao,
      mensagem:
        r.mensagem ??
        (repeticao ? `Exame já pedido ${motivo}.` : `Exame incompatível com outro já pedido ${motivo}.`),
    });
  }
  return saida;
}

function numero(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** O resultado casa com a condição da regra (número com número; texto sem distinguir maiúsculas). */
export function resultadoCasa(op: OperadorResultado, valor: string, r: ResultadoAnterior): boolean {
  const txt = (r.valorTexto ?? '').trim().toLowerCase();
  const alvo = valor.trim().toLowerCase();
  if (op === 'contem') return alvo !== '' && txt.includes(alvo);
  const v = r.valorNumerico ?? numero(r.valorTexto ?? '');
  if (op === 'entre') {
    const [a, b] = valor.split(';').map((x) => numero(x));
    if (v === null || a === null || b === null || a === undefined || b === undefined) return false;
    return v >= Math.min(a, b) && v <= Math.max(a, b);
  }
  const ref = numero(valor);
  if (ref !== null && v !== null) {
    if (op === 'igual') return v === ref;
    if (op === 'diferente') return v !== ref;
    if (op === 'maior') return v > ref;
    if (op === 'maior_igual') return v >= ref;
    if (op === 'menor') return v < ref;
    return v <= ref;
  }
  if (op === 'igual') return txt === alvo;
  if (op === 'diferente') return txt !== '' && txt !== alvo;
  return false;
}

const dias = (de: string, ate: string) =>
  Math.round((diaUtc(ate).getTime() - diaUtc(de).getTime()) / 86_400_000);

/**
 * Os bloqueios pelo último resultado: vale o resultado liberado mais recente do analito (do exame avaliado ou do próprio
 * exame) dentro da janela de dias. Sem resultado na janela, a regra não se aplica.
 */
export function bloqueiosPorResultado(
  regras: readonly BloqueioPorResultado[],
  i: ItemAvaliado,
  resultados: readonly ResultadoAnterior[],
): LimiteAcionado[] {
  const saida: LimiteAcionado[] = [];
  for (const r of regras) {
    if (r.exame !== i.exame) continue;
    const de = r.exameAvaliado ?? r.exame;
    const ultimo = resultados
      .filter((x) => x.exame === de && x.analito === r.analito && x.data <= i.data)
      .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))[0];
    if (!ultimo || dias(ultimo.data, i.data) > r.janelaDias) continue;
    if (!resultadoCasa(r.operador, r.valor, ultimo)) continue;
    saida.push({
      tipo: 'ultimo_resultado',
      regra: r.id,
      exame: i.exame,
      acao: r.acao,
      mensagem:
        r.mensagem ??
        `O último resultado do paciente (${dias(ultimo.data, i.data)} dia(s) atrás) dispensa ou impede o novo pedido.`,
    });
  }
  return saida;
}

export interface DecisaoDosLimites {
  readonly segue: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
  /** Os limites liberados agora (bloqueio autorizado ou justificativa exigida): viram liberação registrada no item. */
  readonly liberados: readonly LimiteAcionado[];
}

/**
 * Decide se o pedido segue pelos limites. "bloquear" só passa com justificativa (10 caracteres ou mais) e com quem
 * grava tendo a permissão de autorizar a exceção; "exigir_justificativa" passa com a justificativa de quem pede;
 * "alertar" pede a confirmação da tela. Todo limite liberado fica registrado no item com quem gravou.
 */
export function decisaoDosLimites(
  acionados: readonly LimiteAcionado[],
  o: {
    readonly confirmado: boolean;
    readonly justificativa: string | null;
    readonly podeAutorizarExcecao: boolean;
  },
): DecisaoDosLimites {
  const justificada = (o.justificativa ?? '').trim().length >= 10;
  const liberados: LimiteAcionado[] = [];
  for (const a of acionados) {
    if (a.acao === 'alertar') continue;
    if (!justificada)
      return {
        segue: false,
        codigo: a.acao === 'bloquear' ? 'limite-bloqueio' : 'limite-justificativa',
        motivo: `${a.mensagem} Informe a justificativa (10 caracteres ou mais).`,
        liberados: [],
      };
    if (a.acao === 'bloquear' && !o.podeAutorizarExcecao)
      return {
        segue: false,
        codigo: 'limite-autorizacao',
        motivo: `${a.mensagem} A liberação precisa de quem tem a permissão de autorizar exceção no pedido de exame.`,
        liberados: [],
      };
    liberados.push(a);
  }
  if (acionados.some((a) => a.acao === 'alertar') && !o.confirmado)
    return {
      segue: false,
      codigo: 'limite-confirmar',
      motivo: 'Confirme os avisos do pedido antes de gravar.',
      liberados: [],
    };
  return { segue: true, codigo: null, motivo: null, liberados };
}

/** Confere o cadastro de uma cota antes de gravar (a tela valida na hora com a mesma regra). */
export function conferirCota(c: Omit<CotaExame, 'id'>): void {
  if (c.exame === null && c.setor === null)
    throw new RecusaLimite('cota-sem-alvo', 'Escolha o exame ou o setor executante da cota.');
  if (c.quantidadeMaxima === null && c.percentualLimite === null)
    throw new RecusaLimite('cota-sem-limite', 'Informe a quantidade máxima ou o percentual da cota.');
  if (c.percentualLimite !== null && c.fontePagadora === null)
    throw new RecusaLimite(
      'cota-percentual-sem-fonte',
      'O percentual da cota é a fatia de uma fonte pagadora.',
    );
  if (c.vigenciaFim !== null && c.vigenciaFim < c.vigenciaInicio)
    throw new RecusaLimite('vigencia-invalida', 'O fim da vigência é antes do início.');
}

/** Confere o intervalo antes de gravar. */
export function conferirIntervalo(r: Omit<IntervaloRepeticao, 'id'>): void {
  if (!r.mesmoDia && r.intervaloMinimoHoras <= 0)
    throw new RecusaLimite(
      'intervalo-sem-regra',
      'Marque "mesmo dia" ou informe o intervalo mínimo em horas.',
    );
  if (r.vigenciaFim !== null && r.vigenciaFim < r.vigenciaInicio)
    throw new RecusaLimite('vigencia-invalida', 'O fim da vigência é antes do início.');
}

/** Confere o bloqueio por resultado antes de gravar. */
export function conferirBloqueioPorResultado(r: Omit<BloqueioPorResultado, 'id'>): void {
  if (!Number.isSafeInteger(r.janelaDias) || r.janelaDias < 1)
    throw new RecusaLimite('janela-invalida', 'A janela do resultado precisa ser de 1 dia ou mais.');
  if (r.operador === 'entre') {
    const p = r.valor.split(';').map((x) => numero(x));
    if (p.length !== 2 || p.some((x) => x === null))
      throw new RecusaLimite('valor-invalido', 'No "entre", informe "mínimo;máximo" em números.');
  } else if (r.valor.trim() === '')
    throw new RecusaLimite('valor-invalido', 'Informe o valor de comparação.');
  if (['maior', 'maior_igual', 'menor', 'menor_igual'].includes(r.operador) && numero(r.valor) === null)
    throw new RecusaLimite('valor-invalido', 'A comparação de maior ou menor precisa de um número.');
}
