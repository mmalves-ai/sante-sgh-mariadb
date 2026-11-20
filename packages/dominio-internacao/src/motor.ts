// Motor do censo e da base dos indicadores (M16; regras 3 a 10; Portaria SAS 312/2002). A partir da trajetória
// normalizada, acumula por dia do censo (hora de fechamento única) e por linha (unidade + tipo do trecho):
//   - internados na hora de fechamento (paciente-dia), admissões, saídas por grupo do motivo de alta, óbitos
//     (e os institucionais, após 24 h), transferências de entrada e de saída entre unidades;
//   - por clínica da internação (recorte sem leito-dia);
//   - reinternação calculada em 7 e 30 dias (mesmo paciente; nunca a coluna constante do legado; regra 9).
// O dia D vai de fechamento(D-1), exclusive, a fechamento(D), inclusive: internados(D) = internados(D-1) +
// admissões(D) + entradas(D) − saídas(D) − saídas por transferência(D), conta conferida nos testes. Leito-dia
// operacional = leitos ativos HOJE × dias (o legado não guarda o bloqueio; limitação declarada, regra 10).
import {
  type BaseMensal,
  type GrandezaBase,
  GRUPOS_MOTIVO_ALTA,
  type GrupoMotivoAlta,
  type LinhaCenso,
  type MovimentoInternacao,
  type PeriodoCenso,
  type RecorteIndicador,
} from '@sgh/contratos';
import {
  chaveLinha,
  chaveUnidade,
  type InternacaoNormalizada,
  type CasoMarcado,
  type MarcaCalculo,
  normalizarTrajetorias,
  partesDaLinha,
} from './trajetoria.js';
import {
  DIA,
  dataDoDia,
  diaDaData,
  diaDoCenso,
  mesDoDia,
  mesesEntre,
  primeiroDiaDoMes,
  ultimoDiaDoMes,
} from './tempo.js';

/** Versão do cálculo (vai ao retrato do censo fechado; mudou a regra, sobe a versão). */
export const VERSAO_CALCULO_CENSO = 1;

/** Primeiro dia que o motor acumula (a série começa em 2020; o retrato da cópia tem 2019-11). */
export const INICIO_PADRAO = '2019-01-01';

export interface OpcoesMotor {
  /** 1 a 24 (regra 7). */
  readonly horaFechamento: number;
  /** Tipos de acomodação de terapia intensiva (regra 4). */
  readonly intensivas: readonly number[];
  /** Agora no relógio de parede do estabelecimento (ms; Date.UTC dos campos locais). */
  readonly agora: number;
  readonly inicio?: string;
}

type Serie = Int32Array;

interface Acumulador {
  readonly internados: Serie;
  readonly admissoes: Serie;
  readonly admissoesUrgencia: Serie;
  readonly saidasPorGrupo: Record<GrupoMotivoAlta, Serie>;
  readonly obitosInstitucionais: Serie;
  readonly reinternacoes7: Serie;
  readonly reinternacoes30: Serie;
  readonly diariasFaturadas: Serie;
  readonly transferenciasEntrada: Serie;
  readonly transferenciasSaida: Serie;
}

export interface InfoLinha {
  readonly chave: string;
  readonly unidade: string;
  readonly bloco: string;
  readonly acomodacao: string;
  readonly nome: string;
  readonly tipo: number;
  readonly tipoNome: string;
  readonly intensiva: boolean;
  readonly leitosOperacionais: number;
}

const ROTULOS_CLINICA: Readonly<Record<string, string>> = {
  M: 'Clínica médica',
  C: 'Clínica cirúrgica',
  O: 'Obstetrícia',
  P: 'Pediatria',
  N: 'Neonatologia',
};

export function rotuloClinica(c: string): string {
  return ROTULOS_CLINICA[c] ?? (c === '?' ? 'Não informada' : `Clínica ${c}`);
}

export class MotorInternacao {
  readonly diaInicial: number;
  /** Dia do censo em curso (aberto). */
  readonly diaAtual: number;
  readonly marcas: Readonly<Record<MarcaCalculo, number>>;
  /** Os casos marcados, com o número da internação (relatório do arquivo médico; regra 5). */
  readonly casosMarcados: readonly CasoMarcado[];
  readonly linhas: ReadonlyMap<string, InfoLinha>;
  /** Último movimento visto (dia de calendário), para o "dados até" e o aviso de cópia parada. */
  readonly ultimoMovimento: number;
  private readonly porLinha = new Map<string, Acumulador>();
  private readonly porClinica = new Map<string, Acumulador>();
  private readonly n: number;
  private readonly mov: MovimentoInternacao;
  private readonly op: OpcoesMotor;

  constructor(mov: MovimentoInternacao, op: OpcoesMotor) {
    this.mov = mov;
    this.op = op;
    if (!Number.isInteger(op.horaFechamento) || op.horaFechamento < 1 || op.horaFechamento > 24)
      throw new RangeError('Hora de fechamento do censo de 1 a 24.');
    const t = normalizarTrajetorias(mov, op.agora);
    this.marcas = t.marcas;
    this.casosMarcados = t.casos;
    this.diaInicial = diaDaData(op.inicio ?? INICIO_PADRAO);
    this.diaAtual = diaDoCenso(op.agora, op.horaFechamento);
    this.n = Math.max(1, this.diaAtual - this.diaInicial + 1);
    this.linhas = this.montarLinhas(t.internacoes);
    let ultimo = this.diaInicial;
    for (const i of t.internacoes) {
      ultimo = Math.max(ultimo, Math.floor(i.ini / DIA), i.fim !== null ? Math.floor(i.fim / DIA) : 0);
      for (const tr of i.trechos) if (tr.fim !== null) ultimo = Math.max(ultimo, Math.floor(tr.fim / DIA));
    }
    this.ultimoMovimento = Math.min(ultimo, Math.floor(op.agora / DIA));
    this.acumular(t.internacoes);
  }

  // ── Montagem ─────────────────────────────────────────────────────────────────────────────────────────

  private montarLinhas(internacoes: readonly InternacaoNormalizada[]): Map<string, InfoLinha> {
    const unidades = new Map(this.mov.unidades.map((u) => [chaveUnidade(u.bloco, u.acomodacao), u]));
    const intensivas = new Set(this.op.intensivas);
    const linhas = new Map<string, InfoLinha>();
    const criar = (unidade: string, tipo: number) => {
      const chave = chaveLinha(unidade, tipo);
      if (linhas.has(chave)) return;
      const p = partesDaLinha(chave);
      const u = unidades.get(unidade);
      const tipoCadastro = u?.tipo ?? 0;
      linhas.set(chave, {
        chave,
        unidade,
        bloco: p.bloco,
        acomodacao: p.acomodacao,
        nome: u?.nome ?? p.acomodacao,
        tipo,
        tipoNome: this.mov.tipos.get(tipo) ?? `Tipo ${tipo}`,
        intensiva: intensivas.has(tipo),
        // Os leitos ativos ficam na linha do tipo atual do cadastro da acomodação.
        leitosOperacionais: u && tipoCadastro === tipo ? u.leitosAtivos : 0,
      });
    };
    for (const u of this.mov.unidades) criar(chaveUnidade(u.bloco, u.acomodacao), u.tipo ?? 0);
    for (const i of internacoes) for (const tr of i.trechos) criar(tr.unidade, tr.tipo);
    return new Map([...linhas.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }

  private novo(): Acumulador {
    const s = () => new Int32Array(this.n);
    return {
      internados: s(),
      admissoes: s(),
      admissoesUrgencia: s(),
      saidasPorGrupo: Object.fromEntries(GRUPOS_MOTIVO_ALTA.map((g) => [g, s()])) as Record<
        GrupoMotivoAlta,
        Serie
      >,
      obitosInstitucionais: s(),
      reinternacoes7: s(),
      reinternacoes30: s(),
      diariasFaturadas: s(),
      transferenciasEntrada: s(),
      transferenciasSaida: s(),
    };
  }

  private acc(mapa: Map<string, Acumulador>, chave: string): Acumulador {
    let a = mapa.get(chave);
    if (!a) {
      a = this.novo();
      mapa.set(chave, a);
    }
    return a;
  }

  /** Índice do dia no acumulador, ou -1 fora da janela. */
  private idx(dia: number): number {
    const k = dia - this.diaInicial;
    return k >= 0 && k < this.n ? k : -1;
  }

  private somar(s: Serie, dia: number, v = 1): void {
    const k = this.idx(dia);
    if (k >= 0) s[k]! += v;
  }

  /** Internado nos dias [diaDoCenso(ini), diaDoCenso(fim) − 1] (fim nulo: até o dia em curso). */
  private ocupar(s: Serie, ini: number, fim: number | null): void {
    const h = this.op.horaFechamento;
    const d0 = Math.max(diaDoCenso(ini, h), this.diaInicial);
    const d1 = Math.min(fim === null ? this.diaAtual : diaDoCenso(fim, h) - 1, this.diaAtual);
    for (let d = d0; d <= d1; d++) s[d - this.diaInicial]! += 1;
  }

  private acumular(internacoes: readonly InternacaoNormalizada[]): void {
    const h = this.op.horaFechamento;
    const reinternacao = this.reinternacoes(internacoes);
    for (const i of internacoes) {
      const primeiro = i.trechos[0]!;
      const ultimo = i.trechos[i.trechos.length - 1]!;
      const clin = this.acc(this.porClinica, i.clinica);
      const diaEntrada = diaDoCenso(i.ini, h);
      for (const a of [this.acc(this.porLinha, primeiro.linha), clin]) {
        this.somar(a.admissoes, diaEntrada);
        if (i.urgencia) this.somar(a.admissoesUrgencia, diaEntrada);
      }
      this.ocupar(clin.internados, i.ini, i.fim);
      for (let k = 0; k < i.trechos.length; k++) {
        const tr = i.trechos[k]!;
        this.ocupar(this.acc(this.porLinha, tr.linha).internados, tr.ini, tr.fim);
        const prox = i.trechos[k + 1];
        if (prox && prox.unidade !== tr.unidade) {
          const d = diaDoCenso(prox.ini, h);
          this.somar(this.acc(this.porLinha, tr.linha).transferenciasSaida, d);
          this.somar(this.acc(this.porLinha, prox.linha).transferenciasEntrada, d);
        }
      }
      if (i.fim !== null && i.grupo) {
        const d = diaDoCenso(i.fim, h);
        const r = reinternacao.get(i.reg);
        for (const a of [this.acc(this.porLinha, ultimo.linha), clin]) {
          this.somar(a.saidasPorGrupo[i.grupo], d);
          if (i.obitoInstitucional) this.somar(a.obitosInstitucionais, d);
          if (i.permanencia !== null && i.permanencia > 0) this.somar(a.diariasFaturadas, d, i.permanencia);
          if (r?.em7) this.somar(a.reinternacoes7, d);
          if (r?.em30) this.somar(a.reinternacoes30, d);
        }
      }
    }
  }

  /** Regra 9: nova internação do mesmo paciente até 7 ou 30 dias depois da saída viva. */
  private reinternacoes(
    internacoes: readonly InternacaoNormalizada[],
  ): Map<number, { em7: boolean; em30: boolean }> {
    const porPaciente = new Map<number, InternacaoNormalizada[]>();
    for (const i of internacoes) {
      const l = porPaciente.get(i.paciente);
      if (l) l.push(i);
      else porPaciente.set(i.paciente, [i]);
    }
    const r = new Map<number, { em7: boolean; em30: boolean }>();
    for (const lista of porPaciente.values()) {
      if (lista.length < 2) continue;
      lista.sort((a, b) => a.ini - b.ini || a.reg - b.reg);
      for (let k = 0; k < lista.length; k++) {
        const a = lista[k]!;
        if (a.fim === null || a.grupo === 'obito') continue;
        const prox = lista.slice(k + 1).find((b) => b.ini > a.fim! && b.reg !== a.reg);
        if (!prox) continue;
        const dias = (prox.ini - a.fim) / DIA;
        if (dias <= 30) r.set(a.reg, { em7: dias <= 7, em30: true });
      }
    }
    return r;
  }

  // ── Consultas ────────────────────────────────────────────────────────────────────────────────────────

  /** Linhas do censo de um dia (regra 7), com os leitos operacionais de cada unidade. */
  censoDoDia(data: string): LinhaCenso[] {
    const k = this.idx(diaDaData(data));
    const v = (s: Serie | undefined) => (k >= 0 && s ? s[k]! : 0);
    const r: LinhaCenso[] = [];
    for (const info of this.linhas.values()) {
      const a = this.porLinha.get(info.chave);
      const altas = Object.fromEntries(GRUPOS_MOTIVO_ALTA.map((g) => [g, v(a?.saidasPorGrupo[g])])) as Record<
        GrupoMotivoAlta,
        number
      >;
      const saidas = GRUPOS_MOTIVO_ALTA.reduce((s, g) => s + altas[g], 0);
      r.push({
        bloco: info.bloco,
        acomodacao: info.acomodacao,
        nome: info.nome,
        tipo: { id: info.tipo, nome: info.tipoNome },
        intensiva: info.intensiva,
        internados: v(a?.internados),
        admissoes: v(a?.admissoes),
        altas,
        saidas,
        obitos: altas.obito,
        transferenciasEntrada: v(a?.transferenciasEntrada),
        transferenciasSaida: v(a?.transferenciasSaida),
        leitosOperacionais: info.leitosOperacionais,
      });
    }
    return r;
  }

  /** Dia (ISO) do censo em curso. */
  get dataAtual(): string {
    return dataDoDia(this.diaAtual);
  }

  /** Série do censo por dia ou por mês (paciente-dia, admissões, saídas, óbitos, entradas e leito-dia). */
  serieCenso(de: string, ate: string, agrupamento: 'dia' | 'mes'): PeriodoCenso[] {
    const d0 = Math.max(diaDaData(de), this.diaInicial);
    const d1 = Math.min(diaDaData(ate), this.diaAtual);
    const leitos = [...this.linhas.values()].reduce((s, l) => s + l.leitosOperacionais, 0);
    const grupos = new Map<string, PeriodoCenso>();
    const todos = [...this.porLinha.values()];
    for (let d = d0; d <= d1; d++) {
      const k = d - this.diaInicial;
      const chave = agrupamento === 'dia' ? dataDoDia(d) : mesDoDia(d);
      const g = grupos.get(chave) ?? {
        periodo: chave,
        dias: 0,
        pacientesDia: 0,
        admissoes: 0,
        saidas: 0,
        obitos: 0,
        transferenciasEntrada: 0,
        leitosDia: 0,
        parcial: false,
      };
      let pac = 0;
      let adm = 0;
      let sai = 0;
      let obi = 0;
      let tin = 0;
      for (const a of todos) {
        pac += a.internados[k]!;
        adm += a.admissoes[k]!;
        for (const gr of GRUPOS_MOTIVO_ALTA) sai += a.saidasPorGrupo[gr][k]!;
        obi += a.saidasPorGrupo.obito[k]!;
        tin += a.transferenciasEntrada[k]!;
      }
      grupos.set(chave, {
        ...g,
        dias: g.dias + 1,
        pacientesDia: g.pacientesDia + pac,
        admissoes: g.admissoes + adm,
        saidas: g.saidas + sai,
        obitos: g.obitos + obi,
        transferenciasEntrada: g.transferenciasEntrada + tin,
        leitosDia: g.leitosDia + leitos,
        parcial: g.parcial || d === this.diaAtual,
      });
    }
    // O mês corrente é parcial mesmo antes de chegar ao dia em curso (regra 14).
    if (agrupamento === 'mes') {
      const mesAtual = mesDoDia(this.diaAtual);
      const g = grupos.get(mesAtual);
      if (g) grupos.set(mesAtual, { ...g, parcial: true });
    }
    return [...grupos.values()];
  }

  // ── Base dos indicadores ─────────────────────────────────────────────────────────────────────────────

  /** Valores possíveis de um recorte (chave e rótulo). */
  opcoesRecorte(recorte: Exclude<RecorteIndicador, 'todos'>): { valor: string; rotulo: string }[] {
    if (recorte === 'clinica')
      return [...this.porClinica.keys()].sort().map((c) => ({ valor: c, rotulo: rotuloClinica(c) }));
    const vistos = new Map<string, string>();
    for (const l of this.linhas.values()) {
      if (recorte === 'acomodacao') vistos.set(`${l.bloco}/${l.acomodacao}`, `${l.bloco} · ${l.nome}`);
      else vistos.set(String(l.tipo), l.tipoNome);
    }
    return [...vistos.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([valor, rotulo]) => ({ valor, rotulo }));
  }

  /** Linhas (e os acumuladores) de um recorte e valor. */
  private selecionar(
    recorte: RecorteIndicador,
    valor: string | null,
  ): { acs: Acumulador[]; linhas: InfoLinha[] } {
    if (recorte === 'clinica') {
      const a = valor !== null ? this.porClinica.get(valor) : undefined;
      return { acs: a ? [a] : [], linhas: [] };
    }
    const linhas = [...this.linhas.values()].filter((l) => {
      if (recorte === 'todos' || valor === null) return true;
      if (recorte === 'acomodacao') return `${l.bloco}/${l.acomodacao}` === valor;
      return String(l.tipo) === valor;
    });
    return {
      acs: linhas.map((l) => this.porLinha.get(l.chave)).filter((a): a is Acumulador => !!a),
      linhas,
    };
  }

  /** Base mensal de um recorte, mês a mês de `de` a `ate` ("AAAA-MM"). */
  basesMensais(
    de: string,
    ate: string,
    recorte: RecorteIndicador = 'todos',
    valor: string | null = null,
  ): BaseMensal[] {
    const { acs, linhas } = this.selecionar(recorte, valor);
    const intensivas = new Set(this.op.intensivas);
    const linhasIntensivas = recorte === 'clinica' ? [] : linhas.filter((l) => intensivas.has(l.tipo));
    const acsIntensivas = linhasIntensivas
      .map((l) => this.porLinha.get(l.chave))
      .filter((a): a is Acumulador => !!a);
    const leitos = linhas.reduce((s, l) => s + l.leitosOperacionais, 0);
    const leitosIntensiva = linhasIntensivas.reduce((s, l) => s + l.leitosOperacionais, 0);
    const mesAtual = mesDoDia(this.diaAtual);
    return mesesEntre(de, ate).map((mes) => {
      const d0 = Math.max(primeiroDiaDoMes(mes), this.diaInicial);
      const d1 = Math.min(ultimoDiaDoMes(mes), this.diaAtual);
      const g: Record<GrandezaBase, number> = {
        dias: 0,
        pacientesDia: 0,
        leitosDia: 0,
        pacientesDiaIntensiva: 0,
        leitosDiaIntensiva: 0,
        admissoes: 0,
        admissoesUrgencia: 0,
        saidas: 0,
        obitos: 0,
        obitosInstitucionais: 0,
        saidasVivas: 0,
        reinternacoes7: 0,
        reinternacoes30: 0,
        diariasFaturadas: 0,
        leitosOperacionaisMedios: 0,
        leitosDiaOciosos: 0,
      };
      const altas = Object.fromEntries(GRUPOS_MOTIVO_ALTA.map((x) => [x, 0])) as Record<
        GrupoMotivoAlta,
        number
      >;
      for (let d = d0; d <= d1; d++) {
        const k = d - this.diaInicial;
        g.dias++;
        for (const a of acs) {
          g.pacientesDia += a.internados[k]!;
          g.admissoes += a.admissoes[k]!;
          g.admissoesUrgencia += a.admissoesUrgencia[k]!;
          for (const x of GRUPOS_MOTIVO_ALTA) altas[x] += a.saidasPorGrupo[x][k]!;
          g.obitosInstitucionais += a.obitosInstitucionais[k]!;
          g.reinternacoes7 += a.reinternacoes7[k]!;
          g.reinternacoes30 += a.reinternacoes30[k]!;
          g.diariasFaturadas += a.diariasFaturadas[k]!;
        }
        for (const a of acsIntensivas) g.pacientesDiaIntensiva += a.internados[k]!;
      }
      g.leitosDia = leitos * g.dias;
      g.leitosDiaIntensiva = leitosIntensiva * g.dias;
      g.leitosOperacionaisMedios = g.dias > 0 ? leitos : 0;
      g.saidas = GRUPOS_MOTIVO_ALTA.reduce((s, x) => s + altas[x], 0);
      g.obitos = altas.obito;
      g.saidasVivas = g.saidas - g.obitos;
      g.leitosDiaOciosos = Math.max(0, g.leitosDia - g.pacientesDia);
      return { periodo: mes, parcial: mes >= mesAtual, grandezas: g, altasPorGrupo: altas };
    });
  }

  /** Detalhar um mês pelo recorte: uma base por valor do recorte. */
  detalhar(
    mes: string,
    recorte: Exclude<RecorteIndicador, 'todos'>,
  ): { chave: string; rotulo: string; base: BaseMensal }[] {
    return this.opcoesRecorte(recorte).map((o) => ({
      chave: o.valor,
      rotulo: o.rotulo,
      base: this.basesMensais(mes, mes, recorte, o.valor)[0]!,
    }));
  }
}
