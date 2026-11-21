// Porta da contabilidade em MEMÓRIA (M54-F1): a sessão sintética de dev/ci (E2E). Os domínios com os códigos que o banco
// do estabelecimento tem (origens e tipos de plano referencial com rótulos de produto), um plano de contas curto, um
// de-para da exportação e fatos SINTÉTICOS de duas fontes (nenhum dado de pessoa), as mesmas recusas do banco (código
// repetido, versão vista, versão de regra concorrente) e o relógio do processo. Nada vai à cópia. A trilha da memória é
// registrada pela API (como nas outras portas em memória).
import { ORIGENS_LANCAMENTO } from '@sgh/contratos';
import type {
  ContaPlanoVersionada,
  FiltroSomasPorta,
  EstadoFonteFatos,
  FatoRegistrado,
  ItemDePara,
  ReferenciasContabeis,
  RegraPublicada,
  FiltroLancamentosPorta,
  FiltroRazaoPorta,
  ResumoFonteFatos,
} from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import { DemonstracoesMemoria, EMPRESA_SINTETICA } from './memoria-demonstracoes.js';
import { LancamentosMemoria } from './memoria-lancamentos.js';
import type { ContextoContabil, GravadorContabil, PedidoDeGravacao, PortaContabil } from './porta.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroProblema('recusa-de-negocio', 409, 'Não foi possível gravar', detalhe, { codigo });

const agora = () => new Date().toISOString().slice(0, 19);
const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const conta = (codigo: string, nome: string, extra: Partial<ContaPlanoVersionada> = {}): ContaPlanoVersionada => ({
  empresa: 1,
  codigo,
  nome,
  grupo: 'ativo',
  tipo: 'analitica',
  natureza: 'devedora',
  referencialTipo: null,
  referencialConta: null,
  contaExportacao: null,
  exigeCentroCusto: false,
  ativa: true,
  versao: 1,
  alteradoPor: 'SINTETICO',
  alteradoEm: '2026-10-01T08:00:00',
  ...extra,
});

/** O plano sintético (máscara 9.9.9.99.9999). */
export const PLANO_SINTETICO: readonly ContaPlanoVersionada[] = [
  conta('1', 'Ativo', { tipo: 'sintetica' }),
  conta('1.1', 'Ativo circulante', { tipo: 'sintetica' }),
  conta('1.1.2', 'Créditos', { tipo: 'sintetica' }),
  conta('1.1.2.01', 'Clientes', { tipo: 'sintetica' }),
  conta('1.1.2.01.0001', 'Convênios a receber', {
    contaExportacao: 1101,
    referencialTipo: 1,
    referencialConta: '1.01.02.01',
  }),
  // M54.3: o patrimônio líquido, destino da apuração do resultado do exercício.
  conta('2', 'Patrimônio líquido', { tipo: 'sintetica', grupo: 'patrimonioLiquido', natureza: 'credora' }),
  conta('2.4', 'Patrimônio social', { tipo: 'sintetica', grupo: 'patrimonioLiquido', natureza: 'credora' }),
  conta('2.4.1', 'Resultados acumulados', {
    tipo: 'sintetica',
    grupo: 'patrimonioLiquido',
    natureza: 'credora',
  }),
  conta('2.4.1.01', 'Superávits e déficits', {
    tipo: 'sintetica',
    grupo: 'patrimonioLiquido',
    natureza: 'credora',
  }),
  conta('2.4.1.01.0001', 'Superávits acumulados', {
    grupo: 'patrimonioLiquido',
    natureza: 'credora',
    referencialTipo: 1,
    referencialConta: '2.03.04.01',
  }),
  conta('3', 'Receitas', { tipo: 'sintetica', grupo: 'receita', natureza: 'credora' }),
  conta('3.1', 'Receita operacional', { tipo: 'sintetica', grupo: 'receita', natureza: 'credora' }),
  conta('3.1.1', 'Serviços hospitalares', { tipo: 'sintetica', grupo: 'receita', natureza: 'credora' }),
  conta('3.1.1.01', 'Convênios', { tipo: 'sintetica', grupo: 'receita', natureza: 'credora' }),
  conta('3.1.1.01.0001', 'Receita de convênios', {
    grupo: 'receita',
    natureza: 'credora',
    exigeCentroCusto: true,
  }),
];

const fato = (idFato: number, id: number, valorCentavos: number, convenio: number): FatoRegistrado => ({
  idFato,
  tabela: 'FCCTAEXT',
  id,
  tipo: 'receitaConta',
  origem: 3,
  empresa: 1,
  data: '2026-10-15',
  competencia: '2026-10',
  valorCentavos,
  centroCusto: 12,
  documento: `conta ${id}`,
  campos: { convenio, tipoConta: 'A' },
  impressao: `sint${String(idFato).padStart(12, '0')}`,
  carimbo: null,
  estorno: false,
  referencia: null,
  situacao: 'pendente',
  motivo: null,
  regraId: null,
  lidoEm: '2026-10-16T01:00:00',
});

export class PortaContabilMemoria implements PortaContabil {
  readonly destino = 'memoria' as const;
  readonly contas: ContaPlanoVersionada[] = PLANO_SINTETICO.map((c) => ({ ...c }));
  readonly regrasGravadas: RegraPublicada[] = [];
  readonly fatosGravados: FatoRegistrado[] = [
    fato(1, 900_001, 125_000, 5),
    fato(2, 900_002, 87_550, 5),
    fato(3, 900_003, 40_000, 6),
  ];
  readonly estados: EstadoFonteFatos[] = [
    {
      tabela: 'FCCTAEXT',
      marca: 900_003,
      varredura: 1,
      ultimaLeitura: '2026-10-16T01:00:00',
      lidosNovos: 3,
      lidosAlterados: 0,
      fatosGravados: 3,
      versao: 1,
    },
  ];
  private seqRegra = 0;
  /** Etapa 2 (F2): lançamentos, períodos e conciliações. */
  readonly f2 = new LancamentosMemoria();
  /** Etapa 3 (F3): demonstrações e os arquivos do SPED (somam os lançamentos da etapa 2). */
  readonly f3 = new DemonstracoesMemoria(() => this.f2);

  /** Data fixa de hoje (os testes do encerramento: só competência passada encerra); nula = o relógio do processo. */
  hojeFixo: string | null = null;
  /** Só teste: roda uma vez no começo da próxima gravação (simula a outra transação que gravou depois da leitura). */
  antesDeGravar: ((p: PortaContabilMemoria) => void) | null = null;
  /** O de-para sintético por convênio (o teste completa o de-para como o contador faria). */
  readonly contasDePara = new Map<number, number | null>([
    [5, 1101],
    [6, null],
  ]);

  hoje(): Promise<string> {
    return Promise.resolve(this.hojeFixo ?? hojeLocal());
  }

  referencias(): Promise<ReferenciasContabeis> {
    return Promise.resolve({
      origens: Object.entries(ORIGENS_LANCAMENTO).map(([id, descricao]) => ({ id: Number(id), descricao })),
      tiposPlanoReferencial: [
        { id: 1, codigo: '1', descricao: 'Pessoas jurídicas em geral (lucro real)', ecf: true },
        { id: 2, codigo: '2', descricao: 'Pessoas jurídicas em geral (lucro presumido)', ecf: true },
        { id: 7, codigo: '7', descricao: 'Entidades imunes e isentas', ecf: true },
      ],
    });
  }

  dePara(_c: ContextoContabil, empresa: number): Promise<ItemDePara[]> {
    const item = (convenio: number, conta: number | null): ItemDePara => ({
      empresa,
      convenio,
      tipoConta: 'A',
      tipoLancamento: null,
      tipoAto: null,
      subtipoDiaria: null,
      contaExportacao: conta,
    });
    return Promise.resolve([...this.contasDePara].map(([conv, conta]) => item(conv, conta)));
  }

  centrosCusto(): Promise<{ codigo: number; nome: string; ativo: boolean }[]> {
    return Promise.resolve([
      { codigo: 3, nome: 'Administração', ativo: true },
      { codigo: 12, nome: 'Centro cirúrgico', ativo: true },
      { codigo: 40, nome: 'Unidade desativada', ativo: false },
    ]);
  }

  empresas(): Promise<number[]> {
    return Promise.resolve([...new Set(this.contas.map((c) => c.empresa))].sort((a, b) => a - b));
  }

  plano(_c: ContextoContabil, empresa: number): Promise<ContaPlanoVersionada[]> {
    return Promise.resolve(
      this.contas
        .filter((c) => c.empresa === empresa)
        .map((c) => ({ ...c }))
        .sort((a, b) => a.codigo.localeCompare(b.codigo)),
    );
  }

  regras(
    _c: ContextoContabil,
    empresa: number,
    f: { origem?: number; tipoFato?: string },
  ): Promise<RegraPublicada[]> {
    return Promise.resolve(
      this.regrasGravadas.filter(
        (r) =>
          r.regra.empresa === empresa &&
          (f.origem === undefined || r.regra.origem === f.origem) &&
          (f.tipoFato === undefined || r.regra.tipoFato === f.tipoFato),
      ),
    );
  }

  fontes(): Promise<EstadoFonteFatos[]> {
    return Promise.resolve(this.estados.map((e) => ({ ...e })));
  }

  resumoFatos(): Promise<ResumoFonteFatos[]> {
    const por = new Map<string, Record<string, number>>();
    for (const f of this.fatosGravados) {
      const x = por.get(f.tabela) ?? {};
      x[f.situacao] = (x[f.situacao] ?? 0) + 1;
      por.set(f.tabela, x);
    }
    return Promise.resolve([...por.entries()].map(([tabela, porSituacao]) => ({ tabela, porSituacao })));
  }

  fatos(
    _c: ContextoContabil,
    f: {
      empresa?: number;
      competencia?: string;
      origem?: number;
      tipoFato?: string;
      situacao?: string;
    },
    pagina: number,
    tamanho: number,
  ): Promise<{ itens: FatoRegistrado[]; total: number }> {
    const todos = this.fatosGravados
      .filter(
        (x) =>
          (f.empresa === undefined || x.empresa === f.empresa) &&
          (f.competencia === undefined || x.competencia === f.competencia) &&
          (f.origem === undefined || x.origem === f.origem) &&
          (f.tipoFato === undefined || x.tipo === f.tipoFato) &&
          (f.situacao === undefined || x.situacao === f.situacao),
      )
      .sort((a, b) => b.idFato - a.idFato);
    const ini = (Math.max(1, pagina) - 1) * tamanho;
    return Promise.resolve({ itens: todos.slice(ini, ini + tamanho), total: todos.length });
  }

  fatosDaCompetencia(
    _c: ContextoContabil,
    empresa: number,
    competencia: string,
    teto: number,
  ): Promise<FatoRegistrado[]> {
    return Promise.resolve(
      this.fatosGravados
        .filter((x) => x.empresa === empresa && x.competencia === competencia)
        .sort((a, b) => a.idFato - b.idFato)
        .slice(0, teto),
    );
  }

  // ── Etapa 2 (F2) ──

  periodos(_c: ContextoContabil, empresa: number) {
    return Promise.resolve(this.f2.periodos(empresa));
  }

  movimentoPorCompetencia(_c: ContextoContabil, empresa: number) {
    return Promise.resolve(this.f2.movimentoPorCompetencia(empresa));
  }

  totaisDoPeriodo(_c: ContextoContabil, empresa: number, competencia: string) {
    return Promise.resolve(this.f2.totaisDoPeriodo(empresa, competencia));
  }

  fatosDoPeriodo(_c: ContextoContabil, empresa: number, competencia: string) {
    const r: Partial<Record<FatoRegistrado['situacao'], number>> = {};
    for (const f of this.fatosGravados.filter((x) => x.empresa === empresa && x.competencia === competencia))
      r[f.situacao] = (r[f.situacao] ?? 0) + 1;
    return Promise.resolve(r);
  }

  lancamentos(_c: ContextoContabil, f: FiltroLancamentosPorta, pagina: number, tamanho: number) {
    return Promise.resolve(this.f2.lancamentos(f, pagina, tamanho));
  }

  lancamento(_c: ContextoContabil, id: number) {
    const l = this.f2.lancamento(id);
    if (!l?.fatoId) return Promise.resolve(l);
    const f = this.fatosGravados.find((x) => x.idFato === l.fatoId);
    return Promise.resolve({
      ...l,
      fato: f
        ? { tabela: f.tabela, tipo: f.tipo, origem: f.origem, documento: f.documento, data: f.data }
        : null,
    });
  }

  lancamentosDosFatos(_c: ContextoContabil, ids: readonly number[]) {
    return Promise.resolve(this.f2.lancamentosDosFatos(ids));
  }

  razao(_c: ContextoContabil, f: FiltroRazaoPorta, teto: number, pagina = 1) {
    return Promise.resolve(this.f2.razao(f, teto, pagina));
  }

  pendentesConciliacao(
    _c: ContextoContabil,
    empresa: number,
    conta: string,
    ate: string | null,
    teto: number,
  ) {
    return Promise.resolve(this.f2.pendentesConciliacao(empresa, conta, ate, teto));
  }

  conciliacoes(_c: ContextoContabil, empresa: number, conta: string, teto: number) {
    return Promise.resolve(this.f2.conciliacoes(empresa, conta, teto));
  }

  paraContabilizar(
    _c: ContextoContabil,
    empresa: number,
    situacoes: readonly FatoRegistrado['situacao'][],
    competencia: string | null,
    lote: number,
  ) {
    const todos = this.fatosGravados
      .filter(
        (f) =>
          situacoes.includes(f.situacao) &&
          f.empresa === empresa &&
          (!competencia || f.competencia === competencia),
      )
      .sort((a, b) => a.idFato - b.idFato);
    const candidatos = todos.slice(0, lote).map((f) => ({ ...f }));
    const linhas = new Set(candidatos.map((f) => `${f.tabela}:${f.id}`));
    const registrados = this.fatosGravados
      .filter((f) => linhas.has(`${f.tabela}:${f.id}`))
      .map((f) => ({ ...f }));
    return Promise.resolve({
      candidatos,
      registrados,
      lancamentos: this.f2.lancamentosDosFatos(registrados.map((f) => f.idFato)),
      restam: todos.length > lote,
    });
  }

  somas(_c: ContextoContabil, f: FiltroSomasPorta, teto: number) {
    return Promise.resolve(this.f3.somas(f, teto));
  }

  apuracoes(_c: ContextoContabil, empresa: number, exercicio: number) {
    return Promise.resolve(this.f3.apuracoes(empresa, exercicio));
  }

  diario(_c: ContextoContabil, empresa: number, de: string, ate: string, teto: number, pagina: number) {
    return Promise.resolve(this.f3.diario(empresa, de, ate, teto, pagina));
  }

  lancamentosDoExercicio(_c: ContextoContabil, empresa: number, exercicio: number, teto: number) {
    return Promise.resolve(this.f3.lancamentosDoExercicio(empresa, exercicio, teto));
  }

  empresaSped(_c: ContextoContabil, empresa: number) {
    return Promise.resolve(empresa === EMPRESA_SINTETICA.codigo ? { ...EMPRESA_SINTETICA } : null);
  }

  arquivosSped(_c: ContextoContabil, empresa: number, teto: number) {
    return Promise.resolve(this.f3.lista(empresa, teto));
  }

  conteudoSped(_c: ContextoContabil, empresa: number, id: number) {
    return Promise.resolve(this.f3.conteudo(empresa, id));
  }

  async gravar<T>(
    _c: ContextoContabil,
    _pedido: PedidoDeGravacao,
    _trilha: unknown,
    fn: (g: GravadorContabil) => Promise<T>,
  ): Promise<T> {
    // Teste da corrida (D-CORRIDA-542): outra transação grava entre a leitura e esta gravação.
    const antes = this.antesDeGravar;
    this.antesDeGravar = null;
    antes?.(this);
    // Transação: tudo ou nada (cópias; só aplica se `fn` terminar).
    const contas = this.contas.map((c) => ({ ...c }));
    const regras = [...this.regrasGravadas];
    const fatos = this.fatosGravados.map((f) => ({ ...f }));
    const f2 = this.f2.clonar();
    const f3 = this.f3.clonar(() => this.f2);
    const g: GravadorContabil = {
      gravarLancamento: (x, usuario) => Promise.resolve().then(() => f2.gravarLancamento(x, usuario)),
      encerrarPeriodo: (x) => Promise.resolve().then(() => f2.encerrarPeriodo(x, fatos)),
      reabrirPeriodo: (x) => Promise.resolve().then(() => f2.reabrirPeriodo(x)),
      conciliar: (x) => Promise.resolve().then(() => f2.conciliar(x)),
      desfazerConciliacao: (x) => Promise.resolve().then(() => f2.desfazerConciliacao(x)),
      gravarArquivoSped: (x) => Promise.resolve().then(() => f3.gravar(x)),
      situacaoArquivoSped: (x) => Promise.resolve().then(() => f3.situacao(x)),
      incluirConta: (x) => {
        if (contas.some((c) => c.empresa === x.conta.empresa && c.codigo === x.conta.codigo))
          return Promise.reject(
            recusa('conta-ja-existe', 'Já existe uma conta com este código no plano da empresa.'),
          );
        contas.push({ ...x.conta, versao: 1, alteradoPor: x.usuario, alteradoEm: agora() });
        return Promise.resolve({ id: contas.length, versao: 1 });
      },
      alterarConta: (x) => {
        const i = contas.findIndex((c) => c.empresa === x.empresa && c.codigo === x.codigo);
        if (i < 0)
          return Promise.reject(recusa('conta-inexistente', 'A conta não existe no plano da empresa.'));
        const antes = contas[i]!;
        if (antes.versao !== x.versao)
          return Promise.reject(
            recusa(
              'conta-desatualizada',
              'A conta mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
            ),
          );
        contas[i] = { ...x.depois, versao: x.versao + 1, alteradoPor: x.usuario, alteradoEm: agora() };
        return Promise.resolve({ antes: { ...antes }, versao: x.versao + 1 });
      },
      publicarRegra: (x) => {
        const r = x.regra;
        const repetida = regras.some(
          (p) =>
            p.regra.empresa === r.empresa &&
            p.regra.origem === r.origem &&
            p.regra.tipoFato === r.tipoFato &&
            p.regra.nome === r.nome &&
            p.regra.versao === r.versao,
        );
        if (repetida)
          return Promise.reject(
            recusa(
              'versao-concorrente',
              'Outra versão desta regra foi publicada agora. Abra de novo e confira antes de publicar.',
            ),
          );
        this.seqRegra += 1;
        regras.push({
          id: this.seqRegra,
          regra: JSON.parse(x.conteudo) as RegraPublicada['regra'],
          impressao: x.impressao,
          justificativa: x.justificativa,
          publicadaPor: x.usuario,
          publicadaEm: agora(),
        });
        return Promise.resolve({ id: this.seqRegra, versao: r.versao });
      },
      marcarSituacao: (x) => {
        const f = fatos.find((y) => y.idFato === x.idFato);
        // D-CORRIDA-542: como a porta própria, só grava se a situação ainda for a lida.
        if (!f || (x.situacaoLida != null && f.situacao !== x.situacaoLida)) return Promise.resolve(false);
        Object.assign(f, { situacao: x.situacao, motivo: x.motivo, regraId: x.regraId });
        return Promise.resolve(true);
      },
    };
    const r = await fn(g);
    this.contas.splice(0, this.contas.length, ...contas);
    this.regrasGravadas.splice(0, this.regrasGravadas.length, ...regras);
    this.fatosGravados.splice(0, this.fatosGravados.length, ...fatos);
    this.f2.substituir(f2);
    this.f3.substituir(f3);
    return r;
  }
}
