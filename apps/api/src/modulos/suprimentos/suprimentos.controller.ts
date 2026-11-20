// Estoque, almoxarifado e compras (M28; ficha, seções 4, 5 e 7). Telas de trabalho sobre os mesmos documentos e saldos
// do outro sistema; o número do documento, o valor da saída, o saldo, o lote e o custo são do banco (gatilhos):
//   GET  /api/suprimentos/gravacao                      as funcionalidades e as ações (permissão + liberação)
//   GET  /api/suprimentos/apoio                         locais, centros de custo, competência e o escopo da sessão
//   GET  /api/suprimentos/itens?termo                   busca de itens
//   GET  /api/suprimentos/saldos?item&local&termo        saldos por item, local e lote, com o alerta de validade
//   GET  /api/suprimentos/saldos/:item/posicao          posição mensal e por local
//   GET  /api/suprimentos/lotes?item&local               lotes do local (a sugestão do que vence primeiro)
//   GET  /api/suprimentos/lotes/rastreio?item&lote        rastreio do lote (leitura auditada)
//   GET  /api/suprimentos/lotes/paciente/:atendimento     os lotes que saíram ao paciente (leitura auditada)
//   POST /api/suprimentos/lotes/:id/validade              saneamento da validade
//   GET  /api/suprimentos/documentos/:tipo?local&inicio&fim; GET documentos/:tipo/:ano/:mes/:doc (auditado)
//   POST /api/suprimentos/saidas | requisicoes | requisicoes/:ano/:mes/:doc/autorizar | requisicoes/atender | devolucoes | movimento-direto | notas
//   GET/POST /api/suprimentos/transferencias/envios; POST envios/:id/receber | envios/:id/cancelar; POST transferencias
//   GET/POST /api/suprimentos/pedidos; GET pedidos/:ano/:doc; POST pedidos/:ano/:doc/propostas/:id | vencedor | aprovacao
//   GET  /api/suprimentos/aprovacoes; GET historico-compras/:item; GET consumo; GET fechamentos; POST fechamentos(/reabrir)
//   GET  /api/suprimentos/recalculos | parametros | usuarios-estoque(/:login) | kits(/:id) | inventarios(/:id)
//   POST /api/suprimentos/kits/:id/conferencia | kits/:id/reposicao | inventarios | inventarios/:id/contagens|decisao|balanco
//   GET  /api/suprimentos/sugestao-compra?local; POST sugestao-compra/pedido; POST pontos-pedido
//   POST /api/suprimentos/documentos/desconsolidar; POST /api/suprimentos/notas/xml (pré-preenchimento pela NF-e)
//   GET  /api/suprimentos/onda3/painel?dia&local          M41: efeito no estoque dos documentos do novo (agregado)
//   GET  /api/suprimentos/onda3/conferencia-numerica?dia&local  M41: saldo e preço médio dos itens movidos pelo novo
//   POST /api/suprimentos/onda3/conferencia-numerica      M41: compara o lido na outra estação com o lido aqui
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type ConferenciaNumericaOnda3,
  type PainelOnda3,
  type AprovacaoPendente,
  type ApoioSuprimentos,
  CODIGOS_TIPO_DOCUMENTO,
  type ConsumoEstoque,
  type DocumentoDetalhe,
  type EscopoUsuarioEstoque,
  type FichaItem,
  esquemaAbrirInventario,
  esquemaAprovarPedido,
  esquemaConferirCarrinho,
  esquemaCorrigirValidade,
  esquemaCriarPedido,
  esquemaDecidirInventario,
  esquemaDefinirVencedor,
  esquemaDesconsolidar,
  esquemaEnviarTransferencia,
  esquemaFecharMes,
  esquemaMotivoSuprimentos,
  esquemaMovimentoDireto,
  esquemaPontoPedidoItem,
  esquemaReabrirMes,
  esquemaReceberTransferencia,
  esquemaRegistrarContagem,
  esquemaRegistrarDevolucao,
  esquemaRegistrarEntradaNF,
  esquemaRegistrarSaida,
  esquemaReporKit,
  esquemaRequisitarMaterial,
  esquemaTransferir,
  esquemaXmlNota,
  EVENTOS_AUDITAVEIS,
  type FechamentosEstoque,
  type GravacaoSuprimentos,
  type HistoricoCompra,
  type InventarioLido,
  type ItemBusca,
  type KitRastreavel,
  type ListaDocumentos,
  type ListaPedidosCompra,
  type ListaRequisicoesEstoque,
  type ListaSaldos,
  type LotesDoPaciente,
  type ParametrosEstoque,
  type PedidoDetalhe,
  type PosicaoMensal,
  type RastreioLote,
  type RecalculosEstoque,
  type ResultadoSuprimentos,
  type SaldoItem,
  type SugestaoCompra,
  type TipoDocumentoEstoque,
  type TransferenciaEnviada,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { csv, exigir, idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  CRITERIO_LIGAR_SETOR,
  type CriterioLigarSetor,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ServicoOnda3 } from './onda3.js';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { ApoiosSuprimentos } from './apoios.js';
import { lerXmlNota, type NotaDoXml } from './nfe-xml.js';
import { type ContextoSuprimentos, PORTA_SUPRIMENTOS, type PortaSuprimentos } from './porta.js';
import { ServicoSuprimentos } from './servico.js';

const ctx = (s: SessaoCadastro): ContextoSuprimentos => s.porta;
const dataOu = (v: string | undefined, padrao: string): string => {
  if (v === undefined || v === '') return padrao;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return v;
};
const localOu = (v: string | undefined): number | undefined => {
  const n = inteiroOuNulo(v);
  return n && n > 0 && n <= 99 ? n : undefined;
};
const tipoDocumento = (v: string): TipoDocumentoEstoque => {
  if (!(CODIGOS_TIPO_DOCUMENTO as readonly string[]).includes(v))
    throw new ErroProblema('nao-encontrado', 404, 'Tipo de documento inválido');
  return v as TipoDocumentoEstoque;
};
/** A permissão de leitura de cada tipo de documento. */
const LEITURA_DO_TIPO: Readonly<Record<TipoDocumentoEstoque, string>> = {
  saida: 'suprimentos.saida.ler',
  devolucao: 'suprimentos.devolucao.ler',
  transferencia: 'suprimentos.transferencia.ler',
  nota: 'suprimentos.nota.ler',
  balanco: 'suprimentos.inventario.ler',
  requisicao: 'suprimentos.requisicao.ler',
};
const comAlerta = async (s: ApoiosSuprimentos, sess: SessaoCadastro) =>
  (await s.apoios.estoque.parametro(sess, 'suprimentos.alertaValidadeDias')) || 60;

const esquemaAtender = z
  .object({
    requisicao: z
      .object({ ano: z.number().int(), mes: z.number().int(), doc: z.number().int().positive() })
      .strict(),
    itens: z
      .array(
        z
          .object({
            seq: z.number().int().positive(),
            item: z.number().int().positive(),
            quantidade: z.number().min(0),
            lotes: z
              .array(
                z
                  .object({ lote: z.string(), validade: z.string(), quantidade: z.number().positive() })
                  .strict(),
              )
              .default([]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const esquemaProposta = z
  .object({ valorUnitario: z.number().min(0).max(999_999_999), marca: z.string().max(25).optional() })
  .strict();
const esquemaVencedor = z
  .object({
    item: z.number().int().positive(),
    seq: z.number().int().min(0),
    vencedoras: z.array(z.number().int().positive()).min(1).max(20),
    justificativa: z.string().max(250).optional(),
  })
  .strict();
const esquemaDecisaoPedido = z
  .object({ decisao: z.enum(['aprovado', 'reprovado']), justificativa: z.string().max(250).default('') })
  .strict();
const esquemaGerarPedido = z
  .object({
    centroCusto: z.number().int().positive(),
    itens: z
      .array(z.object({ item: z.number().int().positive(), quantidade: z.number().positive() }).strict())
      .min(1)
      .max(300),
    fornecedores: z.array(z.number().int().positive()).max(20).default([]),
  })
  .strict();

@Controller('suprimentos')
export class SuprimentosController {
  readonly apoios: ApoiosSuprimentos;
  readonly servico: ServicoSuprimentos;
  readonly onda3: ServicoOnda3;
  constructor(
    @Inject(PORTA_SUPRIMENTOS) private readonly porta: PortaSuprimentos,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfiguracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(CRITERIO_LIGAR_SETOR) criterio: CriterioLigarSetor | null = null,
  ) {
    this.apoios = new ApoiosSuprimentos(porta, trilha, fonteConfiguracao, cache);
    this.servico = new ServicoSuprimentos(porta, this.apoios);
    this.onda3 = new ServicoOnda3(porta, fonteConfiguracao);
    // M41 (regra 1): a tela de chaves e o lote do painel de migração conferem a prescrição em uso por aqui.
    if (criterio) {
      criterio.regraFarmacia = (c, _tipo, chave) => this.onda3.motivoLigar(c, chave);
      criterio.mapaRegra1 = (c) => this.onda3.regra1(c);
    }
  }

  // ── Onda 3 (M41): o efeito dos documentos do novo no estoque e a conferência numérica ────────────────────

  @Get('onda3/painel')
  @Permissao('suprimentos.saldo.ler')
  painelOnda3(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<PainelOnda3> {
    return this.onda3.painel(sessaoDe(req), q);
  }

  @Get('onda3/conferencia-numerica')
  @Permissao('suprimentos.saldo.ler')
  retratoNumerico(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ConferenciaNumericaOnda3> {
    return this.onda3.retratoNumerico(sessaoDe(req), q);
  }

  @Post('onda3/conferencia-numerica')
  @HttpCode(200)
  @Permissao('suprimentos.saldo.ler')
  @AuditadoNoHandler('Não muda estado: compara o retrato informado com a leitura de agora (nada grava)')
  conferirNumerica(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ConferenciaNumericaOnda3> {
    return this.onda3.conferir(sessaoDe(req), b);
  }

  // ── Situação, apoio e buscas ─────────────────────────────────────────────────────────────────────────

  @Get('gravacao')
  @Permissao('suprimentos.saldo.ler')
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoSuprimentos> {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Get('apoio')
  @Permissao('suprimentos.item.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioSuprimentos> {
    return this.servico.apoio(sessaoDe(req));
  }

  @Get('itens')
  @Permissao('suprimentos.item.ler')
  itens(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada): Promise<ItemBusca[]> {
    return this.porta.buscarItens(ctx(sessaoDe(req)), (termo ?? '').slice(0, 60));
  }

  @Get('itens/:item/ficha')
  @Permissao('suprimentos.item.ler')
  async ficha(@Param('item') item: string, @Req() req: RequisicaoAutorizada): Promise<FichaItem> {
    const f = await this.porta.fichaItem(ctx(sessaoDe(req)), idDaRota(item));
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    return f;
  }

  // ── Saldos, lotes e rastreio ─────────────────────────────────────────────────────────────────────────

  @Get('saldos')
  @Permissao('suprimentos.saldo.ler')
  async saldos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaSaldos> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(ctx(s));
    const item = inteiroOuNulo(q['item']);
    const local = localOu(q['local']);
    return this.porta.saldos(ctx(s), {
      ...(item ? { item } : {}),
      ...(local ? { local } : {}),
      ...(q['termo']?.trim() ? { termo: q['termo'].trim().slice(0, 60) } : {}),
      comSaldo: q['todos'] !== 'sim',
      hoje: r.hoje,
      alertaDias: await comAlerta(this.apoios, s),
    });
  }

  @Get('saldos/:item/posicao')
  @Permissao('suprimentos.saldo.ler')
  async posicao(@Param('item') item: string, @Req() req: RequisicaoAutorizada): Promise<PosicaoMensal> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(ctx(s));
    return this.porta.posicaoMensal(ctx(s), idDaRota(item), r.hoje);
  }

  @Get('lotes')
  @Permissao('suprimentos.saldo.ler')
  async lotes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SaldoItem['lotes']> {
    const s = sessaoDe(req);
    const item = inteiroOuNulo(q['item']);
    const local = localOu(q['local']);
    if (!item || !local)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe o item e o local.');
    const r = await this.porta.relogio(ctx(s));
    return this.porta.lotesDoLocal(ctx(s), item, local, r.hoje, await comAlerta(this.apoios, s));
  }

  @Get('lotes/rastreio')
  @Permissao('suprimentos.lote.rastrear')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosLoteRastreado.codigo)
  async rastreio(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RastreioLote> {
    const item = inteiroOuNulo(q['item']);
    const lote = (q['lote'] ?? '').trim().slice(0, 30);
    if (!item || !lote)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe o item e o lote.');
    req.sghAlvo = { tabelaAlvo: 'GEVALMEM', idAlvo: `${item}/${lote}` };
    return this.porta.rastreio(ctx(sessaoDe(req)), item, lote);
  }

  @Get('lotes/paciente/:atendimento')
  @Permissao('suprimentos.lote.rastrear')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosLoteRastreado.codigo)
  lotesDoPaciente(
    @Param('atendimento') a: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<LotesDoPaciente> {
    const atendimento = idDaRota(a);
    req.sghAlvo = { tabelaAlvo: 'GECADSAI', idAlvo: `atendimento ${atendimento}` };
    return this.porta.lotesDoPaciente(ctx(sessaoDe(req)), atendimento);
  }

  @Post('lotes/:id/validade')
  @HttpCode(200)
  @Permissao('suprimentos.lote.corrigir')
  @AuditadoNoHandler('suprimentos.corrigirValidadeLote pelo executor (trilha na mesma transação)')
  corrigirValidade(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    const e = corpo(esquemaCorrigirValidade, { ...((b ?? {}) as object), lote: idDaRota(id) });
    return this.servico.executar(sessaoDe(req), 'suprimentos.corrigirValidadeLote', e);
  }

  // ── Documentos ───────────────────────────────────────────────────────────────────────────────────────

  @Get('documentos/:tipo')
  @Permissao('suprimentos.saldo.ler')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosDocumentosLidos.codigo)
  async documentos(
    @Param('tipo') t: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaDocumentos> {
    const s = sessaoDe(req);
    const tipo = tipoDocumento(t);
    await exigir(s, LEITURA_DO_TIPO[tipo], this.trilha);
    const r = await this.porta.relogio(ctx(s));
    const fim = dataOu(q['fim'], r.hoje);
    const inicio = dataOu(q['inicio'], `${fim.slice(0, 8)}01`);
    const local = localOu(q['local']);
    if (inicio > fim)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O início é depois do fim.');
    const pagina = paginaOu(q['pagina']);
    req.sghAlvo = { tabelaAlvo: 'GECADSAI', idAlvo: `${tipo} ${inicio}..${fim} p${pagina}` };
    const l = await this.porta.documentos(ctx(s), { tipo, ...(local ? { local } : {}), inicio, fim, pagina });
    return { ...l, pagina };
  }

  @Get('documentos/:tipo/:ano/:mes/:doc')
  @Permissao('suprimentos.saldo.ler')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosDocumentosLidos.codigo)
  async documento(
    @Param('tipo') t: string,
    @Param('ano') ano: string,
    @Param('mes') mes: string,
    @Param('doc') doc: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DocumentoDetalhe> {
    const s = sessaoDe(req);
    const tipo = tipoDocumento(t);
    await exigir(s, LEITURA_DO_TIPO[tipo], this.trilha);
    const d = await this.porta.documento(ctx(s), tipo, {
      ano: idDaRota(ano),
      mes: idDaRota(mes),
      doc: idDaRota(doc),
    });
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Documento não encontrado');
    req.sghAlvo = {
      tabelaAlvo: 'GECADSAI',
      idAlvo: String(d.id),
      ...(d.paciente ? { paciente: d.paciente.atendimento } : {}),
    };
    return d;
  }

  @Post('documentos/desconsolidar')
  @HttpCode(200)
  @Permissao('suprimentos.documento.desconsolidar')
  @AuditadoNoHandler(
    'suprimentos.desconsolidarDocumento pelo executor (trilha e ocorrência na mesma transação)',
  )
  desconsolidar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    return this.servico.executar(
      sessaoDe(req),
      'suprimentos.desconsolidarDocumento',
      corpo(esquemaDesconsolidar, b),
    );
  }

  // ── Saída, requisição, devolução, movimento direto ───────────────────────────────────────────────────

  @Post('saidas')
  @HttpCode(200)
  @Permissao('suprimentos.saida.registrar')
  @AuditadoNoHandler('suprimentos.registrarSaida pelo executor (trilha na mesma transação)')
  saida(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    const e = corpo(esquemaRegistrarSaida, b);
    if (e.requisicao)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Use o atendimento',
        'O atendimento da requisição é feito pela fila de requisições.',
      );
    // M46 (etapa 3): o consumo de OPME (com o rastreio) é registrado só pela tela do consumo em sala.
    if (e.opme)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Use o consumo em sala',
        'O OPME é registrado pela tela do consumo em sala, com o rastreio por lote ou série.',
      );
    // M46 (etapa 4; revisão D-SAIDA-MANIP-464): a baixa do insumo da manipulação vai só pela tela da manipulação (a
    // permissão dela e a chave do recurso), nunca pela saída genérica.
    if (e.manipulacao)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Use a manipulação',
        'A baixa do insumo é registrada pela tela de Manipulação.',
      );
    return this.servico.executar(
      sessaoDe(req),
      'suprimentos.registrarSaida',
      e,
      this.servico.avisosDaSaida(e.centroCusto),
    );
  }

  @Get('requisicoes')
  @Permissao('suprimentos.requisicao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosDocumentosLidos.codigo)
  async requisicoes(
    @Query('local') l: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaRequisicoesEstoque> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(ctx(s));
    const local = localOu(l);
    req.sghAlvo = { tabelaAlvo: 'GECADSAI', idAlvo: `requisicoes ${local ?? 'todos'}` };
    return this.porta.requisicoes(ctx(s), { ...(local ? { local } : {}), hoje: r.hoje });
  }

  @Post('requisicoes')
  @HttpCode(200)
  @Permissao('suprimentos.requisicao.criar')
  @AuditadoNoHandler('suprimentos.requisitarMaterial pelo executor (trilha na mesma transação)')
  requisitar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    return this.servico.executar(
      sessaoDe(req),
      'suprimentos.requisitarMaterial',
      corpo(esquemaRequisitarMaterial, b),
    );
  }

  @Post('requisicoes/:ano/:mes/:doc/autorizar')
  @HttpCode(200)
  @Permissao('suprimentos.requisicao.autorizar')
  @AuditadoNoHandler('a autorização da requisição (SGH_) com a SGH_TRILHA na mesma transação')
  autorizar(
    @Param('ano') ano: string,
    @Param('mes') mes: string,
    @Param('doc') doc: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    return this.servico.autorizarRequisicao(sessaoDe(req), {
      ano: idDaRota(ano),
      mes: idDaRota(mes),
      doc: idDaRota(doc),
    });
  }

  @Post('requisicoes/atender')
  @HttpCode(200)
  @Permissao('suprimentos.requisicao.atender')
  @AuditadoNoHandler(
    'suprimentos.registrarSaida (atendimento da requisição) pelo executor (trilha na mesma transação)',
  )
  async atender(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAtender, b);
    const r = await this.porta.relogio(ctx(s));
    const fila = await this.porta.requisicoes(ctx(s), { hoje: r.hoje });
    const x = fila.itens.find(
      (y) =>
        y.chave.ano === e.requisicao.ano &&
        y.chave.mes === e.requisicao.mes &&
        y.chave.doc === e.requisicao.doc,
    );
    if (!x)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Requisição fechada',
        'A requisição já foi atendida ou não existe mais.',
        {
          codigo: 'requisicao-atendida',
        },
      );
    const cc = (await this.porta.centrosCusto(ctx(s))).find((c) => c.codigo === x.centroCusto);
    return this.servico.executar(s, 'suprimentos.registrarSaida', {
      destino: x.destino === 1 || x.destino === 3 ? x.destino : 2,
      origem: 'E',
      local: x.local,
      centroCusto: x.centroCusto,
      localConsumo: cc?.localConsumo ?? 1,
      ...(x.paciente ? { atendimento: x.paciente.atendimento } : {}),
      requisicao: e.requisicao,
      itens: e.itens
        .filter((i) => i.quantidade > 0)
        .map((i) => ({ item: i.item, quantidade: i.quantidade, seq: i.seq, lotes: i.lotes })),
    });
  }

  @Post('devolucoes')
  @HttpCode(200)
  @Permissao('suprimentos.devolucao.registrar')
  @AuditadoNoHandler('suprimentos.registrarDevolucao pelo executor (trilha na mesma transação)')
  devolucao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    const e = corpo(esquemaRegistrarDevolucao, b);
    // M46 (etapa 3): a devolução do OPME não usado é registrada só pela tela do consumo em sala.
    if (e.opme)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Use o consumo em sala',
        'A devolução do OPME não usado é registrada pela tela do consumo em sala.',
      );
    return this.servico.executar(sessaoDe(req), 'suprimentos.registrarDevolucao', e);
  }

  @Post('movimento-direto')
  @HttpCode(200)
  @Permissao('suprimentos.saida.registrar')
  @AuditadoNoHandler('suprimentos.registrarMovimentoDireto pelo executor (trilha na mesma transação)')
  movimentoDireto(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    return this.servico.executar(
      sessaoDe(req),
      'suprimentos.registrarMovimentoDireto',
      corpo(esquemaMovimentoDireto, b),
    );
  }

  // ── Transferência em dois passos ─────────────────────────────────────────────────────────────────────

  @Get('transferencias/envios')
  @Permissao('suprimentos.transferencia.ler')
  envios(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<TransferenciaEnviada[]> {
    const local = localOu(q['local']);
    const etapa = ['enviada', 'recebida', 'divergente', 'cancelada'].includes(q['etapa'] ?? '')
      ? q['etapa']
      : undefined;
    return this.porta.transferencias(ctx(sessaoDe(req)), {
      ...(local ? { local } : {}),
      ...(etapa ? { etapa } : {}),
    });
  }

  @Post('transferencias/envios')
  @HttpCode(200)
  @Permissao('suprimentos.transferencia.enviar')
  @AuditadoNoHandler('o envio da transferência (SGH_) com a SGH_TRILHA na mesma transação')
  enviar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    return this.servico.enviarTransferencia(sessaoDe(req), corpo(esquemaEnviarTransferencia, b));
  }

  @Post('transferencias/envios/:id/receber')
  @HttpCode(200)
  @Permissao('suprimentos.transferencia.receber')
  @AuditadoNoHandler('suprimentos.transferir pelo executor e a divergência (SGH_) com a SGH_TRILHA')
  receber(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    return this.servico.receberTransferencia(
      sessaoDe(req),
      idDaRota(id),
      corpo(esquemaReceberTransferencia, b),
    );
  }

  @Post('transferencias/envios/:id/cancelar')
  @HttpCode(200)
  @Permissao('suprimentos.transferencia.enviar')
  @AuditadoNoHandler('o cancelamento do envio (SGH_) com a SGH_TRILHA na mesma transação')
  cancelarEnvio(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    const m = corpo(z.object({ motivo: esquemaMotivoSuprimentos }).strict(), b);
    return this.servico.cancelarEnvio(sessaoDe(req), idDaRota(id), m.motivo);
  }

  @Post('transferencias')
  @HttpCode(200)
  @Permissao('suprimentos.transferencia.receber')
  @AuditadoNoHandler('suprimentos.transferir (passo único) pelo executor (trilha na mesma transação)')
  transferir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    const e = corpo(esquemaTransferir, b);
    // O fechamento de um envio (dois passos) só pelo recebimento, que confere o motivo da divergência.
    if (e.envio !== undefined && e.envio !== null)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Para receber um envio, use o recebimento do envio na fila de transferências.',
      );
    return this.servico.executar(sessaoDe(req), 'suprimentos.transferir', e);
  }

  // ── Nota fiscal ──────────────────────────────────────────────────────────────────────────────────────

  @Post('notas')
  @HttpCode(200)
  @Permissao('suprimentos.nota.registrar')
  @AuditadoNoHandler('suprimentos.registrarEntradaNF pelo executor (trilha e conferência na mesma transação)')
  nota(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    const e = corpo(esquemaRegistrarEntradaNF.omit({ tolerancias: true }), b);
    return this.servico.registrarNota(sessaoDe(req), e);
  }

  @Post('notas/xml')
  @HttpCode(200)
  @Permissao('suprimentos.nota.registrar')
  @AuditadoNoHandler('só leitura do arquivo enviado (pré-preenchimento): nada é gravado')
  xml(@Body() b: unknown): NotaDoXml {
    return lerXmlNota(corpo(esquemaXmlNota, b).xml);
  }

  // ── Compras ──────────────────────────────────────────────────────────────────────────────────────────

  @Get('pedidos')
  @Permissao('suprimentos.pedido.ler')
  async pedidos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaPedidosCompra> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(ctx(s));
    const ano = inteiroOuNulo(q['ano']) ?? r.ano;
    const situacao = inteiroOuNulo(q['situacao']);
    return this.porta.pedidos(ctx(s), { ano, ...(situacao ? { situacao } : {}) });
  }

  @Get('pedidos/:ano/:doc')
  @Permissao('suprimentos.pedido.ler')
  async pedido(
    @Param('ano') ano: string,
    @Param('doc') doc: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PedidoDetalhe> {
    const p = await this.porta.pedido(ctx(sessaoDe(req)), idDaRota(ano), idDaRota(doc));
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
    return p;
  }

  @Post('pedidos')
  @HttpCode(200)
  @Permissao('suprimentos.pedido.criar')
  @AuditadoNoHandler('suprimentos.criarPedido pelo executor (trilha na mesma transação)')
  criarPedido(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    return this.servico.criarPedido(sessaoDe(req), corpo(esquemaCriarPedido, b));
  }

  @Post('pedidos/:ano/:doc/propostas/:id')
  @HttpCode(200)
  @Permissao('suprimentos.cotacao.escolher')
  @AuditadoNoHandler('suprimentos.registrarProposta pelo executor (trilha na mesma transação)')
  proposta(
    @Param('ano') ano: string,
    @Param('doc') doc: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    const p = corpo(esquemaProposta, b);
    return this.servico.executar(sessaoDe(req), 'suprimentos.registrarProposta', {
      pedido: { ano: idDaRota(ano), doc: idDaRota(doc) },
      proposta: idDaRota(id),
      valorUnitario: p.valorUnitario,
      ...(p.marca ? { marca: p.marca } : {}),
    });
  }

  @Post('pedidos/:ano/:doc/vencedor')
  @HttpCode(200)
  @Permissao('suprimentos.cotacao.escolher')
  @AuditadoNoHandler(
    'suprimentos.definirVencedorCotacao pelo executor (trilha e a escolha SGH_ na mesma transação)',
  )
  vencedor(
    @Param('ano') ano: string,
    @Param('doc') doc: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    const v = corpo(esquemaVencedor, b);
    const e = corpo(esquemaDefinirVencedor, { pedido: { ano: idDaRota(ano), doc: idDaRota(doc) }, ...v });
    return this.servico.definirVencedor(sessaoDe(req), e);
  }

  @Get('aprovacoes')
  @Permissao('suprimentos.pedido.ler')
  aprovacoes(@Req() req: RequisicaoAutorizada): Promise<AprovacaoPendente[]> {
    return this.servico.aprovacoes(sessaoDe(req));
  }

  @Post('pedidos/:ano/:doc/aprovacao')
  @HttpCode(200)
  @Permissao('suprimentos.pedido.aprovar')
  @AuditadoNoHandler('a aprovação por alçada (SGH_) com a SGH_TRILHA na mesma transação')
  aprovar(
    @Param('ano') ano: string,
    @Param('doc') doc: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    const d = corpo(esquemaDecisaoPedido, b);
    const e = corpo(esquemaAprovarPedido, { pedido: { ano: idDaRota(ano), doc: idDaRota(doc) }, ...d });
    return this.servico.aprovarPedido(sessaoDe(req), e);
  }

  @Get('historico-compras/:item')
  @Permissao('suprimentos.compra.ler')
  historico(@Param('item') item: string, @Req() req: RequisicaoAutorizada): Promise<HistoricoCompra> {
    return this.porta.historicoCompras(ctx(sessaoDe(req)), idDaRota(item));
  }

  @Get('historico-compras/:item/csv')
  @Permissao('suprimentos.compra.exportar')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosDocumentosLidos.codigo)
  async historicoCsv(
    @Param('item') item: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { setHeader(k: string, v: string): void },
  ): Promise<string> {
    const h = await this.porta.historicoCompras(ctx(sessaoDe(req)), idDaRota(item));
    req.sghAlvo = { tabelaAlvo: 'GECOMPRA', idAlvo: `item ${h.item} (csv)` };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="historico-compras-${h.item}.csv"`);
    const linhas = h.compras.map((c) =>
      [c.data, c.fornecedorNome, c.nota, c.quantidade, c.unitario, c.custo, c.marca].map(csv).join(';'),
    );
    return ['data;fornecedor;nota;quantidade;unitario;custo;marca', ...linhas].join('\r\n');
  }

  // ── Ponto de pedido e sugestão de compra ─────────────────────────────────────────────────────────────

  @Get('sugestao-compra')
  @Permissao('suprimentos.sugestao.ler')
  sugestao(@Query('local') l: string | undefined, @Req() req: RequisicaoAutorizada): Promise<SugestaoCompra> {
    return this.servico.sugestao(sessaoDe(req), localOu(l));
  }

  @Post('sugestao-compra/pedido')
  @HttpCode(200)
  @Permissao('suprimentos.sugestao.gerarPedido')
  @AuditadoNoHandler('suprimentos.criarPedido pelo executor (trilha na mesma transação)')
  async gerarPedido(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    const s = sessaoDe(req);
    await exigir(s, 'suprimentos.pedido.criar', this.trilha);
    const e = corpo(esquemaGerarPedido, b);
    return this.servico.criarPedido(s, corpo(esquemaCriarPedido, { ...e, tipoCompra: 'P' }));
  }

  @Post('pontos-pedido')
  @HttpCode(200)
  @Permissao('suprimentos.sugestao.gerarPedido')
  @AuditadoNoHandler('o prazo e o estoque de segurança (SGH_) com a SGH_TRILHA na mesma transação')
  async pontoPedido(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPontoPedidoItem, b);
    await this.apoios.apoios.compras.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosPontoPedidoDefinido.codigo,
      'suprimentos.compras',
      { tabela: 'SGH_SUP_PONTO_PEDIDO', id: `${p.item}/${p.local}` },
      (g) =>
        g.definirPontoPedido({
          item: p.item,
          local: p.local,
          prazoDias: p.prazoDias,
          estoqueSeguranca: p.estoqueSeguranca ?? null,
          usuario: s.login,
        }),
    );
    return {
      mensagem: 'Prazo e estoque de segurança gravados.',
      repetida: false,
      ids: { item: p.item, local: p.local },
      avisos: [],
    };
  }

  // ── Consumo, fechamento, recálculos, parâmetros, usuários ────────────────────────────────────────────

  @Get('consumo')
  @Permissao('suprimentos.consumo.ler')
  async consumo(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ConsumoEstoque> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(ctx(s));
    const ano = inteiroOuNulo(q['ano']) ?? r.ano;
    const mes = inteiroOuNulo(q['mes']) ?? r.mes;
    if (mes < 1 || mes > 12) throw new ErroProblema('entrada-invalida', 400, 'Mês inválido');
    return {
      ...(await this.porta.consumo(ctx(s), { ano, mes })),
      fonte: this.porta.destino === 'memoria' ? 'banco' : 'banco',
    };
  }

  @Get('consumo/csv')
  @Permissao('suprimentos.consumo.exportar')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosDocumentosLidos.codigo)
  async consumoCsv(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { setHeader(k: string, v: string): void },
  ): Promise<string> {
    const c = await this.consumo(q, req);
    req.sghAlvo = { tabelaAlvo: 'GEKONCDC', idAlvo: `${c.competencia.mes}/${c.competencia.ano} (csv)` };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="consumo-${c.competencia.ano}-${c.competencia.mes}.csv"`,
    );
    return [
      'centro_custo;nome;quantidade;valor;tecnico',
      ...c.porCentroCusto.map((x) =>
        [x.centroCusto, x.nome, x.quantidade, x.valor, x.tecnico ? 'sim' : 'não'].map(csv).join(';'),
      ),
    ].join('\r\n');
  }

  @Get('fechamentos')
  @Permissao('suprimentos.fechamento.ler')
  async fechamentos(@Req() req: RequisicaoAutorizada): Promise<FechamentosEstoque> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(ctx(s));
    return this.porta.fechamentos(ctx(s), { ano: r.ano, mes: r.mes });
  }

  @Post('fechamentos')
  @HttpCode(200)
  @Permissao('suprimentos.fechamento.fechar')
  @AuditadoNoHandler('suprimentos.fecharMes pelo executor (trilha e ocorrência na mesma transação)')
  fechar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    return this.servico.executar(sessaoDe(req), 'suprimentos.fecharMes', corpo(esquemaFecharMes, b));
  }

  @Post('fechamentos/reabrir')
  @HttpCode(200)
  @Permissao('suprimentos.fechamento.reabrir')
  @AuditadoNoHandler('suprimentos.reabrirMes pelo executor (trilha e ocorrência na mesma transação)')
  reabrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    return this.servico.executar(sessaoDe(req), 'suprimentos.reabrirMes', corpo(esquemaReabrirMes, b));
  }

  @Get('recalculos')
  @Permissao('suprimentos.recalculo.ler')
  recalculos(@Req() req: RequisicaoAutorizada): Promise<RecalculosEstoque> {
    return this.porta.recalculos(ctx(sessaoDe(req)));
  }

  @Get('parametros')
  @Permissao('config.parametro.ler')
  parametros(@Req() req: RequisicaoAutorizada): Promise<ParametrosEstoque> {
    const s = sessaoDe(req);
    return this.porta.parametros(ctx(s), s.login);
  }

  @Get('fornecedores')
  @Permissao('suprimentos.fornecedor.ler')
  fornecedores(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.fornecedores(ctx(sessaoDe(req)), (termo ?? '').slice(0, 60));
  }

  @Get('terceiros')
  @Permissao('suprimentos.fornecedor.ler')
  terceiros(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.terceiros(ctx(sessaoDe(req)), (termo ?? '').slice(0, 60));
  }

  @Get('prestadores')
  @Permissao('suprimentos.fornecedor.ler')
  prestadores(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.prestadores(ctx(sessaoDe(req)), (termo ?? '').slice(0, 60));
  }

  @Get('usuarios-estoque')
  @Permissao('acesso.escopo.ler')
  usuarios(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.usuarios(ctx(sessaoDe(req)), (termo ?? '').slice(0, 31));
  }

  @Get('usuarios-estoque/:login')
  @Permissao('acesso.escopo.ler')
  async usuario(
    @Param('login') login: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EscopoUsuarioEstoque> {
    const e = await this.porta.escopo(ctx(sessaoDe(req)), login.slice(0, 31));
    if (!e) throw new ErroProblema('nao-encontrado', 404, 'Usuário do estoque não encontrado');
    return e;
  }

  // ── Kits e carrinhos ─────────────────────────────────────────────────────────────────────────────────

  @Get('kits')
  @Permissao('suprimentos.kit.ler')
  async kits(@Req() req: RequisicaoAutorizada): Promise<KitRastreavel[]> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(ctx(s));
    return this.porta.kits(ctx(s), r.hoje, await comAlerta(this.apoios, s));
  }

  @Get('kits-padrao')
  @Permissao('suprimentos.kit.ler')
  kitsPadrao(@Req() req: RequisicaoAutorizada) {
    return this.porta.kitsPadrao(ctx(sessaoDe(req)));
  }

  @Get('kits/:id')
  @Permissao('suprimentos.kit.ler')
  async kit(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<KitRastreavel> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(ctx(s));
    const k = await this.porta.kit(ctx(s), idDaRota(id), r.hoje, await comAlerta(this.apoios, s));
    if (!k) throw new ErroProblema('nao-encontrado', 404, 'Carrinho não encontrado');
    return k;
  }

  @Post('kits/:id/conferencia')
  @HttpCode(200)
  @Permissao('suprimentos.kit.repor')
  @AuditadoNoHandler('a conferência do carrinho (SGH_) com a SGH_TRILHA na mesma transação')
  async conferirCarrinho(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    const s = sessaoDe(req);
    const e = corpo(esquemaConferirCarrinho, { ...((b ?? {}) as object), kitRastreavel: idDaRota(id) });
    const r = await this.apoios.apoios.kits.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosKitReposto.codigo,
      'suprimentos.kits',
      (x: number) => ({ tabela: 'SGH_SUP_CARRINHO_CONFERENCIA', id: String(x) }),
      (g) =>
        g.conferirCarrinho({
          kit: e.kitRastreavel,
          lacre: e.lacre,
          conferidos: e.itensConferidos,
          pendencias: e.pendencias ?? null,
          usuario: s.login,
        }),
    );
    return {
      mensagem: `Carrinho conferido com o lacre ${e.lacre}.`,
      repetida: false,
      ids: { conferencia: r },
      avisos: [],
    };
  }

  @Post('kits/:id/reposicao')
  @HttpCode(200)
  @Permissao('suprimentos.kit.repor')
  @AuditadoNoHandler('suprimentos.reporKitRastreavel pelo executor (trilha na mesma transação)')
  reporKit(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    const e = corpo(esquemaReporKit, { ...((b ?? {}) as object), kit: idDaRota(id) });
    return this.servico.executar(sessaoDe(req), 'suprimentos.reporKitRastreavel', e);
  }

  // ── Inventário ───────────────────────────────────────────────────────────────────────────────────────

  @Get('inventarios')
  @Permissao('suprimentos.inventario.ler')
  inventarios(@Req() req: RequisicaoAutorizada) {
    return this.porta.inventarios(ctx(sessaoDe(req)));
  }

  @Get('estoque-inicial')
  @Permissao('suprimentos.inventario.ler')
  estoqueInicial(@Req() req: RequisicaoAutorizada) {
    return this.porta.estoqueInicial(ctx(sessaoDe(req)));
  }

  @Get('inventarios/:id')
  @Permissao('suprimentos.inventario.ler')
  async inventario(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<InventarioLido> {
    const s = sessaoDe(req);
    // Contagem cega: quem conta não vê o saldo; o supervisor (aprovar) vê a divergência.
    const cego = !s.pode('suprimentos.inventario.aprovar');
    const i = await this.porta.inventario(ctx(s), idDaRota(id), cego);
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Inventário não encontrado');
    return i;
  }

  @Post('inventarios')
  @HttpCode(200)
  @Permissao('suprimentos.inventario.aprovar')
  @AuditadoNoHandler('a abertura do inventário (SGH_) com a SGH_TRILHA na mesma transação')
  async abrirInventario(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAbrirInventario, b);
    const r = await this.porta.relogio(ctx(s));
    const saldos = await this.porta.saldos(ctx(s), { local: e.local, hoje: r.hoje, alertaDias: 0 });
    let itens = saldos.itens.map((x) => ({ item: x.item, saldo: x.quantidade }));
    if (e.tipo === 'ciclico' && e.itens.length) itens = itens.filter((x) => e.itens.includes(x.item));
    const limitePct =
      (await this.apoios.apoios.inventario.parametro(s, 'suprimentos.inventarioLimiteDivergenciaPct')) || 5;
    const id = await this.apoios.apoios.inventario.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosInventarioAberto.codigo,
      'suprimentos.inventario',
      (x: number) => ({ tabela: 'SGH_SUP_INVENTARIO', id: String(x) }),
      (g) => g.abrirInventario({ local: e.local, tipo: e.tipo, limitePct, itens, usuario: s.login }),
    );
    return {
      mensagem: `Inventário ${id} aberto com ${itens.length} item(ns): a contagem é cega.`,
      repetida: false,
      ids: { inventario: id },
      avisos: [],
    };
  }

  @Post('inventarios/:id/contagens')
  @HttpCode(200)
  @Permissao('suprimentos.inventario.contar')
  @AuditadoNoHandler('a contagem (SGH_) com a SGH_TRILHA na mesma transação')
  async contar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarContagem, b);
    const inventario = idDaRota(id);
    const r = await this.apoios.apoios.inventario.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosContagemRegistrada.codigo,
      'suprimentos.inventario',
      { tabela: 'SGH_SUP_INV_CONTAGEM', id: `${inventario}/${e.item}` },
      (g) => g.registrarContagem({ inventario, item: e.item, quantidade: e.quantidade, usuario: s.login }),
    );
    return {
      mensagem: `Contagem ${r.ordem} registrada.`,
      repetida: false,
      ids: { ordem: r.ordem },
      avisos: [],
    };
  }

  @Post('inventarios/:id/decisao')
  @HttpCode(200)
  @Permissao('suprimentos.inventario.aprovar')
  @AuditadoNoHandler('a decisão do inventário (SGH_) com a SGH_TRILHA na mesma transação')
  async decidir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSuprimentos> {
    const s = sessaoDe(req);
    const e = corpo(esquemaDecidirInventario, b);
    const inventario = idDaRota(id);
    await this.apoios.apoios.inventario.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosInventarioDecidido.codigo,
      'suprimentos.inventario',
      { tabela: 'SGH_SUP_INVENTARIO', id: String(inventario) },
      (g) =>
        g.decidirInventario({
          inventario,
          decisao: e.decisao,
          justificativa: e.justificativa,
          usuario: s.login,
          podeAprovar: s.pode('suprimentos.inventario.aprovar'),
        }),
    );
    return {
      mensagem: e.decisao === 'aprovado' ? 'Inventário aprovado: grave o balanço.' : 'Inventário cancelado.',
      repetida: false,
      ids: { inventario },
      avisos: [],
    };
  }

  @Post('inventarios/:id/balanco')
  @HttpCode(200)
  @Permissao('suprimentos.inventario.aprovar')
  @AuditadoNoHandler('suprimentos.registrarBalanco pelo executor (trilha na mesma transação)')
  balanco(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ResultadoSuprimentos> {
    return this.servico.executar(sessaoDe(req), 'suprimentos.registrarBalanco', { inventario: idDaRota(id) });
  }
}

/** A página da lista de documentos (1 a 50; 200 por página). */
function paginaOu(v: string | undefined): number {
  if (v === undefined || v === '') return 1;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 50)
    throw new ErroProblema('entrada-invalida', 400, 'Página inválida', 'Use uma página de 1 a 50.');
  return n;
}

/** Campo de CSV: o utilitário comum (neutraliza fórmula de planilha), exportado aqui também por compatibilidade. */
export { csv };
