// Microbiologia estruturada (F7, 05-SADT linha 12): regras puras da cultura, do isolado e do antibiograma.
// - Interpretação pelo ponto de corte vigente (norma BrCAST/EUCAST ou CLSI): a concentração inibitória mínima (CIM) até
//   o limite de sensível é "sensível"; acima do limite de resistente é "resistente"; entre os dois, BrCAST e EUCAST dizem
//   "sensível aumentando a exposição" (aqui: sensivel_dose_dependente) e CLSI diz "intermediário". No disco-difusão, o
//   halo a partir do mínimo de sensível é "sensível" e até o máximo de resistente é "resistente".
// - O ponto de corte específico do material (ex.: liquor) vence o geral; fora da vigência não vale.
// - Só vale o ponto da norma do painel do isolado (BrCAST e CLSI convivem no cadastro com limites e faixa média
//   diferentes). Sem norma conhecida e com mais de uma norma vigente para o par, recusa: o painel decide.
// - Notificação à CCIH por regra: na cultura final, o isolado multirresistente (ou marcado por quem digita) entra na
//   fila de busca ativa sozinho; o contaminante provável não.
// - Liberação seletiva (cascata): o antimicrobiano de liberação restrita só aparece no laudo quando o isolado resiste a
//   algum de primeira linha do mesmo painel.
// - Multirresistência: resistência a um antimicrobiano marcado no painel, ou um marcador de resistência informado
//   (produtor de betalactamase de espectro estendido, de carbapenemase, resistente à meticilina ou à vancomicina).
// - A cultura final confere o crescimento com os isolados e exige a conclusão.

export type Interpretacao =
  'sensivel' | 'sensivel_dose_dependente' | 'intermediario' | 'resistente' | 'nao_testado';
export type MetodoSensibilidade = 'cim' | 'disco_difusao' | 'gradiente' | 'automatizado';
export type Crescimento =
  'em_andamento' | 'sem_crescimento' | 'com_crescimento' | 'contaminada' | 'flora_normal';

export class RecusaMicrobiologia extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface PontoCorte {
  readonly id: number;
  readonly microrganismo: number;
  readonly antimicrobiano: number;
  /** Nulo vale para qualquer material. */
  readonly material: number | null;
  readonly metodo: 'concentracao_inibitoria' | 'disco_difusao';
  readonly norma: string;
  readonly sensivelAte: number | null;
  readonly resistenteAcima: number | null;
  readonly haloSensivelMinimo: number | null;
  readonly haloResistenteMaximo: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

/** O método do teste traduzido para o do ponto de corte (gradiente e automatizado medem CIM). */
export const metodoDoPonto = (m: MetodoSensibilidade): PontoCorte['metodo'] =>
  m === 'disco_difusao' ? 'disco_difusao' : 'concentracao_inibitoria';

const mesmaNorma = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * O ponto de corte vigente na data, na norma do painel: o do material vence o geral; entre iguais, o de vigência mais
 * recente (a versão vigente da norma). Sem norma e com duas normas vigentes para o par, recusa.
 */
export function pontoDeCorteVigente(
  pontos: readonly PontoCorte[],
  alvo: {
    readonly microrganismo: number;
    readonly antimicrobiano: number;
    readonly material: number | null;
    readonly metodo: MetodoSensibilidade;
    readonly data: string;
    /** Norma do painel do isolado (BrCAST, CLSI, EUCAST); nula quando o isolado não tem painel. */
    readonly norma?: string | null;
  },
): PontoCorte | null {
  const metodo = metodoDoPonto(alvo.metodo);
  const norma = alvo.norma?.trim() || null;
  const validos = pontos.filter(
    (p) =>
      p.ativo &&
      p.microrganismo === alvo.microrganismo &&
      p.antimicrobiano === alvo.antimicrobiano &&
      p.metodo === metodo &&
      (p.material === null || p.material === alvo.material) &&
      p.vigenciaInicio <= alvo.data &&
      (p.vigenciaFim === null || p.vigenciaFim >= alvo.data) &&
      (norma === null || mesmaNorma(p.norma, norma)),
  );
  if (norma === null && new Set(validos.map((p) => p.norma.trim().toLowerCase())).size > 1)
    throw new RecusaMicrobiologia(
      'norma-indefinida',
      'Há pontos de corte de mais de uma norma para o antimicrobiano: informe o painel do isolado.',
    );
  validos.sort(
    (a, b) =>
      Number(b.material !== null) - Number(a.material !== null) ||
      b.vigenciaInicio.localeCompare(a.vigenciaInicio),
  );
  return validos[0] ?? null;
}

const faixaMedia = (norma: string): Interpretacao =>
  /clsi/i.test(norma) ? 'intermediario' : 'sensivel_dose_dependente';

/** Interpretação da medida pelo ponto de corte; nulo quando o ponto não cobre a medida informada. */
export function interpretar(
  ponto: PontoCorte,
  medida: { readonly cim: number | null; readonly halo: number | null },
): Interpretacao | null {
  if (ponto.metodo === 'concentracao_inibitoria') {
    if (medida.cim === null) return null;
    if (ponto.sensivelAte !== null && medida.cim <= ponto.sensivelAte) return 'sensivel';
    if (ponto.resistenteAcima !== null && medida.cim > ponto.resistenteAcima) return 'resistente';
    if (ponto.sensivelAte === null || ponto.resistenteAcima === null)
      return ponto.sensivelAte === null ? 'sensivel' : 'resistente';
    return faixaMedia(ponto.norma);
  }
  if (medida.halo === null) return null;
  if (ponto.haloSensivelMinimo !== null && medida.halo >= ponto.haloSensivelMinimo) return 'sensivel';
  if (ponto.haloResistenteMaximo !== null && medida.halo <= ponto.haloResistenteMaximo) return 'resistente';
  if (ponto.haloSensivelMinimo === null || ponto.haloResistenteMaximo === null)
    return ponto.haloSensivelMinimo === null ? 'sensivel' : 'resistente';
  return faixaMedia(ponto.norma);
}

export interface TesteInformado {
  readonly antimicrobiano: number;
  readonly metodo: MetodoSensibilidade;
  readonly cim: number | null;
  readonly halo: number | null;
  /** Só vale sem ponto de corte vigente (o ponto, quando existe, decide). */
  readonly interpretacao: Interpretacao | null;
}

export interface TesteInterpretado extends TesteInformado {
  readonly interpretacao: Interpretacao;
  readonly ponto: number | null;
  /** Verdadeiro quando a interpretação veio do ponto de corte. */
  readonly pelaRegra: boolean;
}

/** Interpreta cada teste do isolado: pelo ponto de corte vigente ou, sem ele, pela leitura informada (obrigatória). */
export function interpretarAntibiograma(
  testes: readonly TesteInformado[],
  pontos: readonly PontoCorte[],
  alvo: {
    readonly microrganismo: number;
    readonly material: number | null;
    readonly data: string;
    readonly norma?: string | null;
  },
): TesteInterpretado[] {
  const vistos = new Set<number>();
  return testes.map((t) => {
    if (vistos.has(t.antimicrobiano))
      throw new RecusaMicrobiologia(
        'antimicrobiano-repetido',
        'O antimicrobiano aparece duas vezes no isolado.',
      );
    vistos.add(t.antimicrobiano);
    if ((t.cim !== null && t.cim < 0) || (t.halo !== null && t.halo < 0))
      throw new RecusaMicrobiologia('medida-invalida', 'A medida não pode ser negativa.');
    if (t.metodo === 'disco_difusao' ? t.cim !== null : t.halo !== null)
      throw new RecusaMicrobiologia(
        'medida-do-metodo',
        'Informe o halo no disco-difusão e a concentração inibitória mínima nos demais métodos.',
      );
    const ponto = pontoDeCorteVigente(pontos, {
      ...alvo,
      antimicrobiano: t.antimicrobiano,
      metodo: t.metodo,
    });
    const pela = ponto ? interpretar(ponto, t) : null;
    if (pela) return { ...t, interpretacao: pela, ponto: ponto!.id, pelaRegra: true };
    if (!t.interpretacao)
      throw new RecusaMicrobiologia(
        'interpretacao-obrigatoria',
        'Sem ponto de corte vigente para a medida, informe a interpretação.',
      );
    return { ...t, interpretacao: t.interpretacao, ponto: null, pelaRegra: false };
  });
}

export interface ItemPainel {
  readonly antimicrobiano: number;
  readonly exibeNoLaudo: boolean;
  readonly liberacaoRestrita: boolean;
  readonly indicaMultirresistencia: boolean;
}

/** Os antimicrobianos que aparecem no laudo (cascata): o restrito só quando há resistência a um de primeira linha. */
export function exibidosNoLaudo(
  testes: readonly Pick<TesteInterpretado, 'antimicrobiano' | 'interpretacao'>[],
  painel: readonly ItemPainel[],
): Set<number> {
  const doPainel = new Map(painel.map((i) => [i.antimicrobiano, i]));
  const resisteAPrimeiraLinha = testes.some((t) => {
    const i = doPainel.get(t.antimicrobiano);
    return t.interpretacao === 'resistente' && (!i || !i.liberacaoRestrita);
  });
  const r = new Set<number>();
  for (const t of testes) {
    if (t.interpretacao === 'nao_testado') continue;
    const i = doPainel.get(t.antimicrobiano);
    if (!i) r.add(t.antimicrobiano);
    else if (i.exibeNoLaudo && (!i.liberacaoRestrita || resisteAPrimeiraLinha)) r.add(t.antimicrobiano);
  }
  return r;
}

export interface MarcadoresResistencia {
  readonly betalactamaseEspectroEstendido: boolean;
  readonly carbapenemase: boolean;
  readonly resistenteMeticilina: boolean;
  readonly resistenteVancomicina: boolean;
}

/** Multirresistente: resistência a antimicrobiano marcado no painel ou um marcador de resistência informado. */
export function multirresistente(
  testes: readonly Pick<TesteInterpretado, 'antimicrobiano' | 'interpretacao'>[],
  painel: readonly ItemPainel[],
  marcadores: MarcadoresResistencia,
): boolean {
  if (
    marcadores.betalactamaseEspectroEstendido ||
    marcadores.carbapenemase ||
    marcadores.resistenteMeticilina ||
    marcadores.resistenteVancomicina
  )
    return true;
  const marcados = new Set(painel.filter((i) => i.indicaMultirresistencia).map((i) => i.antimicrobiano));
  return testes.some((t) => t.interpretacao === 'resistente' && marcados.has(t.antimicrobiano));
}

/**
 * O isolado vai à CCIH (fila de busca ativa) quando a cultura é final e ele é multirresistente ou marcado por quem
 * digita; o contaminante provável nunca vai.
 */
export function notificaControleInfeccao(i: {
  readonly culturaFinal: boolean;
  readonly multirresistente: boolean;
  readonly marcadoManual: boolean;
  readonly contaminanteProvavel: boolean;
}): boolean {
  return i.culturaFinal && !i.contaminanteProvavel && (i.multirresistente || i.marcadoManual);
}

/** Confere a cultura antes de gravar: crescimento coerente com os isolados e a cultura final com conclusão. */
export function conferirCultura(c: {
  readonly crescimento: Crescimento;
  readonly isolados: number;
  readonly final: boolean;
  readonly conclusao: string | null;
  readonly sequencias: readonly number[];
}): void {
  if (new Set(c.sequencias).size !== c.sequencias.length)
    throw new RecusaMicrobiologia('isolado-repetido', 'Dois isolados com a mesma ordem na cultura.');
  if ((c.crescimento === 'sem_crescimento' || c.crescimento === 'em_andamento') && c.isolados > 0)
    throw new RecusaMicrobiologia(
      'isolado-sem-crescimento',
      'Cultura sem crescimento (ou em andamento) não tem isolado.',
    );
  if (c.crescimento === 'com_crescimento' && c.isolados === 0 && c.final)
    throw new RecusaMicrobiologia(
      'crescimento-sem-isolado',
      'Cultura com crescimento precisa de ao menos um isolado.',
    );
  if (c.final && c.crescimento === 'em_andamento')
    throw new RecusaMicrobiologia('cultura-em-andamento', 'A cultura em andamento ainda não pode ser final.');
  if (c.final && !c.conclusao?.trim())
    throw new RecusaMicrobiologia('conclusao-obrigatoria', 'A cultura final precisa da conclusão.');
}

const ROTULO: Record<Interpretacao, string> = {
  sensivel: 'Sensível',
  sensivel_dose_dependente: 'Sensível, aumentando a exposição',
  intermediario: 'Intermediário',
  resistente: 'Resistente',
  nao_testado: 'Não testado',
};
const CRESCIMENTO: Record<Crescimento, string> = {
  em_andamento: 'Em andamento',
  sem_crescimento: 'Sem crescimento',
  com_crescimento: 'Com crescimento',
  contaminada: 'Contaminada',
  flora_normal: 'Flora normal',
};

export interface CulturaParaLaudo {
  readonly material: string;
  readonly crescimento: Crescimento;
  readonly contagemColonias: string | null;
  readonly conclusao: string | null;
  readonly situacao: string;
  readonly isolados: readonly {
    readonly sequencia: number;
    readonly microrganismo: string;
    readonly contagem: string | null;
    readonly multirresistente: boolean;
    readonly testes: readonly {
      readonly antimicrobiano: string;
      readonly medida: string | null;
      readonly interpretacao: Interpretacao;
      readonly exibeNoLaudo: boolean;
    }[];
  }[];
}

/** O texto do laudo da cultura: material, crescimento, cada isolado com o antibiograma liberado e a conclusão. */
export function laudoDaCultura(c: CulturaParaLaudo): string {
  const l: string[] = [`Material: ${c.material}`, `Crescimento: ${CRESCIMENTO[c.crescimento]}`];
  if (c.contagemColonias) l.push(`Contagem de colônias: ${c.contagemColonias}`);
  for (const i of c.isolados) {
    l.push('', `Isolado ${i.sequencia}: ${i.microrganismo}${i.contagem ? ` (${i.contagem})` : ''}`);
    if (i.multirresistente) l.push('Microrganismo multirresistente: aplicar precaução de contato.');
    for (const t of i.testes.filter((x) => x.exibeNoLaudo))
      l.push(`  ${t.antimicrobiano}: ${ROTULO[t.interpretacao]}${t.medida ? ` (${t.medida})` : ''}`);
  }
  if (c.conclusao) l.push('', `Conclusão: ${c.conclusao}`);
  if (c.situacao !== 'final' && c.situacao !== 'retificado') l.push('', 'Resultado parcial.');
  return l.join('\n');
}
