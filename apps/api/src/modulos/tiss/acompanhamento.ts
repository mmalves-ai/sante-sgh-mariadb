// M42 (ficha, campos 4 e 7): o painel "Acompanhamento da competência" na rota do painel de glosas do M31. A
// competência inteira, feita no novo e conferida no outro sistema: contas por situação e por sistema que fechou, lotes e
// protocolos, glosas e recursos (o painel do M31 com a mesma competência), títulos e movimento do mês (com a leitura do
// financeiro), repasse do mês (com a leitura do repasse), gravações do novo por operação da onda e quem ainda usa o
// outro sistema nos grupos da onda (com a leitura da migração). Só agregados, em cache de horas como o painel. A
// conferência compara o que o chave-usuário leu nos relatórios do outro sistema com o que se lê agora: nada grava.
import {
  type AcompanhamentoCompetencia,
  type ConferenciaCompetencia,
  esquemaAcompanhamentoCompetencia,
  esquemaConferenciaCompetencia,
  esquemaFiltroAcompanhamento,
  esquemaPedidoConferenciaCompetencia,
  GRUPOS_ONDA_4,
  operacoesDaOnda4,
  rotuloOperacaoOnda4,
  setoresDaOperacaoOnda4,
} from '@sgh/contratos';
import {
  conferirCodigoOnda4,
  diferencasDaCompetencia,
  resumirContasDaCompetencia,
  type LinhaRetrato,
} from '@sgh/contratos/regras-faturamento';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { ContextoTiss, FiltroAcompanhamentoPorta, LeituraAcompanhamento, PortaTiss } from './porta.js';
import type { ServicoTiss } from './servico.js';

const ROTULO_SITUACAO: Readonly<Record<string, string>> = {
  N: 'Aberta',
  S: 'Fechada',
  A: 'Apresentada (em lote)',
  outra: 'Outra situação',
};

/** Permissões de leitura dos setores donos de cada bloco (sem elas, o bloco vem indisponível com o motivo). */
export const LEITURAS_DOS_BLOCOS = {
  aPagar: 'financeiro.tituloPagar.ler',
  aReceber: 'financeiro.tituloReceber.ler',
  movimento: 'financeiro.movimento.ler',
  repasse: ['repasse.lancamento.ler', 'repasse.rpa.ler'],
  uso: 'config.coexistencia.ler',
} as const;

const invalido = (detalhe: string, campos?: readonly string[]) =>
  new ErroProblema('entrada-invalida', 400, 'Filtro inválido', detalhe, campos ? { campos } : undefined);

const ctx = (s: SessaoCadastro): ContextoTiss => s.porta;

export class AcompanhamentoTiss {
  constructor(
    private readonly porta: PortaTiss,
    private readonly servico: ServicoTiss,
  ) {}

  private filtro(s: SessaoCadastro, q: Record<string, unknown>) {
    const p = esquemaFiltroAcompanhamento.safeParse(
      Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v !== undefined)),
    );
    if (!p.success)
      throw invalido(
        'Informe a competência (AAAA-MM) e, se quiser, um convênio.',
        p.error.issues.map((i) => i.path.join('.')),
      );
    if (p.data.convenio !== undefined) this.servico.exigirEscopoConvenio(s, p.data.convenio);
    const [ano, mes] = p.data.competencia.split('-').map(Number) as [number, number];
    return { competencia: p.data.competencia, ano, mes, convenio: p.data.convenio ?? null };
  }

  /**
   * As contas bancárias do escopo da sessão para o movimento (regra 15 do M32, MFCTAUSU): só com a leitura do
   * movimento; null = todas. Vale para a leitura e para a chave do cache.
   */
  private async contasBancarias(s: SessaoCadastro): Promise<number[] | null> {
    if (!s.pode(LEITURAS_DOS_BLOCOS.movimento)) return [];
    const r = await this.porta.contasBancariasDoEscopo(ctx(s), s.login);
    return r === null ? null : [...r].sort((a, b) => a - b);
  }

  private async ler(
    s: SessaoCadastro,
    f: { ano: number; mes: number; convenio: number | null; competencia: string },
    contasBancarias: readonly number[] | null,
  ): Promise<LeituraAcompanhamento> {
    const podeTitulos =
      s.pode(LEITURAS_DOS_BLOCOS.aPagar) ||
      s.pode(LEITURAS_DOS_BLOCOS.aReceber) ||
      s.pode(LEITURAS_DOS_BLOCOS.movimento);
    const porta: FiltroAcompanhamentoPorta = {
      ano: f.ano,
      mes: f.mes,
      convenio: f.convenio,
      convenios: this.servico.convenios(s),
      operacoes: operacoesDaOnda4(),
      titulos: podeTitulos,
      contasBancarias,
      repasse: LEITURAS_DOS_BLOCOS.repasse.some((p) => s.pode(p)),
      uso: s.pode(LEITURAS_DOS_BLOCOS.uso)
        ? { grupos: [...GRUPOS_ONDA_4], desde: `${f.competencia}-01` }
        : null,
    };
    return this.porta.acompanhamento(ctx(s), porta);
  }

  async painel(s: SessaoCadastro, q: Record<string, unknown>): Promise<AcompanhamentoCompetencia> {
    const f = this.filtro(s, q);
    const cache = this.servico.apoios.cache;
    const contas = await this.contasBancarias(s);
    const montar = async () => this.montar(s, f, await this.ler(s, f, contas));
    if (!cache || this.porta.destino === 'memoria') return montar();
    const horas = await this.servico.parametro(s, 'faturamento.painelGlosaCacheHoras', 6);
    let carregou = false;
    const escopo = (this.servico.convenios(s) ?? ['*']).join('-');
    // A chave leva as leituras da sessão e o escopo de contas bancárias: blocos diferentes não se misturam no cache.
    const leituras = [
      LEITURAS_DOS_BLOCOS.aPagar,
      LEITURAS_DOS_BLOCOS.aReceber,
      LEITURAS_DOS_BLOCOS.movimento,
      ...LEITURAS_DOS_BLOCOS.repasse,
      LEITURAS_DOS_BLOCOS.uso,
    ]
      .map((p) => (s.pode(p) ? '1' : '0'))
      .join('');
    const r = await cache.lerOuCarregar(
      cache.chave(
        s.rede,
        s.hospital,
        'acompanhamento-competencia',
        `${f.competencia}:${f.convenio ?? '*'}:${escopo}:${leituras}:${chaveContasBancarias(contas)}`,
      ),
      horas * 3_600,
      async () => {
        carregou = true;
        return montar();
      },
    );
    return { ...r, emCache: !carregou };
  }

  /** O bloco de glosas da competência (o painel do M31 com a mesma competência). */
  private glosas(s: SessaoCadastro, f: { competencia: string; convenio: number | null }) {
    return this.porta
      .painel(ctx(s), {
        de: f.competencia,
        ate: f.competencia,
        convenios: f.convenio !== null ? [f.convenio] : this.servico.convenios(s),
      })
      .then((p) => ({
        disponivel: true as const,
        emitido: p.somas.emitido,
        conciliado: p.somas.conciliado,
        glosa: p.somas.glosaPositiva,
        contestado: p.somas.contestado,
        recuperado: p.somas.recuperado,
        exitoRotulo: p.indicadores.exitoRotulo,
      }))
      .catch(() => ({ disponivel: false as const, motivo: 'O painel de glosas não pôde ser lido agora.' }));
  }

  private async montar(
    s: SessaoCadastro,
    f: { ano: number; mes: number; convenio: number | null; competencia: string },
    l: LeituraAcompanhamento,
  ): Promise<AcompanhamentoCompetencia> {
    const nomes = new Map(
      (await this.porta.convenios(ctx(s)).catch(() => [])).map((c) => [c.codigo, c.nome]),
    );
    const resumo = resumirContasDaCompetencia(l.contas);
    const glosas = await this.glosas(s, f);
    const t = l.titulos;
    const titulos = t
      ? {
          disponivel: true as const,
          aPagar: s.pode(LEITURAS_DOS_BLOCOS.aPagar) ? t.aPagar : null,
          aReceber: s.pode(LEITURAS_DOS_BLOCOS.aReceber) ? t.aReceber : null,
          movimento: s.pode(LEITURAS_DOS_BLOCOS.movimento)
            ? t.movimento.map((m) => ({
                ...m,
                rotulo: conferirCodigoOnda4('MFLANCTO.TIPO_TRF', m.tipo, []).legenda,
              }))
            : null,
        }
      : { disponivel: false as const, motivo: 'Sem a leitura de títulos ou do movimento do financeiro.' };
    const repasse = l.repasse
      ? { disponivel: true as const, ...l.repasse }
      : { disponivel: false as const, motivo: 'Sem a leitura do repasse médico.' };
    const uso = l.uso
      ? { disponivel: true as const, desde: `${f.competencia}-01`, grupos: l.uso.map((u) => ({ ...u })) }
      : { disponivel: false as const, motivo: 'Sem a leitura do painel de migração.' };
    return esquemaAcompanhamentoCompetencia.parse({
      competencia: f.competencia,
      convenio: f.convenio,
      contas: {
        disponivel: true,
        contas: resumo.contas,
        valor: resumo.valor,
        porSituacao: resumo.porSituacao.map((p) => ({
          ...p,
          rotulo: ROTULO_SITUACAO[p.situacao] ?? p.situacao,
        })),
        fechadas: resumo.fechadas,
        fechadasPeloNovo: resumo.fechadasPeloNovo,
        fechadasPeloOutro: resumo.fechadasPeloOutro,
        parcelaDoNovo: resumo.parcelaDoNovo,
        porConvenio: resumo.porConvenio.map((c) => ({
          ...c,
          nome: nomes.get(c.convenio) ?? `Convênio ${c.convenio}`,
        })),
      },
      lotes: {
        disponivel: true,
        ...l.lotes,
        semProtocolo: Math.max(0, l.lotes.lotes - l.lotes.comProtocolo),
      },
      glosas,
      titulos,
      repasse,
      gravacoes: l.gravacoes.map((g) => {
        const setor = setoresDaOperacaoOnda4(g.operacao)[0];
        return {
          ...g,
          rotulo: rotuloOperacaoOnda4(g.operacao),
          setor: setor?.id ?? '',
          setorNome: setor?.nome ?? '',
        };
      }),
      uso,
      geradoEm: new Date().toISOString(),
      emCache: false,
    });
  }

  /**
   * Exportação (CSV) com as parcelas de cada soma: o mesmo painel, sem cache, bloco a bloco (contas, lotes, glosas,
   * títulos, movimento, repasse, gravações e uso); o bloco sem a leitura do setor sai com o motivo.
   */
  async exportar(
    s: SessaoCadastro,
    q: Record<string, unknown>,
  ): Promise<{ competencia: string; csv: string }> {
    const f = this.filtro(s, q);
    const p = await this.montar(s, f, await this.ler(s, f, await this.contasBancarias(s)));
    return { competencia: p.competencia, csv: csvDoAcompanhamento(p).join('\n') };
  }

  /** O retrato deste sistema, bloco a bloco, com as mesmas chaves que o pedido de conferência monta. */
  private retrato(
    l: LeituraAcompanhamento,
    glosas: Awaited<ReturnType<AcompanhamentoTiss['glosas']>>,
    blocos: ReadonlySet<BlocoConferencia>,
  ): LinhaRetrato[] {
    const r: LinhaRetrato[] = [];
    if (blocos.has('contas'))
      for (const c of resumirContasDaCompetencia(l.contas).porConvenio)
        r.push({
          chave: `convenio ${c.convenio}`,
          valores: { contas: c.contas, fechadas: c.fechadas, valor: c.valor },
        });
    if (blocos.has('lotes'))
      r.push({ chave: 'lotes', valores: { lotes: l.lotes.lotes, protocolados: l.lotes.comProtocolo } });
    if (blocos.has('glosas') && glosas.disponivel)
      r.push({
        chave: 'glosas',
        valores: { emitido: glosas.emitido, glosa: glosas.glosa, recuperado: glosas.recuperado },
      });
    const t = l.titulos;
    if (blocos.has('aPagar') && t)
      r.push({ chave: 'titulos a pagar', valores: { titulos: t.aPagar.titulos, valor: t.aPagar.valor } });
    if (blocos.has('aReceber') && t)
      r.push({
        chave: 'titulos a receber',
        valores: { titulos: t.aReceber.titulos, valor: t.aReceber.valor },
      });
    if (blocos.has('movimento') && t)
      for (const m of t.movimento)
        r.push({ chave: `movimento ${m.tipo}`, valores: { lancamentos: m.lancamentos, valor: m.valor } });
    if (blocos.has('repasse') && l.repasse)
      r.push({
        chave: 'repasse',
        valores: { eventos: l.repasse.eventos, valorEventos: l.repasse.valorEventos, rpas: l.repasse.rpas },
      });
    return r;
  }

  /**
   * A conferência com o outro sistema (campo 4), bloco a bloco: só os blocos informados entram e, dentro de cada um,
   * TODAS as chaves deste sistema (todos os convênios do escopo com conta na competência, todos os tipos de movimento
   * das contas do escopo): a chave não informada, ou a informada que este sistema não tem, é diferença de presença.
   * O bloco sem a leitura do setor é recusado (403). Nada grava.
   */
  async conferir(s: SessaoCadastro, corpo: unknown): Promise<ConferenciaCompetencia> {
    const p = esquemaPedidoConferenciaCompetencia.safeParse(corpo);
    if (!p.success)
      throw invalido(
        'Informe a competência e ao menos um bloco lido no outro sistema (as contas por convênio, os lotes, as glosas, os títulos, o movimento ou o repasse).',
        p.error.issues.map((i) => i.path.join('.')),
      );
    const pedido = p.data;
    for (const l of pedido.linhas ?? []) this.servico.exigirEscopoConvenio(s, l.convenio);
    const b = pedido.blocos ?? {};
    const blocos = new Set<BlocoConferencia>(
      [
        pedido.linhas !== undefined ? 'contas' : null,
        b.lotes ? 'lotes' : null,
        b.glosas ? 'glosas' : null,
        b.aPagar ? 'aPagar' : null,
        b.aReceber ? 'aReceber' : null,
        b.movimento ? 'movimento' : null,
        b.repasse ? 'repasse' : null,
      ].filter((x): x is BlocoConferencia => x !== null),
    );
    const exigir = (bloco: BlocoConferencia, ok: boolean, setor: string) => {
      if (blocos.has(bloco) && !ok)
        throw new ErroProblema(
          'sem-permissao',
          403,
          'Sem a leitura do setor',
          `A conferência deste bloco pede a leitura ${setor}.`,
          { codigo: 'sem-leitura-do-bloco', campos: [`blocos.${bloco}`] },
        );
    };
    exigir('aPagar', s.pode(LEITURAS_DOS_BLOCOS.aPagar), 'dos títulos a pagar');
    exigir('aReceber', s.pode(LEITURAS_DOS_BLOCOS.aReceber), 'dos títulos a receber');
    exigir('movimento', s.pode(LEITURAS_DOS_BLOCOS.movimento), 'do movimento bancário');
    exigir(
      'repasse',
      LEITURAS_DOS_BLOCOS.repasse.some((x) => s.pode(x)),
      'do repasse médico',
    );
    const [ano, mes] = pedido.competencia.split('-').map(Number) as [number, number];
    const f = { competencia: pedido.competencia, ano, mes, convenio: null };
    const lido = await this.porta.acompanhamento(ctx(s), {
      ano,
      mes,
      convenio: null,
      // Todos os convênios do escopo da sessão: o convênio com conta que ficou de fora do pedido é diferença.
      convenios: this.servico.convenios(s),
      operacoes: [],
      titulos: blocos.has('aPagar') || blocos.has('aReceber') || blocos.has('movimento'),
      contasBancarias: blocos.has('movimento') ? await this.contasBancarias(s) : [],
      repasse: blocos.has('repasse'),
      uso: null,
    });
    const glosas = blocos.has('glosas')
      ? await this.glosas(s, f)
      : ({ disponivel: false, motivo: '' } as const);
    if (blocos.has('glosas') && !glosas.disponivel)
      throw new ErroProblema('indisponivel', 503, 'Glosas indisponíveis', glosas.motivo);
    const outro: LinhaRetrato[] = [
      ...(pedido.linhas ?? []).map((l) => ({
        chave: `convenio ${l.convenio}`,
        valores: { contas: l.contas, fechadas: l.fechadas, valor: l.valor },
      })),
      ...(b.lotes ? [{ chave: 'lotes', valores: { ...b.lotes } }] : []),
      ...(b.glosas ? [{ chave: 'glosas', valores: { ...b.glosas } }] : []),
      ...(b.aPagar ? [{ chave: 'titulos a pagar', valores: { ...b.aPagar } }] : []),
      ...(b.aReceber ? [{ chave: 'titulos a receber', valores: { ...b.aReceber } }] : []),
      ...(b.movimento ?? []).map((m) => ({
        chave: `movimento ${m.tipo}`,
        valores: { lancamentos: m.lancamentos, valor: m.valor },
      })),
      ...(b.repasse ? [{ chave: 'repasse', valores: { ...b.repasse } }] : []),
    ];
    const novo = this.retrato(lido, glosas, blocos);
    const diferencas = diferencasDaCompetencia(novo, outro);
    return esquemaConferenciaCompetencia.parse({
      competencia: pedido.competencia,
      comparados: new Set([...novo, ...outro].map((x) => x.chave)).size,
      diferencas,
    });
  }
}

type BlocoConferencia = 'contas' | 'lotes' | 'glosas' | 'aPagar' | 'aReceber' | 'movimento' | 'repasse';

/** A parte da chave do cache que leva o escopo de contas bancárias (todas, nenhuma ou a lista ordenada). */
function chaveContasBancarias(contas: readonly number[] | null): string {
  if (contas === null) return 'cb*';
  return contas.length === 0 ? 'cb-' : `cb${contas.join('.')}`;
}

/** As linhas do CSV do acompanhamento (separador ";", decimal com vírgula; nenhum nome de pessoa). */
export function csvDoAcompanhamento(p: AcompanhamentoCompetencia): string[] {
  const n = (v: number) => v.toFixed(2).replace('.', ',');
  const limpo = (x: string) => x.replace(/;/g, ',');
  const c = p.contas;
  const linhas = [
    `Competência;${p.competencia}`,
    `Contas;${c.contas};${n(c.valor)}`,
    ...c.porSituacao.map((x) => `Situação ${x.rotulo};${x.contas};${n(x.valor)}`),
    `Fechadas;${c.fechadas} = ${c.fechadasPeloNovo} por este sistema + ${c.fechadasPeloOutro} pelo outro sistema`,
    'Convênio;Contas;Fechadas;Fechadas por este sistema;Valor',
    ...c.porConvenio.map(
      (x) => `${limpo(x.nome)};${x.contas};${x.fechadas};${x.fechadasPeloNovo};${n(x.valor)}`,
    ),
    `Lotes;${p.lotes.lotes} = ${p.lotes.comProtocolo} protocolados + ${p.lotes.semProtocolo} sem protocolo`,
    `Contas em lote;${p.lotes.contasEmLote}`,
    `Competência fechada;${p.lotes.conveniosFechados} de ${p.lotes.conveniosComConta} convênios com conta`,
  ];
  const g = p.glosas;
  if (g.disponivel)
    linhas.push(
      'Glosas;Emitido;Conciliado;Glosa;Contestado;Recuperado;Êxito do recurso',
      `Glosas;${n(g.emitido)};${n(g.conciliado)};${n(g.glosa)};${n(g.contestado)};${n(g.recuperado)};${limpo(g.exitoRotulo)}`,
    );
  else linhas.push(`Glosas;indisponível: ${limpo(g.motivo)}`);
  const t = p.titulos;
  if (t.disponivel) {
    linhas.push(
      t.aPagar
        ? `A pagar;${t.aPagar.titulos} títulos;${n(t.aPagar.valor)};pagos ${t.aPagar.pagos};${n(t.aPagar.valorPago)}`
        : 'A pagar;indisponível: sem a leitura de títulos a pagar',
      t.aReceber
        ? `A receber;${t.aReceber.titulos} títulos;${n(t.aReceber.valor)};recebidos ${t.aReceber.recebidos};${n(t.aReceber.valorRecebido)}`
        : 'A receber;indisponível: sem a leitura de títulos a receber',
    );
    if (t.movimento) {
      const total = t.movimento.reduce((x, m) => x + m.lancamentos, 0);
      linhas.push(
        `Movimento;${total} = ${t.movimento.map((m) => `${m.lancamentos} ${limpo(m.rotulo)}`).join(' + ') || '0'}`,
        'Tipo;Lançamentos;Valor',
        ...t.movimento.map((m) => `${limpo(m.rotulo)};${m.lancamentos};${n(m.valor)}`),
      );
    } else linhas.push('Movimento;indisponível: sem a leitura do movimento bancário');
  } else linhas.push(`Títulos e movimento;indisponível: ${limpo(t.motivo)}`);
  const r = p.repasse;
  linhas.push(
    r.disponivel
      ? `Repasse;${r.itensIntegrados} itens integrados;${n(r.valorIntegrado)};${r.eventos} eventos;${n(r.valorEventos)};${r.rpas} RPAs`
      : `Repasse;indisponível: ${limpo(r.motivo)}`,
  );
  linhas.push(
    'Operação;Setor;Por este sistema',
    ...p.gravacoes.map((g) => `${limpo(g.rotulo)};${limpo(g.setorNome)};${g.peloNovo}`),
  );
  const u = p.uso;
  const contagem = (x: number) => (x > 0 && x < 5 ? '<5' : String(x));
  if (u.disponivel)
    linhas.push(
      `Grupo;Usuários;Conectados ao outro sistema desde ${u.desde}`,
      ...u.grupos.map((x) => `${limpo(x.grupo)};${contagem(x.usuarios)};${contagem(x.conectadosDesde)}`),
    );
  else linhas.push(`Uso do outro sistema;indisponível: ${limpo(u.motivo)}`);
  return linhas;
}
