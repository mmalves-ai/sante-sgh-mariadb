// Central de comando assistencial (C2-053, 01-ADM L117), no banco próprio:
//   GET  /api/enfermagem/central-comando/quadro?unidade=        o quadro: pacientes na ordem de quem precisa primeiro,
//                                                                riscos abertos, metas das 24 h, NEWS2, protocolos
//                                                                abertos e alertas de fluxo medidos agora
//   GET  /api/enfermagem/central-comando/atendimentos/:id        a visão por paciente (histórico de riscos e metas)
//   POST /api/enfermagem/central-comando/apuracao                apura as regras agora (abre, mantém, encerra)
//   POST /api/enfermagem/central-comando/ocorrencias/:id         reconhece, resolve ou descarta (com a conduta)
//   POST /api/enfermagem/central-comando/metas                   inclui uma meta das 24 horas
//   POST /api/enfermagem/central-comando/metas/:id/encerramento  cumprida, não cumprida ou cancelada (justificativa)
//   GET  /api/enfermagem/central-comando/regras                  temas, regras, alertas e os combos da configuração
//   POST /api/enfermagem/central-comando/temas                   inclui um tema clínico
//   POST /api/enfermagem/central-comando/regras                  inclui a regra com os critérios
//   POST /api/enfermagem/central-comando/regras/:id/ativacao     liga ou desliga a regra (nunca apaga)
//   POST /api/enfermagem/central-comando/alertas                 inclui o limite de fluxo da unidade
//   POST /api/enfermagem/central-comando/alertas/:id/inativacao  inativa o limite com motivo
// Ler o quadro: quem lê os escores (enfermagem.escore.ler); apurar, tratar o risco e as metas: quem registra os escores
// (enfermagem.escore.registrar); configurar regras e limites: quem publica os protocolos (diretoria clínica). A trilha
// vai na mesma transação da gravação (Executor), e a mesma Idempotency-Key não grava duas vezes.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_ESCORES as P } from '@sgh/contratos';
import {
  CATEGORIAS_META_24H,
  GRAVIDADES_REGRA_RISCO,
  TIPOS_ALERTA_FLUXO,
  TIPOS_CRITERIO_RISCO,
} from '@sgh/dominio-enfermagem';
import { recusa } from '@sgh/nucleo';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  alertasFluxo,
  apoioCentral,
  apurarRiscosTx,
  ativarRegraTx,
  centralDoAtendimento,
  encerrarMetaTx,
  inativarAlertaFluxoTx,
  incluirAlertaFluxoTx,
  incluirMetaTx,
  incluirRegraTx,
  incluirTemaTx,
  passarOcorrenciaTx,
  quadroDaUnidade,
  regrasRisco,
  TABELAS_ALERTA_FLUXO,
  TABELAS_META_24H,
  TABELAS_OCORRENCIA_RISCO,
  TABELAS_REGRA_RISCO,
  temasClinicos,
} from './central-comando-propria.js';
import { sessaoComAto } from './gravacao-direta.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { PortaEnfermagemPropria } from './porta-propria.js';

const CONFIG_LER = 'recepcao.protocolo.ler';
const CONFIG_PUBLICAR = 'recepcao.protocolo.publicar';
const LIDO = EVENTOS_AUDITAVEIS.enfermagemProtocoloInternadoLido.codigo;
const id = z.number().int().positive();
const versao = z.number().int().positive();
const valor = z.number().min(-1_000_000).max(1_000_000).nullable().default(null);
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const motivo = z.string().trim().min(10).max(500);

export const esquemaTema = z
  .object({
    codigo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{2,30}$/),
    descricao: z.string().trim().min(3).max(150),
    categoria: z
      .enum(['risco_assistencial', 'seguranca_paciente', 'protocolo_gerenciado', 'gestao_leito'])
      .default('risco_assistencial'),
  })
  .strict();

export const esquemaCriterio = z
  .object({
    tipo: z.enum(TIPOS_CRITERIO_RISCO),
    exame: id.nullable().default(null),
    item: id.nullable().default(null),
    cid: z.string().trim().max(6).nullable().default(null),
    parametroVital: id.nullable().default(null),
    valorMinimo: valor,
    valorMaximo: valor,
    permanenciaMinimaHoras: z.number().int().min(0).max(8760).nullable().default(null),
    negado: z.boolean().default(false),
  })
  .strict();

export const esquemaRegra = z
  .object({
    codigo: z.string().trim().max(30),
    nome: z.string().trim().max(150),
    tema: id,
    fichaTecnica: z.string().trim().max(4000).nullable().default(null),
    paraTodaRede: z.boolean().default(false),
    gravidade: z.enum(GRAVIDADES_REGRA_RISCO),
    sexo: z.enum(['feminino', 'masculino', 'ambos']).default('ambos'),
    idadeMinimaDias: z.number().int().min(0).max(54_750).nullable().default(null),
    idadeMaximaDias: z.number().int().min(0).max(54_750).nullable().default(null),
    combinacao: z.enum(['todos', 'qualquer']).default('todos'),
    janelaHoras: z.number().int().min(1).max(720).nullable().default(24),
    vigenciaInicio: z.string().regex(DATA),
    vigenciaFim: z.string().regex(DATA).nullable().default(null),
    criterios: z.array(esquemaCriterio).min(1).max(20),
  })
  .strict();

export const esquemaAtivacao = z.object({ versao, ativo: z.boolean(), motivo }).strict();

export const esquemaAlerta = z
  .object({
    unidade: id.nullable().default(null),
    tipo: z.enum(TIPOS_ALERTA_FLUXO),
    unidadeLimite: z.enum(['minutos', 'percentual', 'quantidade']),
    limiteAtencao: z.number().min(0).max(100_000).nullable().default(null),
    limiteCritico: z.number().min(0).max(100_000),
    indicador: id.nullable().default(null),
  })
  .strict();

export const esquemaInativacao = z.object({ versao, motivo }).strict();

export const esquemaPassagem = z
  .object({
    acao: z.enum(['reconhecer', 'resolver', 'descartar']),
    versao,
    resolucao: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();

export const esquemaMeta = z
  .object({
    atendimento: id,
    categoria: z.enum(CATEGORIAS_META_24H),
    descricao: z.string().trim().max(500),
    prazoEm: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Data e hora inválidas.'),
    ocorrencia: id.nullable().default(null),
  })
  .strict();

export const esquemaEncerrarMeta = z
  .object({
    versao,
    situacao: z.enum(['cumprida', 'nao_cumprida', 'cancelada']),
    justificativa: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();

const trilha = (acao: 'inclusao' | 'alteracao', entidade: string, entidadeId: number | null) => ({
  estabelecimento: null,
  usuario: null,
  correlacao: null,
  acao,
  entidade,
  entidadeId,
});

@Controller('enfermagem/central-comando')
export class CentralComandoController {
  constructor(@Inject(PORTA_ENFERMAGEM) private readonly porta: PortaEnfermagem) {}

  private propria(): PortaEnfermagemPropria {
    if (!(this.porta instanceof PortaEnfermagemPropria))
      throw new ErroProblema(
        'recurso-desligado',
        501,
        'Central de comando assistencial',
        'Os riscos, os alertas de fluxo e as metas das 24 horas ficam só no banco próprio do cliente.',
        { codigo: 'pendente-modelo-proprio' },
      );
    return this.porta;
  }

  private usuario(req: RequisicaoAutorizada): number {
    const u = sessaoDe(req).porta.usuario;
    if (u === null) throw recusa('usuario-sem-conta', 'A gravação exige uma conta de usuário do cliente.');
    return u;
  }

  @Get('quadro')
  @Permissao(P.escoreLer)
  @Auditar(LIDO)
  async quadro(@Query('unidade') unidade: string | undefined, @Req() req: RequisicaoAutorizada) {
    req.sghAlvo = { tabelaAlvo: 'ocorrencia_risco_clinico' };
    const u = unidade ? idDaRota(unidade) : null;
    return this.propria().lerNoBanco(sessaoDe(req).porta, (l, est) => quadroDaUnidade(l, est, new Date(), u));
  }

  @Get('atendimentos/:id')
  @Permissao(P.escoreLer)
  @Auditar(LIDO)
  async atendimento(@Param('id') idRota: string, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    req.sghAlvo = { tabelaAlvo: 'ocorrencia_risco_clinico' };
    return this.propria().lerNoBanco(sessaoDe(req).porta, (l, est) =>
      centralDoAtendimento(l, est, n, new Date()),
    );
  }

  @Post('apuracao')
  @HttpCode(200)
  @Permissao(P.escoreRegistrar)
  @AuditadoNoHandler('as ocorrências em ocorrencia_risco_clinico com a trilha_auditoria na mesma transação')
  async apurar(@Req() req: RequisicaoAutorizada) {
    const usuario = this.usuario(req);
    const s = sessaoComAto(sessaoDe(req), { apuracao: true }, null, ':apuracao-risco');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.apurar-riscos',
      TABELAS_OCORRENCIA_RISCO,
      trilha('inclusao', 'ocorrencia_risco_clinico', null),
      (tx, est, an) => apurarRiscosTx(tx, est, an, usuario, new Date()),
    );
    return { ok: true, ...r, mensagem: 'Riscos apurados.' };
  }

  @Post('ocorrencias/:id')
  @HttpCode(200)
  @Permissao(P.escoreRegistrar)
  @AuditadoNoHandler('a situação da ocorrencia_risco_clinico com a trilha_auditoria na mesma transação')
  async passar(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaPassagem, b);
    const usuario = this.usuario(req);
    const s = sessaoComAto(sessaoDe(req), { ocorrencia: n, ...e }, null, ':ocorrencia-risco');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.passar-ocorrencia-risco',
      TABELAS_OCORRENCIA_RISCO,
      trilha('alteracao', 'ocorrencia_risco_clinico', n),
      (tx, est, an) => passarOcorrenciaTx(tx, est, an, usuario, n, e, new Date()),
    );
    return { ok: true, ...r, mensagem: 'Risco atualizado.' };
  }

  @Post('metas')
  @HttpCode(201)
  @Permissao(P.escoreRegistrar)
  @AuditadoNoHandler('a meta em meta_cuidado_24h com a trilha_auditoria na mesma transação')
  async incluirMeta(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaMeta, b);
    const s = sessaoComAto(sessaoDe(req), e, null, ':meta-24h');
    const r = await this.propria().gravarNaTransacao<{ id: number }>(
      s.porta,
      'enfermagem.incluir-meta-24h',
      TABELAS_META_24H,
      (f) => trilha('inclusao', 'meta_cuidado_24h', f.id),
      (tx, est, an) => incluirMetaTx(tx, est, an, e, new Date()),
    );
    return { ok: true, ...r, mensagem: 'Meta incluída.' };
  }

  @Post('metas/:id/encerramento')
  @HttpCode(200)
  @Permissao(P.escoreRegistrar)
  @AuditadoNoHandler('o encerramento da meta_cuidado_24h com a trilha_auditoria na mesma transação')
  async encerrarMeta(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaEncerrarMeta, b);
    const usuario = this.usuario(req);
    const s = sessaoComAto(sessaoDe(req), { meta: n, ...e }, null, ':encerrar-meta-24h');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.encerrar-meta-24h',
      TABELAS_META_24H,
      trilha('alteracao', 'meta_cuidado_24h', n),
      (tx, est, an) => encerrarMetaTx(tx, est, an, usuario, n, e, new Date()),
    );
    return { ok: true, ...r, mensagem: 'Meta encerrada.' };
  }

  @Get('regras')
  @Permissao(CONFIG_LER)
  async regras(@Req() req: RequisicaoAutorizada) {
    req.sghAlvo = { tabelaAlvo: 'regra_risco_clinico' };
    return this.propria().lerNoBanco(sessaoDe(req).porta, async (l, est) => ({
      temas: await temasClinicos(l),
      regras: await regrasRisco(l, est),
      alertas: await alertasFluxo(l, est),
      apoio: await apoioCentral(l, est),
    }));
  }

  @Post('temas')
  @HttpCode(201)
  @Permissao(CONFIG_PUBLICAR)
  @AuditadoNoHandler('o tema em tema_clinico com a trilha_auditoria na mesma transação')
  async incluirTema(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaTema, b);
    const s = sessaoComAto(sessaoDe(req), e, null, ':tema-clinico');
    const r = await this.propria().gravarNaTransacao<{ id: number }>(
      s.porta,
      'enfermagem.incluir-tema-clinico',
      TABELAS_REGRA_RISCO,
      (f) => trilha('inclusao', 'tema_clinico', f.id),
      (tx, _est, an) => incluirTemaTx(tx, an, e),
    );
    return { ok: true, ...r, mensagem: 'Tema incluído.' };
  }

  @Post('regras')
  @HttpCode(201)
  @Permissao(CONFIG_PUBLICAR)
  @AuditadoNoHandler(
    'a regra em regra_risco_clinico e os critérios com a trilha_auditoria na mesma transação',
  )
  async incluirRegra(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaRegra, b);
    const s = sessaoComAto(sessaoDe(req), e, null, ':regra-risco');
    const r = await this.propria().gravarNaTransacao<{ id: number }>(
      s.porta,
      'enfermagem.incluir-regra-risco',
      TABELAS_REGRA_RISCO,
      (f) => trilha('inclusao', 'regra_risco_clinico', f.id),
      (tx, est, an) => incluirRegraTx(tx, est, an, e),
    );
    return { ok: true, ...r, mensagem: 'Regra incluída: entra na próxima apuração.' };
  }

  @Post('regras/:id/ativacao')
  @HttpCode(200)
  @Permissao(CONFIG_PUBLICAR)
  @AuditadoNoHandler('a ativação da regra_risco_clinico com a trilha_auditoria na mesma transação')
  async ativarRegra(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaAtivacao, b);
    const s = sessaoComAto(sessaoDe(req), { regra: n, ...e }, null, ':ativar-regra-risco');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.ativar-regra-risco',
      TABELAS_REGRA_RISCO,
      trilha('alteracao', 'regra_risco_clinico', n),
      (tx, est, an) => ativarRegraTx(tx, est, an, n, e.versao, e.ativo, e.motivo),
    );
    return { ok: true, ...r, mensagem: e.ativo ? 'Regra ligada.' : 'Regra desligada.' };
  }

  @Post('alertas')
  @HttpCode(201)
  @Permissao(CONFIG_PUBLICAR)
  @AuditadoNoHandler('o limite em alerta_fluxo_unidade com a trilha_auditoria na mesma transação')
  async incluirAlerta(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAlerta, b);
    const s = sessaoComAto(sessaoDe(req), e, null, ':alerta-fluxo');
    const r = await this.propria().gravarNaTransacao<{ id: number }>(
      s.porta,
      'enfermagem.incluir-alerta-fluxo',
      TABELAS_ALERTA_FLUXO,
      (f) => trilha('inclusao', 'alerta_fluxo_unidade', f.id),
      (tx, est, an) => incluirAlertaFluxoTx(tx, est, an, e),
    );
    return { ok: true, ...r, mensagem: 'Limite de fluxo incluído.' };
  }

  @Post('alertas/:id/inativacao')
  @HttpCode(200)
  @Permissao(CONFIG_PUBLICAR)
  @AuditadoNoHandler('a inativação do alerta_fluxo_unidade com a trilha_auditoria na mesma transação')
  async inativarAlerta(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaInativacao, b);
    const s = sessaoComAto(sessaoDe(req), { alerta: n, ...e }, null, ':inativar-alerta-fluxo');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.inativar-alerta-fluxo',
      TABELAS_ALERTA_FLUXO,
      trilha('alteracao', 'alerta_fluxo_unidade', n),
      (tx, est, an) => inativarAlertaFluxoTx(tx, est, an, n, e.versao, e.motivo),
    );
    return { ok: true, ...r, mensagem: 'Limite inativado.' };
  }
}
