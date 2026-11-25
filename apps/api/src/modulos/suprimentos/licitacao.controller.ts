// Licitação e pregão (M55, etapa 4; ficha, seções 4, 7 e 8; regras 9, 10 e 12), construída e DESLIGADA por
// estabelecimento (chave `licitacao`, DP-13, POL-3):
//   GET  /api/suprimentos/licitacoes?etapa=&modalidade=&termo=&pagina=  a lista (200 por página) e o painel por etapa
//   GET  /api/suprimentos/licitacoes/pedidos-marcados   os pedidos de compra marcados como licitação (consulta inteira)
//   GET  /api/suprimentos/licitacoes/fornecedores?termo= e /usuarios?termo=   as buscas da tela
//   GET  /api/suprimentos/licitacoes/:id                o detalhe: itens, estimativa com as parcelas, propostas, julgamento,
//                                                       eventos, as próximas ações com o motivo e os avisos
//   POST /api/suprimentos/licitacoes                    o termo de referência (suprimentos.licitacao.conduzir)
//   PUT  /api/suprimentos/licitacoes/:id                a alteração do termo pela versão (conduzir)
//   POST /api/suprimentos/licitacoes/:id/precos         um preço da pesquisa (conduzir)
//   PUT  /api/suprimentos/licitacoes/:id/precos/:p/descarte   o descarte de um preço com a justificativa (conduzir)
//   POST /api/suprimentos/licitacoes/:id/propostas      uma proposta na sessão (conduzir)
//   PUT  /api/suprimentos/licitacoes/:id/propostas/:p   desclassificar, inabilitar ou revalidar (conduzir)
//   POST /api/suprimentos/licitacoes/:id/etapas         pesquisa, edital, aviso, sessão, julgamento, fracassado, deserto
//   POST /api/suprimentos/licitacoes/:id/eventos        parecer, esclarecimento, recurso, documento, ata, pedido (conduzir)
//   POST /api/suprimentos/licitacoes/:id/decisoes       a decisão do recurso (homologar: a autoridade)
//   POST /api/suprimentos/licitacoes/:id/homologacao    a homologação (homologar; outra pessoa que não o agente)
//   POST /api/suprimentos/licitacoes/:id/encerramentos  revogação ou anulação (homologar)
//   POST /api/suprimentos/licitacoes/:id/documentos     o termo, o registro da etapa ou a ata em PDF/A (regra 10; ler),
//                                                       pelo módulo de documentos do M09 (S3 com Object Lock, SHA-256, QR)
// Tudo só do novo (SGH_), com a SGH_TRILHA na mesma transação. Nenhuma publicação externa (regra 12): a publicação é
// registrada com o veículo e o número informados. As leituras valem com a chave desligada (os processos guardados
// ficam para consulta); gravar exige a chave ligada.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  CHAVE_LIBERACAO_LICITACAO,
  esquemaAlterarLicitacao,
  esquemaAvancarLicitacao,
  esquemaCriarLicitacao,
  esquemaEncerrarLicitacao,
  esquemaFiltroLicitacoes,
  esquemaHomologarLicitacao,
  esquemaRegistrarEventoLicitacao,
  esquemaDescartarPrecoLicitacao,
  esquemaRegistrarPrecoLicitacao,
  esquemaRegistrarPropostaLicitacao,
  esquemaSituacaoPropostaLicitacao,
  type EtapaLicitacao,
  EVENTOS_AUDITAVEIS,
  type GravacaoAgenda,
  type LicitacaoDetalhe,
  type LicitacaoResumo,
  type MetodoEstimativa,
  type PainelLicitacoes,
  PARAMETROS_LICITACAO_PADRAO as PADRAO,
  type ParametrosLicitacao,
  type PedidoMarcadoLicitacao,
  PERMISSOES_LICITACAO_CODIGOS as P,
  type TipoEventoLicitacao,
} from '@sgh/contratos';
import {
  esquemaEmitirDocumentoLicitacao,
  type TipoDocumentoLicitacao,
} from '@sgh/contratos/regras-suprimentos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import type { FornecedorContrato, UsuarioContrato } from './contrato-porta.js';
import { emitirDocumentoLicitacao } from './licitacao-documento.js';
import {
  type GravadorLicitacao,
  type LicitacaoGravacao,
  PORTA_LICITACAO,
  type PortaLicitacao,
} from './licitacao-porta.js';

const E = EVENTOS_AUDITAVEIS;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;

const MENSAGEM_ETAPA: Readonly<Partial<Record<EtapaLicitacao, string>>> = {
  pesquisa: 'Termo de referência concluído: siga com a pesquisa de preços.',
  edital: 'Pesquisa de preços concluída: o valor estimado ficou gravado.',
  publicado: 'Aviso publicado registrado.',
  sessao: 'Sessão aberta: registre as propostas.',
  julgado: 'Processo julgado: corre o prazo de recurso.',
  fracassado: 'Processo declarado fracassado.',
  deserto: 'Processo declarado deserto.',
  homologado: 'Processo homologado.',
  revogado: 'Processo revogado.',
  anulado: 'Processo anulado.',
  recurso: 'Recurso registrado: o processo aguarda a decisão.',
};

const MENSAGEM_EVENTO: Readonly<Record<Exclude<TipoEventoLicitacao, 'etapa' | 'publicacao'>, string>> = {
  parecer: 'Parecer jurídico registrado.',
  esclarecimento: 'Esclarecimento registrado.',
  recurso: 'Recurso registrado: o processo aguarda a decisão.',
  'decisao-recurso': 'Decisão do recurso registrada.',
  documento: 'Documento registrado.',
  ata: 'Ata registrada.',
  pedido: 'Pedido de compra ligado ao processo.',
};

/** O documento emitido: o PDF/A em base64, o nome do arquivo e o identificador da validação pública (QR). */
export interface DocumentoLicitacaoEmitido {
  readonly tipo: TipoDocumentoLicitacao;
  readonly formato: 'pdf';
  readonly conteudo: string;
  readonly nomeArquivo: string;
  readonly emissao: string;
  readonly sha256: string;
  readonly identificadorQr: string;
  /**
   * O documento ficou ligado ao processo (o evento `documento`, listado nos atos e na aba de documentos)? Falso com a
   * chave desligada (consulta) ou quando a ligação falhou: o PDF já está guardado e a emissão fica na trilha.
   */
  readonly ligadoAoProcesso: boolean;
}

export interface ResultadoLicitacao {
  readonly ok: true;
  readonly id: number;
  readonly registro: number;
  readonly etapa: EtapaLicitacao;
  readonly repetido: boolean;
  readonly mensagem: string;
}

function naoEncontrado(): ErroProblema {
  return new ErroProblema(
    'nao-encontrado',
    404,
    'Processo não encontrado',
    'O processo de compra não existe neste estabelecimento.',
  );
}

function idDe(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw naoEncontrado();
  return n;
}

const resultado = (x: LicitacaoGravacao, mensagem: string): ResultadoLicitacao => ({
  ok: true,
  id: x.licitacao,
  registro: x.registro,
  etapa: x.etapa,
  repetido: x.repetido,
  mensagem: x.repetido ? 'Isto já estava registrado.' : mensagem,
});

@Controller('suprimentos/licitacoes')
export class LicitacaoController {
  private readonly apoio: ApoioGravacao<GravadorLicitacao>;

  constructor(
    @Inject(PORTA_LICITACAO) private readonly porta: PortaLicitacao,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(FONTE_DOCUMENTO) private readonly documento: FonteDocumento | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_LICITACAO, nome: 'a licitação e o pregão', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private chave(s: SessaoCadastro, doCorpo: string): string {
    const bruto = s.req.headers['idempotency-key'];
    const k = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof k !== 'string' || !CHAVE.test(k) || k !== doCorpo)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'A Idempotency-Key do pedido falta ou difere da chave do corpo.',
      );
    return k;
  }

  /** As regras do estabelecimento (parâmetros `licitacao.*`), com os padrões da lei quando não há valor. */
  private async parametros(s: SessaoCadastro): Promise<ParametrosLicitacao> {
    const r = await this.apoio.resolvedorParametros(s);
    const n = (chave: string, padrao: number) => {
      const v = Number(r(chave) ?? padrao);
      return Number.isFinite(v) ? v : padrao;
    };
    const metodo = String(r('licitacao.metodoEstimativa') ?? PADRAO.metodoEstimativa);
    const parecer = r('licitacao.exigeParecer');
    return {
      minimoPrecos: n('licitacao.minimoPrecos', PADRAO.minimoPrecos),
      metodoEstimativa: (['mediana', 'media', 'menor'].includes(metodo)
        ? metodo
        : PADRAO.metodoEstimativa) as MetodoEstimativa,
      prazoRecursoDiasUteis: n('licitacao.prazoRecursoDiasUteis', PADRAO.prazoRecursoDiasUteis),
      prazoAvisoRegulamentoDiasUteis: n(
        'licitacao.prazoAvisoRegulamentoDiasUteis',
        PADRAO.prazoAvisoRegulamentoDiasUteis,
      ),
      exigeParecer:
        parecer === null || parecer === undefined
          ? PADRAO.exigeParecer
          : parecer !== false && parecer !== 'nao',
      limiteDispensaObras: n('licitacao.limiteDispensaObrasCentavos', PADRAO.limiteDispensaObras * 100) / 100,
      limiteDispensaDemais:
        n('licitacao.limiteDispensaDemaisCentavos', PADRAO.limiteDispensaDemais * 100) / 100,
    };
  }

  private gravacao(s: SessaoCadastro) {
    return this.apoio.gravacao(s, { conduzir: P.conduzir, homologar: P.homologar });
  }

  @Get()
  @Permissao(P.ler)
  async lista(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    hoje: string;
    itens: LicitacaoResumo[];
    pagina: number;
    cortada: boolean;
    painel: PainelLicitacoes;
    gravacao: GravacaoAgenda;
  }> {
    const s = sessaoDe(req);
    const num = (v: string | undefined) => (v && /^\d{1,5}$/.test(v) ? Number(v) : undefined);
    const f = corpo(esquemaFiltroLicitacoes, {
      ...(q['etapa'] ? { etapa: q['etapa'] } : {}),
      ...(q['modalidade'] ? { modalidade: q['modalidade'] } : {}),
      ...(q['termo'] ? { termo: q['termo'] } : {}),
      ...(num(q['pagina']) ? { pagina: num(q['pagina']) } : {}),
    });
    const [lista, painel, gravacao] = await Promise.all([
      this.porta.listar(s.porta, f),
      this.porta.painel(s.porta),
      this.gravacao(s),
    ]);
    return { ...lista, painel, gravacao };
  }

  @Get('pedidos-marcados')
  @Permissao(P.ler)
  async pedidosMarcados(@Req() req: RequisicaoAutorizada): Promise<{ itens: PedidoMarcadoLicitacao[] }> {
    return { itens: await this.porta.pedidosMarcados(sessaoDe(req).porta) };
  }

  @Get('fornecedores')
  @Permissao(P.ler)
  async fornecedores(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: FornecedorContrato[]; cortada: boolean }> {
    const t = (termo ?? '').trim();
    if (t.length < 2) return { itens: [], cortada: false };
    return this.porta.fornecedores(sessaoDe(req).porta, t.slice(0, 60));
  }

  @Get('usuarios')
  @Permissao(P.ler)
  async usuarios(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: UsuarioContrato[] }> {
    const t = (termo ?? '').trim();
    if (t.length < 2) return { itens: [] };
    return { itens: await this.porta.usuarios(sessaoDe(req).porta, t.slice(0, 31)) };
  }

  @Get(':id')
  @Permissao(P.ler)
  async detalhe(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<LicitacaoDetalhe & { gravacao: GravacaoAgenda }> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const [parametros, gravacao] = await Promise.all([this.parametros(s), this.gravacao(s)]);
    const d = await this.porta.detalhar(s.porta, n, {
      parametros,
      usuario: s.login,
      conduz: s.pode(P.conduzir),
    });
    if (!d) throw naoEncontrado();
    return { ...d, gravacao };
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.conduzir)
  @AuditadoNoHandler(
    'suprimentos.criarLicitacao: SGH_SUP_LICITACAO e os itens com a SGH_TRILHA na mesma transação',
  )
  async criar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoLicitacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCriarLicitacao, b);
    this.chave(s, e.chave);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.licitacaoCriada.codigo,
      P.conduzir,
      (y: LicitacaoGravacao) => ({
        tabela: 'processo_licitatorio',
        id: String(y.licitacao),
        paciente: null,
        chave: e.numero,
      }),
      (g) => g.criar({ entrada: e, usuario: s.login, parametros }),
    );
    return resultado(x, 'Processo aberto com o termo de referência.');
  }

  @Put(':id')
  @Permissao(P.conduzir)
  @AuditadoNoHandler(
    'suprimentos.alterarLicitacao: SGH_SUP_LICITACAO e os itens com a SGH_TRILHA na mesma transação',
  )
  async alterar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoLicitacao> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaAlterarLicitacao, b);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.licitacaoAlterada.codigo,
      P.conduzir,
      { tabela: 'processo_licitatorio', id: String(n), paciente: null },
      (g) => g.alterar({ id: n, entrada: e, usuario: s.login, parametros }),
    );
    return resultado(x, 'Termo de referência alterado.');
  }

  @Post(':id/precos')
  @HttpCode(201)
  @Permissao(P.conduzir)
  @AuditadoNoHandler(
    'suprimentos.registrarPrecoLicitacao: SGH_SUP_LICITACAO_PRECO com a SGH_TRILHA na mesma transação',
  )
  async preco(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoLicitacao> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaRegistrarPrecoLicitacao, b);
    this.chave(s, e.chave);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.licitacaoPreco.codigo,
      P.conduzir,
      (y: LicitacaoGravacao) => ({
        tabela: 'pesquisa_preco_item',
        id: String(y.registro),
        paciente: null,
        chave: `${n}`,
      }),
      (g) => g.preco({ licitacao: n, entrada: e, usuario: s.login, parametros }),
    );
    return resultado(x, 'Preço registrado na pesquisa.');
  }

  /** O descarte de um preço da pesquisa (IN SEGES 65/2021): fica gravado e marcado, fora da estimativa e do mínimo. */
  @Put(':id/precos/:preco/descarte')
  @Permissao(P.conduzir)
  @AuditadoNoHandler(
    'suprimentos.descartarPrecoLicitacao: SGH_SUP_LICITACAO_PRECO_DESC com a SGH_TRILHA na mesma transação',
  )
  async descartarPreco(
    @Param('id') id: string,
    @Param('preco') preco: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoLicitacao> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const pr = idDe(preco);
    const e = corpo(esquemaDescartarPrecoLicitacao, b);
    this.chave(s, e.chave);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.licitacaoPrecoDescartado.codigo,
      P.conduzir,
      (y: LicitacaoGravacao) => ({
        tabela: 'pesquisa_preco_item',
        id: String(y.registro),
        paciente: null,
        chave: `${n}:${pr}`,
      }),
      (g) => g.descartarPreco({ licitacao: n, preco: pr, entrada: e, usuario: s.login, parametros }),
    );
    return resultado(x, 'Preço descartado: fica no registro, fora da estimativa.');
  }

  @Post(':id/propostas')
  @HttpCode(201)
  @Permissao(P.conduzir)
  @AuditadoNoHandler(
    'suprimentos.registrarPropostaLicitacao: SGH_SUP_LICITACAO_PROPOSTA com a SGH_TRILHA na mesma transação',
  )
  async proposta(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoLicitacao> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaRegistrarPropostaLicitacao, b);
    this.chave(s, e.chave);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.licitacaoProposta.codigo,
      P.conduzir,
      (y: LicitacaoGravacao) => ({
        tabela: 'proposta_licitacao_item',
        id: String(y.registro),
        paciente: null,
        chave: `${n}:${e.fornecedor}`,
      }),
      (g) => g.proposta({ licitacao: n, entrada: e, usuario: s.login, parametros }),
    );
    return resultado(x, 'Proposta registrada.');
  }

  @Put(':id/propostas/:proposta')
  @Permissao(P.conduzir)
  @AuditadoNoHandler(
    'suprimentos.classificarPropostaLicitacao: SGH_SUP_LICITACAO_PROPOSTA com a SGH_TRILHA na mesma transação',
  )
  async situacaoProposta(
    @Param('id') id: string,
    @Param('proposta') proposta: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoLicitacao> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const pr = idDe(proposta);
    const e = corpo(esquemaSituacaoPropostaLicitacao, b);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.licitacaoProposta.codigo,
      P.conduzir,
      { tabela: 'proposta_licitacao_item', id: String(pr), paciente: null, chave: e.situacao },
      (g) => g.situacaoProposta({ licitacao: n, proposta: pr, entrada: e, usuario: s.login, parametros }),
    );
    const m = {
      valida: 'Proposta válida.',
      desclassificada: 'Proposta desclassificada.',
      inabilitada: 'Licitante inabilitado.',
    };
    return resultado(x, m[e.situacao]);
  }

  @Post(':id/etapas')
  @HttpCode(201)
  @Permissao(P.conduzir)
  @AuditadoNoHandler(
    'suprimentos.avancarLicitacao: SGH_SUP_LICITACAO e o evento com a SGH_TRILHA na mesma transação',
  )
  async etapa(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoLicitacao> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaAvancarLicitacao, b);
    this.chave(s, e.chave);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.licitacaoEtapa.codigo,
      P.conduzir,
      (y: LicitacaoGravacao) => ({
        tabela: 'evento_processo_licitatorio',
        id: String(y.registro),
        paciente: null,
        chave: `${n}:${e.para}`,
      }),
      (g) => g.avancar({ licitacao: n, entrada: e, usuario: s.login, parametros }),
    );
    return resultado(x, MENSAGEM_ETAPA[x.etapa] ?? 'Etapa registrada.');
  }

  private async registrarEvento(
    decisao: boolean,
    id: string,
    b: unknown,
    req: RequisicaoAutorizada,
  ): Promise<ResultadoLicitacao> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaRegistrarEventoLicitacao, b);
    if ((e.tipo === 'decisao-recurso') !== decisao)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inválido',
        decisao
          ? 'Por aqui só a decisão do recurso.'
          : 'A decisão do recurso é registrada pela autoridade, na ação própria.',
        { campos: ['tipo'] },
      );
    this.chave(s, e.chave);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.licitacaoEvento.codigo,
      decisao ? P.homologar : P.conduzir,
      (y: LicitacaoGravacao) => ({
        tabela: 'evento_processo_licitatorio',
        id: String(y.registro),
        paciente: null,
        chave: `${n}:${e.tipo}`,
      }),
      (g) => g.evento({ licitacao: n, entrada: e, usuario: s.login, parametros }),
    );
    return resultado(x, MENSAGEM_EVENTO[e.tipo]);
  }

  @Post(':id/eventos')
  @HttpCode(201)
  @Permissao(P.conduzir)
  @AuditadoNoHandler(
    'suprimentos.registrarEventoLicitacao: SGH_SUP_LICITACAO_EVENTO com a SGH_TRILHA na mesma transação',
  )
  evento(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.registrarEvento(false, id, b, req);
  }

  /** A decisão do recurso é da autoridade (a mesma que homologa), não do agente que conduz. */
  @Post(':id/decisoes')
  @HttpCode(201)
  @Permissao(P.homologar)
  @AuditadoNoHandler(
    'suprimentos.decidirRecursoLicitacao: SGH_SUP_LICITACAO_EVENTO com a SGH_TRILHA na mesma transação',
  )
  decisao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.registrarEvento(true, id, b, req);
  }

  @Post(':id/homologacao')
  @HttpCode(201)
  @Permissao(P.homologar)
  @AuditadoNoHandler(
    'suprimentos.homologarLicitacao: SGH_SUP_LICITACAO e o evento com a SGH_TRILHA na mesma transação',
  )
  async homologar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoLicitacao> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaHomologarLicitacao, b);
    this.chave(s, e.chave);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.licitacaoEtapa.codigo,
      P.homologar,
      (y: LicitacaoGravacao) => ({
        tabela: 'evento_processo_licitatorio',
        id: String(y.registro),
        paciente: null,
        chave: `${n}:homologado`,
      }),
      (g) => g.homologar({ licitacao: n, entrada: e, usuario: s.login, parametros }),
    );
    return resultado(x, 'Processo homologado.');
  }

  @Post(':id/encerramentos')
  @HttpCode(201)
  @Permissao(P.homologar)
  @AuditadoNoHandler(
    'suprimentos.encerrarLicitacao: SGH_SUP_LICITACAO e o evento com a SGH_TRILHA na mesma transação',
  )
  async encerrar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoLicitacao> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaEncerrarLicitacao, b);
    this.chave(s, e.chave);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.licitacaoEtapa.codigo,
      P.homologar,
      (y: LicitacaoGravacao) => ({
        tabela: 'evento_processo_licitatorio',
        id: String(y.registro),
        paciente: null,
        chave: `${n}:${e.para}`,
      }),
      (g) => g.encerrar({ licitacao: n, entrada: e, usuario: s.login, parametros }),
    );
    return resultado(x, MENSAGEM_ETAPA[e.para] ?? 'Processo encerrado.');
  }
  /**
   * Regra 10: o documento do processo em PDF/A, gravado imutável (S3 com Object Lock) pelo módulo de documentos do
   * M09, com SHA-256, QR de validação e a trilha. Cada emissão é um documento novo (nunca sobrescreve) e, com a chave
   * ligada, fica ligada ao processo (o evento `documento`, sem mudar a etapa nem a versão). Vale com a chave desligada
   * (o processo guardado fica para consulta): aí só a trilha.
   */
  @Post(':id/documentos')
  @HttpCode(201)
  @Permissao(P.ler)
  @AuditadoNoHandler('suprimentos.documentoLicitacao: PDF/A no armazenamento imutável com a SGH_TRILHA')
  async emitirDocumento(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DocumentoLicitacaoEmitido> {
    const s = sessaoDe(req);
    const n = idDe(id);
    const e = corpo(esquemaEmitirDocumentoLicitacao, b);
    const parametros = await this.parametros(s);
    const d = await this.porta.detalhar(s.porta, n, {
      parametros,
      usuario: s.login,
      conduz: s.pode(P.conduzir),
    });
    if (!d) throw naoEncontrado();
    const { documento: m, feita: r } = await emitirDocumentoLicitacao(
      this.documento,
      { rede: s.rede, hospital: s.hospital, autor: s.login },
      d,
      e.tipo,
    );
    const emitido = {
      tipo: e.tipo,
      emissao: r.emissao.id,
      sha256: r.emissao.sha256,
      identificadorQr: r.emissao.identificadorQr,
      etapa: d.etapa,
    };
    const chaveNatural = `${e.tipo}:${r.emissao.id}:${r.emissao.sha256.slice(0, 16)}`;
    // Regra 10: com a chave ligada, o documento fica ligado ao processo (o evento `documento` e a trilha na mesma
    // transação). Desligada (consulta) ou se a ligação falhar, a emissão vai só para a trilha: o PDF já está guardado.
    let ligadoAoProcesso = false;
    if ((await this.apoio.liberacao(s)).ligada) {
      try {
        await this.apoio.sgh(
          s,
          E.licitacaoDocumentoEmitido.codigo,
          P.ler,
          (y: LicitacaoGravacao) => ({
            tabela: 'evento_processo_licitatorio',
            id: String(y.registro),
            paciente: null,
            chave: chaveNatural,
          }),
          (g) => g.documento({ licitacao: n, documento: emitido, usuario: s.login }),
        );
        ligadoAoProcesso = true;
      } catch {
        ligadoAoProcesso = false;
      }
    }
    if (!ligadoAoProcesso)
      await this.trilha.registrar({
        evento: E.licitacaoDocumentoEmitido.codigo,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, 'documento-licitacao').slice(0, 64),
        recurso: 'suprimentos.licitacao.documento',
        resultado: 'sucesso',
        tabelaAlvo: 'processo_licitatorio',
        idAlvo: String(n),
        chaveNaturalAlvo: chaveNatural,
      });
    return {
      tipo: e.tipo,
      formato: 'pdf',
      conteudo: Buffer.from(r.pdf).toString('base64'),
      nomeArquivo: m.nomeArquivo,
      emissao: r.emissao.id,
      sha256: r.emissao.sha256,
      identificadorQr: r.emissao.identificadorQr,
      ligadoAoProcesso,
    };
  }
}
