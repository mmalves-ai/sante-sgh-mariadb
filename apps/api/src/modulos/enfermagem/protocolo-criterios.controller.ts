// Critérios de entrada, etapas com meta e alerta de elegível dos protocolos gerenciados (C2-042, 03-PEP L134), no
// banco próprio:
//   GET  /api/enfermagem/protocolos-gerenciados                      os protocolos do estabelecimento
//   GET  /api/enfermagem/protocolos-gerenciados/elegiveis            o alerta: pacientes que atendem à entrada sem o
//                                                                    protocolo aberto (lista com nomes: leitura auditada)
//   GET  /api/enfermagem/protocolos-gerenciados/inclusoes            os protocolos abertos com as metas vencidas
//   GET  /api/enfermagem/protocolos-gerenciados/:id                  a definição: critérios, fórmula e etapas
//   POST /api/enfermagem/protocolos-gerenciados/:id/criterios        inclui um critério (diretoria clínica)
//   POST /api/enfermagem/protocolos-gerenciados/:id/formula          grava a fórmula de entrada
//   POST /api/enfermagem/protocolos-gerenciados/:id/etapas           inclui uma etapa com meta de tempo
//   POST /api/enfermagem/protocolos-gerenciados/:id/modelo           aplica o modelo de mercado (sepse, dor torácica, AVC)
//   POST /api/enfermagem/protocolos-gerenciados/criterios/:id/inativacao   inativa o critério com motivo (nunca apaga)
//   POST /api/enfermagem/protocolos-gerenciados/etapas/:id/meta      ajusta a meta da etapa (vale para as próximas)
//   GET  /api/enfermagem/protocolos-gerenciados/inclusoes/:id/etapas as etapas do paciente com o relógio de cada meta
//   POST /api/enfermagem/protocolos-gerenciados/inclusoes/:id/etapas inicia as etapas e guarda os critérios avaliados
//   POST /api/enfermagem/protocolos-gerenciados/etapas-paciente/:id/conclusao     conclui (meta atingida ou perdida)
//   POST /api/enfermagem/protocolos-gerenciados/etapas-paciente/:id/cancelamento  cancela a etapa opcional com motivo
// A trilha vai na mesma transação da gravação (Executor), e a mesma Idempotency-Key não grava duas vezes.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_PROTOCOLO_GERENCIADO_CODIGOS } from '@sgh/contratos';
import { TIPOS_ETAPA } from '@sgh/dominio-enfermagem';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { sessaoComAto } from './gravacao-direta.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { PortaEnfermagemPropria } from './porta-propria.js';
import {
  ajustarMetaEtapaTx,
  aplicarModeloTx,
  cancelarEtapaTx,
  concluirEtapaTx,
  definicaoProtocolo,
  elegiveisDoEstabelecimento,
  etapasDaInclusao,
  gravarFormulaTx,
  inativarCriterioTx,
  incluirCriterioTx,
  incluirEtapaTx,
  inclusoesAbertas,
  iniciarEtapasTx,
  protocolosGerenciados,
  TABELAS_CONFIG_PROTOCOLO,
  TABELAS_ETAPAS_INCLUSAO,
} from './protocolo-criterios-propria.js';

const G = PERMISSOES_PROTOCOLO_GERENCIADO_CODIGOS;
/** A definição dos protocolos gerenciados é a mesma do PA: lê e publica quem cuida dos protocolos (diretoria clínica). */
const DEFINICAO_LER = 'recepcao.protocolo.ler';
const DEFINICAO_PUBLICAR = 'recepcao.protocolo.publicar';
const LIDO = EVENTOS_AUDITAVEIS.enfermagemProtocoloInternadoLido.codigo;
const HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const id = z.number().int().positive();
const versao = z.number().int().positive();
const faixa = z.number().min(-100_000).max(100_000).nullable().default(null);
const dias = z.number().int().min(0).max(54_750).nullable().default(null);

export const esquemaCriterioProtocolo = z
  .object({
    finalidade: z.enum(['entrada', 'saida', 'sugestao']).default('entrada'),
    grupo: z.string().trim().max(60).nullable().default(null),
    categoria: z.enum(['sinal_vital', 'diagnostico', 'escala', 'idade']),
    campo: z.string().trim().max(60).nullable().default(null),
    termo: id.nullable().default(null),
    valorTexto: z.string().trim().max(500).nullable().default(null),
    valorMinimo: faixa,
    valorMaximo: faixa,
    sexo: z.enum(['todos', 'feminino', 'masculino']).default('todos'),
    idadeMinimaDias: dias,
    idadeMaximaDias: dias,
    validadeHoras: z.number().int().min(1).max(720).nullable().default(null),
    descricao: z.string().trim().min(3).max(500).nullable().default(null),
  })
  .strict();

export const esquemaFormulaProtocolo = z
  .object({ versao, formula: z.string().trim().max(4000).nullable().default(null) })
  .strict();

export const esquemaEtapaProtocolo = z
  .object({
    nome: z.string().trim().min(3).max(150),
    tipo: z.enum(TIPOS_ETAPA),
    metaMinutos: z.number().int().min(1).max(10_080).nullable().default(null),
    faixaEtaria: z.enum(['todas', 'adulto', 'pediatrico', 'neonatal', 'idoso']).default('todas'),
    obrigatoria: z.boolean().default(true),
  })
  .strict();

export const esquemaMetaEtapa = z
  .object({
    versao,
    metaMinutos: z.number().int().min(1).max(10_080).nullable(),
    obrigatoria: z.boolean(),
  })
  .strict();

export const esquemaInativarCriterio = z
  .object({ versao, motivo: z.string().trim().min(10).max(300) })
  .strict();

export const esquemaConcluirEtapa = z
  .object({
    versao,
    concluidaEm: z.string().regex(HORA).nullable().default(null),
    justificativa: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();

export const esquemaCancelarEtapa = z
  .object({ versao, motivo: z.string().trim().min(10).max(1000) })
  .strict();

const trilha = (
  acao: 'inclusao' | 'alteracao',
  entidade: string,
  entidadeId: number | null,
  extra: Record<string, unknown> = {},
) => ({ estabelecimento: null, usuario: null, correlacao: null, acao, entidade, entidadeId, ...extra });

@Controller('enfermagem/protocolos-gerenciados')
export class ProtocoloCriteriosController {
  constructor(@Inject(PORTA_ENFERMAGEM) private readonly porta: PortaEnfermagem) {}

  private propria(): PortaEnfermagemPropria {
    if (!(this.porta instanceof PortaEnfermagemPropria))
      throw new ErroProblema(
        'recurso-desligado',
        501,
        'Protocolos gerenciados',
        'Os critérios e as etapas dos protocolos gravam só no banco próprio do cliente.',
        { codigo: 'pendente-modelo-proprio' },
      );
    return this.porta;
  }

  private async agora(req: RequisicaoAutorizada): Promise<string> {
    return (await this.porta.relogio(sessaoDe(req).porta)).slice(0, 16);
  }

  @Get()
  @Permissao(DEFINICAO_LER)
  @Auditar(LIDO)
  async protocolos(@Req() req: RequisicaoAutorizada) {
    req.sghAlvo = { tabelaAlvo: 'protocolo_gerenciado' };
    const itens = await this.propria().lerNoBanco(sessaoDe(req).porta, (l, est) =>
      protocolosGerenciados(l, est),
    );
    return { itens };
  }

  @Get('elegiveis')
  @Permissao(G.protocoloPacienteLer)
  @Auditar(LIDO)
  async elegiveis(@Req() req: RequisicaoAutorizada) {
    req.sghAlvo = { tabelaAlvo: 'inclusao_protocolo_paciente' };
    const agora = await this.agora(req);
    const r = await this.propria().lerNoBanco(sessaoDe(req).porta, (l, est) =>
      elegiveisDoEstabelecimento(l, est, agora),
    );
    return { agora, ...r };
  }

  @Get('inclusoes')
  @Permissao(G.protocoloPacienteLer)
  @Auditar(LIDO)
  async inclusoes(@Req() req: RequisicaoAutorizada) {
    req.sghAlvo = { tabelaAlvo: 'inclusao_protocolo_paciente' };
    const agora = await this.agora(req);
    const itens = await this.propria().lerNoBanco(sessaoDe(req).porta, (l, est) =>
      inclusoesAbertas(l, est, agora),
    );
    return { agora, itens };
  }

  @Get(':id')
  @Permissao(DEFINICAO_LER)
  @Auditar(LIDO)
  async definicao(@Param('id') idRota: string, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    req.sghAlvo = { tabelaAlvo: 'protocolo_gerenciado' };
    return this.propria().lerNoBanco(sessaoDe(req).porta, (l, est) => definicaoProtocolo(l, est, n));
  }

  @Post(':id/criterios')
  @HttpCode(201)
  @Permissao(DEFINICAO_PUBLICAR)
  @AuditadoNoHandler('o critério em protocolo_gerenciado_criterio com a trilha_auditoria na mesma transação')
  async incluirCriterio(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaCriterioProtocolo, b);
    const s = sessaoComAto(sessaoDe(req), { protocolo: n, ...e }, null, ':criterio-protocolo');
    const r = await this.propria().gravarNaTransacao<{ id: number }>(
      s.porta,
      'enfermagem.incluir-criterio-protocolo',
      TABELAS_CONFIG_PROTOCOLO,
      (f) =>
        trilha('inclusao', 'protocolo_gerenciado_criterio', f.id, { dadosDepois: { protocolo: n, ...e } }),
      (tx, est, an) => incluirCriterioTx(tx, est, an, n, e),
    );
    return { ok: true, ...r, mensagem: 'Critério incluído: entra na próxima avaliação dos pacientes.' };
  }

  @Post(':id/formula')
  @HttpCode(200)
  @Permissao(DEFINICAO_PUBLICAR)
  @AuditadoNoHandler('a fórmula em protocolo_gerenciado com a trilha_auditoria na mesma transação')
  async formula(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaFormulaProtocolo, b);
    const s = sessaoComAto(sessaoDe(req), { protocolo: n, ...e }, null, ':formula-protocolo');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.gravar-formula-protocolo',
      TABELAS_CONFIG_PROTOCOLO,
      trilha('alteracao', 'protocolo_gerenciado', n),
      (tx, est, an) => gravarFormulaTx(tx, est, an, n, e.versao, e.formula),
    );
    return { ok: true, ...r, mensagem: 'Fórmula de entrada gravada.' };
  }

  @Post(':id/etapas')
  @HttpCode(201)
  @Permissao(DEFINICAO_PUBLICAR)
  @AuditadoNoHandler('a etapa em protocolo_gerenciado_etapa com a trilha_auditoria na mesma transação')
  async incluirEtapa(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaEtapaProtocolo, b);
    const s = sessaoComAto(sessaoDe(req), { protocolo: n, ...e }, null, ':etapa-protocolo');
    const r = await this.propria().gravarNaTransacao<{ id: number }>(
      s.porta,
      'enfermagem.incluir-etapa-protocolo',
      TABELAS_CONFIG_PROTOCOLO,
      (f) => trilha('inclusao', 'protocolo_gerenciado_etapa', f.id, { dadosDepois: { protocolo: n, ...e } }),
      (tx, est, an) => incluirEtapaTx(tx, est, an, n, e),
    );
    return { ok: true, ...r, mensagem: 'Etapa incluída: vale para as próximas inclusões.' };
  }

  @Post(':id/modelo')
  @HttpCode(200)
  @Permissao(DEFINICAO_PUBLICAR)
  @AuditadoNoHandler('as etapas e os critérios do modelo com a trilha_auditoria na mesma transação')
  async modelo(@Param('id') idRota: string, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const s = sessaoComAto(sessaoDe(req), { protocolo: n, modelo: true }, null, ':modelo-protocolo');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.aplicar-modelo-protocolo',
      TABELAS_CONFIG_PROTOCOLO,
      trilha('inclusao', 'protocolo_gerenciado', n),
      (tx, est, an) => aplicarModeloTx(tx, est, an, n),
    );
    return {
      ok: true,
      ...r,
      mensagem:
        r.etapas + r.criterios === 0 && !r.formula
          ? 'O protocolo já tinha tudo o que o modelo traz.'
          : `Modelo aplicado: ${r.etapas} etapa(s) e ${r.criterios} critério(s) incluídos.`,
    };
  }

  @Post('criterios/:id/inativacao')
  @HttpCode(200)
  @Permissao(DEFINICAO_PUBLICAR)
  @AuditadoNoHandler(
    'a inativação em protocolo_gerenciado_criterio com a trilha_auditoria na mesma transação',
  )
  async inativarCriterio(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaInativarCriterio, b);
    const s = sessaoComAto(sessaoDe(req), { id: n, ...e }, null, ':inativar-criterio');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.inativar-criterio-protocolo',
      TABELAS_CONFIG_PROTOCOLO,
      trilha('alteracao', 'protocolo_gerenciado_criterio', n, { motivo: e.motivo }),
      (tx, est, an) => inativarCriterioTx(tx, est, an, n, e.versao, e.motivo),
    );
    return { ok: true, ...r, mensagem: 'Critério inativado: fica no histórico.' };
  }

  @Post('etapas/:id/meta')
  @HttpCode(200)
  @Permissao(DEFINICAO_PUBLICAR)
  @AuditadoNoHandler('a meta em protocolo_gerenciado_etapa com a trilha_auditoria na mesma transação')
  async meta(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaMetaEtapa, b);
    const s = sessaoComAto(sessaoDe(req), { id: n, ...e }, null, ':meta-etapa');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.ajustar-meta-etapa',
      TABELAS_CONFIG_PROTOCOLO,
      trilha('alteracao', 'protocolo_gerenciado_etapa', n),
      (tx, est, an) => ajustarMetaEtapaTx(tx, est, an, n, e),
    );
    return { ok: true, ...r, mensagem: 'Meta ajustada: vale para as próximas inclusões.' };
  }

  @Get('inclusoes/:id/etapas')
  @Permissao(G.protocoloPacienteLer)
  @Auditar(LIDO)
  async etapas(@Param('id') idRota: string, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    req.sghAlvo = { tabelaAlvo: 'inclusao_protocolo_etapa' };
    const agora = await this.agora(req);
    return this.propria().lerNoBanco(sessaoDe(req).porta, (l, est) => etapasDaInclusao(l, est, n, agora));
  }

  @Post('inclusoes/:id/etapas')
  @HttpCode(201)
  @Permissao(G.protocoloPacienteRegistrar)
  @AuditadoNoHandler(
    'as etapas em inclusao_protocolo_etapa e os critérios avaliados com a trilha na mesma transação',
  )
  async iniciar(@Param('id') idRota: string, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const agora = await this.agora(req);
    const s = sessaoComAto(sessaoDe(req), { inclusao: n }, null, ':iniciar-etapas');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.iniciar-etapas-protocolo',
      TABELAS_ETAPAS_INCLUSAO,
      trilha('inclusao', 'inclusao_protocolo_etapa', n),
      (tx, est, an) => iniciarEtapasTx(tx, est, an, n, agora),
    );
    return { ok: true, ...r, mensagem: `Etapas iniciadas: ${r.etapas} com prazo a partir do horário zero.` };
  }

  @Post('etapas-paciente/:id/conclusao')
  @HttpCode(200)
  @Permissao(G.protocoloPacienteRegistrar)
  @AuditadoNoHandler('a conclusão em inclusao_protocolo_etapa com a trilha_auditoria na mesma transação')
  async concluir(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaConcluirEtapa, b);
    const agora = await this.agora(req);
    const sessao = sessaoDe(req);
    const s = sessaoComAto(sessao, { id: n, ...e }, null, ':concluir-etapa');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.concluir-etapa-protocolo',
      TABELAS_ETAPAS_INCLUSAO,
      trilha('alteracao', 'inclusao_protocolo_etapa', n),
      (tx, est, an) =>
        concluirEtapaTx(
          tx,
          est,
          an,
          n,
          { ...e, concluidaEm: e.concluidaEm ?? agora, usuario: s.porta.usuario ?? null },
          agora,
        ),
    );
    return {
      ok: true,
      ...r,
      mensagem:
        r.situacao === 'meta_atingida' ? 'Etapa concluída no prazo.' : 'Etapa concluída fora da meta.',
    };
  }

  @Post('etapas-paciente/:id/cancelamento')
  @HttpCode(200)
  @Permissao(G.protocoloPacienteRegistrar)
  @AuditadoNoHandler('o cancelamento em inclusao_protocolo_etapa com a trilha_auditoria na mesma transação')
  async cancelar(@Param('id') idRota: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(idRota);
    const e = corpo(esquemaCancelarEtapa, b);
    const agora = await this.agora(req);
    const s = sessaoComAto(sessaoDe(req), { id: n, ...e }, null, ':cancelar-etapa');
    const r = await this.propria().gravarNaTransacao(
      s.porta,
      'enfermagem.cancelar-etapa-protocolo',
      TABELAS_ETAPAS_INCLUSAO,
      trilha('alteracao', 'inclusao_protocolo_etapa', n, { motivo: e.motivo }),
      (tx, est, an) => cancelarEtapaTx(tx, est, an, n, { ...e, usuario: s.porta.usuario ?? null }, agora),
    );
    return { ok: true, ...r, mensagem: 'Etapa cancelada: fica no histórico com o motivo.' };
  }
}
