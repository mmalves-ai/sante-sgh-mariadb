// W0-10 (programa CRUD completo; linha 'Financeiro' da matriz): a tesouraria das cobranças do portal do paciente. A
// fila (confirmados e duplicados no período, com quem cobrou e os atos), a baixa ou a divergência pelo extrato do
// gateway e o estorno pelo gateway. Cada ato é um fato novo (SGH_POR_CONCILIACAO, script 1143) com a SGH_TRILHA na mesma
// transação; nada se altera nem se apaga. A regra (conferirConciliacaoPortal) é conferida aqui, para o problema sair com
// o código certo, e de novo na gravação com o pagamento travado. O estorno chama o gateway ANTES de gravar e guarda o
// comprovante como referência; sem gateway (produção sem o contrato do dono), o estorno fica indisponível com o motivo.
import {
  CHAVE_PORTAL_PAGAMENTO,
  type ConciliarPagamentoPortal,
  type EstornarPagamentoPortal,
  EVENTOS_AUDITAVEIS,
  type FiltroTesourariaPortal,
  type ListaTesourariaPortal,
  type PagamentoTesourariaPortal as PagamentoTesourariaDto,
} from '@sgh/contratos';
import { ErroPortal, type RegistroTrilhaPortal } from '../tipos.js';
import {
  type AcaoConciliacaoPortal,
  type ConciliacaoPortal,
  conferirConciliacaoPortal,
  type PagamentoTesourariaPortal,
  situacaoTesourariaPortal,
} from './tipos.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { GatewayPagamento } from './gateway.js';
import type { ContextoAgendaOnline, PortaAgendaOnline } from './porta.js';
import type { QuemAgendaOnline } from './servico.js';

const dto = (t: PagamentoTesourariaPortal): PagamentoTesourariaDto => ({
  id: String(t.pagamento.id),
  tipo: t.pagamento.tipo,
  marcacao: String(t.pagamento.marcacao),
  paciente: String(t.pagamento.paciente),
  valor: t.pagamento.valor,
  forma: t.pagamento.forma,
  conector: t.pagamento.conector,
  transacao: t.pagamento.transacao,
  situacaoCobranca: t.pagamento.situacao,
  confirmadoEm: t.pagamento.confirmadoEm,
  cobradoPor: t.cobradoPor,
  situacao: situacaoTesourariaPortal(t.atos),
  atos: t.atos.map((a: ConciliacaoPortal) => ({
    id: String(a.id),
    acao: a.acao,
    valor: a.valor,
    referencia: a.referencia,
    motivo: a.motivo,
    usuario: a.usuario,
    em: a.em,
  })),
});

export class TesourariaPortal {
  constructor(
    private readonly porta: PortaAgendaOnline,
    private readonly gateway: GatewayPagamento,
    private readonly rede: string,
  ) {}

  private ctx(q: QuemAgendaOnline): ContextoAgendaOnline {
    return { rede: q.rede, hospital: q.hospital };
  }

  get estornoDisponivel(): boolean {
    return this.gateway.disponivel;
  }

  async listar(q: QuemAgendaOnline, f: FiltroTesourariaPortal): Promise<ListaTesourariaPortal> {
    const itens = await this.porta.tesouraria(this.ctx(q), f.de, f.ate);
    return { itens: itens.map(dto), estornoDisponivel: this.estornoDisponivel };
  }

  private async conferido(
    q: QuemAgendaOnline,
    id: number,
    acao: AcaoConciliacaoPortal,
    valor: number | null,
    motivo: string | null,
  ): Promise<PagamentoTesourariaPortal> {
    const t = await this.porta.pagamentoTesouraria(this.ctx(q), id);
    if (!t) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'Pagamento não encontrado.');
    const r = conferirConciliacaoPortal(t, {
      acao,
      valor: valor ?? t.pagamento.valor,
      motivo,
      usuario: q.login,
    });
    if (r)
      throw new ErroProblema(
        r.codigo === 'motivo' ? 'entrada-invalida' : 'recusa-de-negocio',
        r.codigo === 'motivo' ? 400 : 409,
        r.codigo === 'segregacao' ? 'Segregação de funções' : 'Pedido recusado',
        r.mensagem,
        { codigo: r.codigo },
      );
    return t;
  }

  private linha(
    q: QuemAgendaOnline,
    t: PagamentoTesourariaPortal,
    acao: AcaoConciliacaoPortal,
  ): RegistroTrilhaPortal {
    const estorno = acao === 'estorno';
    return {
      rede: this.rede,
      hospital: q.hospital,
      usuario: q.login.slice(0, 31),
      evento: estorno
        ? EVENTOS_AUDITAVEIS.portalPagamentoEstornado.codigo
        : EVENTOS_AUDITAVEIS.portalPagamentoConciliado.codigo,
      recurso: CHAVE_PORTAL_PAGAMENTO,
      operacao: estorno
        ? 'estornarPagamento'
        : acao === 'conciliado'
          ? 'conciliarPagamento'
          : 'divergenciaPagamento',
      tabelaAlvo: 'conciliacao_pagamento_portal',
      idAlvo: String(t.pagamento.id),
      chaveNaturalAlvo: t.pagamento.transacao.slice(0, 80),
      resultado: 'sucesso',
      estacao: q.estacao,
      correlacao: q.correlacao,
      origem: null,
      idPaciente: t.pagamento.paciente,
    };
  }

  private async gravar(
    q: QuemAgendaOnline,
    t: PagamentoTesourariaPortal,
    n: { acao: AcaoConciliacaoPortal; valor: number; referencia: string | null; motivo: string | null },
  ): Promise<PagamentoTesourariaDto> {
    try {
      await this.porta.gravar(
        this.ctx(q),
        (g) => g.registrarConciliacao({ pagamento: t.pagamento.id, usuario: q.login, ...n }),
        this.linha(q, t, n.acao),
      );
    } catch (e) {
      // A regra conferida de novo sob a trava (outro ato chegou antes): 409 com o motivo.
      if (e instanceof ErroPortal)
        throw new ErroProblema(
          e.codigo === 'nao-encontrado' ? 'nao-encontrado' : 'recusa-de-negocio',
          e.codigo === 'nao-encontrado' ? 404 : 409,
          'Pedido recusado',
          e.message,
          { codigo: e.codigo },
        );
      throw e;
    }
    const depois = await this.porta.pagamentoTesouraria(this.ctx(q), t.pagamento.id);
    return dto(depois as PagamentoTesourariaPortal);
  }

  /** A baixa (o valor do extrato confere) ou a divergência com motivo. */
  async conciliar(
    q: QuemAgendaOnline,
    id: number,
    e: ConciliarPagamentoPortal,
  ): Promise<PagamentoTesourariaDto> {
    const motivo = e.acao === 'divergente' ? e.motivo : null;
    const t = await this.conferido(q, id, e.acao, e.valor, motivo);
    return this.gravar(q, t, { acao: e.acao, valor: e.valor, referencia: e.referencia, motivo });
  }

  /** O estorno total pelo gateway (o comprovante vira a referência do ato). */
  async estornar(
    q: QuemAgendaOnline,
    id: number,
    e: EstornarPagamentoPortal,
  ): Promise<PagamentoTesourariaDto> {
    const t = await this.conferido(q, id, 'estorno', null, e.motivo);
    if (!this.gateway.disponivel || this.gateway.conector !== t.pagamento.conector)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Estorno indisponível',
        'O gateway de pagamento deste pagamento não está configurado neste ambiente (depende do contrato do gateway).',
        { codigo: 'recurso-desligado' },
      );
    const { comprovante } = await this.gateway.estornar(t.pagamento.transacao, t.pagamento.valor);
    return this.gravar(q, t, {
      acao: 'estorno',
      valor: t.pagamento.valor,
      referencia: comprovante.slice(0, 80),
      motivo: e.motivo,
    });
  }
}
