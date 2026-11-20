// Porta da estrutura de custos em memória (M54, etapa 4): a sessão sintética de dev/ci (E2E) e os testes da API.
// Centros de custo, domínios e fontes agregadas SINTÉTICOS, por estabelecimento; as gravações seguem as mesmas regras
// do legado (versão lida, coleta que substitui só as coletadas, manual que substitui só o manual). Nenhum dado real.
import {
  type ApuracaoCustosLida,
  type ApuracaoParaGravar,
  type CodigosExportacaoLidos,
  type ContaParaGravar,
  type CustoContaLido,
  type FiltroContasCusto,
  type FontesCusteioLidas,
  type GrupoResultadoLido,
  type LinhaCentroLida,
  TAMANHO_PAGINA_CONTAS,
} from '@sgh/legado';
import type {
  CentroCustoEstruturaLido,
  ClassificacaoParaGravar,
  ColetaLida,
  ColetaParaGravar,
  DominiosCustosLidos,
  EstatisticaLida,
  FontesEstatisticaLidas,
  LancamentoEstatisticaParaGravar,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoCustos, PortaCustos } from './porta.js';

const CENTROS_SINTETICOS: readonly Omit<CentroCustoEstruturaLido, 'classificacao'>[] = [
  {
    id: 101,
    codigo: 300100,
    nome: 'UTI ADULTO SINTETICA',
    sigla: 'UTI',
    ativo: true,
    produtivoCadastro: true,
  },
  {
    id: 102,
    codigo: 300310,
    nome: 'CENTRO CIRURGICO SINTETICO',
    sigla: 'CC',
    ativo: true,
    produtivoCadastro: true,
  },
  {
    id: 103,
    codigo: 300500,
    nome: 'LABORATORIO SINTETICO',
    sigla: 'LAB',
    ativo: true,
    produtivoCadastro: true,
  },
  {
    id: 104,
    codigo: 200130,
    nome: 'LAVANDERIA SINTETICA',
    sigla: 'LAV',
    ativo: true,
    produtivoCadastro: false,
  },
  {
    id: 105,
    codigo: 200140,
    nome: 'NUTRICAO SINTETICA',
    sigla: 'NUT',
    ativo: true,
    produtivoCadastro: false,
  },
  {
    id: 106,
    codigo: 100124,
    nome: 'ADMINISTRACAO SINTETICA',
    sigla: 'ADM',
    ativo: true,
    produtivoCadastro: false,
  },
  {
    id: 107,
    codigo: 100999,
    nome: 'SETOR DESATIVADO SINTETICO',
    sigla: null,
    ativo: false,
    produtivoCadastro: null,
  },
];

const DOMINIOS: DominiosCustosLidos = {
  tiposDado: [
    { id: 1, nome: 'Lançamento' },
    { id: 2, nome: 'Referência' },
  ],
  unidades: [{ codigo: 0, nome: 'Não informada' }],
  gruposExportacao: [
    { id: 1, nome: 'Próprio', ativo: true },
    { id: 2, nome: 'ApuraSUS', ativo: true },
    { id: 3, nome: 'Federassantas', ativo: true },
  ],
};

/** Fontes sintéticas de qualquer competência (o censo fechado em 10 dias: o paciente-dia sai estimado). */
const FONTES: FontesEstatisticaLidas = {
  censo: { grupos: [{ cdc: 300100, quantidade: 95 }], diasFechados: 10 },
  internacoes: [
    { cdc: 300100, quantidade: 301 },
    { cdc: 888888, quantidade: 4 },
  ],
  cirurgias: [
    { cdc: 300310, duracao: '0130', n: 20 },
    { cdc: 300310, duracao: '0045', n: 12 },
  ],
  exames: [{ cdc: 300500, quantidade: 1923 }],
  requisicoes: [
    { cdc: 300100, quantidade: 410 },
    { cdc: 300310, quantidade: 120 },
    { cdc: 200140, quantidade: 35 },
  ],
  colaboradores: [],
  leitos: [{ cdc: 300100, quantidade: 10 }],
};

/** Fontes sintéticas do custeio de qualquer competência (sem folha: a apuração sai "parcial (sem pessoal)"). */
const FONTES_CUSTEIO: FontesCusteioLidas = {
  materiais: [
    { cdc: 300100, centavos: 4_500_000, linhas: 820 },
    { cdc: 300310, centavos: 2_800_000, linhas: 310 },
    { cdc: 300500, centavos: 900_000, linhas: 140 },
    { cdc: 200140, centavos: 650_000, linhas: 60 },
    { cdc: 200130, centavos: 120_000, linhas: 25 },
  ],
  atipicas: [{ cdc: 200130, centavos: 12_000_000_000, linhas: 2 }],
  devolucoes: [{ cdc: 300100, centavos: 150_000, linhas: 12 }],
  devolucoesAtipicas: [{ cdc: 200130, centavos: 1_000_000_000, linhas: 1 }],
  despesas: [
    { cdc: 0, centavos: 1_500_000, linhas: 40 },
    { cdc: 100124, centavos: 300_000, linhas: 5 },
  ],
  pessoal: [],
  itensConta: [
    {
      conta: 9001,
      numero: 501,
      tipoConta: 'I',
      convenio: 12,
      procedimento: '0303010',
      cdc: 300100,
      bruta: 3_000_000,
      glosa: 150_000,
      recurso: 0,
    },
    {
      conta: 9001,
      numero: 501,
      tipoConta: 'I',
      convenio: 12,
      procedimento: '0303010',
      cdc: 300500,
      bruta: 200_000,
      glosa: 0,
      recurso: 0,
    },
    {
      conta: 9002,
      numero: 502,
      tipoConta: 'I',
      convenio: 12,
      procedimento: '0415010',
      cdc: 300310,
      bruta: 2_500_000,
      glosa: 0,
      recurso: 0,
    },
    {
      conta: 9002,
      numero: 502,
      tipoConta: 'I',
      convenio: 12,
      procedimento: '0415010',
      cdc: 300100,
      bruta: 800_000,
      glosa: 0,
      recurso: 0,
    },
    {
      conta: 9003,
      numero: 503,
      tipoConta: 'E',
      convenio: 30,
      procedimento: '0202010',
      cdc: 300500,
      bruta: 180_000,
      glosa: 0,
      recurso: 0,
    },
    {
      conta: 9004,
      numero: 504,
      tipoConta: 'E',
      convenio: 30,
      procedimento: '0202010',
      cdc: 300500,
      bruta: 95_000,
      glosa: 10_000,
      recurso: 5_000,
    },
    {
      conta: 9005,
      numero: 505,
      tipoConta: 'I',
      convenio: 40,
      procedimento: '0303010',
      cdc: 300100,
      bruta: 1_200_000,
      glosa: 300_000,
      recurso: 0,
    },
  ],
  contasFechadas: 5,
  truncado: false,
};

const CODIGOS_EXPORTACAO: CodigosExportacaoLidos = {
  centros: [
    { id: 101, codigoApurasus: '02.01', unidade: 0 },
    { id: 102, codigoApurasus: '02.05', unidade: 0 },
    { id: 103, codigoApurasus: null, unidade: 0 },
  ],
  unidades: [{ codigo: 0, codigoApurasus: null }],
};

const CONVENIOS = new Map([
  [12, 'OPERADORA SINTETICA A'],
  [30, 'OPERADORA SINTETICA B'],
  [40, 'CONVENIO PUBLICO SINTETICO'],
]);

interface Estado {
  classificacoes: Map<number, NonNullable<CentroCustoEstruturaLido['classificacao']>>;
  registros: (EstatisticaLida & { vigente: boolean })[];
  coletas: ColetaLida[];
  seq: number;
  apuracoes: ApuracaoCustosLida[];
  linhas: Map<number, LinhaCentroLida[]>;
  contas: Map<number, ContaParaGravar[]>;
}

const desatualizadoApuracao = () =>
  new ErroProblema(
    'recusa-de-negocio',
    409,
    'Operação recusada',
    'A apuração desta competência mudou depois que você abriu (outra pessoa apurou ou aprovou). Abra de novo para ver a versão atual.',
    { codigo: 'desatualizado' },
  );

/** Prontuário sintético da conta (as contas 9001 e 9002 são do mesmo paciente; as demais, uma por paciente). */
const prontuarioSintetico = (conta: number): number | null =>
  conta === 9001 || conta === 9002 ? 800001 : conta > 0 ? 800000 + conta : null;
const contaLida = (c: ContaParaGravar): CustoContaLido => ({
  ...c,
  parcelas: JSON.stringify(c.parcelas),
  prontuario: prontuarioSintetico(c.conta),
});

const agora = (): string => new Date().toISOString().slice(0, 23);

export class PortaCustosMemoria implements PortaCustos {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  private estado(c: ContextoCustos): Estado {
    let e = this.estados.get(c.hospital);
    if (!e) {
      e = {
        classificacoes: new Map(),
        registros: [],
        coletas: [],
        seq: 0,
        apuracoes: [],
        linhas: new Map(),
        contas: new Map(),
      };
      this.estados.set(c.hospital, e);
    }
    return e;
  }

  private montar(e: Estado, id: number): CentroCustoEstruturaLido | null {
    const base = CENTROS_SINTETICOS.find((c) => c.id === id);
    return base ? { ...base, classificacao: e.classificacoes.get(id) ?? null } : null;
  }

  async centros(c: ContextoCustos): Promise<CentroCustoEstruturaLido[]> {
    const e = this.estado(c);
    return CENTROS_SINTETICOS.map((x) => this.montar(e, x.id)!);
  }

  async centro(c: ContextoCustos, id: number): Promise<CentroCustoEstruturaLido | null> {
    return this.montar(this.estado(c), id);
  }

  async dominios(): Promise<DominiosCustosLidos> {
    return DOMINIOS;
  }

  async fontes(): Promise<FontesEstatisticaLidas> {
    return FONTES;
  }

  async estatisticas(
    c: ContextoCustos,
    competencia: string,
  ): Promise<{ registros: EstatisticaLida[]; truncado: boolean }> {
    const registros = this.estado(c)
      .registros.filter(
        (r) =>
          r.vigente && (r.competencia === competencia || (r.competencia < competencia && r.tipoDado === 2)),
      )
      .map((r): EstatisticaLida => {
        const { vigente, ...resto } = r;
        void vigente;
        return resto;
      });
    return { registros, truncado: false };
  }

  async ultimaColeta(c: ContextoCustos, competencia: string): Promise<ColetaLida | null> {
    return (
      this.estado(c)
        .coletas.filter((x) => x.competencia === competencia)
        .at(-1) ?? null
    );
  }

  async classificar(
    c: ContextoCustos,
    x: ClassificacaoParaGravar,
    por: string,
  ): Promise<{ antes: CentroCustoEstruturaLido; depois: CentroCustoEstruturaLido; mudou: boolean } | null> {
    const e = this.estado(c);
    const antes = this.montar(e, x.centro);
    if (!antes) return null;
    const a = antes.classificacao;
    if (x.versao === null ? a !== null : a === null || a.versao !== x.versao)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Operação recusada',
        'A classificação deste centro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
        { codigo: 'desatualizado' },
      );
    if (
      a &&
      a.classe === x.classe &&
      a.ordemRateio === x.ordemRateio &&
      a.criterio === x.criterio &&
      a.unidadeMensuracao === x.unidadeMensuracao &&
      a.observacao === x.observacao
    )
      return { antes, depois: antes, mudou: false };
    e.classificacoes.set(x.centro, {
      classe: x.classe,
      ordemRateio: x.ordemRateio,
      criterio: x.criterio,
      unidadeMensuracao: x.unidadeMensuracao,
      observacao: x.observacao,
      versao: a ? a.versao + 1 : 0,
      alteradoPor: por,
      alteradoEm: agora(),
    });
    return { antes, depois: this.montar(e, x.centro)!, mudou: true };
  }

  async gravarColeta(
    c: ContextoCustos,
    x: ColetaParaGravar,
    por: string,
  ): Promise<{ id: number; gravadas: number; substituidas: number }> {
    const e = this.estado(c);
    let substituidas = 0;
    for (const r of e.registros)
      if (r.vigente && r.competencia === x.competencia && r.origem === 'coletada') {
        r.vigente = false;
        substituidas += 1;
      }
    const id = ++e.seq;
    const em = agora();
    e.coletas.push({
      id,
      competencia: x.competencia,
      resumo: x.resumo,
      linhas: x.linhas.length,
      duracaoMs: Math.round(x.duracaoMs),
      coletadaPor: por,
      coletadaEm: em,
    });
    for (const l of x.linhas)
      e.registros.push({
        id: ++e.seq,
        competencia: x.competencia,
        centro: l.centro,
        codigo: l.codigo,
        cent: l.cent,
        origem: 'coletada',
        fonte: l.fonte,
        estimada: l.estimada,
        tipoDado: l.tipoDado,
        idColeta: id,
        observacao: null,
        registradoPor: por,
        registradoEm: em,
        vigente: true,
      });
    return { id, gravadas: x.linhas.length, substituidas };
  }

  async lancar(
    c: ContextoCustos,
    x: LancamentoEstatisticaParaGravar,
    por: string,
  ): Promise<{ registro: EstatisticaLida; substituidas: number }> {
    const e = this.estado(c);
    let substituidas = 0;
    for (const r of e.registros)
      if (
        r.vigente &&
        r.competencia === x.competencia &&
        r.centro === x.centro &&
        r.codigo === x.codigo &&
        r.origem === 'manual'
      ) {
        r.vigente = false;
        substituidas += 1;
      }
    const registro: EstatisticaLida = {
      id: ++e.seq,
      competencia: x.competencia,
      centro: x.centro,
      codigo: x.codigo,
      cent: x.cent,
      origem: 'manual',
      fonte: 'manual',
      estimada: false,
      tipoDado: x.tipoDado,
      idColeta: null,
      observacao: x.observacao,
      registradoPor: por,
      registradoEm: agora(),
    };
    e.registros.push({ ...registro, vigente: true });
    return { registro, substituidas };
  }

  // ── Etapa 5 ──

  async fontesCusteio(): Promise<FontesCusteioLidas> {
    return FONTES_CUSTEIO;
  }

  async codigosExportacao(): Promise<CodigosExportacaoLidos> {
    return CODIGOS_EXPORTACAO;
  }

  async nomesConvenios(_c: ContextoCustos, codigos: readonly number[]): Promise<Map<number, string>> {
    return new Map(codigos.filter((k) => CONVENIOS.has(k)).map((k) => [k, CONVENIOS.get(k)!]));
  }

  async apuracoes(c: ContextoCustos, competencia: string): Promise<ApuracaoCustosLida[]> {
    return this.estado(c)
      .apuracoes.filter((a) => a.competencia === competencia)
      .sort((a, b) => b.id - a.id);
  }

  async apuracao(c: ContextoCustos, id: number): Promise<ApuracaoCustosLida | null> {
    return this.estado(c).apuracoes.find((a) => a.id === id) ?? null;
  }

  async linhasApuracao(c: ContextoCustos, id: number): Promise<LinhaCentroLida[]> {
    return this.estado(c).linhas.get(id) ?? [];
  }

  async contasApuracao(
    c: ContextoCustos,
    id: number,
    f: FiltroContasCusto,
  ): Promise<{ total: number; contas: CustoContaLido[] }> {
    const ls = (this.estado(c).contas.get(id) ?? [])
      .filter(
        (x) =>
          (f.convenio === undefined || x.convenio === f.convenio) &&
          (f.procedimento === undefined || x.procedimento === f.procedimento) &&
          (f.numero === undefined || x.numero === f.numero) &&
          (f.prontuario === undefined || prontuarioSintetico(x.conta) === f.prontuario) &&
          (!f.negativas || x.margem < 0),
      )
      .sort((a, b) => a.margem - b.margem || a.conta - b.conta);
    const ini = (Math.max(1, f.pagina) - 1) * TAMANHO_PAGINA_CONTAS;
    return { total: ls.length, contas: ls.slice(ini, ini + TAMANHO_PAGINA_CONTAS).map(contaLida) };
  }

  async resultadoAgrupado(
    c: ContextoCustos,
    id: number,
    agrupamento: 'convenio' | 'procedimento' | 'tipoConta' | 'paciente',
  ): Promise<GrupoResultadoLido[]> {
    const g = new Map<string | null, GrupoResultadoLido>();
    for (const x of this.estado(c).contas.get(id) ?? []) {
      const v =
        agrupamento === 'convenio'
          ? x.convenio
          : agrupamento === 'procedimento'
            ? x.procedimento
            : agrupamento === 'paciente'
              ? prontuarioSintetico(x.conta)
              : x.tipoConta;
      const k = v === null ? null : String(v);
      const a = g.get(k) ?? {
        chave: k,
        contas: 0,
        receitaBruta: 0,
        glosa: 0,
        recurso: 0,
        receitaLiquida: 0,
        custo: 0,
        margem: 0,
      };
      g.set(k, {
        chave: k,
        contas: a.contas + 1,
        receitaBruta: a.receitaBruta + x.receitaBruta,
        glosa: a.glosa + x.glosa,
        recurso: a.recurso + x.recurso,
        receitaLiquida: a.receitaLiquida + x.receitaLiquida,
        custo: a.custo + x.custo,
        margem: a.margem + x.margem,
      });
    }
    return [...g.values()];
  }

  async gravarApuracao(
    c: ContextoCustos,
    x: ApuracaoParaGravar,
    por: string,
  ): Promise<{ apuracao: ApuracaoCustosLida; substituida: number | null }> {
    const e = this.estado(c);
    const vigentes = e.apuracoes.filter(
      (a) => a.competencia === x.competencia && a.situacao !== 'substituida',
    );
    if (x.substitui) {
      const i = e.apuracoes.findIndex(
        (a) => a.id === x.substitui!.id && a.versao === x.substitui!.versao && a.situacao !== 'substituida',
      );
      if (i < 0) throw desatualizadoApuracao();
      e.apuracoes[i] = { ...e.apuracoes[i]!, situacao: 'substituida', versao: e.apuracoes[i]!.versao + 1 };
    } else if (vigentes.length > 0) throw desatualizadoApuracao();
    const id = ++e.seq;
    const apuracao: ApuracaoCustosLida = {
      id,
      competencia: x.competencia,
      situacao: 'apurada',
      versao: 0,
      parcial: x.rotuloParcial !== null,
      rotuloParcial: x.rotuloParcial,
      limiteLinha: x.limiteLinha,
      custoProdutivos: x.custoProdutivos,
      totais: x.totais,
      completude: x.completude,
      pendencias: x.pendencias,
      impressao: x.impressao,
      justificativa: x.justificativa,
      duracaoMs: Math.round(x.duracaoMs),
      apuradaPor: por,
      apuradaEm: agora(),
      aprovadaPor: null,
      aprovadaEm: null,
    };
    e.apuracoes.push(apuracao);
    e.linhas.set(
      id,
      x.linhas.map((l) => ({ ...l, recebidos: JSON.stringify(l.recebidos) })),
    );
    e.contas.set(id, [...x.contas]);
    return { apuracao, substituida: x.substitui?.id ?? null };
  }

  async aprovarApuracao(
    c: ContextoCustos,
    id: number,
    versao: number,
    por: string,
  ): Promise<{ antes: ApuracaoCustosLida; depois: ApuracaoCustosLida } | null> {
    const e = this.estado(c);
    const i = e.apuracoes.findIndex((a) => a.id === id);
    if (i < 0) return null;
    const antes = e.apuracoes[i]!;
    if (antes.versao !== versao || antes.situacao !== 'apurada') throw desatualizadoApuracao();
    const depois: ApuracaoCustosLida = {
      ...antes,
      situacao: 'aprovada',
      versao: antes.versao + 1,
      aprovadaPor: por,
      aprovadaEm: agora(),
    };
    e.apuracoes[i] = depois;
    return { antes, depois };
  }
}
