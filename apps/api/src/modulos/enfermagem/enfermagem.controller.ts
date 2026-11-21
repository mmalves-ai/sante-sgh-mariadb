// Enfermagem beira-leito (M25; ficha, seção 7):
//   GET  /api/enfermagem/gravacao                       funcionalidades, ações, parâmetros e a categoria da sessão
//   GET  /api/enfermagem/unidades                       as unidades de internação com os internados
//   GET  /api/enfermagem/turno?unidade&data&turno       a linha do tempo do turno (leitura auditada)
//   GET  /api/enfermagem/pacientes/:atendimento/horarios   os horários do paciente nas 12 h (tablet; leitura auditada)
//   GET  /api/enfermagem/pulseira?codigo                o paciente da pulseira lida
//   GET  /api/enfermagem/horarios/:id                   o horário com o histórico, os atos e a infusão (auditada)
//   POST /api/enfermagem/horarios/:id/checar            enfermagem.checarAdministracao (Idempotency-Key)
//   POST /api/enfermagem/horarios/:id/estornar          estorno da checagem no banco (fato novo com o motivo)
//   POST /api/enfermagem/horarios/:id/infusao           evento da infusão contínua (só no novo)
//   GET|POST /api/enfermagem/aprazamento                proposta e confirmação do aprazamento (grava no horário)
//   GET  /api/enfermagem/conflitos; POST …/:id/resolver os conflitos de sincronização
//   POST /api/enfermagem/sincronizar                    os atos feitos sem rede, na ordem, cada um com a chave dele
//   GET|POST /api/enfermagem/pacientes/:paciente/sinais-vitais; POST /api/enfermagem/sinais-vitais/:id/retificar
//   GET|POST /api/enfermagem/plantao; POST …/:id/aceite passagem de plantão com o aceite de quem recebe
//   POST /api/enfermagem/plantao/:id/cancelar          W0-03: quem passou cancela, com o motivo, antes do aceite (409 depois)
//   GET|POST /api/enfermagem/dispositivos; POST …/:id    aparelhos do modo beira do leito (W0-03: nome, unidade, situação)
//   POST /api/enfermagem/dispositivos/:id/excluir      W0-03: só sem leituras vinculadas (409 com a contagem)
//   GET  /api/enfermagem/indicadores?data               pulseira não lida, dupla checagem, atrasadas e omitidas
//   GET  /api/enfermagem/eventos                        canal de eventos (text/event-stream): um horário mudou
//   GET  /api/enfermagem/contingencia/ultima?unidade    M40, regra 6: o último relatório do posto (o da hora), relido
//                                                       do armazém; leitura auditada; 404 sem relatório gerado
//   POST /api/enfermagem/contingencia                   M40, regra 6: o relatório de contingência do posto (PDF/A;
//                                                       leitura auditada); fora de dev/ci, também a cada hora
// Toda leitura de dado do paciente vai à trilha (@Auditar); toda gravação leva a trilha na mesma transação.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  EVENTOS_AUDITAVEIS,
  esquemaAceitarPlantao,
  esquemaAlterarDispositivo,
  esquemaCancelarPassagemPlantao,
  esquemaExcluirDispositivo,
  esquemaAprazamento,
  esquemaChecarHorario,
  esquemaDispositivoBeiraLeito,
  esquemaEstornarChecagem,
  esquemaEventoInfusao,
  esquemaPassarPlantao,
  esquemaPedidoContingencia,
  marcaSuporteTecnico,
  esquemaResolverConflito,
  esquemaRetificarSinal,
  esquemaSinaisVitais,
  esquemaSincronizar,
  type AtoOffline,
  type ChecarHorario,
  type GravacaoEnfermagem,
  type HorarioDetalhe,
  MENSAGENS_ENFERMAGEM,
  type News2DaAfericao,
  PERMISSOES_ENFERMAGEM as P,
  SINAIS_VITAIS,
  type SinaisVitaisDoPaciente,
  SITUACOES_CHECAGEM,
  type TipoSinalVital,
  TURNOS,
  type Turno,
} from '@sgh/contratos';
import {
  categoriaPorCbo,
  conferirAcaoAprazamento,
  conferirAceite,
  conferirCancelamento,
  conferirEventoInfusao,
  conferirPassagem,
  conferirRetificacao,
  decidirSincronizacao,
  horaRealAceita,
  lerCodigoPulseira,
  ordemDeEnvio,
  podeAprazar,
  podeChecar,
  semRepetidos,
  somarMinutos,
  validarSinal,
  volumeEstimado,
} from '@sgh/dominio-enfermagem';
import { AuditadoNoHandler, Auditar, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import type {
  AvisosAtendimento,
  RequisicaoBrutaAtendimento,
  RespostaEventosAtendimento,
} from '../atendimento/public-api.js';
import { contextoOperacao, exigir, idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { BATIDA_EVENTOS_MS, BATIDA_EVENTOS_PADRAO_MS } from '../internacao/public-api.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/public-api.js';
import { ApoiosEnfermagem } from './apoios.js';
import {
  ALVOS_CONTINGENCIA,
  type ContextoContingencia,
  GeracaoPorHora,
  ServicoContingencia,
} from './contingencia.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { ServicoEnfermagem } from './servico.js';
import { ApoioEscores } from './escores.controller.js';
import { PORTA_ESCORES, type PortaEscores } from './escores-porta.js';
import { contencoesNoTurno, parametrosContencao } from './contencao-servico.js';
import { PARAMETROS_NEWS2 } from './escores-servico.js';
import { atoDe, sessaoComAto } from './gravacao-direta.js';
import { AVISOS_ENFERMAGEM } from './simbolos.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;
const CONFLITOS: Readonly<Record<string, 'suspenso' | 'jaChecado' | 'mudou'>> = {
  'horario-suspenso': 'suspenso',
  'horario-ja-checado': 'jaChecado',
  'horario-mudou': 'mudou',
};

function unidadeDe(v: string | undefined): string {
  const u = (v ?? '').trim();
  if (!UNIDADE.test(u))
    throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
  return u;
}
function turnoDe(data: string | undefined, turno: string | undefined): { data?: string; turno?: Turno } {
  if (!data && !turno) return {};
  if (!data || !DATA.test(data) || !(TURNOS as readonly string[]).includes(turno ?? ''))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Turno inválido',
      'Informe a data e o turno (diurno ou noturno).',
    );
  return { data, turno: turno as Turno };
}

@Controller('enfermagem')
export class EnfermagemController implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly apoios: ApoiosEnfermagem;
  readonly servico: ServicoEnfermagem;
  readonly contingencia: ServicoContingencia;
  /** M45 (etapa 2): o NEWS2 calculado a cada aferição completa registrada por aqui (regra 1). */
  private readonly escores: ApoioEscores | null;
  private porHora: GeracaoPorHora | null = null;
  /** W1-08: a porta da contenção (as checagens de perfusão e pele aprazadas pela ordem entram no turno). */
  private readonly portaEscores: PortaEscores | null;

  constructor(
    @Inject(PORTA_ENFERMAGEM) private readonly porta: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(AVISOS_ENFERMAGEM) private readonly avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
    @Optional() @Inject(FONTE_DOCUMENTO) documento: FonteDocumento | null = null,
    @Optional() @Inject(CONFIGURACAO) private readonly cfg: Configuracao | null = null,
    @Optional() @Inject(PORTA_ESCORES) escores: PortaEscores | null = null,
    @Optional()
    @Inject(ALVOS_CONTINGENCIA)
    private readonly alvosContingencia: readonly ContextoContingencia[] = [],
  ) {
    this.portaEscores = escores;
    this.apoios = new ApoiosEnfermagem(porta, trilha, configuracao, cache);
    this.escores = escores ? new ApoioEscores(escores, porta, trilha, configuracao, cache) : null;
    this.servico = new ServicoEnfermagem(porta);
    this.contingencia = new ServicoContingencia(porta, documento);
  }

  /**
   * M40 (regra 6): fora de dev/ci, o relatório de contingência dos postos do parâmetro é gerado a cada hora (a cópia de
   * dev é compartilhada: lá, só sob pedido na tela). CONTINGENCIA_POR_HORA=desligado desliga.
   */
  onApplicationBootstrap(): void {
    const ambiente = this.cfg?.ambiente ?? 'dev';
    if (this.porta.destino !== 'banco' || ['dev', 'ci'].includes(ambiente)) return;
    if ((process.env['CONTINGENCIA_POR_HORA'] ?? '').trim() === 'desligado') return;
    // Os estabelecimentos vigiados vêm do módulo (o cliente e cada estabelecimento do banco); sem eles, nada roda.
    if (this.alvosContingencia.length === 0) return;
    this.porHora = new GeracaoPorHora(
      this.contingencia,
      this.trilha,
      (rede, hospital, chave) => this.apoios.parametroDoEstabelecimento(rede, hospital, chave),
      this.alvosContingencia,
    );
    this.porHora.iniciar();
  }

  onApplicationShutdown(): void {
    this.porHora?.parar();
  }

  private unidadeDaSessao(s: SessaoCadastro): string | null {
    const u = s.req.sgh?.sessao.unidadeAtiva;
    return u === null || u === undefined ? null : String(u);
  }

  /** O vínculo de enfermagem da sessão (o CBO 2235 ou 3222) e a categoria. */
  private async vinculo(s: SessaoCadastro) {
    const vs = await this.porta.vinculos(s.porta, s.login).catch(() => []);
    const enfermeiro = vs.find((v) => categoriaPorCbo(v.codigo) === 'enfermeiro');
    const v = enfermeiro ?? vs[0] ?? null;
    return { vinculo: v, categoria: v ? categoriaPorCbo(v.codigo) : ('outro' as const) };
  }

  @Get('gravacao')
  @Permissao(P.horarioLer)
  async gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoEnfermagem> {
    const s = sessaoDe(req);
    const [g, p, v] = await Promise.all([
      this.apoios.gravacao(s),
      this.apoios.parametros(s, this.unidadeDaSessao(s)),
      this.vinculo(s),
    ]);
    const doseObrigatoria = p.doseObrigatoria || g.funcionalidades['enfermagem.leituraDose']?.ligada === true;
    const operacoes = { ...g.operacoes };
    // Regra 1: só o enfermeiro apraza; a checagem é da enfermagem.
    if (!podeAprazar(v.categoria) && operacoes['registrarAprazamento']?.pode)
      operacoes['registrarAprazamento'] = { pode: false, motivo: 'O aprazamento é ato do enfermeiro.' };
    if (!podeChecar(v.categoria) && operacoes['enfermagem.checarAdministracao']?.pode)
      operacoes['enfermagem.checarAdministracao'] = {
        pode: false,
        motivo: 'A checagem é da enfermagem: a sessão não tem o vínculo de enfermeiro ou técnico.',
      };
    return {
      ligada: g.ligada,
      motivo: g.motivo,
      operacoes,
      funcionalidades: g.funcionalidades,
      parametros: {
        toleranciaMinutos: p.toleranciaMinutos,
        pulseiraObrigatoria: p.pulseiraObrigatoria,
        doseObrigatoria,
        loteValidadeObrigatorio: p.loteValidade.length > 0,
        duplaChecagem: p.duplaChecagem,
        cacheHoras: p.cacheHoras,
        intervaloSinaisHoras: p.intervaloSinaisHoras,
      },
      categoria: v.categoria,
    };
  }

  /**
   * M40 (regra 6): o relatório de contingência do posto, sob pedido (o mesmo da geração de cada hora). PDF/A pelo serviço
   * de emissão (armazém de documentos com o hash); leitura de prontuário auditada com a unidade e as contagens.
   */
  @Post('contingencia')
  @HttpCode(200)
  @Permissao(P.horarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemContingenciaGerada.codigo)
  async gerarContingencia(
    @Body() corpoPedido: unknown,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { header(n: string, v: string): unknown },
  ): Promise<Buffer> {
    const s = sessaoDe(req);
    const p = esquemaPedidoContingencia.safeParse(corpoPedido ?? {});
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inválido',
        p.error.issues[0]?.message ?? 'Escolha a unidade e o horizonte (2 a 12 horas).',
      );
    const g = await this.contingencia.gerar(s.porta, {
      unidade: p.data.unidade,
      horas: p.data.horas,
      autor: s.login,
      marcaSuporte: req.sghComo ? marcaSuporteTecnico(req.sghComo.alvoNome) : null,
    });
    req.sghAlvo = {
      tabelaAlvo: 'horario_administracao',
      idAlvo: g.resumo.documento,
      chaveNaturalAlvo: `contingencia:${g.resumo.unidade}:${g.resumo.pacientes}:${g.resumo.horarios}`,
    };
    res.header('content-type', 'application/pdf');
    res.header('x-sgh-pacientes', String(g.resumo.pacientes));
    res.header('x-sgh-horarios', String(g.resumo.horarios));
    res.header(
      'content-disposition',
      `inline; filename="contingencia-${g.resumo.unidade}-${g.resumo.geradoEm.replace(/\D/g, '')}.pdf"`,
    );
    return Buffer.from(g.pdf);
  }

  /**
   * M40 (regra 6): o último relatório de contingência do posto (da geração de cada hora ou da tela), relido do armazém
   * pela versão do registro: a estação de contingência baixa e imprime o da hora. Leitura de prontuário auditada; 404
   * quando nenhum foi gerado para o posto desde que a API subiu.
   */
  @Get('contingencia/ultima')
  @Permissao(P.horarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemContingenciaLida.codigo)
  async ultimaContingencia(
    @Query('unidade') unidade: string | undefined,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { header(n: string, v: string): unknown },
  ): Promise<Buffer> {
    const s = sessaoDe(req);
    const p = esquemaPedidoContingencia.safeParse({ unidade });
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inválido',
        p.error.issues[0]?.message ?? 'Escolha a unidade.',
      );
    const u = await this.contingencia.ultima(s.porta, p.data.unidade);
    if (!u)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Nenhum relatório do posto',
        'Ainda não há relatório de contingência gerado para esta unidade: gere um agora.',
      );
    req.sghAlvo = {
      tabelaAlvo: 'horario_administracao',
      idAlvo: u.resumo.documento,
      chaveNaturalAlvo: `contingencia:${u.resumo.unidade}:${u.resumo.pacientes}:${u.resumo.horarios}`,
    };
    res.header('content-type', 'application/pdf');
    res.header('x-sgh-pacientes', String(u.resumo.pacientes));
    res.header('x-sgh-horarios', String(u.resumo.horarios));
    res.header('x-sgh-gerado-em', u.resumo.geradoEm);
    res.header(
      'content-disposition',
      `inline; filename="contingencia-${u.resumo.unidade}-${u.resumo.geradoEm.replace(/\D/g, '')}.pdf"`,
    );
    return Buffer.from(u.pdf);
  }

  @Get('unidades')
  @Permissao(P.horarioLer)
  // Revisão W0-03: o prescritor escolhe a unidade na tela da contenção mecânica (a ordem é ato dele).
  @PermissaoOu('pep.prescricao.criar')
  unidades(@Req() req: RequisicaoAutorizada) {
    return this.porta.unidades(sessaoDe(req).porta);
  }

  @Get('turno')
  @Permissao(P.horarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async turno(
    @Query('unidade') unidade: string | undefined,
    @Query('data') data: string | undefined,
    @Query('turno') turno: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const u = unidadeDe(unidade);
    const p = await this.apoios.parametros(s, u);
    const r = await this.servico.linhaDoTempo(s.porta, u, p, turnoDe(data, turno));
    req.sghAlvo = { tabelaAlvo: 'horario_administracao', chaveNaturalAlvo: `unidade:${u}:${r.horarios.length}` };
    return { ...r, contencoes: await this.contencoesDoTurno(s, u, r) };
  }

  /**
   * W1-08 (mercado: contenção mecânica): a ordem de contenção gera no aprazamento do turno as checagens de perfusão e
   * pele (os horários da ordem na janela do turno), com o alerta da ordem vencida sem renovação. A janela de leitura
   * volta o prazo máximo da ordem (24 horas) e inclui as abertas de qualquer idade (a vencida segue alertando).
   */
  private async contencoesDoTurno(
    s: SessaoCadastro,
    unidade: string | null,
    r: {
      turno: { inicio: string; fim: string };
      agora: string;
      pacientes: readonly { atendimento: number; leito: string | null }[];
    },
  ) {
    if (!this.portaEscores || !r.pacientes.length) return [];
    const [ordens, tol] = await Promise.all([
      this.portaEscores.contencoes(s.porta, {
        atendimentos: r.pacientes.map((x) => x.atendimento),
        desde: somarMinutos(r.turno.inicio, -24 * 60),
        abertas: true,
      }),
      this.apoios.valor(s, 'enfermagem.contencao.toleranciaMinutos', unidade),
    ]);
    const p = parametrosContencao(0, 0, tol);
    return contencoesNoTurno(ordens, r.pacientes, r.turno, r.agora, p.toleranciaMinutos);
  }

  @Get('pacientes/:atendimento/horarios')
  @Permissao(P.horarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async horariosDoPaciente(
    @Param('atendimento') atendimento: string,
    @Query('horas') horas: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const h = Math.min(24, Math.max(2, Number(horas ?? 12) || 12));
    const p = await this.apoios.parametros(s, this.unidadeDaSessao(s));
    const r = await this.servico.horariosDoPaciente(s.porta, idDaRota(atendimento), p, h);
    req.sghAlvo = {
      paciente: r.paciente.paciente,
      atendimento: r.paciente.atendimento,
      tabelaAlvo: 'horario_administracao',
    };
    return { ...r, cacheHoras: p.cacheHoras };
  }

  @Get('pulseira')
  @Permissao(P.administracaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async pulseira(
    @Query('codigo') codigo: string | undefined,
    @Query('unidade') unidade: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const lida = lerCodigoPulseira(codigo ?? '');
    if (!lida)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pulseira',
        'O código lido não é de uma pulseira de identificação.',
        {
          codigo: 'pulseira-ilegivel',
        },
      );
    const unidades = unidade
      ? [unidadeDe(unidade)]
      : (await this.porta.unidades(s.porta)).map((u) => u.unidade);
    for (const u of unidades) {
      const i = (await this.porta.internados(s.porta, u)).find(
        (x) => x.paciente === lida.paciente && (lida.atendimento === null || lida.atendimento === x.numero),
      );
      if (i) {
        req.sghAlvo = { paciente: i.paciente, atendimento: i.atendimento };
        return {
          atendimento: i.atendimento,
          paciente: i.paciente,
          numero: i.numero,
          nome: i.nome,
          leito: i.leito,
          unidade: i.unidade,
        };
      }
    }
    throw new ErroProblema(
      'nao-encontrado',
      404,
      'Pulseira',
      'O paciente da pulseira não está internado aqui.',
    );
  }

  @Get('horarios/:id')
  @Permissao(P.administracaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async horario(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<HorarioDetalhe & { faixas: unknown[] }> {
    const s = sessaoDe(req);
    const p = await this.apoios.parametros(s, this.unidadeDaSessao(s));
    const h = await this.servico.horarioComEstado(s.porta, idDaRota(id), p);
    const [hist, atos, inf, faixas] = await Promise.all([
      this.porta.historico(s.porta, h.lido.id),
      this.porta.atos(s.porta, [h.lido.id]).catch(() => []),
      this.porta.eventosInfusao(s.porta, [h.lido.id]).catch(() => []),
      h.lido.tipo === 'glicemia' && h.lido.faixa === null
        ? this.porta.faixasDoHorario(s.porta, h.lido)
        : Promise.resolve([]),
    ]);
    const nomes = await this.porta
      .nomesVinculos(
        s.porta,
        hist.eventos.map((e) => e.cbo).filter((x): x is number => x !== null),
      )
      .catch(() => new Map<number, string>());
    req.sghAlvo = {
      paciente: h.tela.paciente,
      atendimento: h.tela.atendimento,
      tabelaAlvo: 'horario_administracao',
      idAlvo: String(h.lido.id),
    };
    return {
      horario: h.tela,
      historico: [
        ...hist.eventos.map((e) => ({
          quando: e.quando,
          origem: e.origem,
          situacao: e.situacao,
          rotulo:
            e.origem === 'extrato'
              ? `Extrato: ${(SITUACOES_CHECAGEM as Record<string, string>)[e.situacao] ?? e.situacao}`
              : ((SITUACOES_CHECAGEM as Record<string, string>)[e.situacao] ?? e.situacao),
          profissional: e.cbo !== null ? (nomes.get(e.cbo) ?? null) : null,
          detalhe: e.justificativa,
        })),
        ...atos.map((a) => ({
          quando: a.gravadoEm,
          origem: 'novo' as const,
          situacao: a.situacao,
          rotulo:
            a.tipo === 'estorno'
              ? 'Estorno pedido'
              : `Checado aqui (${a.origemOffline ? 'sem rede, ' : ''}hora real ${a.horaReal.slice(11, 16)})`,
          profissional: a.usuario,
          detalhe: [
            a.pulseiraLida ? 'pulseira lida' : `sem pulseira: ${a.motivoSemPulseira ?? 'motivo'}`,
            a.conferente ? `dupla checagem com ${a.conferente}` : null,
            a.observacao,
          ]
            .filter(Boolean)
            .join('; '),
        })),
      ].sort((a, b) => a.quando.localeCompare(b.quando)),
      cortado: hist.cortado,
      atos: atos.map((a) => ({
        id: a.id,
        tipo: a.tipo,
        situacao: a.situacao,
        horaReal: a.horaReal,
        gravadoEm: a.gravadoEm,
        usuario: a.usuario,
        pulseiraLida: a.pulseiraLida,
        motivoSemPulseira: a.motivoSemPulseira,
        gtin: a.gtin,
        lote: a.lote,
        validade: a.validade,
        conferente: a.conferente,
        origemOffline: a.origemOffline,
        motivo: (a.motivo as never) ?? null,
        observacao: a.observacao,
      })),
      infusao: inf.map((x) => ({ ...x, evento: x.evento as never })),
      faixas,
    };
  }

  /** O segundo profissional da dupla checagem: a senha dele conferida e a permissão de conferir. */
  private async conferente(s: SessaoCadastro, e: ChecarHorario) {
    if (!e.conferente) return null;
    const id = this.resolvedor?.idSessao(s.req) ?? null;
    if (!this.sessoes || !id) return { login: e.conferente.login, conferiu: false, podeConferir: false };
    const r = await this.sessoes
      .conferirSegundoProfissional(
        id,
        this.resolvedor?.rede(s.req) ?? null,
        e.conferente.login,
        e.conferente.senha,
      )
      .catch(() => ({ conferiu: false, permissoes: [] as readonly string[] }));
    return {
      login: e.conferente.login,
      conferiu: r.conferiu,
      podeConferir: r.permissoes.includes(P.administracaoConferir),
    };
  }

  /** A checagem de um horário (em tela, pelo tablet ou da sincronização), com o conflito aberto na recusa. */
  private async checar(
    s: SessaoCadastro,
    horario: number,
    e: ChecarHorario,
    chave: string | null,
    /** Revisão W0-03: o aparelho foi exigido e conferido no começo (a gravação trava a linha dele e recusa sem ela). */
    aparelhoExigido = false,
  ): Promise<{
    ok: true;
    horario: number;
    situacao: 'A' | 'N';
    repetida: boolean;
    avisos: string[];
    mensagem: string;
  }> {
    const v = await this.vinculo(s);
    if (!v.vinculo || !podeChecar(v.categoria))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Checagem',
        'A checagem é da enfermagem: a sessão não tem o vínculo de enfermeiro ou técnico.',
        {
          codigo: 'categoria-nao-checa',
        },
      );
    const p = await this.apoios.parametros(s, this.unidadeDaSessao(s));
    const h = await this.servico.horarioComEstado(s.porta, horario, p);
    if (!h.internado)
      throw new ErroProblema('nao-encontrado', 404, 'Paciente', 'O paciente do horário não está internado.');
    if (
      e.horaReal &&
      !horaRealAceita({ horaReal: e.horaReal.slice(0, 16), agora: h.agora, prazoHoras: p.cacheHoras })
    )
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Hora do ato',
        'A hora real do ato é do futuro ou passou do prazo do aparelho.',
        {
          campos: ['horaReal'],
        },
      );
    // Regra 8: o servidor relê o horário; mudou desde a leitura (suspensão ou checagem em qualquer um dos dois
    // sistemas), o ato vira conflito visível, sem gravar.
    // A repetição do mesmo ato (a mesma chave) devolve o resultado original pelo executor; o ato novo sobre o horário
    // que mudou é recusado por ele e vira o conflito.
    const decisao = decidirSincronizacao({ situacaoLida: e.situacaoLida, situacaoAtual: h.lido.situacao });
    const liberacaoDose = await this.apoios.leituraDose.liberacao(s);
    const faixas =
      h.lido.tipo === 'glicemia' && h.lido.faixa === null
        ? await this.porta.faixasDoHorario(s.porta, h.lido)
        : [];
    const { gravacao, avisos } = this.servico.montarChecagem({
      h: decisao.gravar ? h.lido : { ...h.lido, situacao: e.situacaoLida },
      internado: h.internado,
      faixas,
      entrada: e,
      cbo: v.vinculo.cbo,
      agora: h.agora,
      p,
      doseObrigatoria: p.doseObrigatoria || liberacaoDose.ligada,
      conferente: await this.conferente(s, e),
      login: s.login,
    });
    try {
      const r = await this.apoios.checagem.executar(
        s,
        'enfermagem.checarAdministracao',
        aparelhoExigido ? { ...gravacao, sgh: { ...gravacao.sgh, aparelhoExigido } } : gravacao,
        e.desfecho === 'administrado' ? 'Administração checada.' : 'Não administração registrada.',
        chave ? { chaveIdempotencia: chave } : {},
      );
      this.avisos?.avisar(s.hospital);
      return {
        ok: true,
        horario,
        situacao: e.desfecho === 'administrado' ? 'A' : 'N',
        repetida: r.repetida,
        avisos,
        mensagem: r.mensagem,
      };
    } catch (x) {
      const codigo = x instanceof ErroProblema ? String((x.extras as { codigo?: string }).codigo ?? '') : '';
      const tipo = CONFLITOS[codigo];
      if (!tipo) throw x;
      const atual =
        (await this.porta.situacoes(s.porta, [horario]).catch(() => new Map())).get(horario) ?? '?';
      return this.abrirConflito(
        s,
        horario,
        e,
        chave,
        tipo,
        String(atual),
        h.internado.paciente,
        h.agora,
        aparelhoExigido,
      );
    }
  }

  /** Regra 8: nunca sobrescreve; o conflito fica visível e o enfermeiro e a farmácia são avisados (409). */
  private async abrirConflito(
    s: SessaoCadastro,
    horario: number,
    e: ChecarHorario,
    chave: string | null,
    tipo: 'suspenso' | 'jaChecado' | 'mudou',
    situacaoEncontrada: string,
    paciente: number,
    agora: string,
    aparelhoExigido: boolean,
  ): Promise<never> {
    const k = await this.apoios.checagem.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemConflitoRegistrado.codigo,
      P.administracaoChecar,
      (r: { id: number }) => ({ tabela: 'conflito_sincronizacao', id: String(r.id), paciente }),
      (g) =>
        g.registrarConflito({
          horario,
          paciente,
          chave: (chave ?? String(s.req.headers['idempotency-key'] ?? `conflito-${horario}`)).slice(0, 80),
          tipo,
          situacaoEncontrada: situacaoEncontrada || '?',
          desfechoTentado: e.desfecho === 'administrado' ? 'administrado' : 'naoAdministrado',
          horaReal: `${(e.horaReal ?? agora).slice(0, 16)}:00`,
          dispositivo: e.dispositivo,
          aparelhoExigido,
          usuario: s.login,
        }),
    );
    this.avisos?.avisar(s.hospital);
    const codigo =
      tipo === 'suspenso'
        ? 'horario-suspenso'
        : tipo === 'jaChecado'
          ? 'horario-ja-checado'
          : 'horario-mudou';
    throw new ErroProblema('recusa-de-negocio', 409, 'Conflito', MENSAGENS_ENFERMAGEM.horarioMudou, {
      codigo,
      conflito: k.id,
    });
  }

  @Post('horarios/:id/checar')
  @HttpCode(200)
  @Permissao(P.administracaoChecar)
  @AuditadoNoHandler(
    'enfermagem.checarAdministracao pelo executor (trilha na mesma transação); o conflito em SGH_ com a trilha',
  )
  async checarHorario(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaChecarHorario, b);
    const exigido = e.origemOffline ? await this.exigirAparelho(s, e.dispositivo ?? '') : false;
    return this.checar(s, idDaRota(id), e, null, exigido);
  }

  @Post('horarios/:id/estornar')
  @HttpCode(200)
  @Permissao(P.administracaoEstornar)
  @AuditadoNoHandler(
    'enfermagem.estornarChecagem pelo executor (o horário volta a não checado, o histórico e o pedido em SGH_ com a trilha na mesma transação)',
  )
  async estornar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaEstornarChecagem, b);
    const v = await this.vinculo(s);
    if (!v.vinculo || !podeChecar(v.categoria))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Estorno',
        'O estorno da checagem é da enfermagem: a sessão não tem o vínculo de enfermeiro ou técnico.',
        { codigo: 'categoria-nao-checa' },
      );
    const p = await this.apoios.parametros(s, this.unidadeDaSessao(s));
    const h = await this.servico.horarioComEstado(s.porta, idDaRota(id), p);
    if (h.lido.situacao !== 'A' && h.lido.situacao !== 'N')
      throw new ErroProblema('recusa-de-negocio', 409, 'Estorno', 'O horário não está checado.', {
        codigo: 'horario-nao-checado',
      });
    // W1-08: a correção da checagem é o estorno como fato novo (COFEN 564): o executor volta o horário a "P", grava o
    // retrato no histórico e o pedido com o motivo em SGH_; a dose que já baixou estoque é recusada (409
    // estoque-baixado) até a tela oferecer a devolução ou o estorno com a devolução pendente.
    const r = await this.apoios.checagem.executar(
      s,
      'enfermagem.estornarChecagem',
      {
        horario: h.lido.id,
        paciente: h.tela.paciente,
        cbo: v.vinculo.cbo,
        motivo: e.motivo,
        justificativa: e.justificativa,
        devolucaoPendente: e.devolucaoPendente,
      },
      e.devolucaoPendente
        ? MENSAGENS_ENFERMAGEM.estornoComDevolucaoPendente
        : MENSAGENS_ENFERMAGEM.estornoGravado,
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      horario: h.lido.id,
      situacao: 'P' as const,
      devolucaoPendente: r.resultado['devolucaoPendente'] === true,
      repetida: r.repetida,
      mensagem: r.mensagem,
    };
  }

  @Post('horarios/:id/infusao')
  @HttpCode(201)
  @Permissao(P.administracaoChecar)
  @AuditadoNoHandler(
    'evento da infusão em horario_administracao_evento com a trilha_auditoria na mesma transação',
  )
  async infusao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaEventoInfusao, b);
    const p = await this.apoios.parametros(s, this.unidadeDaSessao(s));
    const h = await this.servico.horarioComEstado(s.porta, idDaRota(id), p);
    if (!h.lido.infusao)
      throw new ErroProblema('recusa-de-negocio', 409, 'Infusão', 'O horário não é de infusão contínua.', {
        codigo: 'nao-e-infusao',
      });
    const anteriores = await this.porta.eventosInfusao(s.porta, [h.lido.id]);
    const horaReal = (e.horaReal ?? h.agora).slice(0, 16);
    const problema = conferirEventoInfusao({
      anteriores: anteriores.map((x) => ({ ...x, evento: x.evento as never })),
      evento: e.evento as never,
      velocidadeMlH: e.velocidadeMlH ?? (e.evento === 'inicio' ? h.lido.infusao.velocidadeMlH : null),
      velocidadeAjustavel: p.alterarVelocidade && h.lido.infusao.ajustavel,
      horaReal,
    });
    if (problema)
      throw new ErroProblema('recusa-de-negocio', 409, 'Infusão', problema, {
        codigo: 'infusao-fora-de-ordem',
      });
    const volume =
      e.volumeInfundidoMl ??
      (e.evento === 'fim' || e.evento === 'trocaBolsa'
        ? volumeEstimado(
            anteriores.map((x) => ({ ...x, evento: x.evento as never })),
            horaReal,
          )
        : null);
    const ev = await this.apoios.checagem.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemInfusaoEvento.codigo,
      P.administracaoChecar,
      (r: number) => ({ tabela: 'horario_administracao_evento', id: String(r), paciente: h.tela.paciente }),
      (g) =>
        g.gravarEventoInfusao({
          horario: h.lido.id,
          solucao: h.lido.infusao?.solucao ?? null,
          paciente: h.tela.paciente,
          evento: e.evento,
          velocidadeMlH:
            e.velocidadeMlH ?? (e.evento === 'inicio' ? (h.lido.infusao?.velocidadeMlH ?? null) : null),
          volumeMl: volume,
          observacao: e.observacao,
          horaReal: `${horaReal}:00`,
          usuario: s.login,
        }),
    );
    return { ok: true, evento: ev, volumeInfundidoMl: volume, mensagem: 'Evento da infusão registrado.' };
  }

  @Get('aprazamento')
  @Permissao(P.horarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async propostas(@Query('unidade') unidade: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const u = unidadeDe(unidade);
    const itens = await this.servico.propostas(s.porta, u);
    const liberado = await this.porta.podeGravar(s.porta, 'enfermagem.aprazarHorario');
    req.sghAlvo = { tabelaAlvo: 'horario_administracao', chaveNaturalAlvo: `aprazamento:${u}:${itens.length}` };
    return {
      unidade: u,
      itens,
      gravaNoHorario: liberado.pode,
      motivo: liberado.pode ? null : liberado.motivo,
    };
  }

  @Post('aprazamento')
  @HttpCode(200)
  @Permissao(P.horarioAprazar)
  @AuditadoNoHandler(
    'enfermagem.aprazarHorario pelo executor, um horário por vez (reaprazar substitui a hora); depois a confirmação em horario_administracao_evento com a trilha_auditoria',
  )
  async aprazar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAprazamento, b);
    const v = await this.vinculo(s);
    if (!podeAprazar(v.categoria))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Aprazamento',
        'O aprazamento é ato do enfermeiro (o técnico executa e checa).',
        {
          codigo: 'categoria-nao-apraza',
        },
      );
    for (const [k, x] of e.itens.entries()) {
      const problema = conferirAcaoAprazamento({
        acao: x.acao,
        proposto: x.proposto,
        confirmado: x.confirmado,
        motivo: x.motivo,
      });
      if (problema)
        throw new ErroProblema('entrada-invalida', 422, 'Aprazamento', problema, { campos: [`itens.${k}`] });
    }
    const lidos = await Promise.all(e.itens.map((x) => this.porta.horario(s.porta, x.horario)));
    const internados = new Map<number, number>();
    for (const h of lidos) {
      if (!h) throw new ErroProblema('nao-encontrado', 404, 'Horário não encontrado');
      if (h.situacao !== 'P')
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Aprazamento',
          'Um dos horários já foi checado ou suspenso.',
          {
            codigo: 'horario-mudou',
          },
        );
      if (!internados.has(h.atendimento))
        internados.set(h.atendimento, (await this.porta.internado(s.porta, h.atendimento))?.paciente ?? 0);
    }
    // W1-08: o aprazamento grava no horário da prescrição (um ato do executor por horário, cada um com a sua chave
    // derivada da do pedido: repetir o pedido devolve o resultado de cada um). O registro da proposta confirmada em
    // horario_administracao_evento vem depois, com os horários que o banco aceitou.
    const chave = contextoOperacao(s, 'enfermagem.aprazarHorario').chaveIdempotencia.slice(0, 72);
    let gravados = 0;
    for (const [k, x] of e.itens.entries()) {
      const h = lidos[k]!;
      await this.apoios.aprazamento.executar(
        s,
        'enfermagem.aprazarHorario',
        {
          horario: h.id,
          item: h.item,
          prescricao: h.prescricao,
          paciente: internados.get(h.atendimento) ?? 0,
          cbo: v.vinculo?.cbo ?? 0,
          acao: x.acao,
          confirmado: x.acao === 'suprimir' ? null : (x.confirmado ?? x.proposto).slice(0, 16),
          motivo: x.motivo,
        },
        MENSAGENS_ENFERMAGEM.aprazamentoGravado,
        { chaveIdempotencia: `${chave}-a${k}` },
      );
      gravados++;
    }
    const ids = await this.apoios.aprazamento.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemHorarioAprazado.codigo,
      P.horarioAprazar,
      (r: number[]) => ({
        tabela: 'horario_administracao_evento',
        id: String(r[0] ?? ''),
        chave: `${r.length} horario(s)`,
      }),
      async (g) => {
        const r: number[] = [];
        for (const [k, x] of e.itens.entries()) {
          const h = lidos[k]!;
          r.push(
            await g.gravarAprazamento({
              horario: h.id,
              item: h.item,
              paciente: internados.get(h.atendimento) ?? 0,
              acao: x.acao,
              previsto: `${h.previsto}:00`,
              proposto: `${x.proposto.slice(0, 16)}:00`,
              confirmado: x.confirmado ? `${x.confirmado.slice(0, 16)}:00` : null,
              motivo: x.motivo,
              usuario: s.login,
            }),
          );
        }
        return r;
      },
    );
    return { ok: true, registrados: ids.length, gravados, mensagem: MENSAGENS_ENFERMAGEM.aprazamentoGravado };
  }

  @Get('conflitos')
  @Permissao(P.administracaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async conflitos(@Query('abertos') abertos: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const ks = await this.porta.conflitos(s.porta, { abertos: abertos !== '0' });
    const unidades = await this.porta.unidades(s.porta);
    const nomes = new Map<number, string>();
    for (const u of unidades)
      for (const i of await this.porta.internados(s.porta, u.unidade)) nomes.set(i.paciente, i.nome);
    req.sghAlvo = { tabelaAlvo: 'conflito_sincronizacao', chaveNaturalAlvo: `conflitos:${ks.length}` };
    return ks.map((k) => ({ ...k, pacienteNome: nomes.get(k.paciente) ?? null }));
  }

  @Post('conflitos/:id/resolver')
  @HttpCode(200)
  @Permissao(P.conflitoResolver)
  @AuditadoNoHandler('a resolução em conflito_sincronizacao com a trilha_auditoria na mesma transação')
  async resolver(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaResolverConflito, b);
    const k = await this.apoios.checagem.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemConflitoResolvido.codigo,
      P.conflitoResolver,
      { tabela: 'conflito_sincronizacao', id },
      (g) =>
        g.resolverConflito({
          id: idDaRota(id),
          resolucao: e.resolucao,
          observacao: e.observacao,
          usuario: s.login,
        }),
    );
    this.avisos?.avisar(s.hospital);
    return { ok: true, conflito: k, mensagem: 'Conflito resolvido.' };
  }

  /** Regra 8: os atos sem rede, na ordem da hora real, cada um com a chave dele (repetido devolve o mesmo). */
  @Post('sincronizar')
  @HttpCode(200)
  @Permissao(P.administracaoChecar)
  @AuditadoNoHandler('cada ato pela sua gravação (executor ou SGH_) com a trilha na mesma transação')
  async sincronizar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaSincronizar, b);
    const exigido = await this.exigirAparelho(s, e.dispositivo);
    const ordem = semRepetidos(
      ordemDeEnvio(
        e.atos.map((a, k) => ({
          ...a,
          sequencia: k,
          horaReal:
            a.tipo === 'checagem'
              ? (a.checagem.horaReal ?? '')
              : a.tipo === 'sinal'
                ? (a.sinal.horaReal ?? '')
                : a.horaReal,
        })),
      ),
    );
    const resultados: {
      chave: string;
      tipo: string;
      ok: boolean;
      codigo: string | null;
      mensagem: string;
      conflito?: number;
    }[] = [];
    for (const a of ordem as (AtoOffline & { sequencia: number })[]) {
      try {
        if (a.tipo === 'checagem') {
          const r = await this.checar(
            s,
            a.horario,
            { ...a.checagem, origemOffline: true, dispositivo: e.dispositivo },
            a.chave,
            exigido,
          );
          resultados.push({
            chave: a.chave,
            tipo: a.tipo,
            ok: true,
            codigo: r.repetida ? 'repetido' : null,
            mensagem: r.mensagem,
          });
        } else if (a.tipo === 'sinal') {
          // A rota pede a permissão de checar; o sinal vital pede a dele, como na rota online.
          await exigir(s, P.sinalCriar, this.trilha);
          // O reenvio do mesmo ato (a mesma chave) devolve o sinal gravado da primeira vez, sem gravar de novo.
          const sa = sessaoComAto(s, { paciente: a.paciente, sinal: a.sinal }, a.chave, ':sinal');
          const id = await this.registrarSinal(sa, a.paciente, { ...a.sinal, origemOffline: true });
          resultados.push({
            chave: a.chave,
            tipo: a.tipo,
            ok: true,
            codigo: atoDe(sa.porta)?.repetida ? 'repetido' : null,
            mensagem: `Sinal vital registrado (${id}).`,
          });
        } else {
          const id = await this.apoios.checagem.sgh(
            s,
            EVENTOS_AUDITAVEIS.enfermagemAnotacaoRegistrada.codigo,
            P.administracaoChecar,
            (r: number) => ({ tabela: 'afericao', id: String(r), paciente: a.paciente }),
            (g) =>
              g.gravarRespostaExt({
                registro: 0,
                paciente: a.paciente,
                componente: 'anexo',
                chave: `anotacao:${a.chave}`.slice(0, 60),
                valor: JSON.stringify({ texto: a.texto, horaReal: a.horaReal, atendimento: a.atendimento }),
                referencia: null,
                usuario: s.login,
              }),
          );
          resultados.push({
            chave: a.chave,
            tipo: a.tipo,
            ok: true,
            codigo: null,
            mensagem: `Anotação registrada (${id}).`,
          });
        }
      } catch (x) {
        const extras = x instanceof ErroProblema ? (x.extras as { codigo?: string; conflito?: number }) : {};
        resultados.push({
          chave: a.chave,
          tipo: a.tipo,
          ok: false,
          codigo:
            extras.codigo ??
            (x instanceof ErroProblema && x.tipo === 'sem-permissao' ? 'sem-permissao' : 'erro'),
          mensagem: x instanceof ErroProblema ? (x.detalhe ?? x.titulo) : 'Falha ao sincronizar o ato.',
          ...(extras.conflito ? { conflito: extras.conflito } : {}),
        });
      }
    }
    await this.apoios.checagem
      .sgh(
        s,
        EVENTOS_AUDITAVEIS.enfermagemDispositivoAlterado.codigo,
        P.administracaoChecar,
        { tabela: 'aparelho_beira_leito', chave: 'sincronismo' },
        (g) => g.marcarSincronismo({ identificador: e.dispositivo }),
      )
      .catch(() => false);
    return {
      ok: resultados.every((r) => r.ok),
      resultados,
      conflitos: resultados.filter((r) => r.conflito).length,
    };
  }

  /**
   * POL-3 (enfermagem.aparelhoAutorizado): ligada, o lote sem rede só vale de aparelho autorizado e ativo na lista
   * de aparelhos (retirado deixa de enviar; a recusa vai à trilha). Desligada, o motivo aparece na tela de aparelhos.
   */
  private async exigirAparelho(s: SessaoCadastro, identificador: string): Promise<boolean> {
    if (!(await this.apoios.aparelho.liberacao(s)).ligada) return false;
    if (await this.porta.dispositivoAutorizado(s.porta, identificador)) return true;
    await this.trilha
      .registrar({
        evento: EVENTOS_AUDITAVEIS.permissaoNegada.codigo,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req),
        correlacao: correlacaoDaRequisicao(s.req, 'negada'),
        recurso: 'enfermagem.aparelhoAutorizado',
        resultado: 'falha',
      })
      .catch(() => undefined);
    throw new ErroProblema(
      'sem-permissao',
      403,
      'Aparelho não autorizado',
      'Este aparelho não está autorizado ao modo beira do leito. Peça à supervisão de enfermagem para autorizá-lo na lista de aparelhos.',
      { codigo: 'aparelho-nao-autorizado' },
    );
  }

  private async registrarSinal(
    s: SessaoCadastro,
    paciente: number,
    x: {
      atendimento: number | null;
      tipo: string;
      valor: number;
      metodo: string | null;
      confirmadoForaDaFaixa: boolean;
      horaReal: string | null;
      origemOffline: boolean;
      observacao: string | null;
    },
  ): Promise<number> {
    const v = validarSinal({ tipo: x.tipo, valor: x.valor, confirmadoForaDaFaixa: x.confirmadoForaDaFaixa });
    if (!v.ok)
      throw new ErroProblema('entrada-invalida', 422, 'Sinal vital', v.mensagem, {
        codigo: v.codigo,
        campos: ['valor'],
      });
    const agora = (await this.porta.relogio(s.porta)).slice(0, 16);
    const hora = (x.horaReal ?? agora).slice(0, 16);
    if (!horaRealAceita({ horaReal: hora, agora, prazoHoras: 24 }))
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Sinal vital',
        'A hora do sinal é do futuro ou de mais de 24 horas.',
        {
          campos: ['horaReal'],
        },
      );
    return this.apoios.sinais.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemSinalRegistrado.codigo,
      P.sinalCriar,
      (r: number) => ({ tabela: 'afericao_valor', id: String(r), paciente }),
      (g) =>
        g.gravarSinal({
          paciente,
          atendimento: x.atendimento,
          horario: null,
          tipo: x.tipo,
          valor: x.valor,
          unidade: v.unidade,
          metodo: x.metodo,
          foraDaFaixa: v.foraDaFaixa,
          horaReal: `${hora}:00`,
          origemOffline: x.origemOffline,
          observacao: x.observacao,
          usuario: s.login,
        }),
    );
  }

  @Get('pacientes/:paciente/sinais-vitais')
  @Permissao(P.sinalLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async sinais(
    @Param('paciente') paciente: string,
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SinaisVitaisDoPaciente> {
    const s = sessaoDe(req);
    const id = idDaRota(paciente);
    const agora = (await this.porta.relogio(s.porta)).slice(0, 16);
    const d = de && DATA.test(de) ? `${de}T00:00` : somarMinutos(agora, -72 * 60);
    const a = ate && DATA.test(ate) ? `${ate}T23:59` : somarMinutos(agora, 60);
    const [r, lab] = await Promise.all([
      this.porta.sinais(s.porta, { paciente: id, de: d, ate: a }),
      this.porta.laboratorio(s.porta, { paciente: id, de: d, ate: a }).catch(() => []),
    ]);
    req.sghAlvo = { paciente: id, tabelaAlvo: 'afericao_valor' };
    const substituidos = new Map(
      r.itens.filter((x) => x.anterior !== null).map((x) => [x.anterior as number, x.id]),
    );
    return {
      paciente: id,
      de: d,
      ate: a,
      sinais: r.itens.map((x) => ({
        id: x.id,
        paciente: x.paciente,
        atendimento: x.atendimento,
        tipo: x.tipo as TipoSinalVital,
        valor: x.valor,
        unidade: x.unidade || SINAIS_VITAIS[x.tipo as TipoSinalVital]?.unidade || '',
        metodo: x.metodo,
        horaReal: x.horaReal,
        usuario: x.usuario,
        foraDaFaixa: x.foraDaFaixa,
        versao: x.versao,
        substituidoPor: substituidos.get(x.id) ?? null,
        justificativa: x.justificativa,
        horario: x.horario,
      })),
      laboratorio: lab,
      cortada: r.cortada,
    };
  }

  @Post('pacientes/:paciente/sinais-vitais')
  @HttpCode(201)
  @Permissao(P.sinalCriar)
  @AuditadoNoHandler('os sinais em afericao_valor com a trilha_auditoria na mesma transação')
  async registrarSinais(
    @Param('paciente') paciente: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const e = corpo(esquemaSinaisVitais, b);
    const ids: number[] = [];
    for (const [i, x] of e.sinais.entries())
      ids.push(await this.registrarSinal(sessaoComAto(s, x, null, `:sinal${i}`), idDaRota(paciente), x));
    this.avisos?.avisar(s.hospital);
    // M45 (etapa 2, regra 1): a aferição com os sete parâmetros do NEWS2 registra o escore (sem a chave dos escores ou
    // sem a permissão, os sinais ficam registrados e o NEWS2 não; a resposta diz por quê).
    const news2 = await this.news2DaAfericao(s, idDaRota(paciente), e.sinais, ids);
    return {
      ok: true,
      sinais: ids,
      mensagem: ids.length === 1 ? 'Sinal vital registrado.' : 'Sinais vitais registrados.',
      news2,
    };
  }

  private async news2DaAfericao(
    s: SessaoCadastro,
    paciente: number,
    sinais: readonly { atendimento: number | null; tipo: string; valor: number; horaReal?: string | null }[],
    ids: readonly number[],
  ): Promise<News2DaAfericao | null> {
    if (!this.escores) return null;
    const valores = new Map(sinais.map((x) => [x.tipo, x.valor]));
    if (!PARAMETROS_NEWS2.every((t) => valores.has(t))) return null;
    const atendimento = sinais.find((x) => x.atendimento)?.atendimento ?? null;
    if (!atendimento)
      return { id: null, motivo: 'Sem a internação do paciente, o NEWS2 não é calculado aqui.' };
    if (!s.pode('enfermagem.escore.registrar'))
      return { id: null, motivo: 'Seu perfil não registra escores: o NEWS2 não foi calculado.' };
    const l = await this.escores.apoio.liberacao(s);
    if (!l.ligada) return { id: null, motivo: l.motivo ?? 'Os escores estão em consulta.' };
    try {
      const i = await this.escores.internado(s, atendimento, paciente);
      const p = await this.escores.parametros(s);
      const v = (t: string) => valores.get(t) as number;
      const { registro, resultado } = await this.escores.servico.prepararAfericao(
        { c: s.porta, login: s.login },
        i,
        {
          paciente,
          atendimento,
          reg: i.numero,
          unidade: i.unidade,
          sinais: {
            fr: v('fr'),
            spo2: v('spo2'),
            o2: v('o2'),
            pas: v('pas'),
            fc: v('fc'),
            acvpu: v('acvpu'),
            temperatura: v('temperatura'),
          },
          escalaSpo2: 1,
          suspeitaInfeccao: false,
          confirmadoForaDaFaixa: true,
          aferidoEm: sinais[0]?.horaReal ? sinais[0].horaReal.slice(0, 16) : null,
        },
        p,
        { sinalVital: ids[0]! },
      );
      const r = await this.escores.apoio.sgh(
        s,
        EVENTOS_AUDITAVEIS.escoreRegistrado.codigo,
        'enfermagem.escore.registrar',
        (x: { id: number }) => ({
          tabela: 'aplicacao_escala',
          id: String(x.id),
          paciente,
          chave: `news2:v${registro.escore.versaoRegra}:${resultado.total}:${resultado.faixa}:${resultado.gatilho}`,
        }),
        (g) => g.registrarEscore(registro),
      );
      return {
        id: r.id,
        total: resultado.total,
        faixa: resultado.faixa,
        rotuloFaixa: resultado.rotuloFaixa,
        gatilho: resultado.gatilho,
        conduta: resultado.conduta,
        avisos: resultado.avisos,
      };
    } catch (x) {
      return {
        id: null,
        motivo: x instanceof ErroProblema ? (x.detalhe ?? x.titulo) : 'O NEWS2 não foi calculado.',
      };
    }
  }

  @Post('sinais-vitais/:id/retificar')
  @HttpCode(200)
  @Permissao(P.sinalRetificar)
  @AuditadoNoHandler('a versão nova em afericao_valor com a trilha_auditoria na mesma transação')
  async retificar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRetificarSinal, b);
    const sid = idDaRota(id);
    // O sinal é lido pelo id no servidor: o paciente da trilha, o tipo da validação e a versão vêm do banco.
    const lido = await this.porta.sinalPorId(s.porta, sid);
    if (!lido)
      throw new ErroProblema('nao-encontrado', 404, 'Sinal vital', 'O sinal vital não foi encontrado.');
    const c = conferirRetificacao({
      atual: { id: lido.id, versao: lido.versao, substituidoPor: lido.substituido ? 1 : null },
      justificativa: e.justificativa,
    });
    if (!c.ok)
      throw new ErroProblema('entrada-invalida', 422, 'Retificação', c.mensagem, {
        campos: ['justificativa'],
      });
    const v = validarSinal({
      tipo: lido.tipo,
      valor: e.valor,
      confirmadoForaDaFaixa: e.confirmadoForaDaFaixa,
    });
    if (!v.ok)
      throw new ErroProblema('entrada-invalida', 422, 'Sinal vital', v.mensagem, {
        codigo: v.codigo,
        campos: ['valor'],
      });
    const novo = await this.apoios.sinais.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemSinalRetificado.codigo,
      P.sinalRetificar,
      (r: number) => ({ tabela: 'afericao_valor', id: String(r), paciente: lido.paciente }),
      (g) =>
        g.retificarSinal({
          id: sid,
          versao: lido.versao,
          valor: e.valor,
          foraDaFaixa: v.ok ? v.foraDaFaixa : false,
          justificativa: e.justificativa,
          usuario: s.login,
        }),
    );
    return { ok: true, sinal: novo, mensagem: 'Sinal vital retificado (a versão anterior fica guardada).' };
  }

  @Get('plantao')
  @Permissao(P.plantaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemHorarioLido.codigo)
  async plantao(
    @Query('unidade') unidade: string | undefined,
    @Query('data') data: string | undefined,
    @Query('turno') turno: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const u = unidadeDe(unidade);
    const p = await this.apoios.parametros(s, u);
    const { linha, sugestoes } = await this.servico.pendencias(s.porta, u, p, turnoDe(data, turno));
    const passagens = await this.porta.passagens(s.porta, { unidade: u });
    const nomes = new Map(linha.pacientes.map((x) => [x.paciente, x.nome]));
    req.sghAlvo = { tabelaAlvo: 'passagem_turno', chaveNaturalAlvo: `plantao:${u}` };
    return {
      unidade: u,
      turno: linha.turno,
      sugestoes,
      passagens: passagens.map((x) => ({
        ...x,
        notas: x.notas.map((n) => ({
          atendimento: n.atendimento,
          paciente: n.paciente,
          pacienteNome: nomes.get(n.paciente) ?? null,
          partes: {
            situacao: n.situacao,
            historia: n.historia,
            avaliacao: n.avaliacao,
            recomendacao: n.recomendacao,
          },
          pendencias: n.pendencias,
        })),
      })),
    };
  }

  @Post('plantao')
  @HttpCode(201)
  @Permissao(P.plantaoPassar)
  @AuditadoNoHandler('a passagem em passagem_turno com a trilha_auditoria na mesma transação')
  async passar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaPassarPlantao, b);
    const problema = conferirPassagem({ passadoPor: s.login, recebedor: e.recebedor, notas: e.notas.length });
    if (problema)
      throw new ErroProblema('entrada-invalida', 422, 'Passagem de plantão', problema, {
        campos: ['recebedor'],
      });
    const id = await this.apoios.plantao.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemPlantaoPassado.codigo,
      P.plantaoPassar,
      (r: number) => ({
        tabela: 'passagem_turno',
        id: String(r),
        chave: `${e.unidade}:${e.data}:${e.turno}`,
      }),
      (g) =>
        g.passarPlantao({
          unidade: e.unidade,
          turno: e.turno,
          data: e.data,
          passadoPor: s.login,
          recebedor: e.recebedor.trim().toUpperCase(),
          notas: e.notas.map((n) => ({
            atendimento: n.atendimento,
            paciente: n.paciente,
            situacao: n.situacao,
            historia: n.historia,
            avaliacao: n.avaliacao,
            recomendacao: n.recomendacao,
            pendencias: n.pendencias,
          })),
        }),
    );
    return {
      ok: true,
      passagem: id,
      mensagem: 'Plantão passado: a responsabilidade passa com o aceite de quem recebe.',
    };
  }

  @Post('plantao/:id/aceite')
  @HttpCode(200)
  @Permissao(P.plantaoAceitar)
  @AuditadoNoHandler('o aceite em passagem_turno com a trilha_auditoria na mesma transação')
  async aceitar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAceitarPlantao, b);
    const [p] = await this.porta.passagens(s.porta, { id: idDaRota(id) });
    const problema = conferirAceite(p ?? null, s.login);
    if (problema)
      throw new ErroProblema('recusa-de-negocio', 409, 'Passagem de plantão', problema, {
        codigo: 'aceite-recusado',
      });
    await this.apoios.plantao.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemPlantaoAceito.codigo,
      P.plantaoAceitar,
      { tabela: 'passagem_turno', id },
      (g) =>
        g.responderPlantao({
          id: idDaRota(id),
          aceite: e.aceite,
          observacao: e.observacao,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      mensagem: e.aceite
        ? 'Plantão aceito: a responsabilidade é sua.'
        : 'Plantão recusado: a responsabilidade continua com quem passou.',
    };
  }

  /** W0-03: quem passou cancela a passagem, com o motivo, antes do aceite; depois do aceite, 409. */
  @Post('plantao/:id/cancelar')
  @HttpCode(200)
  @Permissao(P.plantaoPassar)
  @AuditadoNoHandler('o cancelamento em passagem_turno com a trilha_auditoria na mesma transação')
  async cancelarPlantao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarPassagemPlantao, b);
    const [p] = await this.porta.passagens(s.porta, { id: idDaRota(id) });
    const recusa = conferirCancelamento(p ?? null, s.login);
    if (recusa?.codigo === 'plantao-inexistente')
      throw new ErroProblema('nao-encontrado', 404, 'Passagem de plantão', recusa.problema);
    if (recusa)
      throw new ErroProblema('recusa-de-negocio', 409, 'Passagem de plantão', recusa.problema, {
        codigo: recusa.codigo,
      });
    await this.apoios.plantao.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemPlantaoCancelado.codigo,
      P.plantaoPassar,
      { tabela: 'passagem_turno', id },
      (g) => g.cancelarPlantao({ id: idDaRota(id), motivo: e.motivo, usuario: s.login }),
    );
    return { ok: true, mensagem: 'Passagem cancelada: a responsabilidade continua com quem passou.' };
  }

  @Get('dispositivos')
  @Permissao(P.dispositivoLer)
  dispositivos(@Req() req: RequisicaoAutorizada) {
    return this.porta.dispositivos(sessaoDe(req).porta);
  }

  @Post('dispositivos')
  @HttpCode(201)
  @Permissao(P.dispositivoEditar)
  @AuditadoNoHandler('o aparelho em aparelho_beira_leito com a trilha_auditoria na mesma transação')
  async novoDispositivo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDispositivoBeiraLeito, b);
    // O identificador do aparelho é gerado aqui (o tablet o guarda); o banco guarda só o hash.
    const identificador = `${e.tipo}-${crypto.randomUUID()}`;
    const id = await this.apoios.checagem.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemDispositivoAlterado.codigo,
      P.dispositivoEditar,
      (r: number) => ({ tabela: 'aparelho_beira_leito', id: String(r) }),
      (g) =>
        g.gravarDispositivo({
          nome: e.nome,
          unidade: e.unidade,
          tipo: e.tipo,
          identificador,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      dispositivo: id,
      identificador,
      mensagem: 'Aparelho autorizado ao modo beira do leito.',
    };
  }

  @Post('dispositivos/:id')
  @HttpCode(200)
  @Permissao(P.dispositivoEditar)
  @AuditadoNoHandler(
    'o aparelho (nome, unidade, situação) em aparelho_beira_leito com a trilha_auditoria na mesma transação',
  )
  async alterarDispositivo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarDispositivo, b);
    await this.apoios.checagem.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemDispositivoAlterado.codigo,
      P.dispositivoEditar,
      { tabela: 'aparelho_beira_leito', id },
      (g) =>
        g.alterarDispositivo({
          id: idDaRota(id),
          ativo: e.ativo,
          nome: e.nome,
          unidade: e.unidade?.toUpperCase(),
          usuario: s.login,
          motivo: e.motivo,
        }),
    );
    return {
      ok: true,
      mensagem:
        e.ativo === undefined
          ? 'Aparelho alterado.'
          : e.ativo
            ? 'Aparelho reativado.'
            : 'Aparelho retirado do modo beira do leito.',
    };
  }

  /** W0-03 (D-CRUD-ORFAOS): só o aparelho sem leituras vinculadas; com vínculo, 409 com a contagem. */
  @Post('dispositivos/:id/excluir')
  @HttpCode(200)
  @Permissao(P.dispositivoEditar)
  @AuditadoNoHandler(
    'a exclusão em aparelho_beira_leito com o retrato em trilha_auditoria e a trilha_auditoria juntos',
  )
  async excluirDispositivo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaExcluirDispositivo, b);
    await this.apoios.checagem.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemDispositivoExcluido.codigo,
      P.dispositivoEditar,
      { tabela: 'aparelho_beira_leito', id },
      (g) => g.excluirDispositivo({ id: idDaRota(id), motivo: e.motivo, usuario: s.login }),
    );
    return { ok: true, mensagem: 'Aparelho excluído (o retrato da linha fica guardado).' };
  }

  @Get('indicadores')
  @Permissao(P.horarioLer)
  async indicadores(@Query('unidade') unidade: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const u = unidadeDe(unidade);
    const p = await this.apoios.parametros(s, u);
    const l = await this.servico.linhaDoTempo(s.porta, u, p, {});
    const ids = l.horarios.map((h) => h.id);
    const atos = await this.porta.atos(s.porta, ids).catch(() => []);
    const checagens = atos.filter((a) => a.tipo === 'checagem');
    return {
      unidade: u,
      turno: l.turno,
      resumo: l.resumo,
      checagens: checagens.length,
      semPulseira: checagens.filter((a) => !a.pulseiraLida).length,
      duplaChecagem: checagens.filter((a) => a.conferente).length,
      semRede: checagens.filter((a) => a.origemOffline).length,
      conflitosAbertos: l.conflitosAbertos,
    };
  }

  @Get('eventos')
  @Permissao(P.horarioLer)
  eventos(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    if (!this.avisos) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    this.avisos.abrirCanal(req, res, sessaoDe(req).hospital, P.horarioLer, this.resolvedor, this.batidaMs);
  }

  /** Testes e telas: a permissão de agir conferida na rota e a da funcionalidade (exigir registra a negada). */
  async exigirPermissao(s: SessaoCadastro, codigo: string): Promise<void> {
    await exigir(s, codigo, this.trilha);
  }
}
