// Contabilidade regulatória da operadora (08-SGO L111, C3-026; F7): o plano de contas padrão da ANS (RN ANS 528/2022,
// com vigência e modalidades), o mapa das contas contábeis próprias para ele, o balancete no padrão da ANS que alimenta
// o DIOPS e o cálculo mensal das provisões técnicas.
// Decisão de produto (classe C, como o mercado): o sistema calcula a PEONA pela metodologia da ANS (RN ANS 574/2023: a
// maior entre 8,5% das contraprestações emitidas dos últimos 12 meses e 10% dos eventos indenizáveis conhecidos no
// mesmo período) e a PESL pelos eventos avisados e não pagos; quando a operadora tem nota técnica atuarial aprovada, o
// valor é parâmetro informado pelo atuário, com a referência da nota. Remissão, PIC e PPCNG entram informados.
// Tudo em centavos; a memória do cálculo leva as parcelas de cada conta.

export const TIPOS_PROVISAO_TECNICA = [
  'peona',
  'peona_sus',
  'pesl',
  'pesl_sus',
  'ppcng',
  'pic',
  'remissao',
  'outra',
] as const;
export type TipoProvisaoTecnica = (typeof TIPOS_PROVISAO_TECNICA)[number];
export const METODOS_PROVISAO_TECNICA = ['metodologia_ans', 'nota_tecnica_atuarial'] as const;
export type MetodoProvisaoTecnica = (typeof METODOS_PROVISAO_TECNICA)[number];
export type SituacaoProvisaoTecnica = 'aberta' | 'calculada' | 'contabilizada' | 'cancelada';
export const MODALIDADES_OPERADORA = [
  'autogestao',
  'cooperativa_medica',
  'cooperativa_odontologica',
  'filantropia',
  'medicina_grupo',
  'odontologia_grupo',
  'seguradora',
  'administradora_beneficios',
] as const;

/** Percentuais da metodologia da ANS para a PEONA (RN ANS 574/2023, anexo). */
export const PEONA_PERCENTUAL_CONTRAPRESTACOES = 8.5;
export const PEONA_PERCENTUAL_EVENTOS = 10;

export interface ProblemaProvisaoTecnica {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}
const prob = (codigo: string, campo: string, detalhe: string): ProblemaProvisaoTecnica => ({
  codigo,
  campo,
  detalhe,
});

const sobrepoe = (a: { inicio: string; fim: string | null }, b: { inicio: string; fim: string | null }) =>
  (a.fim === null || a.fim >= b.inicio) && (b.fim === null || b.fim >= a.inicio);
const vigente = (c: { vigenciaInicio: string; vigenciaFim: string | null }, dia: string) =>
  c.vigenciaInicio <= dia && (c.vigenciaFim === null || c.vigenciaFim >= dia);

// ------------------------------------------------------------ plano de contas padrão ---------------------------------
export interface ContaPadraoAns {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: 'sintetica' | 'analitica';
  readonly natureza: 'devedora' | 'credora' | null;
  readonly modalidades: readonly string[] | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly versaoFonte: string;
}

/** O grau da conta é o número de dígitos do código (o plano da ANS cresce um dígito por nível). */
export const grauDaContaAns = (codigo: string): number => codigo.trim().length;

/** A conta-mãe é a de maior prefixo próprio do código, vigente no início da conta. */
export function superiorDaContaAns<T extends ContaPadraoAns>(
  codigo: string,
  existentes: readonly T[],
  dia: string,
): T | null {
  const c = codigo.trim();
  let melhor: T | null = null;
  for (const e of existentes) {
    if (e.codigo.length >= c.length || !c.startsWith(e.codigo) || !vigente(e, dia)) continue;
    if (!melhor || e.codigo.length > melhor.codigo.length) melhor = e;
  }
  return melhor;
}

export function problemasDaContaPadraoAns(
  c: ContaPadraoAns,
  existentes: readonly ContaPadraoAns[],
): ProblemaProvisaoTecnica[] {
  const p: ProblemaProvisaoTecnica[] = [];
  const codigo = c.codigo.trim();
  if (!/^\d{1,12}$/.test(codigo))
    p.push(prob('codigo-invalido', 'codigo', 'O código da conta da ANS tem só dígitos (de 1 a 12).'));
  if (!c.descricao.trim()) p.push(prob('sem-descricao', 'descricao', 'Informe a descrição da conta.'));
  if (c.vigenciaFim !== null && c.vigenciaFim < c.vigenciaInicio)
    p.push(prob('vigencia-invalida', 'vigenciaFim', 'O fim da vigência é anterior ao início.'));
  if (c.tipo === 'analitica' && c.natureza === null)
    p.push(prob('sem-natureza', 'natureza', 'A conta analítica precisa da natureza do saldo.'));
  for (const m of c.modalidades ?? [])
    if (!(MODALIDADES_OPERADORA as readonly string[]).includes(m))
      p.push(prob('modalidade-invalida', 'modalidades', `Modalidade desconhecida: ${m}.`));
  if (p.length) return p;
  if (
    existentes.some(
      (e) =>
        e.codigo === codigo &&
        sobrepoe(
          { inicio: e.vigenciaInicio, fim: e.vigenciaFim },
          { inicio: c.vigenciaInicio, fim: c.vigenciaFim },
        ),
    )
  )
    p.push(prob('conta-repetida', 'codigo', 'Já existe a conta com este código na vigência.'));
  if (codigo.length > 1) {
    const sup = superiorDaContaAns(codigo, existentes, c.vigenciaInicio);
    if (!sup) p.push(prob('sem-superior', 'codigo', 'Cadastre antes a conta-mãe do código.'));
    else if (sup.tipo === 'analitica')
      p.push(
        prob('superior-analitica', 'codigo', `A conta ${sup.codigo} é analítica e não aceita subcontas.`),
      );
  }
  return p;
}

// ------------------------------------------------------------ mapa das contas próprias -------------------------------
export interface MapaContaAns {
  readonly contaContabil: number;
  readonly contaAns: string;
  readonly duplicaValor: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}
export interface ContaPropriaMapa {
  readonly id: number;
  readonly tipo: string;
  readonly ativo: boolean;
}

export function problemasDoMapaAns(
  m: MapaContaAns,
  contaAns: ContaPadraoAns | null,
  propria: ContaPropriaMapa | null,
  modalidade: string,
  existentes: readonly MapaContaAns[],
): ProblemaProvisaoTecnica[] {
  const p: ProblemaProvisaoTecnica[] = [];
  if (m.vigenciaFim !== null && m.vigenciaFim < m.vigenciaInicio)
    p.push(prob('vigencia-invalida', 'vigenciaFim', 'O fim da vigência é anterior ao início.'));
  if (!propria || !propria.ativo)
    p.push(prob('conta-propria-invalida', 'contaContabil', 'A conta contábil não existe ou está inativa.'));
  else if (propria.tipo !== 'analitica')
    p.push(
      prob(
        'conta-propria-sintetica',
        'contaContabil',
        'Só a conta contábil analítica recebe saldo do balancete.',
      ),
    );
  if (!contaAns || !vigente(contaAns, m.vigenciaInicio))
    p.push(prob('conta-ans-fora-vigencia', 'contaAns', 'A conta da ANS não existe na vigência do mapa.'));
  else {
    if (contaAns.tipo !== 'analitica')
      p.push(
        prob('conta-ans-sintetica', 'contaAns', 'O mapa liga a conta própria a uma conta analítica da ANS.'),
      );
    if (contaAns.modalidades && contaAns.modalidades.length && !contaAns.modalidades.includes(modalidade))
      p.push(
        prob(
          'modalidade-nao-aplicavel',
          'contaAns',
          'A conta da ANS não se aplica à modalidade da operadora.',
        ),
      );
  }
  if (p.length) return p;
  const janela = { inicio: m.vigenciaInicio, fim: m.vigenciaFim };
  const mesmas = existentes.filter(
    (e) =>
      e.contaContabil === m.contaContabil &&
      sobrepoe({ inicio: e.vigenciaInicio, fim: e.vigenciaFim }, janela),
  );
  if (mesmas.some((e) => e.contaAns === m.contaAns))
    p.push(
      prob('mapa-repetido', 'contaAns', 'A conta própria já está ligada a esta conta da ANS na vigência.'),
    );
  else if (!m.duplicaValor && mesmas.some((e) => !e.duplicaValor))
    p.push(
      prob(
        'conta-ja-mapeada',
        'contaContabil',
        'A conta própria já está ligada a outra conta da ANS na vigência (marque "duplica o valor" se o saldo compõe as duas).',
      ),
    );
  return p;
}

// ------------------------------------------------------------ balancete no padrão da ANS -----------------------------
export interface SaldoContaPropria {
  readonly contaContabil: number;
  readonly classificacao: string;
  /** Saldo final em centavos, positivo na natureza devedora. */
  readonly saldoCentavos: number;
}
export interface LinhaBalanceteAns {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: 'sintetica' | 'analitica';
  readonly grau: number;
  readonly saldoCentavos: number;
  /** Contas próprias que compõem a linha analítica (parcelas do saldo). */
  readonly parcelas: readonly { readonly classificacao: string; readonly saldoCentavos: number }[];
}
export interface BalanceteAns {
  readonly linhas: readonly LinhaBalanceteAns[];
  readonly semMapa: readonly SaldoContaPropria[];
  /** Soma dos grupos 1 a 4 (ativo devedor positivo; passivo, PL e receitas credores negativos); zero quando fecha. */
  readonly diferencaCentavos: number;
}

/** Leva os saldos das contas próprias ao plano da ANS pelo mapa vigente na data e soma até as contas sintéticas. */
export function balanceteNoPadraoAns(
  saldos: readonly SaldoContaPropria[],
  mapas: readonly MapaContaAns[],
  plano: readonly ContaPadraoAns[],
  dia: string,
): BalanceteAns {
  const contas = plano.filter((c) => vigente(c, dia));
  const porCodigo = new Map(contas.map((c) => [c.codigo, c]));
  const vig = mapas.filter(
    (m) => m.vigenciaInicio <= dia && (m.vigenciaFim === null || m.vigenciaFim >= dia),
  );
  const total = new Map<string, number>();
  const parcelas = new Map<string, { classificacao: string; saldoCentavos: number }[]>();
  const semMapa: SaldoContaPropria[] = [];
  for (const s of saldos) {
    const destinos = vig.filter((m) => m.contaContabil === s.contaContabil && porCodigo.has(m.contaAns));
    if (!destinos.length) {
      if (s.saldoCentavos !== 0) semMapa.push(s);
      continue;
    }
    for (const d of destinos) {
      parcelas.set(d.contaAns, [
        ...(parcelas.get(d.contaAns) ?? []),
        { classificacao: s.classificacao, saldoCentavos: s.saldoCentavos },
      ]);
      for (let n = d.contaAns.length; n >= 1; n--) {
        const cod = d.contaAns.slice(0, n);
        if (porCodigo.has(cod)) total.set(cod, (total.get(cod) ?? 0) + s.saldoCentavos);
      }
    }
  }
  const linhas = contas
    .filter((c) => total.has(c.codigo))
    .sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
    .map((c) => ({
      codigo: c.codigo,
      descricao: c.descricao,
      tipo: c.tipo,
      grau: grauDaContaAns(c.codigo),
      saldoCentavos: total.get(c.codigo) ?? 0,
      parcelas: parcelas.get(c.codigo) ?? [],
    }));
  // Saldos devedores positivos e credores negativos: ativo + passivo e PL + receitas + despesas fecha em zero.
  const diferencaCentavos = ['1', '2', '3', '4'].reduce((s, g) => s + (total.get(g) ?? 0), 0);
  return { linhas, semMapa, diferencaCentavos };
}

// ------------------------------------------------------------ provisões técnicas -------------------------------------
/** Competência é o primeiro dia do mês; a base são os 12 meses que terminam no fim da competência. */
export function baseDaCompetencia(competencia: string): { inicio: string; fim: string } {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const inicio = new Date(Date.UTC(a, m - 12, 1)).toISOString().slice(0, 10);
  return { inicio, fim };
}

export interface BaseMetodologiaAns {
  /** Contraprestações emitidas líquidas dos 12 meses da base, em centavos. */
  readonly contraprestacoesCentavos: number;
  /** Eventos indenizáveis conhecidos nos 12 meses da base, em centavos. */
  readonly eventosCentavos: number;
  /** Eventos avisados e ainda não pagos no fim da competência, em centavos. */
  readonly avisadosNaoPagosCentavos: number;
}
export interface ItemInformado {
  readonly tipo: TipoProvisaoTecnica;
  readonly valorCentavos: number;
  readonly observacao: string | null;
}
export interface EntradaProvisaoTecnica {
  readonly competencia: string;
  readonly metodo: MetodoProvisaoTecnica;
  /** Conta contábil (id) de cada tipo de provisão. */
  readonly contas: Readonly<Partial<Record<TipoProvisaoTecnica, number>>>;
  readonly base: BaseMetodologiaAns;
  /** Valores informados: os do atuário (nota técnica) ou remissão, PIC, PPCNG e outras. */
  readonly informados: readonly ItemInformado[];
  /** Referência da nota técnica atuarial, obrigatória no método atuarial. */
  readonly notaTecnica: string | null;
  /** Valor de cada tipo na competência anterior calculada, para a variação. */
  readonly anteriores: Readonly<Partial<Record<TipoProvisaoTecnica, number>>>;
}
export interface ItemProvisaoCalculado {
  readonly sequencia: number;
  readonly tipo: TipoProvisaoTecnica;
  readonly conta: number;
  readonly valorCentavos: number;
  readonly anteriorCentavos: number | null;
  readonly memoria: string;
}
export interface ResultadoProvisaoTecnica {
  readonly problemas: readonly ProblemaProvisaoTecnica[];
  readonly itens: readonly ItemProvisaoCalculado[];
  readonly totalCentavos: number;
  readonly memoria: string;
}

const reais = (c: number) => (c / 100).toFixed(2);
const pct = (v: number, p: number) => Math.round((v * p) / 100);

/** PEONA pela metodologia da ANS: a maior das duas parcelas, com a memória. */
export function peonaMetodologiaAns(b: BaseMetodologiaAns): { valorCentavos: number; memoria: string } {
  const sobreContra = pct(b.contraprestacoesCentavos, PEONA_PERCENTUAL_CONTRAPRESTACOES);
  const sobreEventos = pct(b.eventosCentavos, PEONA_PERCENTUAL_EVENTOS);
  const valorCentavos = Math.max(sobreContra, sobreEventos);
  return {
    valorCentavos,
    memoria:
      `maior entre ${PEONA_PERCENTUAL_CONTRAPRESTACOES}% x ${reais(b.contraprestacoesCentavos)} = ${reais(sobreContra)}` +
      ` e ${PEONA_PERCENTUAL_EVENTOS}% x ${reais(b.eventosCentavos)} = ${reais(sobreEventos)}: ${reais(valorCentavos)}`,
  };
}

export function calcularProvisoesTecnicas(e: EntradaProvisaoTecnica): ResultadoProvisaoTecnica {
  const p: ProblemaProvisaoTecnica[] = [];
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(e.competencia))
    p.push(prob('competencia-invalida', 'competencia', 'A competência é o primeiro dia do mês.'));
  if (e.metodo === 'nota_tecnica_atuarial' && !e.notaTecnica?.trim())
    p.push(
      prob('sem-nota-tecnica', 'notaTecnica', 'Informe a referência da nota técnica atuarial aprovada.'),
    );
  const vistos = new Set<string>();
  for (const i of e.informados) {
    if (!Number.isInteger(i.valorCentavos) || i.valorCentavos < 0)
      p.push(prob('valor-invalido', 'informados', `O valor de ${i.tipo} não pode ser negativo.`));
    if (vistos.has(i.tipo) && i.tipo !== 'outra')
      p.push(prob('tipo-repetido', 'informados', `O tipo ${i.tipo} foi informado duas vezes.`));
    vistos.add(i.tipo);
    if (e.metodo === 'metodologia_ans' && (i.tipo === 'peona' || i.tipo === 'pesl'))
      p.push(
        prob(
          'calculado-pelo-sistema',
          'informados',
          `Na metodologia da ANS a ${i.tipo} é calculada pelo sistema.`,
        ),
      );
  }
  for (const v of Object.values(e.base))
    if (!Number.isInteger(v) || v < 0)
      p.push(prob('base-invalida', 'base', 'Os valores da base não podem ser negativos.'));
  const brutos: { tipo: TipoProvisaoTecnica; valor: number; memoria: string }[] = [];
  if (e.metodo === 'metodologia_ans') {
    const peona = peonaMetodologiaAns(e.base);
    brutos.push({ tipo: 'peona', valor: peona.valorCentavos, memoria: peona.memoria });
    brutos.push({
      tipo: 'pesl',
      valor: e.base.avisadosNaoPagosCentavos,
      memoria: `eventos avisados e não pagos no fim da competência: ${reais(e.base.avisadosNaoPagosCentavos)}`,
    });
  }
  for (const i of e.informados)
    brutos.push({
      tipo: i.tipo,
      valor: i.valorCentavos,
      memoria:
        (e.metodo === 'nota_tecnica_atuarial'
          ? `informado pelo atuário (nota ${e.notaTecnica?.trim() ?? ''})`
          : 'informado') + (i.observacao?.trim() ? `: ${i.observacao.trim()}` : ''),
    });
  if (!brutos.length) p.push(prob('sem-itens', 'informados', 'Informe ao menos um valor de provisão.'));
  for (const b of brutos)
    if (!e.contas[b.tipo])
      p.push(prob('sem-conta', `contas.${b.tipo}`, `Informe a conta contábil da provisão ${b.tipo}.`));
  if (p.length) return { problemas: p, itens: [], totalCentavos: 0, memoria: '' };
  const itens = brutos.map((b, i) => ({
    sequencia: i + 1,
    tipo: b.tipo,
    conta: e.contas[b.tipo] as number,
    valorCentavos: b.valor,
    anteriorCentavos: e.anteriores[b.tipo] ?? null,
    memoria: b.memoria,
  }));
  const totalCentavos = itens.reduce((s, i) => s + i.valorCentavos, 0);
  const memoria = [
    `Método: ${e.metodo}; base ${baseDaCompetencia(e.competencia).inicio} a ${baseDaCompetencia(e.competencia).fim}.`,
    ...itens.map((i) => `${i.tipo}: ${i.memoria}`),
    `Total: ${itens.map((i) => reais(i.valorCentavos)).join(' + ')} = ${reais(totalCentavos)}.`,
  ].join('\n');
  return { problemas: [], itens, totalCentavos, memoria };
}

const ACOES: Readonly<Record<string, readonly SituacaoProvisaoTecnica[]>> = {
  calcular: ['aberta', 'calculada'],
  contabilizar: ['calculada'],
  cancelar: ['aberta', 'calculada'],
};
export function conferirAcaoProvisao(
  situacao: SituacaoProvisaoTecnica,
  acao: 'calcular' | 'contabilizar' | 'cancelar',
): ProblemaProvisaoTecnica[] {
  return ACOES[acao]?.includes(situacao)
    ? []
    : [prob('situacao-nao-permite', 'situacao', `A provisão ${situacao} não permite ${acao}.`)];
}

/**
 * A contabilização lança a variação sobre o saldo já lançado: a base é a última competência contabilizada (de qualquer
 * método), nunca uma só calculada. Por isso recusa a competência que já tem outro método contabilizado (lançaria a
 * provisão duas vezes) e a que fica antes de uma competência já contabilizada (a variação desta já foi absorvida lá).
 */
export function conferirContabilizacaoProvisao(e: {
  readonly outroMetodoContabilizadoNaCompetencia: boolean;
  readonly competenciaPosteriorContabilizada: boolean;
}): ProblemaProvisaoTecnica[] {
  const p: ProblemaProvisaoTecnica[] = [];
  if (e.outroMetodoContabilizadoNaCompetencia)
    p.push(
      prob(
        'provisao-ja-contabilizada',
        'competencia',
        'A competência já tem provisão contabilizada por outro método.',
      ),
    );
  if (e.competenciaPosteriorContabilizada)
    p.push(
      prob(
        'contabilizacao-fora-de-ordem',
        'competencia',
        'Há competência posterior já contabilizada; contabilize as provisões em ordem.',
      ),
    );
  return p;
}

export interface PartidaProvisao {
  readonly lado: 'D' | 'C';
  readonly conta: string;
  readonly valorCentavos: number;
  readonly historico: string;
  readonly centroCusto: null;
}
/**
 * Partidas da variação de cada provisão (constituída menos a anterior): aumento debita a despesa e credita a conta da
 * provisão; redução debita a provisão e credita a reversão (ou a própria despesa, sem conta de reversão).
 */
export function partidasDaProvisao(
  itens: readonly {
    tipo: string;
    contaClassificacao: string;
    valorCentavos: number;
    anteriorCentavos: number | null;
  }[],
  contaDespesa: string,
  contaReversao: string | null,
  rotulo: string,
): PartidaProvisao[] {
  const r: PartidaProvisao[] = [];
  for (const i of itens) {
    const v = i.valorCentavos - (i.anteriorCentavos ?? 0);
    if (v === 0) continue;
    const h = `${v > 0 ? 'Constituição' : 'Reversão'} da provisão técnica ${i.tipo} ${rotulo}`;
    if (v > 0) {
      r.push({ lado: 'D', conta: contaDespesa, valorCentavos: v, historico: h, centroCusto: null });
      r.push({ lado: 'C', conta: i.contaClassificacao, valorCentavos: v, historico: h, centroCusto: null });
    } else {
      r.push({ lado: 'D', conta: i.contaClassificacao, valorCentavos: -v, historico: h, centroCusto: null });
      r.push({
        lado: 'C',
        conta: contaReversao ?? contaDespesa,
        valorCentavos: -v,
        historico: h,
        centroCusto: null,
      });
    }
  }
  return r;
}
