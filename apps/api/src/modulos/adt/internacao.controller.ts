// Internação (M21; ficha, seções 5 e 7): pré-internação, admissão, guias, trocas, procedimentos extras (leitura), alta
// em dois tempos (a decisão médica e a saída pela recepção) e impressos, sobre a internação do banco do cliente:
//   GET  /api/internacoes/gravacao                 as funcionalidades e cada ação gravam agora? (motivo)
//   GET  /api/internacoes/apoio                    convênios, especialidades, motivos de alta, acomodações, setores…
//   GET  /api/internacoes?termo&bloco              internados (com a alta médica decidida; auditado: lista com nomes)
//   GET  /api/internacoes/busca/medicos|cid?termo  buscas da admissão
//   GET  /api/internacoes/pre?situacao&problema    pré-internações pendentes e a lista de saneamento (auditado)
//   GET  /api/internacoes/pre/:paciente            a pré-internação do paciente que a admissão preenche
//   POST /api/internacoes/pre                      internacao.preInternar
//   POST /api/internacoes/pre/:paciente/corrigir   internacao.corrigirPreInternacao (saneamento)
//   GET  /api/internacoes/relatorios/incoerencias  contagens para o SAME e a coordenação de leitos
//   POST /api/internacoes                          internacao.internar (leito do mapa; recusa "leito ocupado")
//   GET  /api/internacoes/:reg                     a internação inteira (auditado)
//   POST /api/internacoes/:reg/trocas              internacao.trocar* (convênio, clínica, especialidade, médico)
//   POST /api/internacoes/:reg/guias               internacao.registrarGuia
//   POST /api/internacoes/:reg/alta-medica         alta médica no novo (ato médico: conselho ativo)
//   POST /api/internacoes/:reg/alta-medica/cancelar
//   POST /api/internacoes/:reg/alta                internacao.darAlta (a saída; depois da alta médica)
//   POST /api/internacoes/:reg/alta/cancelar       internacao.cancelarAlta (supervisor; confirma a senha)
//   POST /api/internacoes/:reg/excluir             internacao.excluirInternacao (supervisor; dupla confirmação)
//   POST /api/internacoes/:reg/impressos           ficha (PDF), pulseira e etiqueta (ZPL na fila da estação)
import { createHash } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioInternacaoTela,
  type DestinoAlta,
  esquemaCorrigirPreInternacao,
  esquemaDarAlta,
  esquemaEmitirImpressoInternacao,
  esquemaExcluirInternacao,
  esquemaPreInternar,
  esquemaRegistrarAltaMedica,
  esquemaRegistrarGuia,
  esquemaTrocarClinica,
  esquemaTrocarConvenio,
  esquemaTrocarEspecialidade,
  esquemaTrocarMedico,
  EVENTOS_AUDITAVEIS,
  type ImpressoGerado,
  type InternacaoDetalhe,
  type InternacoesLista,
  type PreInternacoes,
  type ResultadoInternacao,
} from '@sgh/contratos';
import {
  type MomentoDocumentoInternacao,
  MOMENTOS_DOCUMENTO_INTERNACAO,
  motivoCoerente,
  preencherMarcadores,
} from '@sgh/dominio-internacao';
import { enfileirarZpl, ErroZpl, zplEtiquetaProntuario, zplPulseira } from '@sgh/dominio-documento';
import {
  emitirComIdentificacao,
  IMPRESSAO_IDENTIFICACAO,
} from '../administracao/impressao-identificacao-emissao.js';
import type { ImpressaoIdentificacaoPropria } from '../administracao/impressao-identificacao-propria.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { exigir, idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/public-api.js';
import { corpo, dataDaConsulta } from '../exames/public-api.js';
import { CONFIGURACAO_M16, type ConfiguracaoM16, PARAMETROS_PADRAO } from '../internacao/public-api.js';
import { AVISOS_ATENDIMENTO, type AvisosAtendimento } from '../atendimento/public-api.js';
import { ApoiosAdt, ctxAdt, janelaOutroSistema } from './apoios.js';
import { AVISOS_ADT } from './simbolos.js';
import { type DadosImpressoInternacao, PORTA_ADT, type PortaAdt } from './porta.js';
import { ServicoAdt } from './servico.js';
import {
  esquemaCancelarAltaBanco,
  esquemaCancelarAltaMedicaBanco,
  esquemaInternarBanco,
} from './esquemas.js';

const TROCAS = {
  convenio: { op: 'internacao.trocarConvenio', esquema: esquemaTrocarConvenio, msg: 'Convênio trocado.' },
  clinica: { op: 'internacao.trocarClinica', esquema: esquemaTrocarClinica, msg: 'Clínica trocada.' },
  especialidade: {
    op: 'internacao.trocarEspecialidade',
    esquema: esquemaTrocarEspecialidade,
    msg: 'Especialidade trocada.',
  },
  medico: { op: 'internacao.trocarMedico', esquema: esquemaTrocarMedico, msg: 'Médico solicitante trocado.' },
} as const;

export async function intensivasDe(
  cfg: ConfiguracaoM16 | null,
  s: SessaoCadastro,
): Promise<readonly number[]> {
  if (!cfg) return PARAMETROS_PADRAO.intensivas;
  try {
    return (await cfg.parametros(s)).intensivas;
  } catch {
    return PARAMETROS_PADRAO.intensivas;
  }
}

/** Avisa o mapa e a higienização (e a fila do M20, que mostra o leito) depois da gravação feita. */
export async function avisandoAdt<T>(
  avisos: readonly (AvisosAtendimento | null)[],
  s: SessaoCadastro,
  p: Promise<T>,
): Promise<T> {
  const r = await p;
  for (const a of avisos) a?.avisar(s.hospital);
  return r;
}

@Controller('internacoes')
export class InternacaoController {
  readonly apoios: ApoiosAdt;
  private readonly servico: ServicoAdt;
  constructor(
    @Inject(PORTA_ADT) private readonly porta: PortaAdt,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(CONFIGURACAO_M16) private readonly cfg16: ConfiguracaoM16 | null = null,
    @Optional() @Inject(FONTE_DOCUMENTO) private readonly documento: FonteDocumento | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(AVISOS_ADT) private readonly avisos: AvisosAtendimento | null = null,
    @Optional()
    @Inject(AVISOS_ATENDIMENTO)
    private readonly avisosAtendimento: AvisosAtendimento | null = null,
    @Optional()
    @Inject(IMPRESSAO_IDENTIFICACAO)
    private readonly identificacao: ImpressaoIdentificacaoPropria | null = null,
  ) {
    this.apoios = new ApoiosAdt(porta, trilha, configuracao, cache);
    this.servico = new ServicoAdt(porta, janelaOutroSistema(configuracao));
  }

  private avisar<T>(s: SessaoCadastro, p: Promise<T>): Promise<T> {
    return avisandoAdt([this.avisos, this.avisosAtendimento], s, p);
  }

  @Get('gravacao')
  @Permissao('internacao.internacao.ler')
  gravacao(@Req() req: RequisicaoAutorizada) {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Get('apoio')
  @Permissao('internacao.internacao.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioInternacaoTela> {
    return this.porta.apoio(ctxAdt(sessaoDe(req)));
  }

  @Get('busca/medicos')
  @Permissao('internacao.internacao.ler')
  medicos(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.medicos(ctxAdt(sessaoDe(req)), (termo ?? '').slice(0, 60));
  }

  @Get('busca/cid')
  @Permissao('internacao.internacao.ler')
  cid(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.cid(ctxAdt(sessaoDe(req)), (termo ?? '').slice(0, 60));
  }

  @Get('relatorios/incoerencias')
  @Permissao('internacao.internacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.internacaoLida.codigo)
  incoerencias(@Req() req: RequisicaoAutorizada) {
    // Agregados e a lista (registro, prontuário e datas, como a leitura da internação) para o SAME e a coordenação.
    req.sghAlvo = { tabelaAlvo: 'internacao', idAlvo: 'incoerencias' };
    return this.porta.incoerencias(ctxAdt(sessaoDe(req)));
  }

  @Get('pre')
  @Permissao('internacao.pre.ler')
  @Auditar(EVENTOS_AUDITAVEIS.internacaoLida.codigo)
  pre(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<PreInternacoes> {
    req.sghAlvo = { tabelaAlvo: 'agendamento_internacao', idAlvo: 'lista' };
    return this.porta.preInternacoes(ctxAdt(sessaoDe(req)), {
      situacao: q['situacao'] === 'todas' ? 'todas' : 'pendente',
      ...(q['problema'] === 'saneamento' ? { problema: 'saneamento' as const } : {}),
    });
  }

  @Get('pre/:paciente')
  @Permissao('internacao.internacao.criar')
  @Auditar(EVENTOS_AUDITAVEIS.internacaoLida.codigo)
  async preDoPaciente(@Param('paciente') paciente: string, @Req() req: RequisicaoAutorizada) {
    const id = idDaRota(paciente);
    req.sghAlvo = { paciente: id, tabelaAlvo: 'agendamento_internacao', idAlvo: String(id) };
    return { pre: await this.porta.preDoPaciente(ctxAdt(sessaoDe(req)), id) };
  }

  @Post('pre')
  @HttpCode(201)
  @Permissao('internacao.pre.criar')
  @AuditadoNoHandler('internacao.preInternar pelo executor (trilha na mesma transação)')
  preInternar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const e = corpo(esquemaPreInternar, b);
    return this.apoios.adt.executar(
      sessaoDe(req),
      'internacao.preInternar',
      e,
      'Pré-internação agendada.',
    ) as Promise<ResultadoInternacao>;
  }

  @Post('pre/:paciente/corrigir')
  @HttpCode(200)
  @Permissao('internacao.pre.criar')
  @AuditadoNoHandler('internacao.corrigirPreInternacao pelo executor (trilha na mesma transação)')
  corrigirPre(@Param('paciente') paciente: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaCorrigirPreInternacao, { ...(b as object), paciente: idDaRota(paciente) });
    return this.apoios.adt.executar(
      sessaoDe(req),
      'internacao.corrigirPreInternacao',
      e,
      'Data da pré-internação corrigida.',
    ) as Promise<ResultadoInternacao>;
  }

  @Get()
  @Permissao('internacao.internacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.internacaoLida.codigo)
  async lista(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<InternacoesLista> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'internacao', idAlvo: 'lista' };
    // A situação: os internados (padrão), as com alta no período (o cancelamento da alta e as consultas depois da
    // saída) ou todas; o período da alta vai até 366 dias (padrão: os últimos 30).
    const situacao = q['situacao'] === 'alta' || q['situacao'] === 'todas' ? q['situacao'] : 'internados';
    const periodo: { altaDe?: string; altaAte?: string } = {};
    if (situacao !== 'internados') {
      const { hoje } = await this.porta.relogio(ctxAdt(s));
      const ate = dataDaConsulta(q['altaAte']) ?? hoje;
      const de =
        dataDaConsulta(q['altaDe']) ??
        new Date(Date.parse(`${ate}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
      if (de > ate || Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`) > 366 * 86_400_000)
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Período inválido',
          'Escolha um período da alta de até 366 dias.',
          { campos: ['altaDe', 'altaAte'] },
        );
      periodo.altaDe = de;
      periodo.altaAte = ate;
    }
    return this.servico.internacoes(ctxAdt(s), {
      ...(q['termo']?.trim() ? { termo: q['termo'].trim().slice(0, 60) } : {}),
      ...(q['bloco']?.trim() ? { bloco: q['bloco'].trim().slice(0, 5) } : {}),
      intensivas: await intensivasDe(this.cfg16, s),
      situacao,
      ...periodo,
    });
  }

  @Post()
  @HttpCode(201)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler('internacao.internar pelo executor (trilha na mesma transação)')
  async internar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaInternarBanco, b);
    // O leito no mapa operacional: bloqueado, em higienização ou reservado não admite a internação.
    // M44: a admissão vinda do NIR pode usar o leito reservado para a solicitação dela (só ela).
    const l = await this.servico.leitoNoMapa(
      ctxAdt(s),
      e.leito,
      await intensivasDe(this.cfg16, s),
      e.solicitacaoNir ?? null,
    );
    if (!l.admissivel)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Leito indisponível',
        l.motivo ?? 'Escolha outro leito.',
        {
          codigo:
            l.situacao === 'ocupado'
              ? 'leito-ocupado'
              : l.situacao === 'reservado'
                ? 'leito-reservado'
                : 'leito-indisponivel',
          campos: ['leito'],
        },
      );
    // Os atributos do leito no novo (sexo e faixa de idade): o leito feminino ou pediátrico não aceita qualquer um.
    await this.servico.exigirCompativel(ctxAdt(s), l, { paciente: e.paciente }, 'leito');
    return this.avisar(
      s,
      this.apoios.adt.executar(
        s,
        'internacao.internar',
        e,
        'Paciente internado.',
      ) as Promise<ResultadoInternacao>,
    );
  }

  @Get(':reg')
  @Permissao('internacao.internacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.internacaoLida.codigo)
  async detalhe(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada): Promise<InternacaoDetalhe> {
    const s = sessaoDe(req);
    const d = await this.servico.detalhe(ctxAdt(s), idDaRota(reg), await intensivasDe(this.cfg16, s));
    req.sghAlvo = { paciente: d.paciente, tabelaAlvo: 'internacao', idAlvo: String(d.reg) };
    return d;
  }

  @Post(':reg/trocas')
  @HttpCode(200)
  @Permissao('internacao.troca.criar')
  @AuditadoNoHandler('internacao.trocar* pelo executor (trilha na mesma transação)')
  trocar(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { tipo, ...resto } = (b ?? {}) as Record<string, unknown>;
    const t = TROCAS[String(tipo) as keyof typeof TROCAS];
    if (!t)
      throw new ErroProblema('entrada-invalida', 400, 'Troca inválida', 'Escolha o que trocar.', {
        campos: ['tipo'],
      });
    const e = corpo(t.esquema as typeof esquemaTrocarConvenio, { ...resto, internacao: idDaRota(reg) });
    const s = sessaoDe(req);
    return this.avisar(s, this.apoios.adt.executar(s, t.op, e, t.msg) as Promise<ResultadoInternacao>);
  }

  @Post(':reg/guias')
  @HttpCode(201)
  @Permissao('internacao.guia.editar')
  @AuditadoNoHandler('internacao.registrarGuia pelo executor (trilha na mesma transação)')
  guia(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaRegistrarGuia, { ...(b as object), internacao: idDaRota(reg) });
    return this.apoios.adt.executar(
      sessaoDe(req),
      'internacao.registrarGuia',
      e,
      'Guia registrada.',
    ) as Promise<ResultadoInternacao>;
  }

  @Post(':reg/alta-medica')
  @HttpCode(201)
  @Permissao('internacao.altaMedica.registrar')
  @AuditadoNoHandler('alta médica (alta_medica) com a trilha de auditoria na mesma transação')
  async altaMedica(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarAltaMedica, { ...(b as object), internacao: idDaRota(reg) });
    const prof = await this.porta.profissional(ctxAdt(s), s.login);
    if (!prof?.conselhoAtivo)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Ato médico',
        'A alta médica é ato médico: só médico com o conselho ativo registra.',
        { codigo: 'ato-medico' },
      );
    if (!motivoCoerente(e.motivo, e.destino))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Motivo e destino incoerentes',
        'O motivo de alta não combina com o destino.',
        {
          campos: ['motivo', 'destino'],
        },
      );
    const d = await this.servico.detalhe(ctxAdt(s), e.internacao, []);
    if (d.alta)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Internação com alta',
        'A internação já tem a saída.',
        { codigo: 'internacao-com-alta' },
      );
    const id = await this.apoios.adt.sgh(
      s,
      EVENTOS_AUDITAVEIS.internacaoAltaMedica.codigo,
      'internacao.altaMedica.registrar',
      (x: number) => ({ tabela: 'alta_medica', id: String(x), paciente: d.paciente }),
      (g) =>
        g.registrarAltaMedica({
          reg: d.reg,
          pront: d.prontuario,
          vinculo: prof.vinculo,
          motivo: e.motivo,
          destino: e.destino,
          sumarioAlta: e.sumarioAlta ?? null,
          previsaoSaida: e.previsaoSaida ?? null,
          observacao: e.observacao ?? null,
          usuario: s.login,
        }),
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      resultado: { altaMedica: id, reg: d.reg },
      repetida: false,
      mensagem: 'Alta médica registrada: a saída fica com a recepção.',
    };
  }

  @Post(':reg/alta-medica/cancelar')
  @HttpCode(200)
  @Permissao('internacao.altaMedica.registrar')
  @AuditadoNoHandler('cancelamento da alta médica (alta_medica) com a trilha de auditoria na mesma transação')
  async cancelarAltaMedica(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarAltaMedicaBanco, { ...(b as object), internacao: idDaRota(reg) });
    const prof = await this.porta.profissional(ctxAdt(s), s.login);
    if (!prof?.conselhoAtivo)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Ato médico',
        'Só médico com o conselho ativo cancela a alta médica.',
        {
          codigo: 'ato-medico',
        },
      );
    const id = await this.apoios.adt.sgh(
      s,
      EVENTOS_AUDITAVEIS.internacaoAltaMedica.codigo,
      'internacao.altaMedica.registrar',
      (x: number) => ({ tabela: 'alta_medica', id: String(x) }),
      (g) =>
        g.cancelarAltaMedica({
          reg: e.internacao,
          motivo: e.motivo,
          motivoCodigo: e.motivoCancelamento ?? null,
          usuario: s.login,
        }),
    );
    return { ok: true, resultado: { altaMedica: id }, repetida: false, mensagem: 'Alta médica cancelada.' };
  }

  @Post(':reg/alta')
  @HttpCode(200)
  @Permissao('internacao.alta.registrar')
  @AuditadoNoHandler('internacao.darAlta pelo executor (trilha na mesma transação)')
  async darAlta(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const internacao = idDaRota(reg);
    // A saída depois da alta médica (dois tempos): o médico e, sem outro, o motivo vêm da decisão registrada.
    const a = await this.porta.altaMedica(ctxAdt(s), internacao);
    if (!a)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sem alta médica',
        'A saída vem depois da alta médica: peça ao médico que registre a alta.',
        { codigo: 'sem-alta-medica' },
      );
    const bruto = (b ?? {}) as Record<string, unknown>;
    // O motivo é o da alta médica (D-ALTA-21); outro motivo da recepção só quando coerente com o destino que o médico
    // decidiu (ex.: "melhorado" e "curado" para o domicílio). O médico é sempre o da alta médica.
    const e = corpo(esquemaDarAlta, {
      ...bruto,
      motivo: bruto['motivo'] ?? a.motivo,
      medicoAlta: a.vinculo,
      internacao,
    });
    if (e.motivo !== a.motivo && !motivoCoerente(e.motivo, a.destino as DestinoAlta))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Motivo diferente da alta médica',
        'O motivo da saída não combina com o destino decidido na alta médica: use o motivo do médico ou peça que ele corrija a alta médica.',
        { codigo: 'motivo-incoerente', campos: ['motivo'] },
      );
    return this.avisar(
      s,
      this.apoios.adt.executar(
        s,
        'internacao.darAlta',
        e,
        'Saída registrada: o leito foi para a higienização.',
      ) as Promise<ResultadoInternacao>,
    );
  }

  @Post(':reg/alta/cancelar')
  @HttpCode(200)
  @Permissao('internacao.alta.cancelar')
  @AuditadoNoHandler('internacao.cancelarAlta pelo executor (trilha na mesma transação)')
  async cancelarAlta(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { senha, ...resto } = (b ?? {}) as Record<string, unknown>;
    const e = corpo(esquemaCancelarAltaBanco, { ...resto, internacao: idDaRota(reg) });
    await exigir(s, 'internacao.alta.cancelar', this.trilha);
    const reautenticadoEm = await this.reautenticar(req, senha);
    return this.avisar(
      s,
      this.apoios.supervisor.executar(
        s,
        'internacao.cancelarAlta',
        e,
        'Alta cancelada: o paciente voltou ao leito.',
        {
          reautenticadoEm,
        },
      ) as Promise<ResultadoInternacao>,
    );
  }

  @Post(':reg/excluir')
  @HttpCode(200)
  @Permissao('internacao.internacao.excluir')
  @AuditadoNoHandler('internacao.excluirInternacao pelo executor (trilha na mesma transação)')
  async excluir(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { senha, ...resto } = (b ?? {}) as Record<string, unknown>;
    const e = corpo(esquemaExcluirInternacao, { ...resto, internacao: idDaRota(reg) });
    await exigir(s, 'internacao.internacao.excluir', this.trilha);
    const reautenticadoEm = await this.reautenticar(req, senha);
    return this.avisar(
      s,
      this.apoios.supervisor.executar(
        s,
        'internacao.excluirInternacao',
        e,
        'Internação excluída com as contas, guias e períodos ligados.',
        {
          reautenticadoEm,
        },
      ) as Promise<ResultadoInternacao>,
    );
  }

  private async reautenticar(req: RequisicaoAutorizada, senha: unknown): Promise<number> {
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário e confirme a senha.',
      );
    return reautenticar(this.sessoes, this.resolvedor, req, typeof senha === 'string' ? senha : undefined);
  }

  @Get(':reg/impressos')
  @Permissao('internacao.impresso.emitir')
  async fichas(
    @Param('reg') reg: string,
    @Query('momento') momento: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const m = momentoDoImpresso(momento);
    return { momento: m, fichas: await this.porta.fichas(ctxAdt(sessaoDe(req)), idDaRota(reg), m) };
  }

  @Post(':reg/impressos')
  @HttpCode(201)
  @Permissao('internacao.impresso.emitir')
  @AuditadoNoHandler('impresso da internação com a linha na trilha')
  async impresso(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
    @Query('momento') momento?: string,
  ): Promise<ImpressoGerado> {
    const s = sessaoDe(req);
    const m = momentoDoImpresso(momento);
    const e = corpo(esquemaEmitirImpressoInternacao, { ...(b as object), internacao: idDaRota(reg) });
    if ((e.impresso === 'ficha') !== (e.formato === 'pdf'))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Formato indisponível',
        'Este impresso não sai neste formato.',
        {
          campos: ['formato'],
        },
      );
    await this.apoios.adt.exigirLiberacao(s);
    const d = await this.porta.impresso(ctxAdt(s), e.internacao);
    if (!d)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Internação não encontrada',
        'A internação não existe mais.',
      );
    let modelo: { modelo: number; nome: string; texto?: string } | null = null;
    let copias = e.copias;
    if (e.modelo !== undefined) {
      const f = (await this.porta.fichas(ctxAdt(s), d.reg, m)).find((x) => x.modelo === e.modelo);
      if (e.impresso !== 'ficha' || !f)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Ficha não configurada',
          'Esta ficha não está entre as que a configuração manda imprimir para esta internação.',
          { codigo: 'ficha-nao-configurada' },
        );
      modelo = { modelo: f.modelo, nome: f.nome, ...(f.texto ? { texto: f.texto } : {}) };
      // As cópias do documento são as da regra (ou do modelo sob demanda), não as digitadas.
      copias = f.copias;
    }
    // Pulseira e etiqueta: a 1ª impressão fica registrada e a reimpressão só sai com o motivo (01-ADM L79).
    const gerado = await emitirComIdentificacao(this.identificacao, s, { internacao: d.reg }, e, () =>
      e.formato === 'pdf' ? this.pdf(s, d, modelo) : this.zpl(s, d, e.impresso, e.copias),
    );
    await this.trilha.registrar({
      evento: EVENTOS_AUDITAVEIS.internacaoImpressoEmitido.codigo,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, 'impresso-internacao').slice(0, 64),
      recurso: 'internacao.impresso.emitir',
      resultado: 'sucesso',
      tabelaAlvo: 'internacao',
      idAlvo: String(d.reg),
      paciente: d.idPaciente,
      // O modelo emitido entra na chave: a tela confere o obrigatório já emitido daquela internação.
      chaveNaturalAlvo: `${e.impresso}${modelo ? `-${modelo.modelo}` : ''}:${m}:${copias}:${createHash('sha256').update(gerado.conteudo).digest('hex').slice(0, 16)}`,
    });
    return gerado;
  }

  private async pdf(
    s: SessaoCadastro,
    d: DadosImpressoInternacao,
    modelo: { modelo: number; nome: string; texto?: string } | null = null,
  ): Promise<ImpressoGerado> {
    const fonte = this.documento;
    if (!fonte)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'O serviço de emissão de documentos não está configurado.',
      );
    try {
      const r = await fonte.emissao.emitir({
        rede: s.rede,
        estabelecimento: s.hospital,
        modelo: modelo ? `internacao-ficha-${modelo.modelo}` : 'internacao-ficha',
        versaoModelo: '1',
        titulo: modelo?.nome || 'Ficha de internação',
        origem: { tipo: 'internacao', idLegado: d.reg },
        campos: [
          { rotulo: 'Paciente', valor: d.nome },
          { rotulo: 'Prontuário', valor: String(d.prontuario) },
          {
            rotulo: 'Nascimento',
            valor: d.nascimento ? d.nascimento.split('-').reverse().join('/') : 'Não informado',
          },
          { rotulo: 'Internação', valor: String(d.reg) },
          {
            rotulo: 'Entrada',
            valor: `${d.entrada.split('-').reverse().join('/')} ${d.hora.slice(0, 2)}:${d.hora.slice(2, 4)}`,
          },
          { rotulo: 'Leito', valor: d.leito },
          { rotulo: 'Convênio', valor: d.convenio },
          { rotulo: 'Médico assistente', valor: d.medico || 'Não informado' },
          // O texto do modelo escolhido pela regra de convênio e especialidade (F3.4, 04-INT linha 69).
          // Os campos variáveis ({paciente}, {leito}...) recebem os dados da internação na emissão.
          ...(modelo?.texto
            ? [{ rotulo: 'Documento', valor: preencherMarcadores(modelo.texto, valoresDoDocumento(d)) }]
            : []),
        ],
        autor: s.login,
      });
      return {
        impresso: 'ficha',
        formato: 'pdf',
        conteudo: Buffer.from(r.pdf).toString('base64'),
        nomeArquivo: modelo ? `ficha-${modelo.modelo}-${d.reg}.pdf` : `internacao-${d.reg}.pdf`,
        fila: null,
      };
    } catch {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'Não foi possível gerar o PDF agora: tente de novo.',
      );
    }
  }

  private async zpl(
    s: SessaoCadastro,
    d: DadosImpressoInternacao,
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
    } catch {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Fila de impressão indisponível',
        'Não foi possível mandar à impressora da estação agora: tente de novo.',
      );
    }
  }
}

/** O momento da emissão pela consulta (vazio: admissão); fora da lista: 400. */
function momentoDoImpresso(momento: string | undefined): MomentoDocumentoInternacao {
  const m = (momento || 'admissao') as MomentoDocumentoInternacao;
  if (!MOMENTOS_DOCUMENTO_INTERNACAO.includes(m))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Momento inválido',
      'Escolha admissão, prorrogação, transferência ou alta.',
      { campos: ['momento'] },
    );
  return m;
}

const dataBr = (iso: string) => iso.split('-').reverse().join('/');

/** Os valores dos campos variáveis do documento, a partir dos dados do impresso da internação. */
function valoresDoDocumento(d: DadosImpressoInternacao): Record<string, string | null> {
  const hoje = new Date().toISOString().slice(0, 10);
  let idade: string | null = null;
  if (d.nascimento) {
    const [a, mm, dd] = d.nascimento.split('-').map(Number);
    const [ha, hm, hd] = d.entrada.split('-').map(Number);
    idade = String(ha! - a! - (hm! < mm! || (hm === mm && hd! < dd!) ? 1 : 0));
  }
  return {
    paciente: d.nome,
    nome_social: d.nomeSocial ?? null,
    prontuario: String(d.prontuario),
    nascimento: d.nascimento ? dataBr(d.nascimento) : null,
    idade,
    convenio: d.convenio,
    leito: d.leito,
    medico: d.medico || null,
    internacao: String(d.reg),
    data_entrada: dataBr(d.entrada),
    hora_entrada: `${d.hora.slice(0, 2)}:${d.hora.slice(2, 4)}`,
    data_emissao: dataBr(hoje),
  };
}
