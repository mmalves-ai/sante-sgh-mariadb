// SADT: laboratório, imagem, métodos gráficos, endoscopia, laudos e a administração do portal (M26; ficha, seções 4,
// 7 e 8). Telas de trabalho sobre os mesmos exames do outro sistema:
//   GET  /api/sadt/gravacao                          funcionalidades por setor, cada ação e a habilitação da sessão
//   GET  /api/sadt/apoio?setor                       prestadores, exames, kits, recipientes, convênios, motivos
//   GET  /api/sadt/exames?setor&data&situacao&urgentes&unidade&termo   exames do setor (auditado: lista com nomes)
//   GET  /api/sadt/exames/:id                        um exame (auditado)
//   POST /api/sadt/exames/receber                    sadt.receberSolicitacao (pedidos do prontuário)
//   POST /api/sadt/exames/lancar                     sadt.lancarExame (lançamento direto no setor)
//   GET  /api/sadt/atendimentos/:id                  o atendimento para o lançamento (conta do setor, retratos)
//   GET  /api/sadt/atendimentos?numero               busca do atendimento pelo número
//   GET  /api/sadt/requisicoes?data&termo            atendimentos externos do dia e a requisição
//   POST /api/sadt/requisicoes                       sadt.abrirRequisicao
//   POST /api/sadt/requisicoes/:reg/protocolo        o protocolo do portal do paciente (o código sai uma vez)
//   GET  /api/sadt/orcamentos?inicio&fim&termo       orçamentos; POST criar; POST :id/converter
//   GET  /api/sadt/coleta?data&unidade&de&ate        lista de coleta por paciente e tubo (unidade e janela)
//   POST /api/sadt/coleta                            a amostra coletada (SGH_) e a etiqueta ZPL na fila da estação
//   GET  /api/sadt/mapa-trabalho?setor&data          mapa de trabalho por bancada
//   GET  /api/sadt/amostras?data&estado; GET amostras/codigo/:codigo; POST amostras/:id/estado
//   GET  /api/sadt/resultados/:id/digitacao          a digitação (referência do dia do exame, críticos, modelos)
//   POST /api/sadt/resultados/:id                    sadt.registrarResultado (o laudador é o médico da sessão)
//   GET  /api/sadt/liberacao?setor&inicio&fim        a fila de liberação com os valores a conferir
//   GET  /api/sadt/resultados/:id/conferencia        um exame para conferir
//   POST /api/sadt/resultados/:id/liberar            sadt.liberarExame (o responsável habilitado da sessão)
//   POST /api/sadt/resultados/:id/retificar          sadt.retificarResultado (motivo; quem já viu é avisado)
//   GET  /api/sadt/criticos?inicio&fim; GET criticos/eventos (canal); POST criticos/:id/comunicar
//   GET  /api/sadt/valores-criticos; GET valores-criticos/elementos?exame; POST valores-criticos
//   GET  /api/sadt/laudos?exame; POST /api/sadt/laudos (PDF/A com código e QR; 2ª via com motivo)
//   GET  /api/sadt/parametros?setor                  parâmetros do setor sem segredo (só o nome dos ocultos)
//   GET  /api/sadt/laudos/codigo/:codigo             a autenticação do laudo pelo código (emitido em, exames)
//   GET  /api/sadt/indicadores?inicio&fim&setor      TAT por setor e prioridade (parcelas impressas)
//   GET  /api/sadt/solicitantes/autocadastro; POST solicitantes/autocadastro/:id; POST solicitantes
//   GET  /api/sadt/busca/profissionais|solicitantes?termo
import { CENTRAL_AVISOS_SADT, type CentralDeAvisos } from './aplicacao/central-critico.js';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type AmostraDetalhe,
  type ApoioSadt,
  type AutocadastroLido,
  CODIGOS_ESTADO_AMOSTRA,
  CODIGOS_SETOR_SADT,
  type ColetaRegistrada,
  esquemaAbrirRequisicao,
  esquemaCadastrarSolicitante,
  esquemaColetarAmostra,
  esquemaComunicarAviso,
  esquemaConverterOrcamento,
  esquemaCriarOrcamento,
  esquemaDecidirAutocadastro,
  esquemaFiltroExamesSadt,
  esquemaFiltroPeriodoSadt,
  esquemaMotivoSadt,
  esquemaMudarEstadoAmostra,
  esquemaReceberSolicitacao,
  esquemaValorCritico,
  type EstadoAmostra,
  EVENTOS_AUDITAVEIS,
  type ExameSadt,
  type GravacaoSadt,
  type IndicadoresSadt,
  type ItemLiberacao,
  type LaudoEmitido,
  type ListaAmostras,
  type ListaColeta,
  type ListaExamesSadt,
  type ListaLiberacao,
  type ListaOrcamentos,
  type ListaRequisicoes,
  type MapaTrabalho,
  MOTIVOS_REJEICAO,
  type PainelCriticos,
  type ParametrosSadt,
  type ResultadoDigitacao,
  type ResultadoSadt,
  type SetorSadt,
  type ValorCriticoLido,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/public-api.js';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { BATIDA_EVENTOS_MS, BATIDA_EVENTOS_PADRAO_MS } from '../internacao/public-api.js';
import {
  AvisosAtendimento,
  type RequisicaoBrutaAtendimento,
  type RespostaEventosAtendimento,
} from '../atendimento/avisos.js';
import { ApoiosSadt } from './aplicacao/apoios.js';
import { ServicoSadt } from './aplicacao/servico.js';
import { VigiaCriticos } from './aplicacao/vigia-criticos.js';
import { type ContextoSadt, PORTA_SADT, type PortaSadt } from './porta.js';

export const AVISOS_SADT = Symbol('AVISOS_SADT');
export const VIGIA_CRITICOS = Symbol('VIGIA_CRITICOS');

const ctx = (s: SessaoCadastro): ContextoSadt => s.porta;
const dataIso = (v: string | undefined, padrao: string): string => {
  if (v === undefined || v === '') return padrao;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return v;
};
const setorOu = (v: string | undefined): SetorSadt | undefined => {
  if (!v) return undefined;
  if (!(CODIGOS_SETOR_SADT as readonly string[]).includes(v))
    throw new ErroProblema('entrada-invalida', 400, 'Setor inválido', 'Escolha um setor do diagnóstico.');
  return v as SetorSadt;
};
/** ID do exame (DOUBLE PRECISION no outro sistema: inteiro seguro). */
const idExame = (v: string): number => {
  if (!/^\d{1,15}$/.test(v) || Number(v) <= 0)
    throw new ErroProblema('nao-encontrado', 404, 'Exame não encontrado');
  return Number(v);
};
const versaoDoCorpo = (b: unknown): string | null => {
  const v = (b as Record<string, unknown> | null)?.['versao'];
  return typeof v === 'string' && v.length <= 40 ? v : null;
};

@Controller('sadt')
export class SadtController implements OnModuleInit, OnModuleDestroy {
  readonly apoios: ApoiosSadt;
  readonly servico: ServicoSadt;
  private readonly avisos: AvisosAtendimento;
  constructor(
    @Inject(PORTA_SADT) private readonly porta: PortaSadt,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfiguracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(FONTE_DOCUMENTO) documento: FonteDocumento | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(AVISOS_SADT) avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(VIGIA_CRITICOS) private readonly vigia: VigiaCriticos | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
    @Optional() @Inject(CENTRAL_AVISOS_SADT) central: CentralDeAvisos | null = null,
  ) {
    this.avisos = avisos ?? new AvisosAtendimento(null);
    this.apoios = new ApoiosSadt(porta, trilha, fonteConfiguracao, cache);
    this.servico = new ServicoSadt(porta, this.apoios, documento, this.avisos, central);
  }

  onModuleInit(): void {
    this.vigia?.iniciar();
  }

  onModuleDestroy(): void {
    this.vigia?.parar();
    this.avisos.fecharTodos();
  }

  private async hoje(s: SessaoCadastro): Promise<string> {
    return (await this.porta.relogio(ctx(s))).hoje;
  }

  // ── Situação, apoio e buscas ─────────────────────────────────────────────────────────────────────

  @Get('gravacao')
  @Permissao('sadt.lancamento.ler')
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoSadt> {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Get('apoio')
  @Permissao('sadt.lancamento.ler')
  async apoio(
    @Query('setor') setor: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ApoioSadt> {
    const s = sessaoDe(req);
    const a = await this.porta.apoio(ctx(s), setorOu(setor));
    const vinculos = await this.porta.vinculos(ctx(s), s.login).catch(() => []);
    return {
      prestadores: a.prestadores,
      executantes: vinculos
        .filter((v) => v.ativo)
        .map((v) => ({ id: v.vinculo, nome: v.nome, conselho: String(v.conselho) })),
      locais: {},
      exames: a.exames,
      kits: a.kits,
      recipientes: a.recipientes,
      convenios: a.convenios,
      motivosRejeicao: MOTIVOS_REJEICAO.map((m) => ({ codigo: m.codigo, rotulo: m.rotulo })),
    };
  }

  @Get('busca/profissionais')
  @Permissao('sadt.lancamento.ler')
  profissionais(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.profissionais(ctx(sessaoDe(req)), (termo ?? '').slice(0, 60));
  }

  @Get('busca/solicitantes')
  @Permissao('sadt.requisicao.ler')
  solicitantes(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.solicitantes(ctx(sessaoDe(req)), { termo: (termo ?? '').slice(0, 60) });
  }

  // ── Exames do setor, recebimento e lançamento ────────────────────────────────────────────────────

  @Get('exames')
  @Permissao('sadt.lancamento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async exames(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaExamesSadt> {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroExamesSadt, {
      ...(q['setor'] ? { setor: q['setor'] } : {}),
      ...(q['data'] ? { data: q['data'] } : {}),
      ...(q['unidade'] ? { unidade: inteiroOuNulo(q['unidade']) ?? -1 } : {}),
      ...(q['situacao'] ? { situacao: q['situacao'] } : {}),
      urgentes: q['urgentes'] === 'sim',
      ...(q['termo']?.trim() ? { termo: q['termo'] } : {}),
    });
    const data = f.data ?? (await this.hoje(s));
    const r = await this.porta.examesDoSetor(ctx(s), {
      ...(f.setor ? { setor: f.setor } : {}),
      inicio: data,
      fim: data,
      situacao: f.situacao,
      urgentes: f.urgentes,
      ...(f.unidade ? { unidade: f.unidade } : {}),
      ...(f.termo ? { termo: f.termo } : {}),
    });
    req.sghAlvo = { tabelaAlvo: 'SILANEXA', idAlvo: `lista ${data}` };
    return { data, ...r };
  }

  @Get('exames/:id')
  @Permissao('sadt.lancamento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async exame(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ExameSadt> {
    const e = await this.porta.exame(ctx(sessaoDe(req)), idExame(id));
    if (!e) throw new ErroProblema('nao-encontrado', 404, 'Exame não encontrado');
    req.sghAlvo = {
      tabelaAlvo: 'SILANEXA',
      idAlvo: String(e.id),
      ...(e.paciente.id ? { paciente: e.paciente.id } : {}),
    };
    return e;
  }

  @Post('exames/receber')
  @HttpCode(200)
  @Permissao('sadt.lancamento.receber')
  @AuditadoNoHandler('sadt.receberSolicitacao pelo executor (trilha na mesma transação)')
  receber(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSadt> {
    return this.servico.receber(sessaoDe(req), corpo(esquemaReceberSolicitacao, b));
  }

  @Post('exames/lancar')
  @HttpCode(200)
  @Permissao('sadt.lancamento.lancar')
  @AuditadoNoHandler('sadt.lancarExame pelo executor (trilha na mesma transação)')
  lancar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSadt> {
    if (!b || typeof b !== 'object') throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    return this.servico.lancar(sessaoDe(req), b as Record<string, unknown>);
  }

  @Get('atendimentos/:id')
  @Permissao('sadt.lancamento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async atendimento(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const a = await this.porta.atendimento(ctx(sessaoDe(req)), idDaRota(id));
    if (!a) throw new ErroProblema('nao-encontrado', 404, 'Atendimento não encontrado');
    req.sghAlvo = {
      tabelaAlvo: 'ATCABECATEND',
      idAlvo: String(a.atendimento),
      ...(a.paciente.id ? { paciente: a.paciente.id } : {}),
    };
    return a;
  }

  @Get('atendimentos')
  @Permissao('sadt.lancamento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async atendimentos(@Query('numero') numero: string | undefined, @Req() req: RequisicaoAutorizada) {
    const n = inteiroOuNulo(numero);
    if (!n)
      throw new ErroProblema('entrada-invalida', 400, 'Número inválido', 'Informe o número do atendimento.');
    req.sghAlvo = { tabelaAlvo: 'ATCABECATEND', idAlvo: `busca ${n}` };
    return this.porta.atendimentosPorNumero(ctx(sessaoDe(req)), n);
  }

  // ── Requisição, protocolo do portal e orçamento ──────────────────────────────────────────────────

  @Get('requisicoes')
  @Permissao('sadt.requisicao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async requisicoes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaRequisicoes> {
    const s = sessaoDe(req);
    const data = dataIso(q['data'], await this.hoje(s));
    req.sghAlvo = { tabelaAlvo: 'SICADATE', idAlvo: `lista ${data}` };
    return {
      data,
      ...(await this.porta.requisicoes(ctx(s), {
        data,
        ...(q['termo']?.trim() ? { termo: q['termo'].slice(0, 60) } : {}),
      })),
    };
  }

  @Post('requisicoes')
  @HttpCode(200)
  @Permissao('sadt.requisicao.criar')
  @AuditadoNoHandler('sadt.abrirRequisicao pelo executor (trilha na mesma transação)')
  abrirRequisicao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSadt> {
    return this.servico.abrirRequisicao(sessaoDe(req), corpo(esquemaAbrirRequisicao, b));
  }

  @Post('requisicoes/:reg/protocolo')
  @HttpCode(200)
  @Permissao('sadt.requisicao.criar')
  @AuditadoNoHandler('o protocolo do portal (SGH_) com a SGH_TRILHA na mesma transação')
  protocolo(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada) {
    return this.servico.protocolo(sessaoDe(req), idDaRota(reg));
  }

  @Get('orcamentos')
  @Permissao('sadt.orcamento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async orcamentos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaOrcamentos> {
    const s = sessaoDe(req);
    const hoje = await this.hoje(s);
    const validadeDias = (await this.apoios.orcamento.parametro(s, 'sadt.validadeOrcamentoDias')) || 30;
    const inicio = dataIso(q['inicio'], `${Number(hoje.slice(0, 4)) - 1}${hoje.slice(4)}`);
    // Lista com nomes e exames de pacientes: trilha de leitura, como as demais listas do diagnóstico.
    req.sghAlvo = { tabelaAlvo: 'SGH_SADT_ORCAMENTO', idAlvo: `lista ${inicio}` };
    return this.porta.orcamentos(ctx(s), {
      inicio,
      fim: dataIso(q['fim'], hoje),
      hoje,
      validadeDias,
      ...(q['termo']?.trim() ? { termo: q['termo'].slice(0, 60) } : {}),
    });
  }

  @Post('orcamentos')
  @HttpCode(200)
  @Permissao('sadt.orcamento.criar')
  @AuditadoNoHandler('sadt.criarOrcamento pelo executor (trilha e SGH_SADT_ORCAMENTO na mesma transação)')
  criarOrcamento(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSadt> {
    return this.servico.criarOrcamento(sessaoDe(req), corpo(esquemaCriarOrcamento, b));
  }

  @Post('orcamentos/:id/converter')
  @HttpCode(200)
  @Permissao('sadt.orcamento.converter')
  @AuditadoNoHandler('sadt.lancarExame pelo executor e a conversão (SGH_) com a SGH_TRILHA')
  converter(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSadt> {
    const e = corpo(esquemaConverterOrcamento, { ...((b ?? {}) as object), orcamento: idDaRota(id) });
    return this.servico.converterOrcamento(sessaoDe(req), e.orcamento, e);
  }

  // ── Coleta, mapa de trabalho e rastreio ──────────────────────────────────────────────────────────

  @Get('coleta')
  @Permissao('sadt.amostra.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async coleta(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaColeta> {
    const s = sessaoDe(req);
    const data = dataIso(q['data'], await this.hoje(s));
    const unidade = inteiroOuNulo(q['unidade']);
    // A janela de coleta (HH:MM), pela previsão da coleta.
    const hora = (v: string | undefined) => (v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
    const deHora = hora(q['de']);
    const ateHora = hora(q['ate']);
    req.sghAlvo = { tabelaAlvo: 'SILANEXA', idAlvo: `coleta ${data}` };
    const r = await this.porta.coleta(ctx(s), {
      inicio: data,
      fim: data,
      ...(unidade ? { unidade } : {}),
      ...(deHora ? { deHora } : {}),
      ...(ateHora ? { ateHora } : {}),
    });
    return { unidade: unidade ?? null, inicio: data, fim: data, deHora, ateHora, ...r };
  }

  @Post('coleta')
  @HttpCode(200)
  @Permissao('sadt.amostra.coletar')
  @AuditadoNoHandler('a amostra coletada (SGH_) com a SGH_TRILHA na mesma transação')
  coletar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ColetaRegistrada> {
    return this.servico.coletar(sessaoDe(req), corpo(esquemaColetarAmostra, b));
  }

  @Get('mapa-trabalho')
  @Permissao('sadt.amostra.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async mapa(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<MapaTrabalho> {
    const s = sessaoDe(req);
    const data = dataIso(q['data'], await this.hoje(s));
    const setor = setorOu(q['setor']) ?? 'laboratorio';
    req.sghAlvo = { tabelaAlvo: 'SILANEXA', idAlvo: `mapa ${data}` };
    return { setor, ...(await this.porta.mapa(ctx(s), { setor, inicio: data, fim: data })) };
  }

  @Get('amostras')
  @Permissao('sadt.amostra.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async amostras(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaAmostras> {
    const s = sessaoDe(req);
    const data = dataIso(q['data'], await this.hoje(s));
    const estado = q['estado'];
    if (estado && !(CODIGOS_ESTADO_AMOSTRA as readonly string[]).includes(estado))
      throw new ErroProblema('entrada-invalida', 400, 'Estado inválido');
    req.sghAlvo = { tabelaAlvo: 'SGH_SADT_AMOSTRA', idAlvo: `lista ${data}` };
    return this.porta.amostras(ctx(s), { data, ...(estado ? { estado: estado as EstadoAmostra } : {}) });
  }

  @Get('amostras/codigo/:codigo')
  @Permissao('sadt.amostra.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async amostraPorCodigo(
    @Param('codigo') codigo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AmostraDetalhe> {
    if (!/^[0-9A-Za-z]{4,12}$/.test(codigo))
      throw new ErroProblema('nao-encontrado', 404, 'Amostra não encontrada');
    const a = await this.porta.amostraPorCodigo(ctx(sessaoDe(req)), codigo);
    if (!a)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Amostra não encontrada',
        'O código lido não é de uma amostra deste estabelecimento.',
      );
    req.sghAlvo = {
      tabelaAlvo: 'SGH_SADT_AMOSTRA',
      idAlvo: String(a.id),
      ...(a.paciente.id ? { paciente: a.paciente.id } : {}),
    };
    return a;
  }

  @Post('amostras/:id/estado')
  @HttpCode(200)
  @Permissao('sadt.amostra.ler')
  @AuditadoNoHandler(
    'a passagem de estado da amostra (SGH_) com a SGH_TRILHA; a permissão de agir é conferida no serviço',
  )
  mudarEstado(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AmostraDetalhe> {
    return this.servico.mudarEstado(sessaoDe(req), idDaRota(id), corpo(esquemaMudarEstadoAmostra, b));
  }

  // ── Digitação, liberação e retificação ───────────────────────────────────────────────────────────

  @Get('resultados/:id/digitacao')
  @Permissao('sadt.resultado.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async digitacao(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ResultadoDigitacao> {
    const r = await this.porta.digitacao(ctx(sessaoDe(req)), idExame(id));
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Exame não encontrado');
    req.sghAlvo = {
      tabelaAlvo: 'SIRES01',
      idAlvo: String(r.exame.id),
      ...(r.exame.paciente.id ? { paciente: r.exame.paciente.id } : {}),
    };
    return r;
  }

  @Post('resultados/:id')
  @HttpCode(200)
  @Permissao('sadt.resultado.ler')
  @AuditadoNoHandler(
    'sadt.registrarResultado pelo executor; a permissão de agir do setor é conferida no apoio',
  )
  digitar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSadt> {
    if (!b || typeof b !== 'object') throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    return this.servico.digitar(sessaoDe(req), idExame(id), b as Record<string, unknown>);
  }

  @Get('liberacao')
  @Permissao('sadt.resultado.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async liberacao(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaLiberacao> {
    const s = sessaoDe(req);
    const hoje = await this.hoje(s);
    const f = corpo(esquemaFiltroPeriodoSadt, {
      inicio: dataIso(q['inicio'], hoje),
      fim: dataIso(q['fim'], hoje),
      ...(q['setor'] ? { setor: q['setor'] } : {}),
    });
    req.sghAlvo = { tabelaAlvo: 'SIRES01', idAlvo: `liberacao ${f.inicio}` };
    return this.porta.filaLiberacao(ctx(s), f);
  }

  @Get('resultados/:id/conferencia')
  @Permissao('sadt.resultado.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async conferencia(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ItemLiberacao> {
    const r = await this.porta.conferencia(ctx(sessaoDe(req)), idExame(id));
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Exame não encontrado');
    req.sghAlvo = {
      tabelaAlvo: 'SIRES01',
      idAlvo: String(r.exame.id),
      ...(r.exame.paciente.id ? { paciente: r.exame.paciente.id } : {}),
    };
    return r;
  }

  @Post('resultados/:id/liberar')
  @HttpCode(200)
  @Permissao('sadt.resultado.ler')
  @AuditadoNoHandler('sadt.liberarExame pelo executor (versão e aviso crítico na mesma transação)')
  liberar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSadt> {
    const confirmar = (b as Record<string, unknown> | null)?.['confirmarCritico'] === true;
    return this.servico.liberar(sessaoDe(req), idExame(id), {
      versao: versaoDoCorpo(b),
      confirmarCritico: confirmar,
    });
  }

  @Post('resultados/:id/retificar')
  @HttpCode(200)
  @Permissao('sadt.resultado.retificar')
  @AuditadoNoHandler('sadt.retificarResultado pelo executor (versão anterior e motivo na mesma transação)')
  retificar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSadt> {
    if (!b || typeof b !== 'object') throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    corpo(z.object({ motivo: esquemaMotivoSadt }).passthrough(), b);
    return this.servico.retificar(sessaoDe(req), idExame(id), b as Record<string, unknown>);
  }

  // ── Valor crítico ────────────────────────────────────────────────────────────────────────────────

  @Get('criticos/eventos')
  @Permissao('sadt.valorCritico.ler')
  eventosCriticos(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    this.avisos.abrirCanal(
      req,
      res,
      sessaoDe(req).hospital,
      'sadt.valorCritico.ler',
      this.resolvedor,
      this.batidaMs,
    );
  }

  @Get('criticos')
  @Permissao('sadt.valorCritico.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async criticos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelCriticos> {
    const s = sessaoDe(req);
    const hoje = await this.hoje(s);
    const f = corpo(esquemaFiltroPeriodoSadt, {
      inicio: dataIso(q['inicio'], hoje),
      fim: dataIso(q['fim'], hoje),
    });
    req.sghAlvo = { tabelaAlvo: 'SGH_SADT_AVISO_CRITICO', idAlvo: `painel ${f.inicio}` };
    return this.servico.painelCriticos(s, f);
  }

  @Post('criticos/:id/comunicar')
  @HttpCode(200)
  @Permissao('sadt.avisoCritico.comunicar')
  @AuditadoNoHandler('a comunicação do aviso (SGH_) com a SGH_TRILHA na mesma transação')
  comunicar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSadt> {
    return this.servico.comunicar(sessaoDe(req), idDaRota(id), corpo(esquemaComunicarAviso, b));
  }

  @Get('valores-criticos')
  @Permissao('sadt.valorCritico.ler')
  valoresCriticos(@Req() req: RequisicaoAutorizada): Promise<ValorCriticoLido[]> {
    return this.porta.valoresCriticos(ctx(sessaoDe(req)));
  }

  @Get('valores-criticos/elementos')
  @Permissao('sadt.valorCritico.ler')
  elementos(@Query('exame') exame: string | undefined, @Req() req: RequisicaoAutorizada) {
    if (!exame || !/^[A-Za-z0-9]{1,4}$/.test(exame))
      throw new ErroProblema('entrada-invalida', 400, 'Exame inválido');
    return this.porta.elementos(ctx(sessaoDe(req)), exame.toUpperCase());
  }

  @Post('valores-criticos')
  @HttpCode(200)
  @Permissao('sadt.valorCritico.editar')
  @AuditadoNoHandler('a faixa crítica (SGH_) com a SGH_TRILHA na mesma transação')
  gravarValorCritico(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSadt> {
    return this.servico.gravarValorCritico(sessaoDe(req), corpo(esquemaValorCritico, b));
  }

  // ── Laudos ───────────────────────────────────────────────────────────────────────────────────────

  @Get('laudos')
  @Permissao('sadt.laudo.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async laudos(@Query('exame') exame: string | undefined, @Req() req: RequisicaoAutorizada) {
    const id = idExame(exame ?? '');
    req.sghAlvo = { tabelaAlvo: 'SIASSLAUDO_IMPRESSAO', idAlvo: String(id) };
    return this.porta.laudosDoExame(ctx(sessaoDe(req)), id);
  }

  /** A autenticação do laudo pelo código (o balcão confere o código impresso): emitido em, quantos exames. */
  @Get('laudos/codigo/:codigo')
  @Permissao('sadt.laudo.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async laudoPorCodigo(@Param('codigo') codigo: string, @Req() req: RequisicaoAutorizada) {
    const c = String(codigo ?? '').slice(0, 40);
    req.sghAlvo = { tabelaAlvo: 'SGH_SADT_LAUDO_EMITIDO', idAlvo: c };
    return this.porta.validarLaudo(ctx(sessaoDe(req)), c);
  }

  @Post('laudos')
  @HttpCode(200)
  @Permissao('sadt.laudo.imprimir')
  @AuditadoNoHandler(
    'sadt.emitirLaudo pelo executor; a 2ª via (SGH_) com a SGH_TRILHA; o PDF/A no registro de emissões',
  )
  emitirLaudo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<LaudoEmitido> {
    const e = corpo(
      z
        .object({
          exames: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(1).max(60),
          segundaVia: z.boolean().default(false),
          motivoSegundaVia: esquemaMotivoSadt.optional(),
        })
        .strict()
        .refine((x) => !x.segundaVia || x.motivoSegundaVia !== undefined, { path: ['motivoSegundaVia'] }),
      b,
    );
    return this.servico.emitirLaudo(sessaoDe(req), e);
  }

  // ── Parâmetros, indicadores e autocadastro ───────────────────────────────────────────────────────

  @Get('parametros')
  @Permissao('sadt.parametro.ler')
  parametros(
    @Query('setor') setor: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ParametrosSadt> {
    return this.servico.parametros(sessaoDe(req), setorOu(setor) ?? 'laboratorio');
  }

  @Get('indicadores')
  @Permissao('sadt.indicador.ler')
  async indicadores(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadoresSadt> {
    const s = sessaoDe(req);
    const hoje = await this.hoje(s);
    const f = corpo(esquemaFiltroPeriodoSadt, {
      inicio: dataIso(q['inicio'], `${hoje.slice(0, 7)}-01`),
      fim: dataIso(q['fim'], hoje),
      ...(q['setor'] ? { setor: q['setor'] } : {}),
    });
    return this.servico.indicadores(s, f);
  }

  @Get('solicitantes/autocadastro')
  @Permissao('sadt.solicitanteWeb.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async autocadastros(@Req() req: RequisicaoAutorizada): Promise<AutocadastroLido[]> {
    const s = sessaoDe(req);
    const hoje = await this.hoje(s);
    const desde = new Date(Date.parse(`${hoje}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
    req.sghAlvo = { tabelaAlvo: 'SGH_SADT_PORTAL_ACESSO', idAlvo: 'autocadastros' };
    return (await this.porta.autocadastros(ctx(s), { desde })).map((a) => ({ ...a }));
  }

  @Post('solicitantes/autocadastro/:id')
  @HttpCode(200)
  @Permissao('sadt.solicitanteWeb.aprovar')
  @AuditadoNoHandler('a decisão do autocadastro (SGH_) com a SGH_TRILHA na mesma transação')
  decidir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSadt> {
    return this.servico.decidirAutocadastro(
      sessaoDe(req),
      idDaRota(id),
      corpo(esquemaDecidirAutocadastro, b),
    );
  }

  @Post('solicitantes')
  @HttpCode(200)
  @Permissao('sadt.solicitanteWeb.aprovar')
  @AuditadoNoHandler('cadastro.cadastrarSolicitante pelo executor (trilha na mesma transação)')
  cadastrarSolicitante(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSadt> {
    return this.servico.cadastrarSolicitante(sessaoDe(req), corpo(esquemaCadastrarSolicitante, b));
  }

  /** Para os testes: a vigia do valor crítico deste controlador (null sem a vigia). */
  get vigiaCriticos(): VigiaCriticos | null {
    return this.vigia;
  }

  get produto(): string {
    return this.configuracao.produtoNome;
  }
}
