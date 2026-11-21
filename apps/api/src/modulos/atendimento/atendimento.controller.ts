// Atendimento ambulatorial e pronto atendimento (M20; ficha, seções 4 e 7). Telas de trabalho da recepção, do
// consultório e do PA sobre a mesma ficha e a mesma conta do outro sistema:
//   GET  /api/atendimento/gravacao                   as funcionalidades e cada ação gravam agora? (motivo)
//   GET  /api/atendimento/apoio                      convênios, unidades, especialidades, profissionais, motivos, herança
//   GET  /api/atendimento/dia?data&unidade&local&termo&requisicoes   atendimentos do dia (requisições à parte; busca)
//   GET  /api/atendimento/marcacoes/:id              o agendamento do dia que a abertura preenche (auditado)
//   POST /api/atendimento                            atendimento.abrirAtendimento (consulta, PA, exame, requisição)
//   GET  /api/atendimento/:reg                       a ficha, o segurado, a conta, os extras (auditado)
//   POST /api/atendimento/:reg/segurado              atendimento.alterarSegurado (carimbo da ficha)
//   POST /api/atendimento/:reg/alterar               atendimento.alterarAtendimento (carimbo; justificativa; conta aberta)
//   POST /api/atendimento/:reg/procedimentos         atendimento.lancarProcedimentoExtra (conta conferida antes)
//   POST /api/atendimento/:reg/procedimentos/:seq/corrigir  atendimento.corrigirProcedimentoExtra (quantidade, data)
//   POST /api/atendimento/:reg/procedimentos/:seq/estornar  atendimento.estornarProcedimentoExtra (confirma a senha)
//   GET  /api/atendimento/fila?local                 fila do consultório do local (auditado: lista com nomes)
//   GET  /api/atendimento/fila/eventos               canal de eventos (text/event-stream): só avisa que mudou
//   POST /api/atendimento/:reg/consultorio           atendimento.conduzirNoConsultorio (chamar, atender; quem chama)
//   POST /api/atendimento/:reg/encerrar              atendimento.encerrarAtendimento (ato médico só por médico)
//   GET  /api/atendimento/:reg/cancelamento          prévia da exclusão (o que será desfeito)
//   POST /api/atendimento/:reg/cancelar              atendimento.cancelarAtendimento (supervisor; confirma a senha)
//   GET  /api/atendimento/:reg/impressos             impressos, o que falta e as fichas a imprimir
//   POST /api/atendimento/:reg/impressos             ficha (PDF), etiqueta e pulseira (ZPL na fila da estação)
//   GET  /api/atendimento/indicadores?inicio&fim&unidade  indicadores (denominador com consulta; parcelas)
//   GET  /api/atendimento/busca/cid|solicitantes|procedimentos?termo   buscas da abertura
//   GET  /api/atendimento/pacientes/:id/historico    atendimentos anteriores e o anterior para a herança (auditado)
//   POST /api/atendimento/pacientes/:id/nao-identificado   marca do paciente não identificado (SGH_)
//   GET  /api/atendimento/nao-identificados          os cadastros marcados (identificação pendente; auditado)
//   POST /api/atendimento/pacientes/:id/identificar  a identificação: o cadastro de destino (encerra a marca)
//   GET  /api/atendimento/heranca                    o que a ficha nova copia do atendimento anterior
//   POST /api/atendimento/heranca                    atendimento.alterarHeranca
import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  type OnModuleDestroy,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type ApoioAtendimento,
  type AtendimentoDetalhe,
  type AtendimentosDia,
  type ConfiguracaoHeranca,
  desfecho as desfechoDe,
  esquemaAbrirAtendimento,
  esquemaAlterarHeranca,
  esquemaAlterarAtendimento,
  esquemaAlterarSegurado,
  esquemaCancelarAtendimento,
  esquemaConduzirNoConsultorio,
  esquemaCorrigirProcedimentoExtra,
  esquemaEmitirImpresso,
  esquemaEncerrarAtendimento,
  esquemaEstornarProcedimentoExtra,
  esquemaFiltroAtendimentosDia,
  esquemaFiltroIndicadoresAtendimento,
  esquemaIdentificarPaciente,
  esquemaLancarProcedimentoExtra,
  esquemaMarcarNaoIdentificado,
  EVENTOS_AUDITAVEIS,
  type FilaConsultorio,
  type GravacaoAtendimento,
  type HerancaPaciente,
  type ImpressoGerado,
  type ImpressosAtendimento,
  type IndicadoresAtendimento,
  type MarcacaoAbertura,
  type PreviaCancelamento,
  type ResultadoAtendimento,
} from '@sgh/contratos';
import {
  copiasValidas,
  fichasAImprimir,
  idadeEmAnos,
  type ModeloFicha,
  podeRegistrarDesfecho,
} from '@sgh/dominio-atendimento';
import { enfileirarZpl, ErroZpl, zplEtiquetaProntuario, zplPulseira } from '@sgh/dominio-documento';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { exigir, idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/public-api.js';
import { ApoioGravacao, corpo, inteiroOuNulo } from '../exames/public-api.js';
import { BATIDA_EVENTOS_MS, BATIDA_EVENTOS_PADRAO_MS } from '../internacao/public-api.js';
import {
  AVISOS_ATENDIMENTO,
  type AvisosAtendimento,
  type RequisicaoBrutaAtendimento,
  type RespostaEventosAtendimento,
} from './avisos.js';
import {
  type ContextoAtendimento,
  type DadosImpresso,
  type GravadorSghAtendimento,
  PORTA_ATENDIMENTO,
  type PortaAtendimento,
} from './porta.js';
import { ServicoAtendimento } from './servico.js';

export const CHAVE_AMBULATORIO = 'atendimento.ambulatorio';
export const CHAVE_PA = 'atendimento.pa';
export const CHAVE_CANCELAR = 'atendimento.cancelar';

/** Operações do ambulatório (recepção e consultório) e a permissão de agir de cada uma. */
export const OPERACOES_AMBULATORIO: Readonly<Record<string, string>> = {
  'atendimento.abrirAtendimento': 'atendimento.atendimento.abrir',
  'atendimento.alterarSegurado': 'atendimento.segurado.editar',
  'atendimento.alterarAtendimento': 'atendimento.segurado.editar',
  'atendimento.lancarProcedimentoExtra': 'atendimento.procedimento.lancar',
  'atendimento.corrigirProcedimentoExtra': 'atendimento.procedimento.lancar',
  'atendimento.estornarProcedimentoExtra': 'atendimento.procedimento.lancar',
  'atendimento.conduzirNoConsultorio': 'atendimento.fila.conduzir',
  'atendimento.encerrarAtendimento': 'atendimento.atendimento.encerrar',
  'atendimento.alterarHeranca': 'atendimento.heranca.editar',
};
/** Operações do pronto atendimento. */
export const OPERACOES_PA: Readonly<Record<string, string>> = {
  'atendimento.abrirAtendimento': 'atendimento.atendimento.abrir',
  'atendimento.conduzirNoConsultorio': 'pa.etapa.registrar',
  'atendimento.encerrarAtendimento': 'pa.desfecho.registrar',
};
export const OPERACOES_CANCELAR: Readonly<Record<string, string>> = {
  'atendimento.cancelarAtendimento': 'atendimento.atendimento.cancelar',
};
const ACOES_SGH_AMBULATORIO = {
  impresso: 'atendimento.impresso.emitir',
  naoIdentificado: 'atendimento.atendimento.abrir',
};
const ACOES_SGH_PA = { etapa: 'pa.etapa.registrar', observacao: 'pa.observacao.alocar' };

const TABELA_IMPRESSO = 'SGH_ATD_IMPRESSO';
const TABELA_NAO_IDENTIFICADO = 'SGH_ATD_NAO_IDENTIFICADO';

/** Os apoios de gravação do M20 (uma chave de liberação cada): o controlador do PA usa os mesmos. */
export class ApoiosAtendimento {
  readonly ambulatorio: ApoioGravacao<GravadorSghAtendimento>;
  readonly pa: ApoioGravacao<GravadorSghAtendimento>;
  readonly cancelar: ApoioGravacao<GravadorSghAtendimento>;
  constructor(
    porta: PortaAtendimento,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.ambulatorio = new ApoioGravacao(
      { chave: CHAVE_AMBULATORIO, nome: 'o atendimento ambulatorial', operacoes: OPERACOES_AMBULATORIO },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.pa = new ApoioGravacao(
      { chave: CHAVE_PA, nome: 'o pronto atendimento', operacoes: OPERACOES_PA },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.cancelar = new ApoioGravacao(
      { chave: CHAVE_CANCELAR, nome: 'a exclusão de atendimento', operacoes: OPERACOES_CANCELAR },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  /** O apoio pelo tipo do atendimento (o PA tem a chave própria). */
  doTipo(tipo: string | null | undefined): ApoioGravacao<GravadorSghAtendimento> {
    return tipo === 'pa' ? this.pa : this.ambulatorio;
  }

  async gravacao(s: SessaoCadastro, porta: PortaAtendimento): Promise<GravacaoAtendimento> {
    const [a, p, c, prof] = await Promise.all([
      this.ambulatorio.gravacao(s, ACOES_SGH_AMBULATORIO),
      this.pa.gravacao(s, ACOES_SGH_PA),
      this.cancelar.gravacao(s),
      porta.profissional(ctx(s), s.login).catch(() => null),
    ]);
    const ato = podeRegistrarDesfecho('alta', {
      desfechoMedico: s.pode('atendimento.desfecho.medico'),
      conselhoAtivo: prof?.conselhoAtivo === true,
    });
    return {
      ambulatorio: { ligada: a.ligada, motivo: a.motivo },
      pa: { ligada: p.ligada, motivo: p.motivo },
      cancelar: { ligada: c.ligada, motivo: c.motivo },
      atoMedico: {
        pode: ato.pode && prof !== null,
        motivo: ato.pode && prof !== null ? null : (ato.motivo ?? 'Sem vínculo de médico na sessão.'),
      },
      operacoes: {
        ...a.operacoes,
        ...Object.fromEntries(Object.entries(p.operacoes).map(([k, v]) => [`pa:${k}`, v])),
        ...c.operacoes,
      },
    };
  }
}

const ctx = (s: SessaoCadastro): ContextoAtendimento => s.porta;

/** Avisa a fila do consultório e o quadro do PA depois de uma gravação feita (o canal de eventos relê). */
export async function avisando<T>(
  avisos: AvisosAtendimento | null,
  s: SessaoCadastro,
  p: Promise<T>,
): Promise<T> {
  const r = await p;
  avisos?.avisar(s.hospital);
  return r;
}

@Controller('atendimento')
export class AtendimentoController implements OnModuleDestroy {
  readonly apoios: ApoiosAtendimento;
  private readonly servico: ServicoAtendimento;
  constructor(
    @Inject(PORTA_ATENDIMENTO) private readonly porta: PortaAtendimento,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(FONTE_DOCUMENTO) private readonly documento: FonteDocumento | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(AVISOS_ATENDIMENTO) private readonly avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
  ) {
    this.apoios = new ApoiosAtendimento(porta, trilha, configuracao, cache);
    this.servico = new ServicoAtendimento(porta);
  }

  onModuleDestroy(): void {
    this.avisos?.fecharTodos();
  }

  @Get('gravacao')
  @Permissao('atendimento.atendimento.ler')
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoAtendimento> {
    return this.apoios.gravacao(sessaoDe(req), this.porta);
  }

  @Get('apoio')
  @Permissao('atendimento.atendimento.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioAtendimento> {
    return this.servico.apoio(ctx(sessaoDe(req)));
  }

  @Get('dia')
  @Permissao('atendimento.atendimento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.atendimentoFilaLida.codigo)
  dia(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<AtendimentosDia> {
    const f = corpo(esquemaFiltroAtendimentosDia, {
      ...(q['unidade'] ? { unidade: inteiroOuNulo(q['unidade']) ?? -1 } : {}),
      ...(q['local'] ? { local: inteiroOuNulo(q['local']) ?? -1 } : {}),
      ...(q['termo']?.trim() ? { termo: q['termo'] } : {}),
    });
    return this.servico.dia(ctx(sessaoDe(req)), {
      data: q['data'] ?? null,
      unidade: f.unidade ?? null,
      requisicoes: q['requisicoes'] === 'sim',
      local: f.local ?? null,
      termo: f.termo ?? null,
    });
  }

  @Get('marcacoes/:id')
  @Permissao('atendimento.atendimento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.atendimentoFilaLida.codigo)
  async marcacao(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<MarcacaoAbertura> {
    const m = await this.servico.marcacao(ctx(sessaoDe(req)), idDaRota(id));
    req.sghAlvo = {
      ...(m.paciente ? { paciente: m.paciente.id } : {}),
      tabelaAlvo: 'REPACAGD',
      idAlvo: String(m.id),
    };
    return m;
  }

  @Get('fila/eventos')
  @Permissao('atendimento.fila.ler')
  eventosFila(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    if (!this.avisos) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    this.avisos.abrirCanal(
      req,
      res,
      sessaoDe(req).hospital,
      'atendimento.fila.ler',
      this.resolvedor,
      this.batidaMs,
    );
  }

  @Get('fila')
  @Permissao('atendimento.fila.ler')
  @Auditar(EVENTOS_AUDITAVEIS.atendimentoFilaLida.codigo)
  async fila(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<FilaConsultorio> {
    const s = sessaoDe(req);
    const p = await this.porta.profissional(ctx(s), s.login);
    // O médico vê a fila dele no local; a enfermagem e a recepção, a do local inteiro.
    const soDoMedico = q['todos'] !== 'sim' && p !== null && p.crm > 0;
    return this.servico.fila(ctx(s), {
      local: inteiroOuNulo(q['local']),
      crm: soDoMedico ? p.crm : null,
      profissional: p ? { crm: p.crm, nome: p.nome } : null,
    });
  }

  @Get('indicadores')
  @Permissao('atendimento.indicador.ler')
  indicadores(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadoresAtendimento> {
    const f = corpo(esquemaFiltroIndicadoresAtendimento, {
      inicio: q['inicio'],
      fim: q['fim'],
      ...(q['unidade'] ? { unidade: Number(q['unidade']) } : {}),
    });
    return this.servico.indicadores(ctx(sessaoDe(req)), {
      inicio: f.inicio,
      fim: f.fim,
      unidade: f.unidade ?? null,
    });
  }

  @Get('busca/cid')
  @Permissao('atendimento.atendimento.ler')
  cid(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.cid(ctx(sessaoDe(req)), (termo ?? '').slice(0, 60));
  }

  @Get('busca/solicitantes')
  @Permissao('atendimento.atendimento.ler')
  solicitantes(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.solicitantes(ctx(sessaoDe(req)), (termo ?? '').slice(0, 60));
  }

  @Get('busca/procedimentos')
  @Permissao('atendimento.atendimento.ler')
  procedimentos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const convenio = inteiroOuNulo(q['convenio']);
    if (!convenio)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Convênio obrigatório',
        'Escolha o convênio antes do procedimento.',
      );
    return this.porta.procedimentos(ctx(sessaoDe(req)), convenio, (q['termo'] ?? '').slice(0, 60));
  }

  @Get('heranca')
  @Permissao('atendimento.atendimento.ler')
  heranca(@Req() req: RequisicaoAutorizada): Promise<ConfiguracaoHeranca> {
    return this.servico.configuracaoHeranca(ctx(sessaoDe(req)));
  }

  @Post('heranca')
  @HttpCode(200)
  @Permissao('atendimento.heranca.editar')
  @AuditadoNoHandler('atendimento.alterarHeranca pelo executor (trilha na mesma transação)')
  alterarHeranca(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAtendimento> {
    const e = corpo(esquemaAlterarHeranca, b);
    return this.apoios.ambulatorio.executar(
      sessaoDe(req),
      'atendimento.alterarHeranca',
      e,
      'Configuração da herança gravada.',
    ) as Promise<ResultadoAtendimento>;
  }

  @Get('nao-identificados')
  @Permissao('atendimento.atendimento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.atendimentoNaoIdentificadosLidos.codigo)
  naoIdentificados(@Req() req: RequisicaoAutorizada) {
    // Prontuário e a descrição física da pessoa (dado pessoal sensível): a leitura vai à trilha (LGPD).
    req.sghAlvo = { tabelaAlvo: TABELA_NAO_IDENTIFICADO, idAlvo: 'lista' };
    return this.porta.naoIdentificados(ctx(sessaoDe(req)));
  }

  @Post('pacientes/:id/identificar')
  @HttpCode(200)
  @Permissao('atendimento.atendimento.abrir')
  @AuditadoNoHandler('identificação do paciente não identificado (SGH_) com a SGH_TRILHA na mesma transação')
  async identificar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAtendimento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaIdentificarPaciente, { ...(b as object), paciente: idDaRota(id) });
    await this.apoios.ambulatorio.sgh(
      s,
      EVENTOS_AUDITAVEIS.atendimentoNaoIdentificado.codigo,
      'atendimento.atendimento.abrir',
      { tabela: TABELA_NAO_IDENTIFICADO, id: String(e.paciente), paciente: e.paciente },
      (g) => g.identificarPaciente({ paciente: e.paciente, destino: e.destino, usuario: s.login }),
    );
    return {
      ok: true,
      resultado: { paciente: e.paciente, destino: e.destino },
      repetida: false,
      mensagem:
        'Identificação registrada: a unificação dos dois cadastros segue pela fila de duplicidades do cadastro de pacientes.',
    };
  }

  @Get('pacientes/:id/historico')
  @Permissao('atendimento.atendimento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.atendimentoFilaLida.codigo)
  historico(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<HerancaPaciente> {
    const pac = idDaRota(id);
    req.sghAlvo = { paciente: pac, tabelaAlvo: 'RICADPAC', idAlvo: String(pac) };
    return this.servico.historico(ctx(sessaoDe(req)), pac);
  }

  @Post('pacientes/:id/nao-identificado')
  @HttpCode(200)
  @Permissao('atendimento.atendimento.abrir')
  @AuditadoNoHandler('marca do paciente não identificado (SGH_) com a SGH_TRILHA na mesma transação')
  async naoIdentificado(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAtendimento> {
    const s = sessaoDe(req);
    // O prontuário do cadastro temporário vai junto (referência para a identificação), fora da entrada validada.
    const { prontuario: pront, ...resto } = (b ?? {}) as Record<string, unknown>;
    const e = corpo(esquemaMarcarNaoIdentificado, { ...resto, paciente: idDaRota(id) });
    const h = await this.porta.historico(ctx(s), e.paciente);
    const prontuario = Number.isInteger(pront) && Number(pront) > 0 ? Number(pront) : 0;
    await this.apoios.ambulatorio.sgh(
      s,
      EVENTOS_AUDITAVEIS.atendimentoNaoIdentificado.codigo,
      'atendimento.atendimento.abrir',
      { tabela: TABELA_NAO_IDENTIFICADO, id: String(e.paciente), paciente: e.paciente },
      (g) =>
        g.marcarNaoIdentificado({
          paciente: e.paciente,
          prontuario,
          caracteristicas: e.caracteristicas,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      resultado: { paciente: e.paciente, atendimentosAnteriores: h.historico.length },
      repetida: false,
      mensagem: 'Paciente marcado como não identificado: a identificação fica pendente.',
    };
  }

  @Post()
  @HttpCode(201)
  @Permissao('atendimento.atendimento.abrir')
  @AuditadoNoHandler('atendimento.abrirAtendimento pelo executor (trilha na mesma transação)')
  abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAtendimento> {
    const e = corpo(esquemaAbrirAtendimento, b);
    // M50, etapa 4: a ficha da teleconsulta só nasce pelo início da teleconsulta (permissão de realizar, chave da
    // telemedicina, o médico que abriu a sala); por esta rota o campo é recusado.
    if (e.teleconsulta)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Teleconsulta pela tela de telemedicina',
        'O atendimento da teleconsulta é aberto pelo médico ao iniciar a teleconsulta.',
        { codigo: 'teleconsulta-pela-telemedicina' },
      );
    const s = sessaoDe(req);
    return avisando(
      this.avisos,
      s,
      this.apoios
        .doTipo(e.tipo)
        .executar(
          s,
          'atendimento.abrirAtendimento',
          e,
          'Atendimento aberto.',
        ) as Promise<ResultadoAtendimento>,
    );
  }

  @Get(':reg')
  @Permissao('atendimento.atendimento.ler')
  @Auditar('atendimento.atendimento.lido')
  async detalhe(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada): Promise<AtendimentoDetalhe> {
    const d = await this.servico.detalhe(ctx(sessaoDe(req)), idDaRota(reg));
    req.sghAlvo = {
      ...(d.paciente.id ? { paciente: d.paciente.id } : {}),
      tabelaAlvo: 'RECADATE',
      idAlvo: String(d.reg),
    };
    return d;
  }

  @Post(':reg/segurado')
  @HttpCode(200)
  @Permissao('atendimento.segurado.editar')
  @AuditadoNoHandler('atendimento.alterarSegurado pelo executor (trilha na mesma transação)')
  async segurado(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarSegurado, { ...(b as object), atendimento: idDaRota(reg) });
    const d = await this.servico.detalhe(ctx(s), e.atendimento);
    return this.apoios
      .doTipo(d.tipo)
      .executar(s, 'atendimento.alterarSegurado', e, 'Dados do convênio gravados.');
  }

  @Post(':reg/procedimentos')
  @HttpCode(201)
  @Permissao('atendimento.procedimento.lancar')
  @AuditadoNoHandler('atendimento.lancarProcedimentoExtra pelo executor (trilha na mesma transação)')
  async procedimento(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaLancarProcedimentoExtra, { ...(b as object), atendimento: idDaRota(reg) });
    const d = await this.servico.detalhe(ctx(s), e.atendimento);
    // Regra 2: a tela já mostrou a situação; o servidor confere de novo antes (a receita relê sob trava).
    if (!d.conta.permiteLancar)
      throw new ErroProblema('recusa-de-negocio', 409, 'Conta sem lançamento', d.conta.rotulo, {
        codigo: `conta-${d.conta.situacao}`,
      });
    return this.apoios
      .doTipo(d.tipo)
      .executar(s, 'atendimento.lancarProcedimentoExtra', e, 'Procedimento lançado na conta do atendimento.');
  }

  @Post(':reg/alterar')
  @HttpCode(200)
  @Permissao('atendimento.segurado.editar')
  @AuditadoNoHandler('atendimento.alterarAtendimento pelo executor (trilha na mesma transação)')
  async alterar(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarAtendimento, { ...(b as object), atendimento: idDaRota(reg) });
    const d = await this.servico.detalhe(ctx(s), e.atendimento);
    return avisando(
      this.avisos,
      s,
      this.apoios.doTipo(d.tipo).executar(s, 'atendimento.alterarAtendimento', e, 'Atendimento corrigido.'),
    );
  }

  @Post(':reg/procedimentos/:seq/corrigir')
  @HttpCode(200)
  @Permissao('atendimento.procedimento.lancar')
  @AuditadoNoHandler('atendimento.corrigirProcedimentoExtra pelo executor (trilha na mesma transação)')
  async corrigirExtra(
    @Param('reg') reg: string,
    @Param('seq') seq: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCorrigirProcedimentoExtra, {
      ...(b as object),
      atendimento: idDaRota(reg),
      sequencia: idDaRota(seq),
    });
    const d = await this.servico.detalhe(ctx(s), e.atendimento);
    return this.apoios
      .doTipo(d.tipo)
      .executar(
        s,
        'atendimento.corrigirProcedimentoExtra',
        e,
        'Procedimento corrigido na conta do atendimento.',
      );
  }

  @Post(':reg/procedimentos/:seq/estornar')
  @HttpCode(200)
  @Permissao('atendimento.procedimento.lancar')
  @AuditadoNoHandler('atendimento.estornarProcedimentoExtra pelo executor (trilha na mesma transação)')
  async estornarExtra(
    @Param('reg') reg: string,
    @Param('seq') seq: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    // A senha da confirmação não faz parte da entrada da receita (nem da trilha): o estorno apaga da conta.
    const { senha, ...resto } = (b ?? {}) as Record<string, unknown>;
    const e = corpo(esquemaEstornarProcedimentoExtra, {
      ...resto,
      atendimento: idDaRota(reg),
      sequencia: idDaRota(seq),
    });
    const d = await this.servico.detalhe(ctx(s), e.atendimento);
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário e confirme a senha.',
      );
    const reautenticadoEm = await reautenticar(
      this.sessoes,
      this.resolvedor,
      req,
      typeof senha === 'string' ? senha : undefined,
    );
    return this.apoios
      .doTipo(d.tipo)
      .executar(
        s,
        'atendimento.estornarProcedimentoExtra',
        e,
        'Procedimento estornado da conta do atendimento.',
        {
          reautenticadoEm,
        },
      );
  }

  @Post(':reg/consultorio')
  @HttpCode(200)
  @Permissao('atendimento.fila.conduzir')
  @AuditadoNoHandler('atendimento.conduzirNoConsultorio pelo executor (trilha na mesma transação)')
  async consultorio(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaConduzirNoConsultorio, { ...(b as object), atendimento: idDaRota(reg) });
    const d = await this.servico.detalhe(ctx(s), e.atendimento);
    return avisando(
      this.avisos,
      s,
      this.apoios
        .doTipo(d.tipo)
        .executar(
          s,
          'atendimento.conduzirNoConsultorio',
          e,
          e.evento === 'chamar' ? 'Paciente chamado ao consultório.' : 'Atendimento iniciado.',
        ),
    );
  }

  @Post(':reg/encerrar')
  @HttpCode(200)
  @Permissao('atendimento.atendimento.encerrar')
  @AuditadoNoHandler('atendimento.encerrarAtendimento pelo executor (trilha na mesma transação)')
  async encerrar(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return avisando(
      this.avisos,
      s,
      encerrarPelaSessao(this.porta, this.servico, this.apoios, s, reg, b, 'ambulatorio'),
    );
  }

  @Get(':reg/cancelamento')
  @Permissao('atendimento.atendimento.cancelar')
  async previa(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada): Promise<PreviaCancelamento> {
    const s = sessaoDe(req);
    return this.servico.previa(ctx(s), idDaRota(reg), await this.apoios.cancelar.liberacao(s));
  }

  @Post(':reg/cancelar')
  @HttpCode(200)
  @Permissao('atendimento.atendimento.cancelar')
  @AuditadoNoHandler('atendimento.cancelarAtendimento pelo executor (trilha na mesma transação)')
  async cancelar(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    // A senha da confirmação não faz parte da entrada da receita (nem da trilha).
    const { senha, ...resto } = (b ?? {}) as Record<string, unknown>;
    const e = corpo(esquemaCancelarAtendimento, { ...resto, atendimento: idDaRota(reg) });
    await exigir(s, 'atendimento.atendimento.cancelar', this.trilha);
    const p = await this.servico.previa(ctx(s), e.atendimento, await this.apoios.cancelar.liberacao(s));
    if (!p.pode)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Exclusão recusada',
        p.motivo ?? 'Exclusão recusada.',
        {
          codigo: 'exclusao-recusada',
          // A saída oferecida é a anulação lógica do atendimento (o "inativar" do problema comum do W0-02).
          ...(p.dependentes
            ? {
                dependentes: p.dependentes.map((x) => ({ ...x, origem: 'logica' as const })),
                total: p.dependentes.reduce((t, x) => t + x.quantidade, 0),
                podeInativar: true,
              }
            : {}),
        },
      );
    // Supervisor: a exclusão é crítica e pede a senha de novo (o executor confere a reautenticação recente).
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário e confirme a senha.',
      );
    const reautenticadoEm = await reautenticar(
      this.sessoes,
      this.resolvedor,
      req,
      typeof senha === 'string' ? senha : undefined,
    );
    return avisando(
      this.avisos,
      s,
      this.apoios.cancelar.executar(s, 'atendimento.cancelarAtendimento', e, 'Atendimento excluído.', {
        reautenticadoEm,
      }),
    );
  }

  @Get(':reg/impressos')
  @Permissao('atendimento.impresso.emitir')
  async impressos(
    @Param('reg') reg: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ImpressosAtendimento> {
    const s = sessaoDe(req);
    const d = await this.exigirDadosImpresso(s, idDaRota(reg));
    const fichas = await this.fichasDoAtendimento(s, d);
    return {
      reg: d.reg,
      impressos: this.servico.impressos(d),
      fichas: fichas.lista,
      configuracaoLida: fichas.lida,
    };
  }

  @Post(':reg/impressos')
  @HttpCode(201)
  @Permissao('atendimento.impresso.emitir')
  @AuditadoNoHandler('impresso do atendimento (SGH_ATD_IMPRESSO) com a SGH_TRILHA na mesma transação')
  async emitir(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ImpressoGerado> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEmitirImpresso, { ...(b as object), atendimento: idDaRota(reg) });
    const d = await this.exigirDadosImpresso(s, e.atendimento);
    const decisao = this.servico.impressos(d).find((x) => x.impresso === e.impresso);
    if (!decisao?.pode)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Impresso indisponível',
        decisao?.motivo ?? 'Impresso indisponível.',
        {
          codigo: 'impresso-indisponivel',
        },
      );
    if (!decisao.formatos.includes(e.formato))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Formato indisponível',
        'Este impresso não sai neste formato.',
        {
          campos: ['formato'],
        },
      );
    if (!copiasValidas(e.impresso, e.copias))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Cópias fora do limite',
        'Confira o número de cópias.',
        {
          campos: ['copias'],
        },
      );
    // A ficha configurada (modelo das fichas a imprimir do atendimento): só um modelo que a configuração manda.
    let modelo: { modelo: number; nome: string } | null = null;
    if (e.modelo !== undefined) {
      const fichas = await this.fichasDoAtendimento(s, d);
      const f = fichas.lista.find((x) => x.modelo === e.modelo);
      if (e.impresso !== 'ficha' || e.formato !== 'pdf' || !f)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Ficha não configurada',
          'Esta ficha não está entre as que a configuração manda imprimir para este atendimento.',
          { codigo: 'ficha-nao-configurada' },
        );
      modelo = { modelo: f.modelo, nome: f.nome };
    }
    const gerado =
      e.formato === 'zpl'
        ? await this.zpl(s, d, e.impresso, e.copias)
        : await this.pdf(s, d, e.impresso, modelo);
    const resumo = createHash('sha256').update(gerado.conteudo).digest('hex');
    await this.apoios.doTipo(d.pa ? 'pa' : null).sgh(
      s,
      EVENTOS_AUDITAVEIS.atendimentoImpressoEmitido.codigo,
      'atendimento.impresso.emitir',
      (id: number) => ({
        tabela: TABELA_IMPRESSO,
        id: String(id),
        paciente: d.idPaciente,
        chave: `${d.reg}:${e.impresso}`,
      }),
      (g) =>
        g.registrarImpresso({
          reg: d.reg,
          impresso: modelo ? `ficha-${modelo.modelo}` : e.impresso,
          formato: e.formato,
          copias: e.copias,
          resumo,
          usuario: s.login,
        }),
    );
    return gerado;
  }

  private async exigirDadosImpresso(s: SessaoCadastro, reg: number): Promise<DadosImpresso> {
    const d = await this.porta.dadosImpresso(ctx(s), reg);
    if (!d)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Atendimento não encontrado',
        'O atendimento não existe mais.',
      );
    return d;
  }

  /** As fichas a imprimir pela configuração comum (modelo e seleções); sem a configuração, a ficha padrão. */
  private async fichasDoAtendimento(
    s: SessaoCadastro,
    d: DadosImpresso,
  ): Promise<{ lista: ImpressosAtendimento['fichas']; lida: boolean }> {
    try {
      const lidas = await this.porta.fichasConfiguradas(s.porta);
      if (!lidas) return { lista: [], lida: false };
      const modelos: ModeloFicha[] = [...lidas.modelos];
      const lista = fichasAImprimir(
        modelos,
        lidas.selecoes,
        {
          convenio: d.codigoConvenio,
          especialidade: d.codigoEspecialidade,
          unidade: d.unidade,
          grupos: [],
          clinica: d.clinica,
          retorno: d.retorno,
          idade: idadeEmAnos(d.nascimento, d.data),
        },
        true,
      );
      return { lista, lida: true };
    } catch {
      return { lista: [], lida: false };
    }
  }

  private async zpl(
    s: SessaoCadastro,
    d: DadosImpresso,
    impresso: string,
    copias: number,
  ): Promise<ImpressoGerado> {
    let um: string;
    try {
      um =
        impresso === 'pulseira'
          ? zplPulseira({
              nomeCompleto: d.nome,
              nomeSocial: d.nomeSocial ?? null,
              nascimento: d.nascimento ?? '',
              idPaciente: d.idPaciente,
              prontuario: d.prontuario,
              atendimento: d.reg,
              leito: d.leito,
              alergia: d.alergia,
            })
          : zplEtiquetaProntuario({
              nomeCompleto: d.nome,
              nascimento: d.nascimento ?? '',
              prontuario: d.prontuario,
              idPaciente: d.idPaciente,
            });
    } catch (x) {
      if (x instanceof ErroZpl)
        throw new ErroProblema('recusa-de-negocio', 409, 'Impresso indisponível', x.message, {
          codigo: 'impresso-indisponivel',
        });
      throw x;
    }
    const conteudo = um.replace('^PQ1', `^PQ${copias}`);
    const nomeArquivo = `${impresso}-${d.reg}.zpl`;
    const fonte = this.documento;
    if (!fonte) return { impresso, formato: 'zpl', conteudo, nomeArquivo, fila: null };
    const chave = s.req.headers['idempotency-key'];
    const k = Array.isArray(chave) ? chave[0] : chave;
    if (typeof k !== 'string' || k.length < 8)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'Falta a Idempotency-Key do pedido de impressão.',
      );
    try {
      const r = await enfileirarZpl(
        {
          chaveIdempotencia: k,
          rede: s.rede || 'rede',
          estabelecimento: s.hospital,
          // A fila da estação pelo identificador da estação (só letras, dígitos, ponto, hífen e sublinhado).
          estacao: estacaoDaRequisicao(s.req)
            .replace(/[^A-Za-z0-9._-]/g, '-')
            .slice(0, 64),
          modelo: impresso === 'pulseira' ? 'pulseira' : 'etiqueta-prontuario',
          zpl: conteudo,
        },
        fonte.armazem,
        fonte.destino,
        fonte.novoId,
      );
      return { impresso, formato: 'zpl', conteudo, nomeArquivo, fila: r };
    } catch (x) {
      if (x instanceof Error && /Idempotency-Key/.test(x.message))
        throw new ErroProblema('entrada-invalida', 400, 'Pedido incompleto', x.message);
      throw new ErroProblema(
        'indisponivel',
        503,
        'Fila de impressão indisponível',
        'Não foi possível mandar à impressora da estação agora: tente de novo.',
      );
    }
  }

  private async pdf(
    s: SessaoCadastro,
    d: DadosImpresso,
    impresso: string,
    modelo: { modelo: number; nome: string } | null = null,
  ): Promise<ImpressoGerado> {
    const fonte = this.documento;
    if (!fonte)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'O serviço de emissão de documentos não está configurado.',
      );
    const titulo = modelo
      ? modelo.nome || 'Ficha de atendimento'
      : impresso === 'ficha'
        ? 'Ficha de atendimento'
        : 'Etiqueta de identificação';
    const campos = [
      { rotulo: 'Paciente', valor: d.nome },
      { rotulo: 'Prontuário', valor: String(d.prontuario) },
      {
        rotulo: 'Nascimento',
        valor: d.nascimento ? d.nascimento.split('-').reverse().join('/') : 'Não informado',
      },
      { rotulo: 'Atendimento', valor: String(d.reg) },
      { rotulo: 'Data e hora', valor: `${d.data.split('-').reverse().join('/')} ${d.hora}` },
      { rotulo: 'Tipo', valor: d.tipo },
      { rotulo: 'Convênio', valor: d.convenio },
      { rotulo: 'Profissional', valor: d.profissional },
      { rotulo: 'Especialidade', valor: d.especialidade || 'Não se aplica' },
      ...(d.leito ? [{ rotulo: 'Leito', valor: d.leito }] : []),
    ];
    try {
      const r = await fonte.emissao.emitir({
        rede: s.rede,
        estabelecimento: s.hospital,
        modelo: modelo ? `atendimento-ficha-${modelo.modelo}` : `atendimento-${impresso}`,
        versaoModelo: '1',
        titulo,
        origem: { tipo: 'atendimento', idLegado: d.reg },
        campos,
        autor: s.login,
      });
      return {
        impresso,
        formato: 'pdf',
        conteudo: Buffer.from(r.pdf).toString('base64'),
        nomeArquivo: modelo ? `ficha-${modelo.modelo}-${d.reg}.pdf` : `${impresso}-${d.reg}.pdf`,
        fila: null,
      };
    } catch {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'Não foi possível gerar o PDF agora: tente de novo ou imprima a etiqueta.',
      );
    }
  }
}

/**
 * O desfecho pela sessão (ambulatório e PA): o ato médico só com a permissão do desfecho clínico e o vínculo do
 * próprio médico com conselho ativo (o vínculo vem da sessão, nunca da tela); a recepção registra a evasão e o
 * encerramento administrativo.
 */
export async function encerrarPelaSessao(
  porta: PortaAtendimento,
  servico: ServicoAtendimento,
  apoios: ApoiosAtendimento,
  s: SessaoCadastro,
  reg: string,
  b: unknown,
  origem: 'ambulatorio' | 'pa',
): Promise<ResultadoAtendimento> {
  const bruto: Record<string, unknown> = {
    ...((b ?? {}) as Record<string, unknown>),
    atendimento: idDaRota(reg),
  };
  // D-ATO-20: o vínculo nunca vem da tela. No ato médico, o da sessão (conferido abaixo e na receita); na evasão e no
  // encerramento administrativo, nenhum (o que vier no corpo é descartado).
  delete bruto['profissional'];
  const d = desfechoDe(String(bruto['desfecho'] ?? ''));
  const p = await porta.profissional(ctx(s), s.login);
  if (d?.atoMedico) {
    const decisao = podeRegistrarDesfecho(d.codigo, {
      desfechoMedico: s.pode('atendimento.desfecho.medico'),
      conselhoAtivo: p?.conselhoAtivo === true,
    });
    if (!decisao.pode || !p)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Ato médico',
        decisao.motivo ?? 'Só o médico registra este desfecho.',
        {
          codigo: 'ato-medico',
        },
      );
    bruto['profissional'] = p.vinculo;
  }
  const e = corpo(esquemaEncerrarAtendimento, bruto);
  const ficha = await servico.detalhe(ctx(s), e.atendimento);
  const apoio = origem === 'pa' ? apoios.pa : apoios.doTipo(ficha.tipo);
  return apoio.executar(
    s,
    'atendimento.encerrarAtendimento',
    e,
    `Atendimento encerrado: ${d?.rotulo.toLowerCase() ?? e.desfecho}.`,
  ) as Promise<ResultadoAtendimento>;
}
