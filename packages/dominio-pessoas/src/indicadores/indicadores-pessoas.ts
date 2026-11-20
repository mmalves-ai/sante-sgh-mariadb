// W0-06, parte 7 (M4 de mercado; itens 193 e 215 juntos): indicadores de pessoas por unidade e setor, com a ficha
// técnica e as parcelas impressas. Regra da conta (a mesma do M54): o consolidado é Σ numeradores ÷ Σ denominadores,
// nunca a média dos setores; cada setor traz a sua conta por extenso. Funções puras: a porta lê o cadastro, o ponto,
// a folha, os treinamentos, o SESMT, o censo e o dimensionamento e entrega a `BaseIndicadoresPessoas`.
import {
  CATEGORIAS_SCP,
  type CategoriaScp,
  CODIGOS_CATEGORIA_SCP,
  type FichaIndicadorPessoas,
  type IndicadorPessoas,
  type IndicadorPessoasCalculado,
  INDICADORES_PESSOAS,
  type ParcelaIndicadorPessoas,
} from '@sgh/contratos';

/** O setor de uma linha da base (setor nulo = sem lotação). */
export interface SetorIndicador {
  readonly hospital: string;
  readonly setor: number | null;
  readonly nomeSetor: string;
}

export interface BaseIndicadoresPessoas {
  readonly inicio: string;
  readonly fim: string;
  /** Vínculos com admissão até o fim do período (o desligamento nulo = ativo). */
  readonly vinculos: readonly (SetorIndicador & { admissao: string; desligamento: string | null })[];
  /** Horas apuradas no ponto no período, por setor; `horasEnfermagem` = trabalhadas pela equipe de enfermagem. */
  readonly ponto: readonly (SetorIndicador & {
    horasPrevistas: number;
    horasTrabalhadas: number;
    horasAusencia: number;
    horasExtras: number;
    horasEnfermagem: number;
  })[];
  /** Valor pago de horas extras na folha das competências do período (centavos). */
  readonly folhaHorasExtras: readonly (SetorIndicador & { valorCent: number })[];
  /** Horas de presença em turmas realizadas no período (Σ carga horária × presentes). */
  readonly treinamento: readonly (SetorIndicador & { horas: number })[];
  readonly acidentes: readonly (SetorIndicador & { quantidade: number; comAfastamento: number })[];
  /** Pacientes-dia do censo no período. */
  readonly censo: readonly (SetorIndicador & { pacientesDia: number })[];
  /** Pacientes por categoria do último dimensionamento registrado do setor (a referência da COFEN 543/2017). */
  readonly dimensionamento: readonly (SetorIndicador & {
    pacientes: Readonly<Record<CategoriaScp, number>>;
  })[];
  /** Horas por paciente em 24 h por categoria, se ajustadas pelo parâmetro (o padrão é a Res. COFEN 543/2017). */
  readonly horasCofen?: Partial<Record<CategoriaScp, number>>;
}

export const FICHAS_INDICADOR_PESSOAS: Readonly<Record<IndicadorPessoas, FichaIndicadorPessoas>> = {
  turnover: {
    codigo: 'turnover',
    rotulo: 'Rotatividade (turnover)',
    definicao:
      'Quanto do quadro foi renovado no período: a média de admissões e desligamentos sobre o efetivo médio.',
    formula: '((admissões + desligamentos) ÷ 2) ÷ ((efetivo no início + efetivo no fim) ÷ 2) × 100',
    unidade: '%',
    numerador: 'Média de admissões e desligamentos no período',
    denominador: 'Efetivo médio (vínculos ativos no primeiro e no último dia)',
    fontes: ['cadastro'],
    norma: 'Padrão de mercado de gestão de pessoas (taxa de rotatividade)',
    interpretacao: 'Quanto menor, mais estável o quadro.',
  },
  absenteismo: {
    codigo: 'absenteismo',
    rotulo: 'Absenteísmo',
    definicao:
      'Horas de ausência (faltas, atrasos e afastamentos curtos) sobre as horas previstas na escala ou jornada.',
    formula: 'Σ horas de ausência ÷ Σ horas previstas × 100',
    unidade: '%',
    numerador: 'Horas de ausência apuradas no ponto',
    denominador: 'Horas previstas no ponto',
    fontes: ['ponto'],
    norma: 'Padrão de mercado de gestão de pessoas (taxa de absenteísmo por horas)',
    interpretacao: 'Quanto menor, melhor.',
  },
  horasExtras: {
    codigo: 'horasExtras',
    rotulo: 'Horas extras',
    definicao: 'Horas extras apuradas sobre as horas trabalhadas; o valor pago vem da folha.',
    formula: 'Σ horas extras ÷ Σ horas trabalhadas × 100',
    unidade: '%',
    numerador: 'Horas extras apuradas no ponto',
    denominador: 'Horas trabalhadas apuradas no ponto',
    fontes: ['ponto', 'folha'],
    norma: 'CLT art. 59 (limite de 2 horas extras por dia)',
    interpretacao: 'Quanto menor, melhor; alto e persistente indica quadro insuficiente.',
  },
  horasEnfermagemPacienteDia: {
    codigo: 'horasEnfermagemPacienteDia',
    rotulo: 'Horas de enfermagem por paciente-dia',
    definicao:
      'Horas trabalhadas pela equipe de enfermagem sobre os pacientes-dia do censo, comparadas à referência da COFEN para os pacientes classificados no setor.',
    formula:
      'Σ horas de enfermagem ÷ Σ pacientes-dia; referência = Σ (pacientes da categoria × horas da categoria) ÷ Σ pacientes classificados',
    unidade: 'h',
    numerador: 'Horas trabalhadas pela enfermagem no ponto',
    denominador: 'Pacientes-dia do censo',
    fontes: ['ponto', 'censo', 'dimensionamento'],
    norma: 'Resolução COFEN 543/2017, art. 3º (4, 6, 10, 10 e 18 h por paciente em 24 h)',
    interpretacao: 'Abaixo da referência (razão menor que 1) indica equipe aquém do dimensionamento.',
  },
  treinamentoPerCapita: {
    codigo: 'treinamentoPerCapita',
    rotulo: 'Horas de treinamento per capita',
    definicao: 'Horas de treinamento com presença registrada sobre o efetivo médio do período.',
    formula: 'Σ horas de presença em treinamento ÷ efetivo médio',
    unidade: 'h',
    numerador: 'Horas de presença em turmas realizadas',
    denominador: 'Efetivo médio (vínculos ativos no primeiro e no último dia)',
    fontes: ['treinamento', 'cadastro'],
    norma: 'Padrão de mercado de gestão de pessoas (horas de treinamento por colaborador)',
    interpretacao: 'Quanto maior, mais investimento em capacitação.',
  },
  acidentesTrabalho: {
    codigo: 'acidentesTrabalho',
    rotulo: 'Acidentes de trabalho (taxa de frequência)',
    definicao: 'Acidentes de trabalho registrados por milhão de horas-homem trabalhadas.',
    formula: 'Σ acidentes × 1.000.000 ÷ Σ horas trabalhadas',
    unidade: 'acidentes por milhão de h',
    numerador: 'Acidentes de trabalho registrados no SESMT no período (× 1.000.000)',
    denominador: 'Horas-homem trabalhadas apuradas no ponto',
    fontes: ['sesmt', 'ponto'],
    norma: 'ABNT NBR 14280 (taxa de frequência)',
    interpretacao: 'Quanto menor, melhor.',
  },
};

const arred = (n: number, casas = 2) => {
  const f = 10 ** casas;
  return Math.round(n * f + Math.sign(n) * Number.EPSILON) / f;
};
const br = (n: number) => String(arred(n)).replace('.', ',');
const chave = (s: SetorIndicador) => `${s.hospital}|${s.setor ?? ''}`;

interface Termo {
  numerador: number;
  denominador: number;
}
interface Acumulado<T> {
  setor: SetorIndicador;
  v: T;
}

/** Soma por setor, na ordem hospital → nome do setor. */
function porSetor<L extends SetorIndicador, T>(
  linhas: readonly L[],
  vazio: () => T,
  somar: (t: T, l: L) => void,
): Acumulado<T>[] {
  const m = new Map<string, Acumulado<T>>();
  for (const l of linhas) {
    const k = chave(l);
    let a = m.get(k);
    if (!a) {
      a = { setor: { hospital: l.hospital, setor: l.setor, nomeSetor: l.nomeSetor }, v: vazio() };
      m.set(k, a);
    }
    somar(a.v, l);
  }
  return [...m.values()].sort(
    (a, b) =>
      a.setor.hospital.localeCompare(b.setor.hospital) ||
      a.setor.nomeSetor.localeCompare(b.setor.nomeSetor, 'pt-BR'),
  );
}

function valorDe(t: Termo, fator: number): number | null {
  return t.denominador === 0 ? null : arred((t.numerador / t.denominador) * fator);
}

function parcela(
  s: SetorIndicador,
  t: Termo,
  fator: number,
  conta: (v: number | null) => string,
): ParcelaIndicadorPessoas {
  const valor = valorDe(t, fator);
  return {
    ...s,
    numerador: arred(t.numerador),
    denominador: arred(t.denominador),
    valor,
    conta: conta(valor),
    referencia: null,
    contaReferencia: null,
  };
}

function consolidar(
  codigo: IndicadorPessoas,
  parcelas: ParcelaIndicadorPessoas[],
  fator: number,
  sufixo: string,
  complementos: IndicadorPessoasCalculado['complementos'] = [],
): IndicadorPessoasCalculado {
  const numerador = arred(parcelas.reduce((s, p) => s + p.numerador, 0));
  const denominador = arred(parcelas.reduce((s, p) => s + p.denominador, 0));
  const valor = valorDe({ numerador, denominador }, fator);
  const vezes = fator === 1 ? '' : ` × ${fator.toLocaleString('pt-BR')}`;
  const conta =
    parcelas.length === 0
      ? 'Sem dados no período.'
      : `(${parcelas.map((p) => br(p.numerador)).join(' + ')}) ÷ (${parcelas.map((p) => br(p.denominador)).join(' + ')})${vezes} = ${br(numerador)} ÷ ${br(denominador)}${vezes} = ${valor === null ? 'sem denominador' : `${br(valor)}${sufixo}`}`;
  return {
    ficha: FICHAS_INDICADOR_PESSOAS[codigo],
    numerador,
    denominador,
    valor,
    conta,
    referencia: null,
    razaoReferencia: null,
    parcelas,
    complementos,
  };
}

const ativoEm = (v: { admissao: string; desligamento: string | null }, dia: string) =>
  v.admissao <= dia && (v.desligamento === null || v.desligamento >= dia);
const dentro = (dia: string | null, inicio: string, fim: string) =>
  dia !== null && dia >= inicio && dia <= fim;

interface Movimento {
  adm: number;
  desl: number;
  ini: number;
  fim: number;
}

/** Efetivo e movimento por setor (o turnover e o denominador do treinamento per capita). */
function movimentoPorSetor(b: BaseIndicadoresPessoas): Acumulado<Movimento>[] {
  return porSetor(
    b.vinculos,
    () => ({ adm: 0, desl: 0, ini: 0, fim: 0 }),
    (t, v) => {
      if (dentro(v.admissao, b.inicio, b.fim)) t.adm += 1;
      if (dentro(v.desligamento, b.inicio, b.fim)) t.desl += 1;
      if (ativoEm(v, b.inicio)) t.ini += 1;
      if (ativoEm(v, b.fim)) t.fim += 1;
    },
  );
}

/** Horas de enfermagem por paciente em 24 h que valem para cada categoria (o parâmetro ajusta; o padrão é a COFEN). */
export function horasCofenVigentes(
  ajuste?: Partial<Record<CategoriaScp, number>>,
): Record<CategoriaScp, number> {
  const r = {} as Record<CategoriaScp, number>;
  for (const c of CODIGOS_CATEGORIA_SCP) r[c] = ajuste?.[c] ?? CATEGORIAS_SCP[c].horas;
  return r;
}

/** A referência do setor: Σ (pacientes × horas da categoria) ÷ Σ pacientes, com a conta por extenso. */
export function referenciaCofen(
  pacientes: Readonly<Record<CategoriaScp, number>>,
  horas: Readonly<Record<CategoriaScp, number>>,
): { valor: number | null; conta: string } {
  const usadas = CODIGOS_CATEGORIA_SCP.filter((c) => pacientes[c] > 0);
  const totalPacientes = usadas.reduce((s, c) => s + pacientes[c], 0);
  if (totalPacientes === 0) return { valor: null, conta: 'Sem pacientes classificados no dimensionamento.' };
  const totalHoras = usadas.reduce((s, c) => s + pacientes[c] * horas[c], 0);
  const valor = arred(totalHoras / totalPacientes);
  return {
    valor,
    conta: `(${usadas.map((c) => `${pacientes[c]} × ${br(horas[c])} h`).join(' + ')}) ÷ ${totalPacientes} paciente(s) = ${br(totalHoras)} ÷ ${totalPacientes} = ${br(valor)} h`,
  };
}

/** Calcula os seis indicadores do painel, na ordem de `INDICADORES_PESSOAS`. */
export function calcularIndicadoresPessoas(b: BaseIndicadoresPessoas): IndicadorPessoasCalculado[] {
  const mov = movimentoPorSetor(b);
  const ponto = porSetor(
    b.ponto,
    () => ({ prev: 0, trab: 0, aus: 0, he: 0, enf: 0 }),
    (t, l) => {
      t.prev += l.horasPrevistas;
      t.trab += l.horasTrabalhadas;
      t.aus += l.horasAusencia;
      t.he += l.horasExtras;
      t.enf += l.horasEnfermagem;
    },
  );
  const pct = (v: number | null) => (v === null ? 'sem denominador' : `${br(v)}%`);

  const turnover = consolidar(
    'turnover',
    mov.map(({ setor, v }) =>
      parcela(
        setor,
        { numerador: (v.adm + v.desl) / 2, denominador: (v.ini + v.fim) / 2 },
        100,
        (r) =>
          `((${v.adm} admissão(ões) + ${v.desl} desligamento(s)) ÷ 2) ÷ ((${v.ini} + ${v.fim}) ÷ 2) × 100 = ${pct(r)}`,
      ),
    ),
    100,
    '%',
  );

  const absenteismo = consolidar(
    'absenteismo',
    ponto.map(({ setor, v }) =>
      parcela(
        setor,
        { numerador: v.aus, denominador: v.prev },
        100,
        (r) => `${br(v.aus)} h ÷ ${br(v.prev)} h × 100 = ${pct(r)}`,
      ),
    ),
    100,
    '%',
  );

  const valorHe = b.folhaHorasExtras.reduce((s, l) => s + l.valorCent, 0);
  const horasExtras = consolidar(
    'horasExtras',
    ponto.map(({ setor, v }) =>
      parcela(
        setor,
        { numerador: v.he, denominador: v.trab },
        100,
        (r) => `${br(v.he)} h ÷ ${br(v.trab)} h × 100 = ${pct(r)}`,
      ),
    ),
    100,
    '%',
    [
      { rotulo: 'Horas extras no período', valor: `${br(ponto.reduce((s, p) => s + p.v.he, 0))} h` },
      {
        rotulo: 'Valor pago na folha',
        valor: `R$ ${(valorHe / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
  );

  // Horas de enfermagem por paciente-dia: o setor entra se tem horas de enfermagem ou pacientes-dia.
  const horas = horasCofenVigentes(b.horasCofen);
  const enfPorSetor = new Map(ponto.map((p) => [chave(p.setor), p]));
  const censo = porSetor(
    b.censo,
    () => ({ pd: 0 }),
    (t, l) => (t.pd += l.pacientesDia),
  );
  const censoPorSetor = new Map(censo.map((c) => [chave(c.setor), c]));
  const dimPorSetor = new Map(b.dimensionamento.map((d) => [chave(d), d]));
  const setoresEnf = [
    ...ponto.filter((p) => p.v.enf > 0).map((p) => p.setor),
    ...censo.filter((c) => !enfPorSetor.get(chave(c.setor))?.v.enf).map((c) => c.setor),
  ].sort((a, z) => a.hospital.localeCompare(z.hospital) || a.nomeSetor.localeCompare(z.nomeSetor, 'pt-BR'));
  let refHoras = 0;
  let refPacientesDia = 0;
  const parcelasEnf = setoresEnf.map((s) => {
    const enf = enfPorSetor.get(chave(s))?.v.enf ?? 0;
    const pd = censoPorSetor.get(chave(s))?.v.pd ?? 0;
    const p = parcela(
      s,
      { numerador: enf, denominador: pd },
      1,
      (r) => `${br(enf)} h ÷ ${br(pd)} paciente(s)-dia = ${r === null ? 'sem pacientes-dia' : `${br(r)} h`}`,
    );
    const dim = dimPorSetor.get(chave(s));
    const ref = dim ? referenciaCofen(dim.pacientes, horas) : null;
    if (ref && ref.valor !== null && pd > 0) {
      refHoras += ref.valor * pd;
      refPacientesDia += pd;
    }
    return {
      ...p,
      referencia: ref?.valor ?? null,
      contaReferencia: ref?.conta ?? 'Sem dimensionamento registrado no setor.',
    };
  });
  const enfermagem = consolidar('horasEnfermagemPacienteDia', parcelasEnf, 1, ' h');
  const referencia = refPacientesDia === 0 ? null : arred(refHoras / refPacientesDia);
  const enfermagemComRef: IndicadorPessoasCalculado = {
    ...enfermagem,
    referencia,
    razaoReferencia:
      referencia === null || enfermagem.valor === null || referencia === 0
        ? null
        : arred(enfermagem.valor / referencia),
    complementos:
      referencia === null
        ? [{ rotulo: 'Referência da COFEN', valor: 'Sem dimensionamento registrado nos setores do painel.' }]
        : [
            {
              rotulo: 'Referência da COFEN (média ponderada pelos pacientes-dia)',
              valor: `${parcelasEnf
                .filter((p) => p.referencia !== null && p.denominador > 0)
                .map((p) => `${br(p.referencia!)} h × ${br(p.denominador)}`)
                .join(' + ')} ÷ ${br(refPacientesDia)} = ${br(referencia)} h`,
            },
          ],
  };

  const efetivoMedio = new Map(mov.map((m) => [chave(m.setor), (m.v.ini + m.v.fim) / 2]));
  const trein = porSetor(
    b.treinamento,
    () => ({ h: 0 }),
    (t, l) => (t.h += l.horas),
  );
  const treinPorSetor = new Map(trein.map((t) => [chave(t.setor), t.v.h]));
  const setoresTrein = [
    ...mov.map((m) => m.setor),
    ...trein.filter((t) => !efetivoMedio.has(chave(t.setor))).map((t) => t.setor),
  ];
  const treinamento = consolidar(
    'treinamentoPerCapita',
    setoresTrein.map((s) => {
      const h = treinPorSetor.get(chave(s)) ?? 0;
      const ef = efetivoMedio.get(chave(s)) ?? 0;
      return parcela(
        s,
        { numerador: h, denominador: ef },
        1,
        (r) => `${br(h)} h ÷ ${br(ef)} colaborador(es) = ${r === null ? 'sem efetivo' : `${br(r)} h`}`,
      );
    }),
    1,
    ' h',
  );

  const acid = porSetor(
    b.acidentes,
    () => ({ q: 0, af: 0 }),
    (t, l) => {
      t.q += l.quantidade;
      t.af += l.comAfastamento;
    },
  );
  const acidPorSetor = new Map(acid.map((a) => [chave(a.setor), a.v]));
  const trabPorSetor = new Map(ponto.map((p) => [chave(p.setor), p.v.trab]));
  const setoresAcid = [
    ...ponto.map((p) => p.setor),
    ...acid.filter((a) => !trabPorSetor.has(chave(a.setor))).map((a) => a.setor),
  ];
  const totalAcid = acid.reduce((s, a) => s + a.v.q, 0);
  const acidentes = consolidar(
    'acidentesTrabalho',
    setoresAcid.map((s) => {
      const q = acidPorSetor.get(chave(s))?.q ?? 0;
      const trab = trabPorSetor.get(chave(s)) ?? 0;
      return parcela(
        s,
        { numerador: q * 1_000_000, denominador: trab },
        1,
        (r) =>
          `${q} acidente(s) × 1.000.000 ÷ ${br(trab)} h = ${r === null ? 'sem horas trabalhadas' : br(r)}`,
      );
    }),
    1,
    '',
    [
      { rotulo: 'Acidentes no período', valor: String(totalAcid) },
      { rotulo: 'Com afastamento', valor: String(acid.reduce((s, a) => s + a.v.af, 0)) },
    ],
  );

  const porCodigo: Record<IndicadorPessoas, IndicadorPessoasCalculado> = {
    turnover,
    absenteismo,
    horasExtras,
    horasEnfermagemPacienteDia: enfermagemComRef,
    treinamentoPerCapita: treinamento,
    acidentesTrabalho: acidentes,
  };
  return INDICADORES_PESSOAS.map((c) => porCodigo[c]);
}
