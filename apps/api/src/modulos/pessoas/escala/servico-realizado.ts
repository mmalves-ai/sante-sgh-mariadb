// Serviço do plantão realizado e do relatório ao repasse, fatia F6 (M52.6; ficha, seções 5 e 14, DP-33): a lista dos
// plantões da escala publicada da competência com o realizado, a sugestão pelas marcações do ponto, o registro (chave
// `pessoas.plantaoRealizado`), a decisão por OUTRA pessoa (quatro olhos; nunca o próprio plantão; nunca na sessão
// "como"), as tarifas por hora, o relatório dos realizados aprovados do prestador com as contas e o lançamento no
// repasse pela receita `repasse.lancarEvento`, origem `plantao` (sem chave de liberação desde a C2-100, ADR 0002: vale a
// permissão do cargo e o evento de repasse no parâmetro; `pessoas.repassePlantao` fica só como nome do recurso na trilha). As regras ficam em @sgh/dominio-pessoas.
import { type RegistroPlantaoParaRealizado, type RegistroRealizado } from './tipos.js';
import {
  type ApoioRealizado,
  CHAVE_PESSOAS_PLANTAO_REALIZADO,
  CHAVE_PESSOAS_REPASSE_PLANTAO,
  type DecidirRealizadoEntrada,
  type EncerrarTarifaEntrada,
  type EstornarRealizadoEntrada,
  EVENTOS_AUDITAVEIS,
  type FiltroRealizadoEntrada,
  type GrupoRepasseResposta,
  type LancarPlantoesRepasseEntrada,
  type LinhaRealizado,
  type ListaRealizado,
  type ListaTarifas,
  PARAMETRO_EVENTO_REPASSE_PLANTAO,
  type RealizadoResposta,
  type RegistrarRealizadoEntrada,
  type RelatorioRepasse,
  type ResultadoF6,
  type ResultadoLancamentoPlantao,
  type SugestaoRealizado,
  type TarifaPlantaoEntrada,
} from '@sgh/contratos';
import {
  conferirDecisaoRealizado,
  conferirRealizado,
  conferirTarifa,
  dataDoLancamento,
  gruposRepasse,
  minutosRealizado,
  motivoForaDoRepasse,
  type RealizadoParaRepasse,
  type RecusaSesmt,
  sugestaoDoPonto,
  tarifaVigente,
  valoracoesPelaTarifa,
  valorRealizado,
} from '@sgh/dominio-pessoas';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import type { PortaPonto } from '../ponto/porta-ponto.js';
import type { GravadorRealizado, PortaRealizado } from './porta-realizado.js';

const E = EVENTOS_AUDITAVEIS;
export const PERMISSOES_REALIZADO = {
  ler: 'pessoas.realizado.ler',
  registrar: 'pessoas.realizado.registrar',
  aprovar: 'pessoas.realizado.aprovar',
  lancar: 'pessoas.realizado.lancar',
} as const;
const P = PERMISSOES_REALIZADO;

const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    'O registro não existe neste estabelecimento.',
  );
const recusar = (r: RecusaSesmt) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', r.mensagem, {
    codigo: r.codigo,
    ...(r.campo ? { campos: [r.campo] } : {}),
  });
const recusaRegra = (codigo: string, mensagem: string, campo: string | null = null) =>
  recusar({ codigo, mensagem, campo });
const semPermissao = () =>
  new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.', {
    codigo: 'sem-permissao',
  });

/** Sessão "como" (ADR 0021): registrar e decidir o realizado são os dois lados dos quatro olhos (D-COMO-526). */
export const MOTIVO_SESSAO_COMO_REALIZADO =
  'Na sessão de suporte não se registra nem se decide o plantão realizado: entre com a sua própria conta.';
export const MOTIVO_PROPRIO_REALIZADO = 'O seu próprio plantão é aprovado por outra pessoa da coordenação.';
export const MOTIVO_FALTA_EVENTO_PLANTAO =
  'Falta definir o evento de repasse do plantão (parâmetro do repasse): o faturamento e o repasse confirmam o evento antes do primeiro lançamento.';
const emComo = (s: SessaoCadastro): boolean => !!s.req?.sghComo;
function naoComo(s: SessaoCadastro): void {
  if (emComo(s))
    throw new ErroProblema('recusa-de-negocio', 403, 'Ação pessoal', MOTIVO_SESSAO_COMO_REALIZADO, {
      codigo: 'sessao-como',
    });
}

const p2 = (x: number) => String(x).padStart(2, '0');
/** A janela [início, fim) da competência em instantes locais. */
function janela(competencia: string): { de: string; ate: string } {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${p2(m + 1)}`;
  return { de: `${competencia}-01T00:00`, ate: `${prox}-01T00:00` };
}
function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function competenciaSeguinte(c: string): string {
  const [a, m] = c.split('-').map(Number) as [number, number];
  return m === 12 ? `${a + 1}-01` : `${a}-${p2(m + 1)}`;
}
const reais = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Revisão W0-06: estornado e lançado no repasse, sem o lançamento negativo ligado (o estorno ficou no meio). */
const estornoPendente = (r: RegistroRealizado): boolean =>
  r.situacao === 'estornado' && r.lancamento !== null && (r.estorno?.lancamento ?? null) === null;
const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class ServicoRealizado {
  readonly apoio: ApoioGravacao<GravadorRealizado>;
  /** O lançamento no repasse: sem chave de liberação (ADR 0002); só a permissão e o evento do parâmetro. */
  readonly apoioRepasse: ApoioGravacao<GravadorRealizado>;

  constructor(
    readonly porta: PortaRealizado,
    readonly pessoas: PortaPessoas,
    readonly ponto: PortaPonto | null,
    private readonly trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorRealizado>(
      { chave: CHAVE_PESSOAS_PLANTAO_REALIZADO, nome: 'o plantão realizado', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.apoioRepasse = new ApoioGravacao<GravadorRealizado>(
      {
        chave: CHAVE_PESSOAS_REPASSE_PLANTAO,
        nome: 'o lançamento do plantão no repasse',
        operacoes: { 'repasse.lancarEvento': P.lancar },
        semLiberacao: true,
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private async nomesUnidades(s: SessaoCadastro): Promise<Map<number, string>> {
    return new Map((await this.pessoas.unidades(s.porta)).map((u) => [u.codigo, u.nome]));
  }

  private async vinculosDoLogin(s: SessaoCadastro): Promise<number[]> {
    return this.ponto ? this.ponto.vinculosDoLogin(s.porta, s.login).catch(() => []) : [];
  }

  private async eventoRepasse(s: SessaoCadastro): Promise<number | null> {
    const v = await this.apoio.parametro(s, PARAMETRO_EVENTO_REPASSE_PLANTAO).catch(() => 0);
    return v > 0 ? v : null;
  }

  private async situacaoRepasse(s: SessaoCadastro): Promise<ApoioRealizado['repasse']> {
    const [l, evento] = await Promise.all([this.apoioRepasse.liberacao(s), this.eventoRepasse(s)]);
    return {
      ligado: l.ligada && evento !== null,
      evento,
      motivo: !l.ligada ? l.motivo : evento === null ? MOTIVO_FALTA_EVENTO_PLANTAO : null,
    };
  }

  async apoioTela(s: SessaoCadastro): Promise<ApoioRealizado> {
    const [relogio, unidades, gravacao, repasse] = await Promise.all([
      this.porta.relogio(s.porta),
      this.pessoas.unidades(s.porta),
      this.apoio.gravacao(s),
      this.situacaoRepasse(s),
    ]);
    const ligado = gravacao.ligada;
    const como = emComo(s);
    return {
      hoje: relogio.hoje,
      agora: relogio.agora,
      gravacao: { ligada: gravacao.ligada, motivo: gravacao.motivo },
      acoes: {
        registrar: ligado && !como && s.pode(P.registrar),
        aprovar: ligado && !como && s.pode(P.aprovar),
        lancar: repasse.ligado && s.pode(P.lancar),
        tarifa: ligado && s.pode(P.lancar),
        motivo: como ? MOTIVO_SESSAO_COMO_REALIZADO : null,
      },
      unidades: unidades.map((u) => ({ codigo: u.codigo, rotulo: u.nome })),
      repasse,
    };
  }

  private realizadoResposta(r: RegistroRealizado): RealizadoResposta {
    return {
      id: r.id,
      inicio: r.inicio,
      fim: r.fim,
      minutos: r.minutos,
      origem: r.origem,
      situacao: r.situacao,
      observacao: r.observacao,
      informadoPor: r.informadoPor,
      informadoEm: r.informadoEm,
      decididoPor: r.decididoPor,
      decididoEm: r.decididoEm,
      motivo: r.motivo,
      valorHora: r.valorHora,
      valor: r.valor,
      parcelas:
        r.valor !== null && r.valorHora !== null ? valorRealizado(r.minutos, r.valorHora).parcelas : null,
      lancamento: r.lancamento,
      versao: r.versao,
      estorno: r.estorno ?? null,
      estornoPendente: estornoPendente(r),
    };
  }

  /** O realizado em vigor do plantão: o aprovado; senão o informado; senão o recusado mais recente. */
  private emVigor(rs: readonly RegistroRealizado[]): RegistroRealizado | null {
    const ordem = ['aprovado', 'informado', 'recusado', 'estornado'];
    for (const s of ordem) {
      const r = rs.filter((x) => x.situacao === s).sort((a, b) => b.id - a.id)[0];
      if (r) return r;
    }
    return null;
  }

  async lista(s: SessaoCadastro, f: FiltroRealizadoEntrada): Promise<ListaRealizado> {
    const { de, ate } = janela(f.competencia);
    const [ps0, unidades, gravacao, doLogin] = await Promise.all([
      this.porta.plantoes(s.porta, { de, ate, ...(f.unidade !== undefined ? { unidade: f.unidade } : {}) }),
      this.nomesUnidades(s),
      this.apoio.gravacao(s),
      this.vinculosDoLogin(s),
    ]);
    const TETO = 2000;
    const limitado = ps0.length > TETO;
    const ps = ps0.slice(0, TETO);
    const rs = await this.porta.realizadosDosPlantoes(
      s.porta,
      ps.map((p) => p.plantao),
    );
    const porPlantao = new Map<number, RegistroRealizado[]>();
    for (const r of rs) porPlantao.set(r.plantao, [...(porPlantao.get(r.plantao) ?? []), r]);
    const como = emComo(s);
    const proprios = new Set(doLogin);
    const cont = { plantoes: 0, semRealizado: 0, aguardando: 0, aprovados: 0, recusados: 0 };
    const itens: LinhaRealizado[] = [];
    for (const p of ps) {
      const r = this.emVigor(porPlantao.get(p.plantao) ?? []);
      cont.plantoes++;
      if (!r) cont.semRealizado++;
      else if (r.situacao === 'informado') cont.aguardando++;
      else if (r.situacao === 'aprovado') cont.aprovados++;
      else if (r.situacao === 'recusado') cont.recusados++;
      const sit = r ? r.situacao : 'semRealizado';
      if (f.situacao !== 'todos' && f.situacao !== sit) continue;
      const proprio = proprios.has(p.vinculo);
      const motivo = !gravacao.ligada
        ? gravacao.motivo
        : como
          ? MOTIVO_SESSAO_COMO_REALIZADO
          : r?.situacao === 'informado' && proprio && s.pode(P.aprovar)
            ? MOTIVO_PROPRIO_REALIZADO
            : null;
      itens.push({
        plantao: p.plantao,
        escala: p.escala,
        unidadeNome: unidades.get(p.unidade) ?? null,
        vinculo: p.vinculo,
        nome: p.nome,
        tipoVinculo: p.tipoVinculo,
        tipoPlantao: p.tipo,
        previstoInicio: p.inicio,
        previstoFim: p.fim,
        realizado: r ? this.realizadoResposta(r) : null,
        acoes: {
          registrar:
            gravacao.ligada &&
            !como &&
            s.pode(P.registrar) &&
            r?.situacao !== 'aprovado' &&
            !(r && estornoPendente(r)),
          decidir:
            gravacao.ligada &&
            !como &&
            s.pode(P.aprovar) &&
            r?.situacao === 'informado' &&
            r.informadoPor !== s.login &&
            !proprio,
          estornar:
            gravacao.ligada &&
            s.pode(P.aprovar) &&
            ((r?.situacao === 'aprovado' && (r.lancamento === null || s.pode(P.lancar))) ||
              (r !== null && r !== undefined && estornoPendente(r) && s.pode(P.lancar))),
          motivo,
        },
      });
    }
    return { competencia: f.competencia, itens, contagem: cont, limitado };
  }

  private async plantaoOu404(s: SessaoCadastro, id: number): Promise<RegistroPlantaoParaRealizado> {
    const p = await this.porta.plantao(s.porta, id);
    if (!p) throw naoEncontrado('Plantão');
    return p;
  }

  /** A sugestão do horário real pelas marcações do ponto do colaborador (primeira e última na janela ± 2 h). */
  async sugestao(s: SessaoCadastro, plantao: number): Promise<SugestaoRealizado> {
    const p = await this.plantaoOu404(s, plantao);
    if (!this.ponto) return { plantao, sugestao: null, marcacoes: 0 };
    const hmac = (await this.ponto.hmacs(s.porta, [p.vinculo])).get(p.vinculo);
    if (!hmac) return { plantao, sugestao: null, marcacoes: 0 };
    const ms = await this.ponto.marcacoes(
      s.porta,
      hmac,
      somarDias(p.inicio.slice(0, 10), -1),
      somarDias(p.fim.slice(0, 10), 1),
    );
    const instantes = ms.map((m) => m.instante.slice(0, 16));
    return { plantao, sugestao: sugestaoDoPonto(p, instantes), marcacoes: instantes.length };
  }

  async registrar(s: SessaoCadastro, e: RegistrarRealizadoEntrada): Promise<ResultadoF6> {
    naoComo(s);
    if (!s.pode(P.registrar)) throw semPermissao();
    const { agora } = await this.porta.relogio(s.porta);
    const r = await this.apoio.sgh(
      s,
      E.pessoasRealizadoRegistrado.codigo,
      CHAVE_PESSOAS_PLANTAO_REALIZADO,
      (y: { id: number }) => ({ tabela: 'plantao', id: String(y.id) }),
      async (g) => {
        const p = await g.plantao(e.plantao);
        if (!p) throw naoEncontrado('Plantão');
        const doPlantao = await g.realizadosDoPlantao(p.plantao);
        const daPessoa = await g.realizadosDaPessoa(
          p.pessoa,
          `${somarDias(p.inicio.slice(0, 10), -2)}T00:00`,
          `${somarDias(p.fim.slice(0, 10), 2)}T00:00`,
        );
        const recusa = conferirRealizado(
          e,
          p,
          agora,
          doPlantao.filter((x) => x.situacao !== 'substituido'),
          daPessoa,
        );
        if (recusa) throw recusar(recusa);
        const id = await g.incluirRealizado({
          plantao: p.plantao,
          vinculo: p.vinculo,
          inicio: e.inicio,
          fim: e.fim,
          minutos: minutosRealizado(e),
          origem: e.origem,
          observacao: e.observacao,
          por: s.login,
        });
        return { id };
      },
    );
    return { id: r.id, mensagem: 'Realizado registrado: outra pessoa da coordenação aprova.' };
  }

  async decidir(s: SessaoCadastro, e: DecidirRealizadoEntrada): Promise<ResultadoF6> {
    naoComo(s);
    if (!s.pode(P.aprovar)) throw semPermissao();
    const doLogin = new Set(await this.vinculosDoLogin(s));
    const r = await this.apoio.sgh(
      s,
      E.pessoasRealizadoDecidido.codigo,
      CHAVE_PESSOAS_PLANTAO_REALIZADO,
      { tabela: 'plantao', id: String(e.realizado) },
      async (g) => {
        const x = await g.realizado(e.realizado);
        if (!x) throw naoEncontrado('Realizado');
        const recusa = conferirDecisaoRealizado(
          { situacao: x.situacao, informadoPor: x.informadoPor, proprio: doLogin.has(x.vinculo) },
          s.login,
        );
        if (recusa) throw recusar(recusa);
        let tarifa: number | null = null;
        let valorHora: number | null = null;
        let valor: number | null = null;
        if (e.decisao === 'aprovar') {
          const p = await g.plantao(x.plantao);
          const t = p ? tarifaVigente(await g.tarifas(), p.tipo, p.unidade, x.inicio.slice(0, 10)) : null;
          if (t) {
            const v = valorRealizado(x.minutos, t.valorHora);
            tarifa = t.id;
            valorHora = t.valorHora;
            valor = v.valor;
          }
        }
        await g.decidirRealizado({
          id: x.id,
          versao: e.versao,
          situacao: e.decisao === 'aprovar' ? 'aprovado' : 'recusado',
          motivo: e.decisao === 'recusar' ? e.motivo : null,
          tarifa,
          valorHora,
          valor,
          por: s.login,
        });
        return { valor };
      },
    );
    return {
      id: e.realizado,
      mensagem:
        e.decisao === 'recusar'
          ? 'Realizado recusado: a coordenação registra de novo.'
          : r.valor !== null
            ? `Realizado aprovado (${reais(r.valor)}).`
            : 'Realizado aprovado (sem tarifa vigente para o tipo de plantão: fica fora do repasse até a tarifa ser incluída; a inclusão da tarifa dá o valor a este plantão).',
    };
  }

  /**
   * W0-06: estorno do realizado APROVADO, com o motivo (matriz, linha "Financeiro (repasses)": o lançamento de plantão
   * no repasse se estorna; se o repasse já foi apurado, recusa e encaminha para a devolução da apuração).
   *   - não lançado: só no banco (fica fora do relatório do repasse; a coordenação registra de novo se for o caso);
   *   - lançado, com a apuração do repasse da competência já conferida, aprovada ou titulada: 409
   *     `repasse-apurado`, com o caminho da devolução da apuração;
   *   - lançado e não apurado: o lançamento negativo pela receita `repasse.lancarEvento`, origem `estorno`, na
   *     competência seguinte à do original (ou na corrente, se posterior), ligado ao realizado. O estorno no banco vem
   *     antes (trava o realizado contra o lançamento duplo) e volta se a receita recusar.
   */
  async estornar(s: SessaoCadastro, e: EstornarRealizadoEntrada): Promise<ResultadoF6> {
    const x = await this.porta.realizado(s.porta, e.realizado);
    if (!x) throw naoEncontrado('Realizado');
    const pendente = estornoPendente(x);
    if (x.situacao !== 'aprovado' && !pendente)
      throw recusaRegra('nao-aprovado', 'Só o realizado aprovado se estorna.', 'realizado');
    // O estorno pendente (estornado e lançado, sem o negativo ligado) conclui com o motivo que já tem.
    const motivo = pendente ? (x.estorno?.motivo ?? e.motivo.trim()) : e.motivo.trim();
    if (x.lancamento === null) {
      if (!s.pode(P.aprovar)) throw semPermissao();
      await this.apoio.sgh(
        s,
        E.pessoasRealizadoEstornado.codigo,
        CHAVE_PESSOAS_PLANTAO_REALIZADO,
        { tabela: 'plantao', id: String(x.id) },
        async (g) => {
          const y = await g.realizado(x.id);
          if (!y || y.situacao !== 'aprovado' || y.lancamento !== null)
            throw recusaRegra('desatualizado', 'O realizado mudou: abra de novo.', 'realizado');
          await g.estornarRealizado({ id: x.id, versao: e.versao, motivo, por: s.login });
        },
      );
      return { id: x.id, mensagem: 'Realizado estornado: fica fora do repasse.' };
    }
    if (!s.pode(P.aprovar) || !s.pode(P.lancar)) throw semPermissao();
    const alvoSgh = { tabela: 'plantao', id: String(x.id) };
    if (pendente) {
      // Conciliação: o negativo que a receita já lançou (a falha foi na ligação) só se liga; nunca se lança de novo.
      const ligado = await this.apoio.sgh(
        s,
        E.pessoasRealizadoEstornado.codigo,
        CHAVE_PESSOAS_PLANTAO_REALIZADO,
        alvoSgh,
        async (g) => {
          const y = await g.realizado(x.id);
          if (!y || !estornoPendente(y))
            throw recusaRegra('desatualizado', 'O realizado mudou: abra de novo.', 'realizado');
          const l = await g.estornoLancado({ id: x.id, original: x.lancamento! });
          if (l !== null) await g.ligarEstorno({ id: x.id, lancamento: l });
          return l;
        },
      );
      if (ligado !== null)
        return {
          id: x.id,
          mensagem: `Estorno concluído: o lançamento negativo ${ligado}, que já estava no repasse, foi ligado ao realizado (estorno do lançamento ${x.lancamento}).`,
        };
    }
    const competencia = x.inicio.slice(0, 7);
    const apurado = (a: { id: number; estado: string } | null) => a !== null && a.estado !== 'aberta';
    const recusaApurado = (a: { id: number; estado: string }) =>
      new ErroProblema(
        'recusa-de-negocio',
        409,
        'Repasse já apurado',
        `O repasse da competência ${competencia} já foi apurado (apuração ${a.id}, ${a.estado}): o estorno do plantão lançado (lançamento ${x.lancamento}) depende da devolução da apuração. Peça ao repasse a devolução da apuração e estorne de novo.`,
        {
          codigo: 'repasse-apurado',
          bloqueios: [`Apuração do repasse ${competencia}: 1`],
          avisos: [`Devolução da apuração ${a.id} em Repasse > Apuração do período`],
        },
      );
    const ap = await this.porta.apuracaoRepasse(s.porta, competencia);
    if (ap && apurado(ap)) throw recusaApurado(ap);
    const repasse = await this.situacaoRepasse(s);
    if (!repasse.ligado)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Lançamento desligado',
        repasse.motivo ?? MOTIVO_FALTA_EVENTO_PLANTAO,
        { codigo: 'repasse-plantao-desligado' },
      );
    const [p] = await this.porta.plantoesPorIds(s.porta, [x.plantao]);
    const registro = p?.registro ?? null;
    const prestador =
      registro !== null
        ? ((await this.porta.codigosDosRegistros(s.porta, [registro])).get(registro) ?? null)
        : null;
    if (registro === null || prestador === null || x.valor === null)
      throw recusaRegra(
        'sem-prestador',
        'O plantão lançado não tem o prestador ligado: confira o cadastro.',
        'realizado',
      );
    const { hoje } = await this.porta.relogio(s.porta);
    const seguinte = competenciaSeguinte(competencia);
    const destino = hoje.slice(0, 7) > seguinte ? hoje.slice(0, 7) : seguinte;
    // 1. O estorno no banco (trava o realizado: o segundo pedido simultâneo é recusado como desatualizado). Daqui até a
    // ligação (3), o realizado fica "estorno pendente de lançamento" (estornado e lançado, sem o negativo ligado): a
    // tela o mostra e o mesmo pedido de estorno o concilia (liga o negativo já lançado ou o lança).
    if (!pendente)
      await this.apoio.sgh(
        s,
        E.pessoasRealizadoEstornado.codigo,
        CHAVE_PESSOAS_PLANTAO_REALIZADO,
        alvoSgh,
        async (g) => {
          const a = await g.apuracaoRepasse(competencia);
          if (a && apurado(a)) throw recusaApurado(a);
          await g.estornarRealizado({ id: x.id, versao: e.versao, motivo, por: s.login });
        },
      );
    // 2. O lançamento negativo pela receita; recusado, o estorno no banco volta.
    let lancamento: number;
    try {
      const r = await this.apoioRepasse.executar(
        s,
        'repasse.lancarEvento',
        {
          origem: 'estorno',
          empresa: 1,
          competencia: destino,
          data: dataDoLancamento(destino, hoje),
          previsao: null,
          evento: repasse.evento,
          tipo: 'M',
          prestador,
          profissional: registro,
          valor: -x.valor,
          referente: `ESTORNO PLANTAO ${x.id}`.slice(0, 60),
          justificativa: `Estorno do plantão realizado ${x.id} (lançamento ${x.lancamento}): ${motivo}`.slice(
            0,
            400,
          ),
          apuracao: null,
          estornaDe: x.lancamento,
          plantoes: [],
        },
        'Estorno do plantão lançado no repasse.',
      );
      lancamento = Number((r.resultado as Record<string, unknown>)['lancamento'] ?? 0);
    } catch (erro) {
      await this.apoio
        .sgh(s, E.pessoasRealizadoEstornado.codigo, CHAVE_PESSOAS_PLANTAO_REALIZADO, alvoSgh, (g) =>
          g.desfazerEstorno(x.id),
        )
        .catch((falha: unknown) =>
          this.alertaEstornoPendente(s, x.id, `desfazer o estorno falhou: ${mensagemDe(falha)}`),
        );
      throw erro;
    }
    // 3. A ligação do lançamento negativo ao realizado.
    try {
      await this.apoio.sgh(
        s,
        E.pessoasRealizadoEstornado.codigo,
        CHAVE_PESSOAS_PLANTAO_REALIZADO,
        alvoSgh,
        (g) => g.ligarEstorno({ id: x.id, lancamento }),
      );
    } catch (falha) {
      await this.alertaEstornoPendente(
        s,
        x.id,
        `o lançamento ${lancamento} foi feito e a ligação falhou: ${mensagemDe(falha)}`,
      );
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Estorno pendente',
        `O lançamento negativo ${lancamento} entrou no repasse, mas a ligação ao realizado falhou. Peça o estorno de novo: ele liga o lançamento já feito (nada se lança duas vezes).`,
        { codigo: 'estorno-pendente' },
      );
    }
    return {
      id: x.id,
      mensagem: `Realizado estornado: lançamento ${lancamento} de ${reais(-x.valor)} no repasse da competência ${destino} (estorno do lançamento ${x.lancamento}).`,
    };
  }

  /** O estorno que ficou pendente de lançamento ou de ligação vai à trilha como falha (alerta), sem engolir o erro. */
  private async alertaEstornoPendente(s: SessaoCadastro, id: number, detalhe: string): Promise<void> {
    await this.trilha
      .registrar({
        evento: E.pessoasRealizadoEstornado.codigo,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, E.pessoasRealizadoEstornado.codigo).slice(0, 64),
        recurso: CHAVE_PESSOAS_PLANTAO_REALIZADO,
        resultado: 'falha',
        tabelaAlvo: 'plantao',
        idAlvo: String(id),
        chaveNaturalAlvo: `estorno pendente: ${detalhe}`.slice(0, 120),
      })
      .catch(() => undefined);
  }

  // ── Tarifas ─────────────────────────────────────────────────────────────────────────────────────────────────

  async tarifas(s: SessaoCadastro): Promise<ListaTarifas> {
    const [ts, unidades] = await Promise.all([this.porta.tarifas(s.porta), this.nomesUnidades(s)]);
    return {
      itens: ts.map((t) => ({
        ...t,
        unidadeNome: t.unidade !== null ? (unidades.get(t.unidade) ?? null) : null,
      })),
    };
  }

  async incluirTarifa(s: SessaoCadastro, e: TarifaPlantaoEntrada): Promise<ResultadoF6> {
    if (!s.pode(P.lancar)) throw semPermissao();
    if (e.unidade !== null && !(await this.nomesUnidades(s)).has(e.unidade))
      throw recusaRegra('unidade-inexistente', 'A unidade não existe neste estabelecimento.', 'unidade');
    const r = await this.apoio.sgh(
      s,
      E.pessoasTarifaPlantaoGravada.codigo,
      CHAVE_PESSOAS_PLANTAO_REALIZADO,
      (y: { id: number; valorados: number }) => ({
        tabela: 'valor_hora_plantao',
        id: String(y.id),
        chave: y.valorados > 0 ? `realizados-valorados:${y.valorados}` : null,
      }),
      async (g) => {
        const recusa = conferirTarifa(e, await g.tarifas());
        if (recusa) throw recusar(recusa);
        const id = await g.incluirTarifa({ ...e, por: s.login });
        // Os aprovados que ficaram sem valor (sem tarifa no dia da aprovação) e a nova alcança são valorados na mesma
        // transação, sob a mesma trilha: assim entram no repasse sem nova decisão.
        const semValor = await g.realizadosSemValor(e.inicio, e.fim);
        let valorados = 0;
        if (semValor.length > 0) {
          const ps = new Map(
            (await g.plantoesPorIds([...new Set(semValor.map((x) => x.plantao))])).map((p) => [p.plantao, p]),
          );
          const vs = valoracoesPelaTarifa(
            await g.tarifas(),
            semValor.flatMap((x) => {
              const p = ps.get(x.plantao);
              return p
                ? [{ id: x.id, minutos: x.minutos, inicio: x.inicio, tipo: p.tipo, unidade: p.unidade }]
                : [];
            }),
          );
          for (const v of vs) if (await g.valorarRealizado(v)) valorados += 1;
        }
        return { id, valorados };
      },
    );
    return {
      id: r.id,
      mensagem:
        r.valorados === 0
          ? 'Tarifa incluída.'
          : `Tarifa incluída: ${r.valorados} plantão(ões) realizado(s) aprovado(s) sem valor passaram a ter valor e entram no repasse.`,
    };
  }

  async encerrarTarifa(s: SessaoCadastro, e: EncerrarTarifaEntrada): Promise<ResultadoF6> {
    if (!s.pode(P.lancar)) throw semPermissao();
    await this.apoio.sgh(
      s,
      E.pessoasTarifaPlantaoGravada.codigo,
      CHAVE_PESSOAS_PLANTAO_REALIZADO,
      { tabela: 'valor_hora_plantao', id: String(e.tarifa) },
      async (g) => g.encerrarTarifa({ id: e.tarifa, fim: e.fim, por: s.login }),
    );
    return { id: e.tarifa, mensagem: 'Vigência da tarifa encerrada.' };
  }

  // ── Relatório ao repasse e lançamento ───────────────────────────────────────────────────────────────────────

  async relatorio(s: SessaoCadastro, competencia: string): Promise<RelatorioRepasse> {
    const { de, ate } = janela(competencia);
    const [rs0, repasse] = await Promise.all([
      this.porta.realizadosAprovados(s.porta, de, ate),
      this.situacaoRepasse(s),
    ]);
    const TETO = 2000;
    const limitado = rs0.length > TETO;
    const rs = rs0.slice(0, TETO);
    const ps = new Map(
      (
        await this.porta.plantoesPorIds(
          s.porta,
          rs.map((r) => r.plantao),
        )
      ).map((p) => [p.plantao, p]),
    );
    const codigos = await this.porta.codigosDosRegistros(
      s.porta,
      [...ps.values()].map((p) => p.registro).filter((x): x is number => x !== null),
    );
    const paraRepasse: RealizadoParaRepasse[] = rs.map((r) => {
      const p = ps.get(r.plantao);
      const registro = p?.registro ?? null;
      return {
        id: r.id,
        prestador: registro !== null ? (codigos.get(registro) ?? null) : null,
        registro,
        tipoVinculo: p?.tipoVinculo ?? '',
        situacao: r.situacao,
        lancado: r.lancamento !== null,
        inicio: r.inicio,
        valor: r.valor,
      };
    });
    const nomeDe = (id: number) => ps.get(rs.find((r) => r.id === id)?.plantao ?? 0)?.nome ?? '';
    const grupos: GrupoRepasseResposta[] = gruposRepasse(paraRepasse).map((g) => ({
      ...g,
      nome: nomeDe(g.realizados[0]!),
      plantoes: g.realizados.length,
      minutos: g.realizados.reduce((t, id) => t + (rs.find((r) => r.id === id)?.minutos ?? 0), 0),
    }));
    const total = grupos.reduce((t, g) => t + Math.round(g.valor * 100), 0) / 100;
    return {
      competencia,
      grupos,
      lancados: rs
        .filter((r) => r.lancamento !== null)
        .map((r) => ({ realizado: r.id, nome: nomeDe(r.id), lancamento: r.lancamento!, valor: r.valor })),
      foraDoRepasse: paraRepasse
        .filter((r) => !r.lancado)
        .flatMap((r) => {
          const m = motivoForaDoRepasse(r);
          return m ? [{ realizado: r.id, nome: nomeDe(r.id), motivo: m }] : [];
        }),
      total: {
        valor: total,
        parcelas:
          grupos.length <= 1
            ? reais(total)
            : `${grupos.map((g) => reais(g.valor)).join(' + ')} = ${reais(total)}`,
      },
      repasse,
      limitado,
    };
  }

  async lancar(s: SessaoCadastro, e: LancarPlantoesRepasseEntrada): Promise<ResultadoLancamentoPlantao> {
    const repasse = await this.situacaoRepasse(s);
    if (!repasse.ligado)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Lançamento desligado',
        repasse.motivo ?? MOTIVO_FALTA_EVENTO_PLANTAO,
        {
          codigo: 'repasse-plantao-desligado',
        },
      );
    const rel = await this.relatorio(s, e.competencia);
    const g = rel.grupos.find((x) => x.prestador === e.prestador && x.registro === e.registro);
    if (!g)
      throw recusaRegra(
        'sem-plantao-a-lancar',
        'O prestador não tem plantão aprovado a lançar nesta competência.',
        'prestador',
      );
    const pedidos = new Set(e.realizados);
    if (pedidos.size !== g.realizados.length || g.realizados.some((id) => !pedidos.has(id)))
      throw recusaRegra(
        'relatorio-mudou',
        'Os plantões do prestador mudaram depois que você abriu o relatório: abra de novo.',
        'realizados',
      );
    const { hoje } = await this.porta.relogio(s.porta);
    const r = await this.apoioRepasse.executar(
      s,
      'repasse.lancarEvento',
      {
        origem: 'plantao',
        empresa: 1,
        competencia: e.competencia,
        data: dataDoLancamento(e.competencia, hoje),
        previsao: null,
        evento: repasse.evento,
        tipo: 'M',
        prestador: g.prestador,
        profissional: g.registro,
        valor: g.valor,
        referente: `PLANTOES ${e.competencia}`,
        justificativa: `Plantões realizados e aprovados (${g.plantoes}): ${g.parcelas}`.slice(0, 400),
        apuracao: null,
        estornaDe: null,
        plantoes: g.realizados,
      },
      'Plantões lançados no repasse.',
    );
    const lancamento = Number((r.resultado as Record<string, unknown>)['lancamento'] ?? 0);
    return {
      lancamento,
      valor: g.valor,
      realizados: g.realizados.length,
      mensagem: `Lançamento ${lancamento} no repasse: ${g.parcelas}.`,
    };
  }
}
