// Aplicação do estoque, do almoxarifado e das compras (M28): as gravações das telas (pelo executor, com a trilha na
// mesma transação, ou só do novo em SGH_ com a SGH_TRILHA junto), o recebimento da transferência em dois passos, a
// conferência da nota com as tolerâncias do parâmetro, a aprovação por alçada, o inventário e a sugestão de compra.
// A tela nunca manda número de documento, valor de saída nem data gravada: o banco e os gatilhos fazem.
import {
  type AprovacaoPendente,
  type ApoioSuprimentos,
  type CriarPedidoEntrada,
  type DefinirVencedorEntrada,
  EVENTOS_AUDITAVEIS,
  type RegistrarEntradaNFEntrada,
  type ResultadoSuprimentos,
  PERMISSOES_CONTRATO_CODIGOS,
  SITUACOES_PEDIDO_COMPRA,
  type SugestaoCompra,
} from '@sgh/contratos';
import {
  calcularPontos,
  pontoDefinidoDoItem,
  centroTecnico,
  type FaixaAlcada,
  faixaDoValor,
  mesFechado,
  PARAMETROS_PADRAO,
  valorDaSugestao,
} from '@sgh/dominio-suprimentos';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { ApoiosSuprimentos } from './apoios.js';
import type { ContextoSuprimentos, PortaSuprimentos } from './porta.js';

const ctx = (s: SessaoCadastro): ContextoSuprimentos => s.porta;

/** O nível de alçada de quem tem a marca de autorizar pedido (sem nível por pessoa no outro sistema: D-ALCADA-28). */
export const NIVEL_APROVADOR = 3;

const MENSAGENS: Readonly<Record<string, string>> = {
  'suprimentos.registrarSaida': 'Saída registrada e consolidada.',
  'suprimentos.requisitarMaterial': 'Requisição enviada ao estoque.',
  'suprimentos.registrarDevolucao': 'Devolução registrada e consolidada.',
  'suprimentos.transferir': 'Transferência recebida e consolidada.',
  'suprimentos.registrarEntradaNF': 'Nota fiscal registrada e consolidada.',
  'suprimentos.criarPedido': 'Pedido de compra criado.',
  'suprimentos.registrarProposta': 'Proposta registrada.',
  'suprimentos.definirVencedorCotacao': 'Vencedor definido.',
  'suprimentos.registrarMovimentoDireto': 'Movimento direto registrado.',
  'suprimentos.registrarBalanco': 'Balanço do inventário gravado.',
  'suprimentos.fecharMes': 'Mês fechado.',
  'suprimentos.reabrirMes': 'Mês reaberto.',
  'suprimentos.reporKitRastreavel': 'Reposição do kit registrada.',
  'suprimentos.desconsolidarDocumento': 'Documento desconsolidado.',
  'suprimentos.corrigirValidadeLote': 'Validade do lote corrigida.',
};

const resultado = (
  mensagem: string,
  repetida: boolean,
  ids: Record<string, unknown>,
  avisos: string[] = [],
): ResultadoSuprimentos => ({
  mensagem,
  repetida,
  ids: Object.fromEntries(
    Object.entries(ids).filter(
      (e): e is [string, number | string] => typeof e[1] === 'number' || typeof e[1] === 'string',
    ),
  ),
  avisos,
});

export class ServicoSuprimentos {
  constructor(
    private readonly porta: PortaSuprimentos,
    private readonly apoios: ApoiosSuprimentos,
  ) {}

  /** Grava pelo executor (a funcionalidade da operação confere permissão e liberação). */
  async executar(
    s: SessaoCadastro,
    op: string,
    entrada: unknown,
    avisos: string[] = [],
  ): Promise<ResultadoSuprimentos> {
    const r = await this.apoios.daOperacao(op).executar(s, op, entrada, MENSAGENS[op] ?? 'Gravado.');
    const ids = r.resultado as Record<string, unknown>;
    const doc =
      typeof ids['doc'] === 'number' && typeof ids['mes'] === 'number'
        ? ` Documento ${ids['doc']} de ${String(ids['mes']).padStart(2, '0')}/${ids['ano']}.`
        : '';
    return resultado(`${r.mensagem}${doc}`, r.repetida, ids, avisos);
  }

  async apoio(s: SessaoCadastro): Promise<ApoioSuprimentos> {
    const [locais, centros, relogio, fechados, escopo] = await Promise.all([
      this.porta.locais(ctx(s)),
      this.porta.centrosCusto(ctx(s)),
      this.porta.relogio(ctx(s)),
      this.porta.mesesFechados(ctx(s)),
      this.porta.escopo(ctx(s), s.login).catch(() => null),
    ]);
    return {
      locais,
      centrosCusto: centros,
      situacoesPedido: SITUACOES_PEDIDO_COMPRA.map((x) => ({ id: x.id, rotulo: x.rotulo })),
      hoje: relogio.hoje,
      competencia: { ano: relogio.ano, mes: relogio.mes },
      mesFechado: mesFechado({ ano: relogio.ano, mes: relogio.mes }, fechados),
      escopo,
    };
  }

  // ── Nota fiscal: as tolerâncias do parâmetro do estabelecimento ─────────────────────────────────────

  async registrarNota(
    s: SessaoCadastro,
    e: Omit<RegistrarEntradaNFEntrada, 'tolerancias'>,
  ): Promise<ResultadoSuprimentos> {
    const apoio = this.apoios.apoios.notaFiscal;
    const [q, p, d] = await Promise.all([
      apoio.parametro(s, 'suprimentos.notaToleranciaQuantidadePct'),
      apoio.parametro(s, 'suprimentos.notaToleranciaPrecoPct'),
      apoio.parametro(s, 'suprimentos.notaToleranciaPrazoDias'),
    ]);
    const tolerancias = { quantidadePct: q || 5, precoPct: p || 2, prazoDias: d || 3 };
    return this.executar(s, 'suprimentos.registrarEntradaNF', { ...e, tolerancias });
  }

  // ── Transferência em dois passos (D-TRANSF-28) ──────────────────────────────────────────────────────

  async enviarTransferencia(
    s: SessaoCadastro,
    e: {
      origem: number;
      destino: number;
      observacao?: string | undefined;
      itens: {
        item: number;
        quantidade: number;
        lotes: { lote: string; validade: string; quantidade: number }[];
      }[];
    },
  ): Promise<ResultadoSuprimentos> {
    const id = await this.apoios.apoios.estoque.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosTransferenciaEnviada.codigo,
      'suprimentos.estoque',
      (x: number) => ({ tabela: 'SGH_SUP_TRANSF_ETAPA', id: String(x) }),
      (g) =>
        g.enviarTransferencia({
          origem: e.origem,
          destino: e.destino,
          observacao: e.observacao ?? null,
          itens: e.itens,
          usuario: s.login,
        }),
    );
    return resultado(
      `Transferência enviada (envio ${id}): o saldo fica na origem até o recebimento.`,
      false,
      { envio: id },
    );
  }

  async receberTransferencia(
    s: SessaoCadastro,
    envio: number,
    e: { recebidos: { item: number; quantidade: number }[]; motivoDivergencia?: string | undefined },
  ): Promise<ResultadoSuprimentos> {
    const x = await this.porta.envio(ctx(s), envio);
    if (!x) throw new ErroProblema('nao-encontrado', 404, 'Envio não encontrado');
    if (x.etapa !== 'enviada')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Envio já fechado',
        'O envio já foi recebido ou cancelado.',
        { codigo: 'envio-recebido' },
      );
    const itens = x.itens.flatMap((i) => {
      const r = e.recebidos.find((y) => y.item === i.item);
      const q = r ? r.quantidade : 0;
      if (q <= 0) return [];
      const lotes: { lote: string; validade: string; quantidade: number }[] = i.lotes
        ? JSON.parse(i.lotes)
        : [];
      // Recebido a menos: os lotes do envio na ordem até a quantidade recebida.
      let falta = q;
      const usados = lotes.flatMap((l) => {
        if (falta <= 0) return [];
        const u = Math.min(falta, l.quantidade);
        falta -= u;
        return [{ ...l, quantidade: u }];
      });
      return [{ item: i.item, quantidade: q, lotes: usados }];
    });
    const divergente = x.itens.some(
      (i) => (e.recebidos.find((y) => y.item === i.item)?.quantidade ?? 0) !== i.quantidade,
    );
    if (divergente && (e.motivoDivergencia ?? '').trim().length < 10)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Divergência sem motivo',
        'O recebido difere do enviado: escreva o motivo da divergência.',
        {
          codigo: 'sem-motivo-divergencia',
          campos: ['motivoDivergencia'],
        },
      );
    if (itens.length === 0)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Nada recebido',
        'Nenhum item recebido: cancele o envio em vez de receber.',
        { codigo: 'nada-recebido' },
      );
    const r = await this.executar(s, 'suprimentos.transferir', {
      origem: x.origem,
      destino: x.destino,
      envio,
      itens,
    });
    if (divergente)
      await this.apoios.apoios.estoque.sgh(
        s,
        EVENTOS_AUDITAVEIS.suprimentosTransferenciaRecebida.codigo,
        'suprimentos.estoque',
        { tabela: 'SGH_SUP_TRANSF_ETAPA', id: String(envio) },
        (g) => g.registrarDivergencia({ id: envio, motivo: e.motivoDivergencia ?? '' }),
      );
    return divergente ? { ...r, avisos: [...r.avisos, 'Recebimento com divergência registrada.'] } : r;
  }

  /** A autorização da requisição pendente (registro do novo; a marca "autoriza requisição" relida na transação). */
  async autorizarRequisicao(
    s: SessaoCadastro,
    r: { ano: number; mes: number; doc: number },
  ): Promise<ResultadoSuprimentos> {
    await this.apoios.apoios.estoque.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosRequisicaoAutorizada.codigo,
      'suprimentos.estoque',
      { tabela: 'SGH_SUP_DOC_OCORRENCIA', id: `requisicao ${r.ano}/${r.mes}/${r.doc}` },
      (g) => g.autorizarRequisicao({ ...r, usuario: s.login }),
    );
    return resultado('Requisição autorizada.', false, { doc: r.doc });
  }

  async cancelarEnvio(s: SessaoCadastro, envio: number, motivo: string): Promise<ResultadoSuprimentos> {
    await this.apoios.apoios.estoque.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosTransferenciaEnviada.codigo,
      'suprimentos.estoque',
      { tabela: 'SGH_SUP_TRANSF_ETAPA', id: String(envio) },
      (g) => g.cancelarTransferencia({ id: envio, motivo, usuario: s.login }),
    );
    return resultado('Envio cancelado: o saldo continua na origem.', false, { envio });
  }

  // ── Compras: aprovação por alçada (só no novo) ──────────────────────────────────────────────────────

  async faixas(s: SessaoCadastro): Promise<FaixaAlcada[]> {
    const a = this.apoios.apoios.compras;
    const n1 = (await a.parametro(s, 'suprimentos.alcadaNivel1Ate')) || 5_000;
    const n2 = (await a.parametro(s, 'suprimentos.alcadaNivel2Ate')) || 50_000;
    return [
      { ate: n1, nivel: 1 },
      { ate: Math.max(n2, n1), nivel: 2 },
      { ate: Number.POSITIVE_INFINITY, nivel: 3 },
    ];
  }

  async aprovacoes(s: SessaoCadastro): Promise<AprovacaoPendente[]> {
    const r = await this.porta.relogio(ctx(s));
    const [lista, faixas, escopo] = await Promise.all([
      this.porta.pedidos(ctx(s), { ano: r.ano }),
      this.faixas(s),
      this.porta.escopo(ctx(s), s.login).catch(() => null),
    ]);
    const pode = s.pode('suprimentos.pedido.aprovar') && (escopo?.flags.autorizarPedido ?? false);
    return lista.itens
      .filter((p) => p.aprovacao === null && p.valor.parcelas.length > 0)
      .map((p) => {
        const f = faixaDoValor(p.valor.total, faixas);
        const motivo = !pode
          ? 'Seu usuário do estoque não tem a marca de autorizar pedido.'
          : p.usuario === s.login
            ? 'Quem fez o pedido não o aprova.'
            : NIVEL_APROVADOR < f.nivel
              ? `O valor exige a alçada de nível ${f.nivel}.`
              : null;
        return {
          ...p,
          faixa: { nivel: f.nivel, ate: Number.isFinite(f.ate) ? f.ate : null },
          podeAprovar: motivo === null,
          motivo,
        };
      });
  }

  async aprovarPedido(
    s: SessaoCadastro,
    e: { pedido: { ano: number; doc: number }; decisao: 'aprovado' | 'reprovado'; justificativa: string },
  ): Promise<ResultadoSuprimentos> {
    const faixas = await this.faixas(s);
    const r = await this.apoios.apoios.compras.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosPedidoAprovado.codigo,
      'suprimentos.compras',
      (x: { id: number }) => ({
        tabela: 'SGH_SUP_APROVACAO_PEDIDO',
        id: String(x.id),
        chave: `${e.pedido.ano}/${e.pedido.doc}`,
      }),
      (g) =>
        g.aprovarPedido({
          ano: e.pedido.ano,
          doc: e.pedido.doc,
          decisao: e.decisao,
          justificativa: e.justificativa,
          usuario: s.login,
          nivel: NIVEL_APROVADOR,
          faixas,
        }),
    );
    return resultado(
      e.decisao === 'aprovado' ? `Pedido aprovado (alçada de nível ${r.nivel}).` : 'Pedido reprovado.',
      false,
      { id: r.id, valor: r.valor, nivel: r.nivel },
    );
  }

  async definirVencedor(s: SessaoCadastro, e: DefinirVencedorEntrada): Promise<ResultadoSuprimentos> {
    return this.executar(s, 'suprimentos.definirVencedorCotacao', e);
  }

  async criarPedido(s: SessaoCadastro, e: CriarPedidoEntrada): Promise<ResultadoSuprimentos> {
    // M55 (etapa 3): o pedido ligado a contrato só com a permissão de ligar ao contrato (a mesma da tela de contratos)
    // e com os contratos ligados no estabelecimento (POL-3).
    if (e.contrato) {
      await this.apoios.apoios.contratos.exigirPermissao(s, PERMISSOES_CONTRATO_CODIGOS.editar);
      await this.apoios.apoios.contratos.exigirLiberacao(s);
    }
    return this.executar(s, 'suprimentos.criarPedido', e);
  }

  // ── Ponto de pedido e sugestão de compra ────────────────────────────────────────────────────────────

  async sugestao(s: SessaoCadastro, local: number | undefined): Promise<SugestaoCompra> {
    const r = await this.porta.relogio(ctx(s));
    const apoio = this.apoios.apoios.compras;
    const meses = (await apoio.parametro(s, 'suprimentos.pontoPedidoMeses')) || PARAMETROS_PADRAO.meses;
    const nivel = (await apoio.parametro(s, 'suprimentos.pontoPedidoNivelServicoPct')) || 95;
    const fatorServico =
      nivel >= 99 ? 2.33 : nivel >= 97 ? 1.88 : nivel >= 95 ? 1.65 : nivel >= 90 ? 1.28 : 1;
    const competencias: { ano: number; mes: number }[] = [];
    let { ano, mes } = r;
    for (let i = 0; i < meses; i += 1) {
      mes -= 1;
      if (mes === 0) {
        mes = 12;
        ano -= 1;
      }
      competencias.unshift({ ano, mes });
    }
    const [consumo, emPedido, pontos, saldos] = await Promise.all([
      this.porta.consumoMensalPorItem(ctx(s), { ...(local ? { local } : {}), meses: competencias }),
      this.porta.emPedidoPorItem(ctx(s), r.ano - 1),
      this.porta.pontosPedido(ctx(s), local),
      this.porta.saldos(ctx(s), {
        ...(local ? { local } : {}),
        comSaldo: false,
        hoje: r.hoje,
        alertaDias: 0,
      }),
    ]);
    const saldoPorItem = new Map<number, { saldo: number; nome: string; custo: number }>();
    for (const x of saldos.itens) {
      const a = saldoPorItem.get(x.item) ?? { saldo: 0, nome: x.nome, custo: x.custoMedio };
      a.saldo += x.quantidade;
      saldoPorItem.set(x.item, a);
    }
    const base = [...consumo.entries()]
      .filter(([item]) => saldoPorItem.has(item))
      .map(([item, c]) => {
        const definido = pontoDefinidoDoItem(pontos, item, local);
        return {
          item,
          consumos: c.consumos,
          valor: c.valor,
          saldo: saldoPorItem.get(item)!.saldo,
          prazoDias: definido?.prazoDias ?? 15,
          emPedido: emPedido.get(item) ?? 0,
          estoqueSegurancaDefinido: definido?.estoqueSeguranca ?? null,
        };
      });
    const calc = calcularPontos(base, { ...PARAMETROS_PADRAO, meses, fatorServico });
    const itens = calc
      .filter((p) => p.sugestao > 0)
      .map((p) => {
        const b = base.find((x) => x.item === p.item)!;
        const sx = saldoPorItem.get(p.item)!;
        return {
          item: p.item,
          nome: sx.nome,
          saldo: b.saldo,
          emPedido: b.emPedido,
          mediaMensal: p.mediaMensal,
          estoqueSeguranca: p.estoqueSeguranca,
          pontoPedido: p.pontoPedido,
          sugestao: p.sugestao,
          curvaAbc: p.curvaAbc,
          curvaXyz: p.curvaXyz,
          prazoDias: b.prazoDias,
          custo: sx.custo,
        };
      })
      .sort((a, b) => a.curvaAbc.localeCompare(b.curvaAbc) || b.sugestao - a.sugestao);
    return {
      local: local ?? null,
      meses,
      itens,
      valor: valorDaSugestao(itens.map((i) => ({ quantidade: i.sugestao, custo: i.custo }))),
      calculadoEm: new Date().toISOString(),
    };
  }

  /** Centros de custo técnicos (9901 a 9999) não geram consumo: a tela avisa. */
  avisosDaSaida(centroCusto: number): string[] {
    return centroTecnico(centroCusto) ? ['Centro de custo técnico: a saída não gera consumo.'] : [];
  }
}
