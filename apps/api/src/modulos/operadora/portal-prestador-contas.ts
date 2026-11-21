// W0-10 (M8): as contas médicas pelo portal do prestador credenciado. O prestador envia o lote XML TISS 04.03.00 pelo
// portal, com a MESMA conferência do recebimento interno (M56, etapa 6: a versão, o XSD, o hash do epílogo, a operadora
// de destino, o prestador da rede, o lote repetido, as críticas e as glosas automáticas) e mais uma: o lote tem de ser
// do prestador da conta do portal e da operadora dela (`lote-de-outro-prestador`, antes de qualquer escrita). O XML vai
// guardado sem edição (lote_conta_recebida, com o SHA-256 único e o hash do epílogo) e recebe o protocolo; a trilha
// `operadora.portal.lote-enviado` vai na mesma transação. O prestador vê os lotes dele (só os dele, na operadora da conta)
// e baixa o demonstrativo de análise e, do lote pago, o de pagamento (o mesmo XML do lado interno, validado no XSD), com
// a trilha da leitura. O prestador vê as glosas do lote e recorre item a item (a guia inteira de uma vez, uma por guia):
// registro novo ligado à guia e a cada item, com a trilha `operadora.portal.recurso-item-enviado`. Exige a
// chave do portal (`operadora.portalPrestador`) e a das contas (`operadora.contas`).
import {
  CHAVE_OPERADORA_CONTAS,
  type ContasPortal,
  EVENTOS_AUDITAVEIS,
  type GlosasContaPortal,
  type ReceberContaEntrada,
  type RegistrarRecursoItensEntrada,
  type ResultadoConta,
} from '@sgh/contratos';
import { protocoloConta } from '@sgh/dominio-operadora';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro } from '../cadastro/comum.js';
import type { PortaContasOperadora } from './contas-porta.js';
import { recusaDasContas, resumoDaConta, ServicoContasOperadora } from './contas-servico.js';
import {
  type ServicoPortalPrestador,
  type SessaoPortalPrestadorInterna,
  USUARIO_PORTAL_PRESTADOR,
} from './portal-prestador-servico.js';

const E = EVENTOS_AUDITAVEIS;
const TABELA = 'lote_conta_recebida';
const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const naoEncontrado = () =>
  new ErroProblema('nao-encontrado', 404, 'Lote não encontrado', 'Este lote não é do seu credenciamento.');

export class ServicoContasPortalPrestador {
  readonly contas: ServicoContasOperadora;

  constructor(
    private readonly portal: ServicoPortalPrestador,
    private readonly porta: PortaContasOperadora,
  ) {
    this.contas = new ServicoContasOperadora(porta);
  }

  private c(s: SessaoPortalPrestadorInterna) {
    return this.portal.contextoDe(s);
  }

  /** Os lotes do prestador da sessão na operadora da conta, do mais novo (50 por página). */
  async lista(s: SessaoPortalPrestadorInterna, apos?: number): Promise<ContasPortal> {
    await this.portal.exigirContaComChave(s, CHAVE_OPERADORA_CONTAS);
    const c = this.c(s);
    const [r, relogio] = await Promise.all([
      this.porta.contas(c, { prestador: s.prestador, ...(apos !== undefined ? { apos } : {}) }),
      this.porta.relogio(c),
    ]);
    return {
      itens: r.itens
        .filter((x) => x.operadora === s.operadora && x.prestador === s.prestador)
        .map((x) => ({
          ...resumoDaConta(x, relogio.hoje),
          demonstrativo: x.situacao === 'analisada' || x.situacao === 'paga',
          demonstrativoPagamento: x.situacao === 'paga',
        })),
      proxima: r.proxima,
    };
  }

  /** O envio do lote: a conferência inteira do recebimento e a do dono do lote, antes de qualquer escrita. */
  async enviar(s: SessaoPortalPrestadorInterna, e: ReceberContaEntrada, ip: string): Promise<ResultadoConta> {
    await this.portal.exigirContaComChave(s, CHAVE_OPERADORA_CONTAS);
    const c = this.c(s);
    const x = await this.contas.conferirRecebimento(c, e);
    if (x.recebimento.prestador !== s.prestador || x.recebimento.operadora !== s.operadora)
      throw recusaDasContas([{ codigo: 'lote-de-outro-prestador', campo: 'arquivo' }]);
    const { hoje } = await this.porta.relogio(c);
    let protocolo = '';
    const r = await this.porta
      .gravar(
        c,
        (y: { id: number; versao: number }) =>
          this.portal.linhaDoPortal(
            s,
            E.operadoraPortalLoteEnviado.codigo,
            String(y.id),
            'sucesso',
            ip,
            TABELA,
          ),
        async (g) => {
          protocolo = protocoloConta(hoje, await g.proximoProtocolo());
          return g.receber({
            ...x.recebimento,
            protocolo,
            texto: `Enviado pelo portal do prestador. ${ServicoContasOperadora.textoDoRecebimento(protocolo, x)}`,
            usuario: USUARIO_PORTAL_PRESTADOR,
          });
        },
      )
      .catch((err: unknown) => {
        throw problemaDoCadastro(err);
      });
    const prazo = x.recebimento.prazoPagamento.split('-').reverse().join('/');
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      situacao: 'recebida',
      protocolo,
      mensagem: `Lote ${x.recebimento.numeroLote} recebido com o protocolo ${protocolo}: ${x.guias} guia(s), apresentado ${brl(x.recebimento.apresentado)}. Pagamento previsto até ${prazo}.`,
      avisos: x.itensGlosados
        ? [
            `Glosa automática de ${brl(x.glosadoAutomatico)} em ${x.itensGlosados} item(ns), revista pelo auditor na análise.`,
          ]
        : [],
    };
  }

  /** O lote do prestador da sessão (404 para o de outro: nem a existência vaza). */
  private async contaDoPrestador(s: SessaoPortalPrestadorInterna, id: number) {
    const conta = await this.porta.conta(this.c(s), id);
    if (!conta || conta.prestador !== s.prestador || conta.operadora !== s.operadora) throw naoEncontrado();
    return conta;
  }

  /** As glosas de um lote do prestador: as guias com glosa, os itens glosados e o recurso de cada item. */
  async glosas(s: SessaoPortalPrestadorInterna, id: number): Promise<GlosasContaPortal> {
    await this.portal.exigirContaComChave(s, CHAVE_OPERADORA_CONTAS);
    const c = this.c(s);
    const conta = await this.contaDoPrestador(s, id);
    const [guias, itens, motivos, recursos] = await Promise.all([
      this.porta.guias(c, id),
      this.porta.itens(c, id),
      this.porta.motivos(c),
      this.porta.recursosItens(c, id),
    ]);
    const nomeMotivo = new Map(motivos.map((m) => [m.codigo, m.nome]));
    const podeRecorrer = conta.situacao === 'analisada' || conta.situacao === 'paga';
    return {
      id: conta.id,
      versao: conta.versao,
      protocolo: conta.protocolo,
      numeroLote: conta.numeroLote,
      situacao: conta.situacao,
      podeRecorrer,
      guias: guias
        .filter((g) => g.glosado > 0 || g.recurso)
        .map((g) => ({
          id: g.id,
          numeroGuiaPrestador: g.numeroGuiaPrestador,
          apresentado: g.apresentado,
          glosado: g.glosado,
          acatado: g.acatado,
          recurso: g.recurso
            ? {
                situacao: g.recurso.situacao,
                valor: g.recurso.valor,
                justificativa: g.recurso.justificativa,
                parecer: g.recurso.parecer,
              }
            : null,
          recorrivel: podeRecorrer && g.glosado > 0 && !g.recurso,
          itens: itens
            .filter((i) => i.guia === g.id && i.glosado > 0)
            .map((i) => {
              const r = recursos.find((x) => x.item === i.id);
              return {
                id: i.id,
                codigo: i.codigo,
                descricao: i.descricao,
                apresentado: i.apresentado,
                glosado: i.glosado,
                motivo: i.motivo,
                motivoNome: i.motivo === null ? null : (nomeMotivo.get(i.motivo) ?? null),
                justificativa: i.justificativa,
                recurso: r
                  ? {
                      id: r.id,
                      item: r.item,
                      valor: r.valor,
                      justificativa: r.justificativa,
                      em: r.em,
                      por: r.por,
                      decisao: r.decisao ? { ...r.decisao } : null,
                    }
                  : null,
              };
            }),
        })),
    };
  }

  /**
   * O recurso de glosa por item de uma guia do lote do prestador: a conferência inteira antes de qualquer escrita; o
   * recurso é registro novo (a guia recebe a soma e cada item a sua linha), com a trilha na mesma transação.
   */
  async recorrer(
    s: SessaoPortalPrestadorInterna,
    id: number,
    e: RegistrarRecursoItensEntrada,
    ip: string,
  ): Promise<ResultadoConta> {
    await this.portal.exigirContaComChave(s, CHAVE_OPERADORA_CONTAS);
    const c = this.c(s);
    await this.contaDoPrestador(s, id);
    const x = await this.contas.conferirRecursoItens(c, id, e);
    const r = await this.porta
      .gravar(
        c,
        this.portal.linhaDoPortal(
          s,
          E.operadoraPortalRecursoItemEnviado.codigo,
          String(id),
          'sucesso',
          ip,
          TABELA,
        ),
        (g) =>
          g.registrarRecursoItens({
            id,
            versao: e.versao,
            guia: e.guia,
            itens: e.itens,
            justificativa: e.justificativa,
            situacao: x.situacao,
            acesso: s.acesso,
            usuario: USUARIO_PORTAL_PRESTADOR,
          }),
      )
      .catch((err: unknown) => {
        throw problemaDoCadastro(err);
      });
    return {
      ok: true,
      id,
      versao: r.versao,
      situacao: x.situacao,
      protocolo: x.conta.protocolo,
      mensagem: `Recurso de ${brl(x.valor)} em ${e.itens.length} item(ns) da guia ${x.guia.numeroGuiaPrestador} enviado. A operadora decide item a item.`,
      avisos: [],
    };
  }

  /**
   * O demonstrativo de análise (ou o de pagamento, do lote pago) de um lote do prestador (404 para o lote de outro),
   * com a trilha da leitura.
   */
  async demonstrativo(
    s: SessaoPortalPrestadorInterna,
    id: number,
    ip: string,
    tipo: 'analise' | 'pagamento' = 'analise',
  ): Promise<{ nome: string; xmlBase64: string; hash: string }> {
    await this.portal.exigirContaComChave(s, CHAVE_OPERADORA_CONTAS);
    const c = this.c(s);
    const conta = await this.porta.conta(c, id);
    if (!conta || conta.prestador !== s.prestador || conta.operadora !== s.operadora) throw naoEncontrado();
    const d =
      tipo === 'pagamento'
        ? await this.contas.demonstrativoPagamento(c, id)
        : await this.contas.demonstrativo(c, id);
    if (this.porta.destino === 'banco')
      await this.porta.gravar(
        c,
        this.portal.linhaDoPortal(
          s,
          tipo === 'pagamento'
            ? E.operadoraPortalDemonstrativoPagamentoBaixado.codigo
            : E.operadoraPortalDemonstrativoBaixado.codigo,
          String(id),
          'sucesso',
          ip,
          TABELA,
        ),
        async () => ({ id }),
      );
    return d;
  }
}
