// Conferência do item da prescrição antes de gravar, por tipo (03-PEP L105): o que a tela já valida na hora e o
// servidor repete. Regra pura, sem banco: a porta própria só traduz a recusa em 422. Ventilação, dieta, solução em
// etapas e "se necessário" têm aqui a sua coerência clínica; o cadastro (existência dos ids, via aérea invasiva, modo
// controlado, categoria do tipo de item) é lido pelo adaptador e conferido aqui pelas funções de cadastro.
//
// Sem sentinela: parâmetro não prescrito chega nulo e fica nulo no banco (nada de 0 ou de tempo fixo inventado).

export type ClasseDieta = 'jejum' | 'livre' | 'oral' | 'enteral';

export interface EtapaGravavel {
  readonly etapa: number;
  /** AAAA-MM-DDTHH:MM civil do estabelecimento. */
  readonly inicio: string;
  readonly fim: string;
  readonly velocidade: number;
  readonly unidadeInfusao: number;
  readonly volume: number;
}

export type DetalheGravavel =
  | {
      readonly tipo: 'medicamento';
      readonly dose: number;
      readonly seNecessario: readonly number[];
      /** Intervalo mínimo entre doses do "se necessário", em minutos. */
      readonly intervaloMinimoMinutos?: number | null;
      /** Dose máxima no período (horas) do "se necessário". */
      readonly doseMaxima?: { readonly dose: number; readonly periodoHoras: number } | null;
    }
  | {
      readonly tipo: 'dieta';
      readonly classe: ClasseDieta;
      readonly quantidade: number | null;
      readonly velocidade: number | null;
      readonly unidadeInfusao: number | null;
      readonly caracteristicas: readonly { readonly caracteristica: number; readonly resposta: string }[];
      /** Composição por refeição (alimento e quantidade em cada refeição do dia; 03-PEP L112). */
      readonly refeicoes?: readonly RefeicaoDietaGravavel[];
    }
  | {
      readonly tipo: 'solucao';
      readonly componentes: readonly {
        readonly dose: number;
        readonly principal: boolean;
        readonly etapa: number;
      }[];
      readonly etapas: readonly EtapaGravavel[];
    }
  | {
      readonly tipo: 'vmi';
      readonly frequenciaRespiratoria: number | null;
      readonly peep: number | null;
      readonly volumeCorrente: number | null;
      readonly pressao: number | null;
      readonly tempoInspiratorio: number | null;
      readonly tempoExpiratorio: number | null;
      readonly fio2: number | null;
    }
  | {
      readonly tipo: 'vni';
      readonly pressaoInspiratoria: number | null;
      readonly pressaoExpiratoria: number | null;
      readonly pressaoSuporte: number | null;
      readonly duracaoMinutos: number | null;
      readonly fio2: number | null;
    }
  | { readonly tipo: string };

/** O que a conferência precisa além do detalhe: quantos horários fixos vêm e a vigência do item (civil). */
export interface ContextoItemGravavel {
  readonly horarios?: number;
  readonly vigencia?: { readonly inicio: string; readonly fim: string } | null;
  /** mL/h por unidade de velocidade da etapa (null: unidade sem conversão conhecida, sem conferência de volume). */
  readonly mlPorHora?: (unidadeInfusao: number) => number | null;
}

export type RecusaItemGravavel =
  | 'dose-invalida'
  | 'se-necessario-repetido'
  | 'se-necessario-sem-intervalo'
  | 'se-necessario-com-horario'
  | 'se-necessario-dose-maxima-invalida'
  | 'se-necessario-sem-condicao'
  | 'dieta-quantidade-invalida'
  | 'dieta-quantidade-indevida'
  | 'dieta-velocidade-sem-unidade'
  | 'dieta-velocidade-indevida'
  | 'dieta-caracteristica-repetida'
  | 'dieta-refeicao-indevida'
  | 'dieta-refeicao-repetida'
  | 'dieta-refeicao-medida-caseira'
  | 'dieta-refeicao-substituto-invalido'
  | 'dieta-refeicao-percentual-acima'
  | 'solucao-sem-principal'
  | 'solucao-etapa-repetida'
  | 'solucao-componente-sem-etapa'
  | 'solucao-etapa-sem-componente'
  | 'solucao-etapa-fim-antes-inicio'
  | 'solucao-etapa-invalida'
  | 'solucao-etapa-sobreposta'
  | 'solucao-etapa-fora-da-vigencia'
  | 'solucao-volume-incoerente'
  | 'ventilacao-fio2-fora-da-faixa'
  | 'ventilacao-parametro-invalido'
  | 'ventilacao-sem-alvo'
  | 'ventilacao-fr-obrigatoria'
  | 'ventilacao-sem-pressao'
  | 'ventilacao-ipap-menor-epap'
  | 'ventilacao-via-incoerente'
  | 'tipo-item-incoerente';

export const MENSAGENS_ITEM_GRAVAVEL: Readonly<Record<RecusaItemGravavel, string>> = {
  'dose-invalida': 'A dose do medicamento tem de ser maior que zero.',
  'se-necessario-repetido': 'A mesma condição de "se necessário" foi informada duas vezes.',
  'se-necessario-sem-intervalo': 'O "se necessário" precisa do intervalo mínimo entre as doses.',
  'se-necessario-com-horario':
    'Item "se necessário" não tem horário fixo: a dose é registrada quando a condição ocorre.',
  'se-necessario-dose-maxima-invalida':
    'A dose máxima do "se necessário" tem de cobrir ao menos uma dose, num período de 1 a 72 horas.',
  'se-necessario-sem-condicao': 'Intervalo mínimo e dose máxima só valem com a condição de "se necessário".',
  'dieta-quantidade-invalida': 'A dieta oral medida e a enteral precisam da quantidade, maior que zero.',
  'dieta-quantidade-indevida': 'Jejum e dieta livre não têm quantidade.',
  'dieta-velocidade-sem-unidade': 'Informe a unidade da velocidade de infusão da dieta.',
  'dieta-velocidade-indevida': 'Só a dieta enteral tem velocidade de infusão.',
  'dieta-caracteristica-repetida': 'A mesma característica da dieta foi informada duas vezes.',
  'dieta-refeicao-indevida': 'Jejum e dieta enteral não têm composição por refeição.',
  'dieta-refeicao-repetida': 'O mesmo alimento foi informado duas vezes na mesma refeição.',
  'dieta-refeicao-medida-caseira':
    'A medida caseira e a quantidade dela vão juntas, com a quantidade maior que zero.',
  'dieta-refeicao-substituto-invalido':
    'O substituto aponta para um alimento anterior da mesma refeição que não é ele próprio substituto.',
  'dieta-refeicao-percentual-acima': 'A soma da parte das calorias do dia nas refeições passa de 100%.',
  'solucao-sem-principal': 'A solução precisa de um componente principal (a base, como o soro).',
  'solucao-etapa-repetida': 'O número da etapa da solução se repete.',
  'solucao-componente-sem-etapa': 'Há componente ligado a uma etapa que não foi descrita.',
  'solucao-etapa-sem-componente': 'Há etapa da solução sem nenhum componente.',
  'solucao-etapa-fim-antes-inicio': 'O fim da etapa tem de ser depois do início.',
  'solucao-etapa-invalida': 'Volume, velocidade e dose de cada etapa têm de ser maiores que zero.',
  'solucao-etapa-sobreposta': 'As etapas da solução não podem se sobrepor no tempo.',
  'solucao-etapa-fora-da-vigencia': 'As etapas da solução têm de caber na vigência do item.',
  'solucao-volume-incoerente':
    'O volume da etapa não confere com a velocidade e a duração (volume = velocidade × tempo).',
  'ventilacao-fio2-fora-da-faixa': 'A fração inspirada de oxigênio vai de 21% a 100%.',
  'ventilacao-parametro-invalido':
    'Parâmetro ventilatório fora da faixa clínica (FR 4 a 60, PEEP 3 a 30, VC 20 a 1.500 mL, pressão controlada 5 a 50, IPAP 4 a 40, EPAP 3 a 25, pressão de suporte 1 a 30, tempos de 0,2 a 10 s, sessão até 24 h).',
  'ventilacao-sem-alvo': 'A ventilação invasiva precisa do volume corrente ou da pressão controlada.',
  'ventilacao-fr-obrigatoria': 'Em modo controlado, informe a frequência respiratória.',
  'ventilacao-sem-pressao': 'A ventilação não invasiva precisa do EPAP (CPAP) ou do IPAP.',
  'ventilacao-ipap-menor-epap': 'O IPAP tem de ser maior que o EPAP.',
  'ventilacao-via-incoerente':
    'A via aérea não combina com a modalidade (invasiva pede tubo ou traqueostomia; não invasiva, máscara).',
  'tipo-item-incoerente':
    'O tipo do item não combina com o que foi prescrito (ex.: dieta em tipo de medicamento).',
};

const repetido = (xs: readonly number[]) => new Set(xs).size !== xs.length;

/** Um alimento numa refeição do dia; `substitui` é a posição (1..n) do alimento anterior que ele pode trocar. */
export interface RefeicaoDietaGravavel {
  readonly refeicao: number;
  readonly alimento: number;
  readonly quantidade: number;
  readonly medidaCaseira: number | null;
  readonly quantidadeMedidaCaseira: number | null;
  readonly substitui: number | null;
  readonly percentualDiario: number | null;
}

/**
 * Composição da dieta por refeição (03-PEP L112): só a dieta oral e a livre têm refeições; quantidade positiva; o
 * mesmo alimento não se repete na refeição (o substituto é a alternativa declarada, apontando um alimento anterior da
 * mesma refeição que não é ele próprio substituto); medida caseira com a quantidade dela; parte das calorias do dia
 * somando até 100% (os substitutos não somam: trocam o titular).
 */
export function conferirRefeicoesDieta(
  classe: ClasseDieta,
  refeicoes: readonly RefeicaoDietaGravavel[],
): RecusaItemGravavel | null {
  if (refeicoes.length === 0) return null;
  if (classe === 'jejum' || classe === 'enteral') return 'dieta-refeicao-indevida';
  const titulares = new Set<string>();
  let percentual = 0;
  for (const [i, r] of refeicoes.entries()) {
    if (!(r.quantidade > 0)) return 'dieta-quantidade-invalida';
    if ((r.medidaCaseira === null) !== (r.quantidadeMedidaCaseira === null))
      return 'dieta-refeicao-medida-caseira';
    if (r.quantidadeMedidaCaseira !== null && !(r.quantidadeMedidaCaseira > 0))
      return 'dieta-refeicao-medida-caseira';
    if (r.substitui !== null) {
      const alvo = r.substitui >= 1 && r.substitui <= i ? refeicoes[r.substitui - 1] : undefined;
      if (!alvo || alvo.substitui !== null || alvo.refeicao !== r.refeicao || alvo.alimento === r.alimento)
        return 'dieta-refeicao-substituto-invalido';
      continue;
    }
    const chave = `${r.refeicao}:${r.alimento}`;
    if (titulares.has(chave)) return 'dieta-refeicao-repetida';
    titulares.add(chave);
    percentual += r.percentualDiario ?? 0;
  }
  return percentual > 100 + 1e-9 ? 'dieta-refeicao-percentual-acima' : null;
}
const fio2Ok = (f: number | null) => f === null || (f >= 21 && f <= 100);
/** Valor opcional: nulo passa; informado tem de estar na faixa. */
const faixa = (v: number | null, min: number, max: number) => v === null || (v >= min && v <= max);

/** Minutos desde 1970 de um AAAA-MM-DDTHH:MM civil (só para diferenças, sem fuso). */
export function minutosCivis(civil: string): number {
  return Math.round(Date.parse(`${civil}:00Z`) / 60_000);
}

/** mL/h por unidade da velocidade, pela sigla do cadastro (mL/h, gotas/min, microgotas/min); null se desconhecida. */
export function mlPorHoraDaSigla(sigla: string | null | undefined): number | null {
  const s = (sigla ?? '').toLowerCase().replace(/\s+/g, '');
  if (/^ml\/h/.test(s)) return 1;
  if (/^(mgt|mgts|mcgt|microgotas?)\/min/.test(s)) return 1;
  if (/^(gt|gts|gotas?)\/min/.test(s)) return 3;
  return null;
}

/** Tolerância da conferência volume × velocidade × tempo: 5% ou 2 mL (arredondamento da velocidade). */
const volumeConfere = (volume: number, mlh: number, minutos: number) =>
  Math.abs(volume - (mlh * minutos) / 60) <= Math.max(2, volume * 0.05);

function conferirSolucao(
  s: Extract<DetalheGravavel, { tipo: 'solucao' }>,
  c: ContextoItemGravavel,
): RecusaItemGravavel | null {
  if (!s.componentes.some((x) => x.principal)) return 'solucao-sem-principal';
  const numeros = s.etapas.map((e) => e.etapa);
  if (repetido(numeros)) return 'solucao-etapa-repetida';
  if (s.componentes.some((x) => !numeros.includes(x.etapa))) return 'solucao-componente-sem-etapa';
  if (numeros.some((n) => !s.componentes.some((x) => x.etapa === n))) return 'solucao-etapa-sem-componente';
  if (s.etapas.some((e) => !(e.fim > e.inicio))) return 'solucao-etapa-fim-antes-inicio';
  if (s.etapas.some((e) => !(e.volume > 0 && e.velocidade > 0)) || s.componentes.some((x) => !(x.dose > 0)))
    return 'solucao-etapa-invalida';
  const ordem = [...s.etapas].sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
  for (let k = 1; k < ordem.length; k++)
    if (ordem[k]!.inicio < ordem[k - 1]!.fim) return 'solucao-etapa-sobreposta';
  const v = c.vigencia;
  if (v && s.etapas.some((e) => e.inicio < v.inicio || e.fim > v.fim))
    return 'solucao-etapa-fora-da-vigencia';
  if (c.mlPorHora)
    for (const e of s.etapas) {
      const fator = c.mlPorHora(e.unidadeInfusao);
      if (fator === null) continue;
      const minutos = minutosCivis(e.fim) - minutosCivis(e.inicio);
      if (!volumeConfere(e.volume, e.velocidade * fator, minutos)) return 'solucao-volume-incoerente';
    }
  return null;
}

/** A primeira incoerência do item (ou null). Datas das etapas em AAAA-MM-DDTHH:MM civil, comparáveis como texto. */
export function conferirItemGravavel(
  d: DetalheGravavel,
  c: ContextoItemGravavel = {},
): RecusaItemGravavel | null {
  switch (d.tipo) {
    case 'medicamento': {
      const m = d as Extract<DetalheGravavel, { tipo: 'medicamento' }>;
      if (!(m.dose > 0)) return 'dose-invalida';
      if (repetido(m.seNecessario)) return 'se-necessario-repetido';
      const intervalo = m.intervaloMinimoMinutos ?? null;
      const maxima = m.doseMaxima ?? null;
      if (m.seNecessario.length === 0)
        return intervalo !== null || maxima !== null ? 'se-necessario-sem-condicao' : null;
      if (!(intervalo !== null && intervalo > 0 && intervalo <= 48 * 60))
        return 'se-necessario-sem-intervalo';
      if ((c.horarios ?? 0) > 0) return 'se-necessario-com-horario';
      if (maxima && !(maxima.dose >= m.dose && maxima.periodoHoras >= 1 && maxima.periodoHoras <= 72))
        return 'se-necessario-dose-maxima-invalida';
      return null;
    }
    case 'dieta': {
      const x = d as Extract<DetalheGravavel, { tipo: 'dieta' }>;
      const medida = x.classe === 'oral' || x.classe === 'enteral';
      if (medida && !(x.quantidade !== null && x.quantidade > 0)) return 'dieta-quantidade-invalida';
      if (!medida && x.quantidade !== null) return 'dieta-quantidade-indevida';
      if (x.velocidade !== null && x.classe !== 'enteral') return 'dieta-velocidade-indevida';
      if (x.velocidade !== null && x.unidadeInfusao === null) return 'dieta-velocidade-sem-unidade';
      if (repetido(x.caracteristicas.map((k) => k.caracteristica))) return 'dieta-caracteristica-repetida';
      return conferirRefeicoesDieta(x.classe, x.refeicoes ?? []);
    }
    case 'solucao':
      return conferirSolucao(d as Extract<DetalheGravavel, { tipo: 'solucao' }>, c);
    case 'vmi': {
      const v = d as Extract<DetalheGravavel, { tipo: 'vmi' }>;
      if (!fio2Ok(v.fio2)) return 'ventilacao-fio2-fora-da-faixa';
      if (
        !faixa(v.frequenciaRespiratoria, 4, 60) ||
        !faixa(v.peep, 3, 30) ||
        !faixa(v.volumeCorrente, 20, 1_500) ||
        !faixa(v.pressao, 5, 50) ||
        !faixa(v.tempoInspiratorio, 0.2, 5) ||
        !faixa(v.tempoExpiratorio, 0.2, 10)
      )
        return 'ventilacao-parametro-invalido';
      if (v.volumeCorrente === null && v.pressao === null) return 'ventilacao-sem-alvo';
      return null;
    }
    case 'vni': {
      const v = d as Extract<DetalheGravavel, { tipo: 'vni' }>;
      if (!fio2Ok(v.fio2)) return 'ventilacao-fio2-fora-da-faixa';
      if (
        !faixa(v.pressaoInspiratoria, 4, 40) ||
        !faixa(v.pressaoExpiratoria, 3, 25) ||
        !faixa(v.pressaoSuporte, 1, 30) ||
        !faixa(v.duracaoMinutos, 1, 1_440)
      )
        return 'ventilacao-parametro-invalido';
      if (v.pressaoInspiratoria === null && v.pressaoExpiratoria === null) return 'ventilacao-sem-pressao';
      if (
        v.pressaoInspiratoria !== null &&
        v.pressaoExpiratoria !== null &&
        !(v.pressaoInspiratoria > v.pressaoExpiratoria)
      )
        return 'ventilacao-ipap-menor-epap';
      return null;
    }
    default:
      return null;
  }
}

/**
 * Coerência da ventilação com o cadastro: VMI só por via aérea invasiva e VNI só por não invasiva; em modo
 * controlado a frequência respiratória é obrigatória (VMI).
 */
export function conferirVentilacaoNoCadastro(
  d: { readonly tipo: 'vmi' | 'vni'; readonly frequenciaRespiratoria?: number | null },
  cadastro: { readonly viaInvasiva: boolean; readonly modoControlado: boolean },
): RecusaItemGravavel | null {
  if ((d.tipo === 'vmi') !== cadastro.viaInvasiva) return 'ventilacao-via-incoerente';
  if (d.tipo === 'vmi' && cadastro.modoControlado && (d.frequenciaRespiratoria ?? null) === null)
    return 'ventilacao-fr-obrigatoria';
  return null;
}

/** Categoria do tipo de item (cadastro) que cada detalhe aceita. */
const CATEGORIAS_DO_DETALHE: Readonly<Record<string, readonly string[]>> = {
  medicamento: ['medicamento'],
  dieta: ['dieta'],
  solucao: ['solucao'],
  vmi: ['ventilacao'],
  vni: ['ventilacao'],
  hemoterapia: ['hemocomponente'],
  procedimento: ['procedimento', 'cuidado'],
};

/** O tipo de lançamento (plano do legado ou tipo próprio) tem de casar com o detalhe prescrito. */
export function conferirCategoriaDoDetalhe(
  categoria: string,
  tipoDetalhe: string,
): RecusaItemGravavel | null {
  return (CATEGORIAS_DO_DETALHE[tipoDetalhe] ?? []).includes(categoria) ? null : 'tipo-item-incoerente';
}
