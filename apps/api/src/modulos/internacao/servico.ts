// Serviço do M16: monta o painel de leitos, o censo, a série, os indicadores e os painéis gerenciais a partir da
// fonte (banco do cliente ou memória) e dos motores puros (@sgh/dominio-internacao e @sgh/dominio-relatorio). Caches por
// estabelecimento (ADR 0011: a chave leva a rede):
//   - painel: a leitura ao vivo é reaproveitada enquanto o vigia não viu mudança (50 telas que releem depois de um
//     evento fazem UMA leitura), no máximo 30 s;
//   - movimento (motor do censo e dos indicadores): enquanto o vigia não viu mudança, no máximo 2 min;
//   - painéis da cópia diária (operacional e financeiro) e a data da cópia: 6 h (DP-15), no armazém compartilhado
//     (Valkey: as réplicas da API leem a cópia diária uma vez a cada 6 h, não uma vez cada) com a memória do
//     processo como reserva. O painel ao vivo e o motor ficam na memória do processo: dependem da versão do vigia,
//     que é deste processo (D-VIGIA-1), e o motor não é serializável (a leitura do movimento leva ~1 s).
import {
  CODIGOS_INDICADOR,
  type CensoDia,
  type CodigoIndicador,
  type ConsultaIndicador,
  type DivergenciasLeitos,
  type FichaComMeta,
  GRUPOS_MOTIVO_ALTA,
  type IndiceIndicadores,
  type InternacoesMarcadas,
  type LinhaCenso,
  type PainelGerencial,
  type PainelGerencialDados,
  type PainelLeitos,
  type PeriodoCenso,
  type SerieCenso,
  type SerieIndicador,
} from '@sgh/contratos';
import {
  dataDoDia,
  diaDaData,
  instanteReal,
  mesDoAnoAnterior,
  mesDoDia,
  mesesEntre,
  montarPainel,
  MotorInternacao,
  relogioDeParede,
  VERSAO_CALCULO_CENSO,
} from '@sgh/dominio-internacao';
import { conferirLeitos } from '@sgh/dominio-organizacao';
import {
  fichaDe,
  FICHAS,
  seriesAssistenciais,
  seriesFinanceiras,
  seriesOperacionais,
  serieDe,
  situacaoDaMeta,
  ultimoFechado,
  valorDe,
} from '@sgh/dominio-relatorio';
import { ErroProblema } from '../../problema.filter.js';
import type { ParametrosM16 } from './configuracao.js';
import { type CtxInternacao, type DestinoFonte, destinoNoContrato, type FonteInternacao } from './fonte.js';
import type { ArmazemSessao } from '../../sessao/armazem.js';
import type { MotorVigia } from './vigia.js';

const TTL_PAINEL_MS = 30_000;
const TTL_MOTOR_MS = 120_000;
const TTL_COPIA_DIARIA_MS = 6 * 3_600_000;
/** Mais de 2 dias sem movimento: a tela avisa (cópia parada ou estabelecimento sem movimento). */
export const DIAS_SEM_MOVIMENTO_AVISO = 2;

interface EntradaCache<T> {
  readonly em: number;
  readonly versao: number;
  readonly valor: Promise<T>;
}

/** Chave de cache do estabelecimento: o cliente (um banco por cliente) e o id do estabelecimento da sessão. */
function chaveDoCtx(c: CtxInternacao): string {
  return c.porta ? `${c.porta.cliente}:${c.porta.estabelecimento ?? 0}` : `${c.rede}:${c.hospital}`;
}

export class ServicoInternacao {
  private readonly paineis = new Map<string, EntradaCache<PainelLeitos>>();
  private readonly motores = new Map<string, EntradaCache<{ motor: MotorInternacao; lidoEm: number }>>();
  private readonly copia = new Map<string, { em: number; valor: Promise<unknown> }>();

  constructor(
    private readonly fonte: FonteInternacao,
    private readonly vigia: Pick<MotorVigia, 'versao' | 'ultimoCiclo'> | null,
    private readonly relogio: () => number = () => Date.now(),
    /** Armazém compartilhado (Valkey) dos painéis da cópia diária; null: só a memória do processo. */
    private readonly armazem: ArmazemSessao | null = null,
  ) {}

  get destino(): DestinoFonte {
    return destinoNoContrato(this.fonte.destino);
  }

  private versao(c: CtxInternacao): number {
    return c.porta && this.vigia ? this.vigia.versao(c.porta, 'leitos') : 0;
  }

  private emCache<T>(
    mapa: Map<string, EntradaCache<T>>,
    chave: string,
    versao: number,
    ttl: number,
    carregar: () => Promise<T>,
  ): Promise<T> {
    const agora = this.relogio();
    const x = mapa.get(chave);
    if (x && x.versao === versao && agora - x.em < ttl) return x.valor;
    const valor = carregar();
    mapa.set(chave, { em: agora, versao, valor });
    valor.catch(() => mapa.delete(chave));
    return valor;
  }

  /** Agora no relógio de parede do estabelecimento. */
  agoraParede(): number {
    return relogioDeParede(this.relogio());
  }

  // ── Painel e divergência ────────────────────────────────────────────────────────────────────────────

  painel(c: CtxInternacao, p: ParametrosM16): Promise<PainelLeitos> {
    return this.emCache(
      this.paineis,
      `${chaveDoCtx(c)}:${p.intensivas.join(',')}`,
      this.versao(c),
      TTL_PAINEL_MS,
      async () => {
        const l = await this.fonte.leiturasPainel(c);
        const lidoEm = new Date(this.relogio()).toISOString();
        return montarPainel(l, {
          intensivas: p.intensivas,
          agora: this.agoraParede(),
          lidoEm,
          dadosAte: (c.porta && this.vigia?.ultimoCiclo(c.porta, 'leitos')) || lidoEm,
          destino: this.destino,
        });
      },
    );
  }

  /** Abertura do cartão (regra 16): o nome do paciente da internação em aberto. */
  pacienteDaInternacao(c: CtxInternacao, reg: number) {
    return this.fonte.pacienteDaInternacao(c, reg);
  }

  async divergencias(c: CtxInternacao): Promise<DivergenciasLeitos> {
    const { cadastro, espelho } = await this.fonte.conferencia(c);
    const r = conferirLeitos(
      {
        acomodacoes: cadastro.acomodacoes.map((a) => ({
          bloco: a.bloco.trimEnd(),
          acomodacao: a.acomodacao.trimEnd(),
          nome: a.nome.trimEnd(),
        })),
        leitos: cadastro.leitos.map((l) => ({
          bloco: l.bloco,
          acomodacao: l.acomodacao,
          leito: l.leito,
          ativo: l.ativo,
          ramal: l.ramal,
        })),
      },
      espelho,
    );
    return {
      lidoEm: new Date(this.relogio()).toISOString(),
      destino: this.destino,
      divergencias: [...r.divergencias],
      contagens: r.contagens,
      porTipo: r.porTipo,
      retratos: espelho.retratos,
    };
  }

  // ── Motor do censo e dos indicadores ─────────────────────────────────────────────────────────────────

  motor(c: CtxInternacao, p: ParametrosM16): Promise<{ motor: MotorInternacao; lidoEm: number }> {
    return this.emCache(
      this.motores,
      `${chaveDoCtx(c)}:${p.horaFechamento}:${p.intensivas.join(',')}`,
      this.versao(c),
      TTL_MOTOR_MS,
      async () => {
        const mov = await this.fonte.movimento(c);
        return {
          motor: new MotorInternacao(mov, {
            horaFechamento: p.horaFechamento,
            intensivas: p.intensivas,
            agora: this.agoraParede(),
          }),
          lidoEm: this.relogio(),
        };
      },
    );
  }

  private ultimoMovimento(m: MotorInternacao): string {
    return dataDoDia(m.ultimoMovimento);
  }

  /** Censo de um dia: o retrato fechado, o dia em aberto ou o dia passado calculado na hora. */
  async censo(c: CtxInternacao, p: ParametrosM16, data: string | undefined): Promise<CensoDia> {
    const { motor, lidoEm } = await this.motor(c, p);
    const dia = data ?? motor.dataAtual;
    if (diaDaData(dia) > diaDaData(motor.dataAtual))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Data no futuro',
        'O censo de um dia futuro não existe.',
      );
    const nomes = new Map(
      [...motor.linhas.values()].map((l) => [`${l.bloco}/${l.acomodacao}`, l.nome] as const),
    );
    const tipos = new Map([...motor.linhas.values()].map((l) => [l.tipo, l.tipoNome] as const));
    const fechado =
      dia === motor.dataAtual ? null : await this.fonte.censoFechado(c, dia, tipos, nomes, p.intensivas);
    const linhas = fechado?.linhas ?? motor.censoDoDia(dia);
    return {
      data: dia,
      situacao: fechado ? 'fechado' : dia === motor.dataAtual ? 'aberto' : 'calculado',
      horaFechamento: fechado?.horaFechamento ?? p.horaFechamento,
      versaoCalculo: fechado?.versaoCalculo ?? VERSAO_CALCULO_CENSO,
      geradoEm: fechado?.geradoEm ?? null,
      linhas,
      totais: somarLinhas(linhas),
      marcas: { ...motor.marcas },
      dadosAte: new Date(lidoEm).toISOString(),
      ultimoMovimento: this.ultimoMovimento(motor),
    };
  }

  /** Relatório das internações marcadas no cálculo (regra 5): o número da internação e a marca. */
  async internacoesMarcadas(c: CtxInternacao, p: ParametrosM16): Promise<InternacoesMarcadas> {
    const { motor, lidoEm } = await this.motor(c, p);
    const casos = [...motor.casosMarcados].sort(
      (a, b) => a.marca.localeCompare(b.marca) || a.internacao - b.internacao,
    );
    return { casos, marcas: { ...motor.marcas }, dadosAte: new Date(lidoEm).toISOString() };
  }

  async serieCenso(
    c: CtxInternacao,
    p: ParametrosM16,
    de: string,
    ate: string,
    agrupamento: 'dia' | 'mes',
  ): Promise<SerieCenso> {
    if (de > ate)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O início vem depois do fim.');
    if (agrupamento === 'dia' && diaDaData(ate) - diaDaData(de) > 366)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Período longo',
        'Por dia, até um ano; por mês, desde 2020.',
      );
    const { motor, lidoEm } = await this.motor(c, p);
    return {
      agrupamento,
      de,
      ate,
      periodos: motor.serieCenso(de, ate, agrupamento),
      dadosAte: new Date(lidoEm).toISOString(),
      ultimoMovimento: this.ultimoMovimento(motor),
    };
  }

  // ── Indicadores ──────────────────────────────────────────────────────────────────────────────────────

  /** Período padrão: os 12 meses até o mês do último movimento (ou o corrente). */
  private periodoPadrao(m: MotorInternacao, de?: string, ate?: string): { de: string; ate: string } {
    const atual = mesDoDia(m.diaAtual);
    const ultimo = mesDoDia(m.ultimoMovimento);
    const fim = ate ?? (m.diaAtual - m.ultimoMovimento > DIAS_SEM_MOVIMENTO_AVISO ? ultimo : atual);
    const [a, mm] = fim.split('-').map(Number) as [number, number];
    const inicio = de ?? `${mm === 12 ? a : a - 1}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}`;
    if (inicio > fim)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O início vem depois do fim.');
    if (inicio < '2019-01')
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'A série começa em 2019.');
    return { de: inicio, ate: fim };
  }

  private fichaComMeta(codigo: CodigoIndicador, p: ParametrosM16): FichaComMeta {
    return { ...fichaDe(codigo)!, meta: p.metas[codigo] };
  }

  async indice(c: CtxInternacao, p: ParametrosM16, de?: string, ate?: string): Promise<IndiceIndicadores> {
    const { motor, lidoEm } = await this.motor(c, p);
    const periodo = this.periodoPadrao(motor, de, ate);
    const bases = motor.basesMensais(periodo.de, periodo.ate);
    return {
      periodo,
      indicadores: FICHAS.map((f) => {
        const ficha = this.fichaComMeta(f.codigo, p);
        const ultimo = ultimoFechado(serieDe(f, bases));
        return { ficha, ultimo, situacao: situacaoDaMeta(f, ficha.meta, ultimo?.valor ?? null) };
      }),
      dadosAte: new Date(lidoEm).toISOString(),
      ultimoMovimento: this.ultimoMovimento(motor),
    };
  }

  async serieIndicador(
    c: CtxInternacao,
    p: ParametrosM16,
    codigo: string,
    q: ConsultaIndicador,
  ): Promise<SerieIndicador> {
    if (!(CODIGOS_INDICADOR as readonly string[]).includes(codigo))
      throw new ErroProblema('nao-encontrado', 404, 'Indicador não encontrado');
    const cod = codigo as CodigoIndicador;
    const f = fichaDe(cod)!;
    const { motor, lidoEm } = await this.motor(c, p);
    const periodo = this.periodoPadrao(motor, q.de, q.ate);
    if (q.recorte !== 'todos' && !f.recortes.includes(q.recorte))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Recorte sem denominador',
        'Este indicador não tem denominador neste recorte (veja a ficha técnica).',
      );
    const valor = q.recorte === 'todos' ? null : (q.valor ?? null);
    const opcoes = q.recorte === 'todos' ? [] : motor.opcoesRecorte(q.recorte);
    if (valor !== null && !opcoes.some((o) => o.valor === valor))
      throw new ErroProblema('entrada-invalida', 400, 'Recorte desconhecido', 'Escolha um valor da lista.');
    const meses = mesesEntre(periodo.de, periodo.ate);
    const bases = motor.basesMensais(periodo.de, periodo.ate, q.recorte, valor);
    const anteriores = motor.basesMensais(
      mesDoAnoAnterior(periodo.de),
      mesDoAnoAnterior(periodo.ate),
      q.recorte,
      valor,
    );
    const mesDetalhe = q.detalhar ?? meses.at(-1) ?? null;
    const recorteDetalhe = q.recorte === 'todos' ? (f.recortes[0] ?? null) : q.recorte;
    const detalhe =
      mesDetalhe && recorteDetalhe
        ? motor.detalhar(mesDetalhe, recorteDetalhe).map((x) => {
            const v = valorDe(f, x.base);
            return {
              chave: x.chave,
              rotulo: x.rotulo,
              numerador: v.numerador,
              denominador: v.denominador,
              valor: v.valor,
            };
          })
        : [];
    return {
      ficha: this.fichaComMeta(cod, p),
      recorte: q.recorte,
      valorRecorte: valor,
      opcoesRecorte: opcoes,
      valores: serieDe(f, bases),
      anoAnterior: serieDe(f, anteriores),
      detalhe,
      periodoDetalhe: mesDetalhe,
      dadosAte: new Date(lidoEm).toISOString(),
      ultimoMovimento: this.ultimoMovimento(motor),
    };
  }

  // ── Painéis gerenciais ───────────────────────────────────────────────────────────────────────────────

  private daCopia<T>(
    c: CtxInternacao,
    tipo: string,
    de: string,
    ate: string,
    ler: () => Promise<T>,
    reviver: (bruto: unknown) => T = (x) => x as T,
  ): Promise<T> {
    const k = `${chaveDoCtx(c)}:${tipo}:${de}:${ate}`;
    const x = this.copia.get(k);
    if (x && this.relogio() - x.em < TTL_COPIA_DIARIA_MS) return x.valor as Promise<T>;
    const valor = this.daCopiaCompartilhada(
      `sgh:${c.porta?.cliente ?? c.rede}:m16:copia:${c.porta?.estabelecimento ?? c.hospital}:${tipo}:${de}:${ate}`,
      ler,
      reviver,
    );
    this.copia.set(k, { em: this.relogio(), valor });
    valor.catch(() => this.copia.delete(k));
    return valor;
  }

  /** O valor no armazém compartilhado; sem ele (ou fora do ar), a leitura da cópia, gravada para as outras réplicas. */
  private async daCopiaCompartilhada<T>(
    chave: string,
    ler: () => Promise<T>,
    reviver: (bruto: unknown) => T,
  ): Promise<T> {
    if (this.armazem) {
      try {
        const bruto = await this.armazem.obter(chave);
        if (bruto !== null) return reviver((JSON.parse(bruto) as { v: unknown }).v);
      } catch {
        // Armazém fora ou valor ilegível: lê da cópia.
      }
    }
    const v = await ler();
    if (this.armazem)
      await this.armazem
        .gravar(chave, JSON.stringify({ v }), TTL_COPIA_DIARIA_MS / 1000)
        .catch(() => undefined);
    return v;
  }

  async painelGerencial(
    c: CtxInternacao,
    p: ParametrosM16,
    painel: PainelGerencial,
    de?: string,
    ate?: string,
  ): Promise<PainelGerencialDados> {
    const { motor, lidoEm } = await this.motor(c, p);
    if (painel === 'assistencial') {
      const periodo = this.periodoPadrao(motor, de, ate);
      return {
        painel,
        fonte: 'ao-vivo',
        periodo,
        dadosAte: new Date(lidoEm).toISOString(),
        series: seriesAssistenciais(motor.basesMensais(periodo.de, periodo.ate)),
        notas: [
          'Indicadores calculados da trajetória do paciente (trechos de leito) na hora de fechamento do censo; o mês corrente é parcial.',
        ],
        ultimoMovimento: this.ultimoMovimento(motor),
      };
    }
    const copia = await this.daCopia(
      c,
      'data',
      '',
      '',
      () => this.fonte.dataDaCopia(c),
      (x) => (typeof x === 'string' ? new Date(x) : null),
    );
    // Na cópia diária, o período padrão termina no mês da data da cópia.
    const mesCopia = copia ? copia.toISOString().slice(0, 7) : mesDoDia(motor.diaAtual);
    const fim = ate ?? mesCopia;
    const [a, mm] = fim.split('-').map(Number) as [number, number];
    const inicio = de ?? `${mm === 12 ? a : a - 1}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}`;
    if (inicio > fim)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O início vem depois do fim.');
    const meses = mesesEntre(inicio, fim);
    const dadosAte = copia
      ? new Date(instanteReal(copia.getTime())).toISOString()
      : new Date(lidoEm).toISOString();
    if (painel === 'operacional') {
      const linhas = await this.daCopia(c, 'operacional', inicio, fim, () =>
        this.fonte.operacional(c, inicio, fim),
      );
      return {
        painel,
        fonte: 'copia-diaria',
        periodo: { de: inicio, ate: fim },
        dadosAte,
        series: seriesOperacionais(linhas, meses, mesCopia),
        notas: [
          'Contagens por mês na cópia diária do banco (nunca no banco em uso); o mês da cópia é parcial.',
        ],
        ultimoMovimento: null,
      };
    }
    const linhas = await this.daCopia(c, 'financeiro', inicio, fim, () =>
      this.fonte.financeiro(c, inicio, fim),
    );
    return {
      painel,
      fonte: 'copia-diaria',
      periodo: { de: inicio, ate: fim },
      dadosAte,
      series: seriesFinanceiras(linhas, meses, mesCopia),
      notas: [
        'Duas réguas da receita: pela data do item e pela competência da conta. Elas divergem no mês e convergem no ano: compare sempre na mesma régua.',
        'A glosa é calculada só sobre os itens já baixados (cobrado − pago); a maturação mostra quanto do cobrado já foi baixado. Itens recentes ainda não baixados não são glosa.',
        'Não há receita por médico: o profissional responsável não é registrado no item de conta.',
      ],
      ultimoMovimento: null,
    };
  }
}

/** Totais das linhas do censo. */
export function somarLinhas(linhas: readonly LinhaCenso[]): CensoDia['totais'] {
  const altas = Object.fromEntries(GRUPOS_MOTIVO_ALTA.map((g) => [g, 0])) as LinhaCenso['altas'];
  const t = {
    internados: 0,
    admissoes: 0,
    altas,
    saidas: 0,
    obitos: 0,
    transferenciasEntrada: 0,
    transferenciasSaida: 0,
    leitosOperacionais: 0,
  };
  for (const l of linhas) {
    t.internados += l.internados;
    t.admissoes += l.admissoes;
    for (const g of GRUPOS_MOTIVO_ALTA) altas[g] += l.altas[g];
    t.saidas += l.saidas;
    t.obitos += l.obitos;
    t.transferenciasEntrada += l.transferenciasEntrada;
    t.transferenciasSaida += l.transferenciasSaida;
    t.leitosOperacionais += l.leitosOperacionais;
  }
  return t;
}

/** Planilha do censo do dia (só contagens; separador ";"). */
export function planilhaDoCenso(c: CensoDia): string {
  const cab = [
    'data',
    'bloco',
    'acomodacao',
    'tipo',
    'internados',
    'admissoes',
    ...GRUPOS_MOTIVO_ALTA.map((g) => `saidas_${g}`),
    'transferencias_entrada',
    'transferencias_saida',
    'leitos_operacionais',
    'situacao',
  ];
  const q = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const linhas = c.linhas.map((l) =>
    [
      c.data,
      q(l.bloco),
      q(l.nome),
      q(l.tipo.nome),
      l.internados,
      l.admissoes,
      ...GRUPOS_MOTIVO_ALTA.map((g) => l.altas[g]),
      l.transferenciasEntrada,
      l.transferenciasSaida,
      l.leitosOperacionais,
      c.situacao,
    ].join(';'),
  );
  return [cab.join(';'), ...linhas].join('\r\n') + '\r\n';
}

/** Planilha das internações marcadas (o número da internação e a marca; separador ";"). */
export function planilhaDasMarcadas(m: InternacoesMarcadas, rotulo: (marca: string) => string): string {
  const linhas = m.casos.map((x) => [x.internacao, `"${rotulo(x.marca).replaceAll('"', '""')}"`].join(';'));
  return [['internacao', 'marca'].join(';'), ...linhas].join('\r\n') + '\r\n';
}

/** Planilha da série do censo. */
export function planilhaDaSerieCenso(s: SerieCenso): string {
  const cab = [
    'periodo',
    'dias',
    'pacientes_dia',
    'admissoes',
    'saidas',
    'obitos',
    'transferencias_entrada',
    'leitos_dia',
    'parcial',
  ];
  const linhas = s.periodos.map((p: PeriodoCenso) =>
    [
      p.periodo,
      p.dias,
      p.pacientesDia,
      p.admissoes,
      p.saidas,
      p.obitos,
      p.transferenciasEntrada,
      p.leitosDia,
      p.parcial ? 'sim' : 'não',
    ].join(';'),
  );
  return [cab.join(';'), ...linhas].join('\r\n') + '\r\n';
}
