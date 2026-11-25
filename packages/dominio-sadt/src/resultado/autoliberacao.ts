// Autoliberação do resultado por regra e checagens de consistência (F8, 05-SADT linha 11). Regra pura: a gravação lê o
// cadastro, os resultados anteriores do paciente, as substâncias interferentes e os pontos da curva e só aplica o que
// esta regra decide. Prática de mercado (ISO 15189 e checklist CAP de autoverificação):
//   - desligada por padrão: sem regra ativa do exame no setor, o resultado segue para a liberação manual (nada muda);
//   - as travas vêm antes de qualquer regra: valor crítico, variação acima do limite contra o resultado anterior do
//     paciente (delta check), substância interferente que bloqueia e curva incompleta ou fora do tempo retêm o
//     resultado para conferência do responsável técnico, mesmo que uma regra o liberasse;
//   - as regras são avaliadas na ordem da prioridade; a primeira com todas as condições atendidas decide (liberar ou
//     reter); nenhuma atendida também retém (o sistema nunca libera por omissão).

export type TipoCondicaoAutoliberacao = 'faixa' | 'delta' | 'analito_relacionado' | 'idade' | 'sexo';
export const TIPOS_CONDICAO_AUTOLIBERACAO: readonly TipoCondicaoAutoliberacao[] = [
  'faixa',
  'delta',
  'analito_relacionado',
  'idade',
  'sexo',
];
export type OperadorCondicao = 'entre' | 'maior' | 'maior_igual' | 'menor' | 'menor_igual' | 'igual';

export interface CondicaoAutoliberacao {
  /** Tipo gravado no banco (o cadastro só aceita os de TIPOS_CONDICAO_AUTOLIBERACAO; outro tipo nunca é atendido). */
  readonly tipo: string;
  readonly analito: number | null;
  readonly operador: OperadorCondicao | null;
  readonly valor: string | null;
  readonly minimo: number | null;
  readonly maximo: number | null;
  readonly deltaPercentual: number | null;
  readonly deltaJanelaHoras: number | null;
}

export interface RegraAutoliberacao {
  readonly id: number;
  readonly acao: 'liberar' | 'reter';
  readonly prioridade: number;
  readonly condicoes: readonly CondicaoAutoliberacao[];
}

export interface LimiteDelta {
  readonly analito: number;
  readonly tipo: 'percentual' | 'absoluta';
  readonly variacaoMaxima: number;
  readonly janelaHoras: number;
  readonly acao: 'alertar' | 'reter_revisao' | 'bloquear_autoliberacao';
}

export interface ValorParaAutoliberacao {
  readonly analito: number;
  readonly numero: number | null;
  readonly critico: boolean;
}

/** O último resultado liberado do mesmo analito do paciente, antes deste. */
export interface ResultadoAnteriorAnalito {
  readonly analito: number;
  readonly numero: number;
  readonly em: Date;
}

export interface InterferentePresente {
  readonly substancia: string;
  readonly analito: number | null;
  readonly bloqueia: boolean;
}

export interface PontoPrevistoCurva {
  readonly sequencia: number;
  readonly tempoMinutos: number;
}
export interface PontoMedidoCurva {
  readonly sequencia: number;
  readonly numero: number | null;
  readonly coletadoEm: Date | null;
}
export interface CurvaDoExame {
  readonly previstos: readonly PontoPrevistoCurva[];
  readonly medidos: readonly PontoMedidoCurva[];
  /** Tolerância de atraso de cada ponto, em minutos (nula: só confere que todos os pontos têm valor). */
  readonly toleranciaMinutos: number | null;
}

export type MotivoRetencao =
  'critico' | 'delta' | 'interferente' | 'curva' | 'regra-reter' | 'sem-regra-atendida';

export const MENSAGEM_RETENCAO: Readonly<Record<MotivoRetencao, string>> = {
  critico: 'Valor crítico: a liberação é do responsável técnico, com o aviso ao assistente.',
  delta: 'Variação acima do limite contra o resultado anterior do paciente (delta check).',
  interferente: 'Substância interferente presente (medicamento em uso ou condição da amostra).',
  curva: 'Curva incompleta ou com coleta fora do tempo previsto.',
  'regra-reter': 'Uma regra de autoliberação manda reter este resultado para conferência.',
  'sem-regra-atendida': 'Nenhuma regra de autoliberação foi atendida: o resultado aguarda a conferência.',
};

export interface VariacaoDelta {
  readonly analito: number;
  readonly anterior: number;
  readonly atual: number;
  /** Variação no tipo do limite (percentual sobre o anterior ou valor absoluto). */
  readonly variacao: number;
  readonly acao: LimiteDelta['acao'];
}

/** Variação entre o valor atual e o anterior: percentual sobre o anterior (anterior zero: infinita, se mudou). */
export function variacaoEntre(atual: number, anterior: number, tipo: 'percentual' | 'absoluta'): number {
  const dif = Math.abs(atual - anterior);
  if (tipo === 'absoluta') return dif;
  if (anterior === 0) return dif === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (dif / Math.abs(anterior)) * 100;
}

const dentroDaJanela = (em: Date, agora: Date, horas: number) =>
  agora.getTime() - em.getTime() <= horas * 3_600_000 && em.getTime() <= agora.getTime();

/**
 * O delta check: para cada analito com limite e resultado anterior do paciente dentro da janela, a variação que passa
 * do máximo aceito. Sem anterior na janela, nada a comparar.
 */
export function conferirDelta(
  valores: readonly ValorParaAutoliberacao[],
  anteriores: readonly ResultadoAnteriorAnalito[],
  limites: readonly LimiteDelta[],
  agora: Date,
): VariacaoDelta[] {
  const fora: VariacaoDelta[] = [];
  for (const v of valores) {
    if (v.numero === null) continue;
    const limite = limites.find((l) => l.analito === v.analito);
    if (!limite) continue;
    const ant = anteriores
      .filter((a) => a.analito === v.analito && dentroDaJanela(a.em, agora, limite.janelaHoras))
      .sort((a, b) => b.em.getTime() - a.em.getTime())[0];
    if (!ant) continue;
    const variacao = variacaoEntre(v.numero, ant.numero, limite.tipo);
    if (variacao > limite.variacaoMaxima)
      fora.push({ analito: v.analito, anterior: ant.numero, atual: v.numero, variacao, acao: limite.acao });
  }
  return fora;
}

export type FalhaCurva = 'ponto-faltando' | 'tempo-fora' | 'ordem-invertida';

/**
 * A consistência da curva: todo ponto previsto tem valor; as coletas seguem a ordem dos pontos; e, com tolerância, o
 * intervalo de cada coleta contado da coleta do primeiro ponto não se afasta do tempo previsto mais do que ela.
 */
export function conferirCurva(c: CurvaDoExame): FalhaCurva | null {
  const previstos = [...c.previstos].sort((a, b) => a.sequencia - b.sequencia);
  const porSeq = new Map(c.medidos.map((m) => [m.sequencia, m]));
  for (const p of previstos) {
    const m = porSeq.get(p.sequencia);
    if (!m || m.numero === null) return 'ponto-faltando';
  }
  const coletas = previstos.map((p) => ({ p, em: porSeq.get(p.sequencia)!.coletadoEm }));
  for (let i = 1; i < coletas.length; i++) {
    const a = coletas[i - 1]!.em;
    const b = coletas[i]!.em;
    if (a && b && b.getTime() < a.getTime()) return 'ordem-invertida';
  }
  const zero = coletas[0];
  if (c.toleranciaMinutos !== null && zero?.em) {
    const base = zero.em.getTime() - zero.p.tempoMinutos * 60_000;
    for (const { p, em } of coletas) {
      if (!em) continue;
      const real = (em.getTime() - base) / 60_000;
      if (Math.abs(real - p.tempoMinutos) > c.toleranciaMinutos) return 'tempo-fora';
    }
  }
  return null;
}

export interface PacienteDaAutoliberacao {
  readonly idadeAnos: number | null;
  /** Sigla do sexo do cadastro (M, F...). */
  readonly sexo: string | null;
}

function comparar(numero: number, c: CondicaoAutoliberacao): boolean {
  const op = c.operador ?? 'entre';
  const ref = c.valor !== null && c.valor.trim() !== '' ? Number(c.valor) : null;
  switch (op) {
    case 'entre':
      return (c.minimo === null || numero >= c.minimo) && (c.maximo === null || numero <= c.maximo);
    case 'maior':
      return ref !== null && numero > ref;
    case 'maior_igual':
      return ref !== null && numero >= ref;
    case 'menor':
      return ref !== null && numero < ref;
    case 'menor_igual':
      return ref !== null && numero <= ref;
    case 'igual':
      return ref !== null && numero === ref;
    default:
      return false;
  }
}

/** Uma condição da regra contra o resultado, o anterior do paciente e o paciente. Tipo desconhecido: não atendida. */
export function condicaoAtendida(
  c: CondicaoAutoliberacao,
  valores: readonly ValorParaAutoliberacao[],
  anteriores: readonly ResultadoAnteriorAnalito[],
  paciente: PacienteDaAutoliberacao,
  agora: Date,
): boolean {
  const valorDo = (analito: number | null) =>
    analito === null ? null : (valores.find((v) => v.analito === analito)?.numero ?? null);
  switch (c.tipo) {
    case 'faixa':
    case 'analito_relacionado': {
      const v = valorDo(c.analito);
      return v !== null && comparar(v, c);
    }
    case 'delta': {
      const v = valorDo(c.analito);
      if (v === null || c.deltaPercentual === null) return false;
      const fora = conferirDelta(
        [{ analito: c.analito!, numero: v, critico: false }],
        anteriores,
        [
          {
            analito: c.analito!,
            tipo: 'percentual',
            variacaoMaxima: c.deltaPercentual,
            janelaHoras: c.deltaJanelaHoras ?? 24 * 365,
            acao: 'bloquear_autoliberacao',
          },
        ],
        agora,
      );
      return fora.length === 0;
    }
    case 'idade':
      return paciente.idadeAnos !== null && comparar(paciente.idadeAnos, c);
    case 'sexo':
      return (
        paciente.sexo !== null && (c.valor ?? '').trim().toUpperCase() === paciente.sexo.trim().toUpperCase()
      );
    default:
      return false;
  }
}

export interface EntradaAutoliberacao {
  readonly regras: readonly RegraAutoliberacao[];
  readonly valores: readonly ValorParaAutoliberacao[];
  readonly anteriores: readonly ResultadoAnteriorAnalito[];
  readonly limitesDelta: readonly LimiteDelta[];
  readonly interferentes: readonly InterferentePresente[];
  readonly curva: CurvaDoExame | null;
  readonly paciente: PacienteDaAutoliberacao;
  readonly agora: Date;
}

export interface DecisaoAutoliberacao {
  /** manual: sem regra ativa (desligada); liberar: liberado pela regra; reter: fila de conferência. */
  readonly decisao: 'manual' | 'liberar' | 'reter';
  readonly regra: number | null;
  readonly motivos: readonly MotivoRetencao[];
  /** Variações acima do limite (as de ação "alertar" só avisam; as outras retêm). */
  readonly deltas: readonly VariacaoDelta[];
  readonly falhaCurva: FalhaCurva | null;
  /** Substâncias interferentes presentes (as que não bloqueiam só avisam). */
  readonly interferentes: readonly string[];
}

/** A decisão da autoliberação: travas primeiro, depois a primeira regra atendida pela prioridade. */
export function decidirAutoliberacao(e: EntradaAutoliberacao): DecisaoAutoliberacao {
  const deltas = conferirDelta(e.valores, e.anteriores, e.limitesDelta, e.agora);
  const falhaCurva = e.curva ? conferirCurva(e.curva) : null;
  const analitos = new Set(e.valores.map((v) => v.analito));
  const presentes = e.interferentes.filter((i) => i.analito === null || analitos.has(i.analito));
  const base = { deltas, falhaCurva, interferentes: presentes.map((i) => i.substancia) };
  if (!e.regras.length) return { decisao: 'manual', regra: null, motivos: [], ...base };
  const motivos: MotivoRetencao[] = [];
  if (e.valores.some((v) => v.critico)) motivos.push('critico');
  if (deltas.some((d) => d.acao !== 'alertar')) motivos.push('delta');
  if (presentes.some((i) => i.bloqueia)) motivos.push('interferente');
  if (falhaCurva) motivos.push('curva');
  const ordem = [...e.regras].sort((a, b) => a.prioridade - b.prioridade || a.id - b.id);
  const atendida = ordem.find((r) =>
    r.condicoes.every((c) => condicaoAtendida(c, e.valores, e.anteriores, e.paciente, e.agora)),
  );
  if (!atendida) motivos.push('sem-regra-atendida');
  else if (atendida.acao === 'reter') motivos.push('regra-reter');
  if (motivos.length) return { decisao: 'reter', regra: atendida?.id ?? null, motivos, ...base };
  return { decisao: 'liberar', regra: atendida!.id, motivos: [], ...base };
}

export type RecusaRegraAutoliberacao =
  | 'regra-sem-condicao'
  | 'condicao-tipo'
  | 'condicao-sem-analito'
  | 'condicao-analito-fora'
  | 'condicao-faixa'
  | 'condicao-delta'
  | 'condicao-sexo'
  | 'vigencia-invertida';

export const MENSAGEM_REGRA_AUTOLIBERACAO: Readonly<Record<RecusaRegraAutoliberacao, string>> = {
  'regra-sem-condicao': 'A regra que libera precisa de ao menos uma condição de faixa do analito.',
  'condicao-tipo': 'Tipo de condição não aceito.',
  'condicao-sem-analito': 'A condição de faixa, analito relacionado ou delta precisa do analito.',
  'condicao-analito-fora': 'O analito da condição não faz parte do exame da regra.',
  'condicao-faixa': 'Informe a faixa (mínimo menor ou igual ao máximo) ou o operador com o valor numérico.',
  'condicao-delta': 'Informe a variação máxima em percentual (maior que zero) e a janela em horas.',
  'condicao-sexo': 'Informe a sigla do sexo da condição.',
  'vigencia-invertida': 'O fim da vigência não pode ser antes do início.',
};

/** O cadastro da regra, conferido na hora (antes de gravar). */
export function conferirRegraAutoliberacao(r: {
  readonly acao: 'liberar' | 'reter';
  readonly condicoes: readonly CondicaoAutoliberacao[];
  readonly analitosDoExame: readonly number[];
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}): RecusaRegraAutoliberacao | null {
  if (r.vigenciaFim !== null && r.vigenciaFim < r.vigenciaInicio) return 'vigencia-invertida';
  if (r.acao === 'liberar' && !r.condicoes.some((c) => c.tipo === 'faixa')) return 'regra-sem-condicao';
  for (const c of r.condicoes) {
    if (!(TIPOS_CONDICAO_AUTOLIBERACAO as readonly string[]).includes(c.tipo)) return 'condicao-tipo';
    if (c.tipo === 'faixa' || c.tipo === 'analito_relacionado' || c.tipo === 'delta') {
      if (c.analito === null) return 'condicao-sem-analito';
      if (!r.analitosDoExame.includes(c.analito)) return 'condicao-analito-fora';
    }
    if (c.tipo === 'faixa' || c.tipo === 'analito_relacionado' || c.tipo === 'idade') {
      const op = c.operador ?? 'entre';
      if (op === 'entre') {
        if (c.minimo === null && c.maximo === null) return 'condicao-faixa';
        if (c.minimo !== null && c.maximo !== null && c.minimo > c.maximo) return 'condicao-faixa';
      } else if (c.valor === null || !Number.isFinite(Number(c.valor)) || c.valor.trim() === '')
        return 'condicao-faixa';
    }
    if (
      c.tipo === 'delta' &&
      !(c.deltaPercentual !== null && c.deltaPercentual > 0 && (c.deltaJanelaHoras ?? 0) > 0)
    )
      return 'condicao-delta';
    if (c.tipo === 'sexo' && !(c.valor ?? '').trim()) return 'condicao-sexo';
  }
  return null;
}
