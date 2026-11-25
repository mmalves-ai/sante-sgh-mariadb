// Rotas da troca TISS na visão da operadora (08-SGO linha 107, C2-061; F7):
//   GET  /api/operadora/troca-tiss            as últimas trocas recebidas e enviadas (tipo, direção)
//   POST /api/operadora/troca-tiss/mensagens  a mensagem TISS 4.03 recebida do prestador (XML em base64): o XSD oficial,
//                                             a versão e o hash do epílogo; a operadora de destino, o prestador da rede
//                                             e o sequencial novo; e, pelo tipo de transação:
//                                               - SOLICITACAO_PROCEDIMENTOS: a troca reservada 'em_processamento' (o UNIQUE
//                                                 do sequencial recusa o envio simultâneo do mesmo sequencial), o pedido de
//                                                 autorização registrado como o do portal e da central (as mesmas regras),
//                                                 com a origem "troca eletrônica", e a reserva concluída com o protocolo;
//                                               - CANCELA_GUIA: o resultado guia a guia e o protocolo da resposta;
//                                               - COMUNICACAO_BENEFICIARIO: a internação ou a alta comunicada.
//                                             A mensagem que não vira pedido fica registrada como rejeitada, com o motivo.
// Cada gravação é uma operação do Executor com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import {
  CHAVE_OPERADORA_AUTORIZACAO,
  CHAVE_OPERADORA_CONTAS,
  esquemaRegistrarAutorizacao,
  EVENTOS_AUDITAVEIS,
  ROTAS_OPERADORA_F5,
} from '@sgh/contratos';
import {
  carregarEsquemas,
  conferirHashEpilogo,
  explicarErroXsd,
  iso88591,
  PADRAO_TISS,
  validarNoXsd,
  type ArquivoEsquema,
} from '@sgh/dominio-faturamento';
import {
  ErroTrocaTiss,
  lerCabecalhoTroca,
  lerCancelamentoGuia,
  lerComunicacaoBeneficiario,
  lerSolicitacaoProcedimento,
  pedidoDaSolicitacao,
  problemasDaComunicacao,
  problemasDaSolicitacao,
  problemasDaTroca,
  protocoloAtendimento,
  TIPOS_TROCA_TISS,
} from '@sgh/dominio-operadora';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ServicoSituacaoOperadora } from './aplicacao/situacao.js';
import { PORTA_AUTORIZACAO_OPERADORA, type PortaAutorizacaoOperadora } from './autorizacao-porta.js';
import { ServicoAutorizacaoOperadora } from './autorizacao-servico.js';
import { contextoGravacao } from './contexto-gravacao.js';
import {
  type ApoioRecebimentoTroca,
  PORTA_TROCA_TISS,
  type PortaTrocaTissPropria,
  type TrocaRecebida,
  type TrocaTissResumo,
} from './troca-tiss-propria.js';

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'operadora.troca-tiss';
const PERM_LER = ROTAS_OPERADORA_F5.lista.permissao;
const PERM_RECEBER = ROTAS_OPERADORA_F5.receber.permissao;
const PERM_AUTORIZAR = 'operadora.autorizacao.registrar';
/** O teto da mensagem recebida (a mesma ordem de grandeza do lote de contas). */
const MAXIMO_BYTES = 2_000_000;

export const ROTAS_TROCA_TISS = {
  lista: 'operadora/troca-tiss',
  receber: 'operadora/troca-tiss/mensagens',
} as const;

const esquemaMensagem = z
  .object({
    arquivo: z
      .string()
      .min(1)
      .max(Math.ceil((MAXIMO_BYTES * 4) / 3) + 8),
    canal: z.enum(['arquivo', 'webservice']).default('arquivo'),
  })
  .strict();

const esquemaFiltro = z
  .object({
    tipo: z.enum(TIPOS_TROCA_TISS).optional(),
    direcao: z.enum(['recebida', 'enviada']).optional(),
  })
  .strict();

const TEXTOS: Readonly<Record<string, string>> = {
  'transacao-nao-recebida':
    'Esta porta recebe pedido de autorização, cancelamento de guia e comunicação de internação.',
  'operadora-de-outro-registro': 'A mensagem é para outra operadora (registro na agência).',
  'prestador-nao-identificado': 'O prestador de origem não está na rede desta operadora.',
  'transacao-repetida': 'Este sequencial de transação do prestador já foi recebido.',
  'mensagem-sem-cabecalho': 'A mensagem não tem o cabeçalho TISS completo.',
  'corpo-ausente': 'O corpo da mensagem não corresponde ao tipo de transação.',
  'evento-no-futuro': 'A data do evento não pode ser futura.',
  'internacao-sem-tipo': 'A comunicação de internação precisa do tipo de internação.',
  'alta-sem-motivo': 'A comunicação de alta precisa do motivo de encerramento.',
  'conselho-nao-aceito': 'O conselho do profissional solicitante não é aceito.',
  'uf-invalida': 'A UF do conselho do solicitante é inválida.',
  'sem-itens': 'O pedido não tem procedimentos.',
  'tabela-nao-aceita': 'Há item de tabela não aceita (use 18, 19, 20 ou 22).',
  'internacao-sem-cid': 'O pedido de internação precisa do CID-10.',
  'origem-troca-ausente': 'Cadastre a origem de pedido do canal "troca eletrônica" antes de receber pedidos.',
  'tipo-guia-ausente': 'O tipo de guia do pedido não está cadastrado.',
};
const texto = (codigos: readonly string[]) => codigos.map((c) => TEXTOS[c] ?? c);

export interface ResultadoTrocaRecebida {
  readonly troca: number | null;
  readonly tipo: string;
  readonly situacao: 'processada' | 'rejeitada';
  readonly protocolo: string | null;
  readonly motivos: readonly string[];
  readonly guias?: readonly { numeroGuiaPrestador: string; resultado: string; observacao: string | null }[];
  readonly comunicacao?: { situacao: string; beneficiarioIdentificado: boolean };
}

let esquemasTiss: Promise<ArquivoEsquema[]> | null = null;
function esquemas(): Promise<ArquivoEsquema[]> {
  esquemasTiss ??= carregarEsquemas().catch((e: unknown) => {
    esquemasTiss = null;
    throw e;
  });
  return esquemasTiss;
}

const recusa = (codigos: readonly string[], avisos?: readonly string[]) =>
  new ErroProblema('recusa-de-negocio', 409, 'Mensagem recusada', texto(codigos).join(' '), {
    codigo: codigos[0] ?? 'recusa',
    campos: ['arquivo'],
    bloqueios: [...codigos],
    ...(avisos ? { avisos } : {}),
  });

@Controller()
export class TrocaTissOperadoraController {
  readonly situacoes: ServicoSituacaoOperadora;
  readonly autorizacao: ServicoAutorizacaoOperadora;

  constructor(
    @Inject(PORTA_TROCA_TISS) private readonly porta: PortaTrocaTissPropria,
    @Inject(PORTA_AUTORIZACAO_OPERADORA) private readonly autorizacoes: PortaAutorizacaoOperadora,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.situacoes = new ServicoSituacaoOperadora(fonte, cache);
    this.autorizacao = new ServicoAutorizacaoOperadora(autorizacoes);
  }

  private async exigir(
    req: RequisicaoAutorizada,
    chave: typeof CHAVE_OPERADORA_CONTAS | typeof CHAVE_OPERADORA_AUTORIZACAO,
  ): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    await this.situacoes.exigir(
      { rede: s.rede, hospital: s.hospital, login: s.login, setor: req.sgh?.sessao.unidadeAtiva ?? null },
      chave,
    );
    return s;
  }

  private linha(s: SessaoCadastro, evento: string, operacao: string, tabela: string) {
    return (r: { id: number }) => linhaTrilha(s, evento, RECURSO, operacao, { tabela, id: String(r.id) });
  }

  @Get(ROTAS_TROCA_TISS.lista)
  @Permissao(PERM_LER)
  async lista(@Query() q: Record<string, string | undefined>, @Req() req: RequisicaoAutorizada) {
    const f = esquemaFiltro.safeParse(q ?? {});
    if (!f.success)
      throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
    const s = await this.exigir(req, CHAVE_OPERADORA_CONTAS);
    const itens: TrocaTissResumo[] = await this.porta.trocas(s.porta, f.data).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    return { itens };
  }

  @Post(ROTAS_TROCA_TISS.receber)
  @HttpCode(200)
  @Permissao(PERM_RECEBER)
  @AuditadoNoHandler(
    'operadora.troca-tiss (troca_tiss_operadora e, pelo tipo, pedido_autorizacao_plano, cancelamento_guia_recebido ou comunicacao_internacao_recebida) com a trilha_auditoria na mesma transação',
  )
  async receber(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTrocaRecebida> {
    const e = corpo(esquemaMensagem, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_CONTAS);
    // 1. O arquivo: tamanho, versão, XSD oficial e hash do epílogo.
    const bytes = new Uint8Array(Buffer.from(e.arquivo.replace(/\s+/g, ''), 'base64'));
    if (bytes.length === 0 || bytes.length > MAXIMO_BYTES) throw recusa(['mensagem-sem-cabecalho']);
    const xml = iso88591(bytes);
    if (/<(?:[A-Za-z0-9_]+:)?Padrao>([^<]*)</.exec(xml)?.[1] !== PADRAO_TISS)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Mensagem recusada',
        `Só a versão ${PADRAO_TISS} da TISS é aceita.`,
        {
          codigo: 'versao-recusada',
          campos: ['arquivo'],
        },
      );
    const v = await validarNoXsd(bytes, await esquemas());
    if (!v.valido)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Mensagem recusada',
        'A mensagem não passou no XSD da TISS.',
        {
          codigo: 'xsd-invalido',
          campos: ['arquivo'],
          avisos: v.erros.slice(0, 10).map(explicarErroXsd),
        },
      );
    const hash = conferirHashEpilogo(xml);
    if (!hash.confere)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Mensagem recusada',
        'O hash do epílogo não confere.',
        {
          codigo: 'hash-nao-confere',
          campos: ['arquivo'],
        },
      );
    // 2. O cabeçalho: operadora, prestador e sequencial.
    let cab;
    try {
      cab = lerCabecalhoTroca(xml);
    } catch (x) {
      if (x instanceof ErroTrocaTiss) throw recusa([x.codigo]);
      throw x;
    }
    const apoio = await this.porta
      .apoioRecebimento(s.porta, cab.prestador, cab.sequencial)
      .catch((x: unknown) => {
        throw problemaDoCadastro(x);
      });
    const problemas = problemasDaTroca(cab, {
      registroAnsOperadora: apoio.operadora?.registroAns ?? null,
      prestadorEncontrado: apoio.prestador !== null,
      sequencialRepetido: apoio.sequencialRepetido,
    });
    if (problemas.length || !apoio.operadora || !apoio.prestador)
      throw recusa(problemas.map((p) => p.codigo));
    const troca: TrocaRecebida = {
      cabecalho: cab,
      canal: e.canal,
      hash: hash.informado,
      operadora: apoio.operadora.id,
      prestador: apoio.prestador,
    };
    // O pedido de autorização: a permissão própria antes de qualquer gravação; depois, a reserva do sequencial.
    const pedido = cab.transacao === 'SOLICITACAO_PROCEDIMENTOS';
    if (pedido) await this.exigirPedido(s, req);
    const reserva: { id: number | null; pedidoGravado: boolean } = { id: null, pedidoGravado: false };
    if (pedido) reserva.id = await this.reservar(s, troca);
    const rejeitar = async (motivos: readonly string[]): Promise<ResultadoTrocaRecebida> => {
      const resultado = { situacao: 'rejeitada', protocolo: null, erro: motivos.join(' ') } as const;
      const trilha = this.linha(
        s,
        E.operadoraContaRecebida.codigo,
        'operadora.troca-tiss.registrar',
        'troca_tiss_operadora',
      );
      const r = await (
        reserva.id !== null
          ? this.porta.concluirRecebida(s.porta, reserva.id, resultado, trilha)
          : this.porta.registrarRecebida(s.porta, troca, resultado, trilha)
      ).catch((x: unknown) => {
        throw problemaDoCadastro(x);
      });
      return { troca: r.id, tipo: cab.tipo, situacao: 'rejeitada', protocolo: null, motivos };
    };
    try {
      // 3. O corpo, pelo tipo de transação.
      if (cab.transacao === 'CANCELA_GUIA') {
        const r = await this.porta.receberCancelamento(
          s.porta,
          troca,
          lerCancelamentoGuia(xml),
          this.linha(
            s,
            E.operadoraAutorizacaoCancelada.codigo,
            'operadora.troca-tiss.cancelamento.receber',
            'cancelamento_guia_recebido',
          ),
        );
        return {
          troca: r.troca,
          tipo: cab.tipo,
          situacao: 'processada',
          protocolo: r.protocolo,
          motivos: [],
          guias: r.guias,
        };
      }
      if (cab.transacao === 'COMUNICACAO_BENEFICIARIO') {
        const c = lerComunicacaoBeneficiario(xml);
        const p = problemasDaComunicacao(c, apoio.hoje);
        if (p.length) return rejeitar(texto(p.map((x) => x.codigo)));
        const r = await this.porta.receberComunicacao(
          s.porta,
          troca,
          c,
          this.linha(
            s,
            E.operadoraContaRecebida.codigo,
            'operadora.troca-tiss.comunicacao.receber',
            'comunicacao_internacao_recebida',
          ),
        );
        return {
          troca: r.troca,
          tipo: cab.tipo,
          situacao: 'processada',
          protocolo: null,
          motivos: [],
          comunicacao: { situacao: r.situacao, beneficiarioIdentificado: r.beneficiarioIdentificado },
        };
      }
      return await this.solicitacao(s, xml, troca, apoio, reserva as { id: number; pedidoGravado: boolean });
    } catch (x) {
      // Com o pedido já gravado, a falha ao concluir não vira rejeição: a reserva segura o sequencial (sem pedido em dobro).
      if (reserva.pedidoGravado) throw problemaDoCadastro(x);
      if (x instanceof ErroTrocaTiss) return rejeitar(texto([x.codigo]));
      // A recusa das regras do pedido (dados ou negócio) não perde a mensagem: fica rejeitada com o motivo.
      if (x instanceof ErroProblema && [400, 409].includes(x.getStatus()))
        return rejeitar([x.detalhe ?? x.titulo, ...(x.extras.campos ?? []).map((c) => `Campo: ${c}.`)]);
      throw problemaDoCadastro(x);
    }
  }

  /** O pedido de autorização exige a permissão própria e a fatia da autorização ligada. */
  private async exigirPedido(s: SessaoCadastro, req: RequisicaoAutorizada): Promise<void> {
    if (!s.pode(PERM_AUTORIZAR))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'Registrar pedido de autorização exige a permissão própria.',
      );
    await this.exigir(req, CHAVE_OPERADORA_AUTORIZACAO);
  }

  /** A reserva do sequencial (troca 'em_processamento'); o envio simultâneo do mesmo sequencial é recusado. */
  private async reservar(s: SessaoCadastro, troca: TrocaRecebida): Promise<number> {
    try {
      const r = await this.porta.registrarRecebida(
        s.porta,
        troca,
        { situacao: 'em_processamento', protocolo: null, erro: null },
        this.linha(
          s,
          E.operadoraContaRecebida.codigo,
          'operadora.troca-tiss.registrar',
          'troca_tiss_operadora',
        ),
      );
      return r.id;
    } catch (x) {
      const repetido = await this.porta
        .apoioRecebimento(s.porta, troca.cabecalho.prestador, troca.cabecalho.sequencial)
        .then(
          (a) => a.sequencialRepetido,
          () => false,
        );
      if (repetido) throw recusa(['transacao-repetida']);
      throw problemaDoCadastro(x);
    }
  }

  /**
   * O pedido de autorização: a guia TISS vira o pedido da operadora, com as regras do portal e da central; a reserva do
   * sequencial é concluída com o protocolo depois do pedido gravado.
   */
  private async solicitacao(
    s: SessaoCadastro,
    xml: string,
    troca: TrocaRecebida,
    apoio: ApoioRecebimentoTroca,
    reserva: { readonly id: number; pedidoGravado: boolean },
  ): Promise<ResultadoTrocaRecebida> {
    const lida = lerSolicitacaoProcedimento(xml);
    const p = problemasDaSolicitacao(lida);
    if (p.length) throw new ErroTrocaTiss(p[0]!.codigo);
    const tipoGuia = apoio.tipoGuia[lida.tipo];
    if (!tipoGuia) throw new ErroTrocaTiss('tipo-guia-ausente');
    if (!apoio.origemTroca) throw new ErroTrocaTiss('origem-troca-ausente');
    const x = await this.autorizacao.conferirRegistro(
      s.porta,
      corpo(
        esquemaRegistrarAutorizacao,
        pedidoDaSolicitacao(lida, { prestador: troca.prestador!, tipoGuia, origem: apoio.origemTroca }),
      ),
    );
    let protocolo = '';
    await this.autorizacoes.gravar(
      contextoGravacao(s, 'operadora.registrarAutorizacao'),
      this.linha(
        s,
        E.operadoraAutorizacaoRegistrada.codigo,
        'operadora.registrarAutorizacao',
        'pedido_autorizacao_plano',
      ),
      async (g) => {
        protocolo = protocoloAtendimento(x.registroAns, x.registro.solicitadaEm, await g.proximoProtocolo());
        return g.registrar({ ...x.registro, protocolo, usuario: s.login });
      },
    );
    reserva.pedidoGravado = true;
    const r = await this.porta.concluirRecebida(
      s.porta,
      reserva.id,
      { situacao: 'processada', protocolo: protocolo.slice(0, 100), erro: null },
      this.linha(
        s,
        E.operadoraAutorizacaoRegistrada.codigo,
        'operadora.troca-tiss.concluir',
        'troca_tiss_operadora',
      ),
    );
    return { troca: r.id, tipo: troca.cabecalho.tipo, situacao: 'processada', protocolo, motivos: [] };
  }
}
