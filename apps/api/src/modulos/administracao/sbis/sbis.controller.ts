// Rotas do M59-F5 (ficha do M59, seções 4, 7, 8 regras 1, 9 e 10, e 13; cap-13 §13.2.1, §13.6):
//   GET  /api/administracao/coexistencia/concessoes                      termo das concessões, com a medida de cada uma
//   POST /api/administracao/coexistencia/concessoes/:codigo/encerrar     com a evidência (reautenticação)
//   POST /api/administracao/coexistencia/concessoes/:codigo/reabrir      com o motivo (reautenticação)
//   POST /api/administracao/coexistencia/concessoes/:codigo/previsao     data prevista do fim
//   GET  /api/administracao/auditoria/sbis                               requisitos, pacote de evidências e ciclos
//   GET  /api/administracao/auditoria/sbis/ciclos/:id                    um ciclo com os itens
//   POST /api/administracao/auditoria/sbis/ciclos                        abrir (autoavaliação, pré-auditoria, auditoria)
//   POST /api/administracao/auditoria/sbis/ciclos/:id/itens/:requisito   avaliar um requisito
//   POST /api/administracao/auditoria/sbis/ciclos/:id/itens/:requisito/corrigir | verificar
//   POST /api/administracao/auditoria/sbis/ciclos/:id/concluir           parecer (reautenticação)
//   POST /api/administracao/auditoria/sbis/ciclos/:id/cancelar
//   GET  /api/administracao/auditoria/backup                             backup verificado (restaurações)
//   POST /api/administracao/auditoria/backup/restauracoes                registrar o relatório de uma restauração
// As leituras entram na trilha própria (@Auditar); as gravações, na mesma transação SGH_ (porta). Encerrar ou reabrir
// concessão e concluir ciclo são críticos: reautenticação recente (SBIS-07). A exportação da trilha para a auditoria
// fica com as demais da trilha (auditoria.controller.ts, /auditoria/trilha/exportar-sbis).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  type BackupVerificado,
  type CicloSbisDetalhe,
  CONCESSOES_COEXISTENCIA,
  esquemaAbrirCiclo,
  esquemaAvaliarItem,
  esquemaCancelarCiclo,
  esquemaConcluirCiclo,
  esquemaCorrigirItem,
  esquemaEncerrarConcessao,
  esquemaPrevisaoConcessao,
  esquemaReabrirConcessao,
  esquemaRegistrarRestauracao,
  EVENTOS_AUDITAVEIS,
  type ItemCicloSbis,
  type PainelConcessoes,
  type PainelSbis,
  PERMISSOES_M10_CODIGOS as M10,
  PERMISSOES_M58_CODIGOS as M58,
  PERMISSOES_M59_F5_CODIGOS as P,
} from '@sgh/contratos';
import { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { reautenticar } from '../../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { ServicoSessao } from '../../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../../acesso/acesso.controller.js';
import { type AtorSbis, SERVICO_SBIS, type ServicoSbis } from './servico.js';

const BASE_CONCESSOES = 'administracao/coexistencia/concessoes';
const BASE_SBIS = 'administracao/auditoria/sbis';
const BASE_BACKUP = 'administracao/auditoria/backup';

const esquemaCodigoConcessao = z.enum(CONCESSOES_COEXISTENCIA);
const esquemaIdCiclo = z.string().regex(/^\d{1,18}$/, 'Ciclo inválido.');
const esquemaRequisito = z.string().regex(/^[A-Z0-9.-]{3,20}$/, 'Requisito inválido.');

function analisar<T extends z.ZodType>(esquema: T, corpo: unknown): z.infer<T> {
  const r = esquema.safeParse(corpo);
  if (!r.success)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Dados inválidos',
      r.error.issues[0]?.message ?? undefined,
    );
  return r.data;
}

@Controller()
export class SbisController {
  constructor(
    @Inject(SERVICO_SBIS) private readonly servico: ServicoSbis,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  private ator(req: RequisicaoAutorizada): AtorSbis {
    const s = req.sgh?.sessao;
    if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login)
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return {
      rede: s.rede,
      hospital: s.estabelecimentoAtivo,
      login: s.usuario.login,
      estacao: estacaoDaRequisicao(req).slice(0, 80) || null,
      correlacao: correlacaoDaRequisicao(req, 'sbis'),
    };
  }

  // ── concessões ─────────────────────────────────────────────────────────────────────────────────

  @Get(BASE_CONCESSOES)
  @Permissao(M58.painelLer)
  @Auditar(EVENTOS_AUDITAVEIS.concessoesConsultadas.codigo)
  concessoes(@Req() req: RequisicaoAutorizada): Promise<PainelConcessoes> {
    return this.servico.painelConcessoes(this.ator(req));
  }

  @Post(`${BASE_CONCESSOES}/:codigo/encerrar`)
  @HttpCode(200)
  @Permissao(P.concessaoEncerrar)
  @AuditadoNoHandler('porta SGH_: SGH_AUDIT_CONCESSAO e SGH_TRILHA na mesma transação')
  async encerrar(@Param('codigo') bruto: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const codigo = analisar(esquemaCodigoConcessao, bruto);
    const p = analisar(esquemaEncerrarConcessao, corpo);
    const a = this.ator(req);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.servico.encerrarConcessao(a, codigo, p);
  }

  @Post(`${BASE_CONCESSOES}/:codigo/reabrir`)
  @HttpCode(200)
  @Permissao(P.concessaoEncerrar)
  @AuditadoNoHandler('porta SGH_: SGH_AUDIT_CONCESSAO e SGH_TRILHA na mesma transação')
  async reabrir(@Param('codigo') bruto: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const codigo = analisar(esquemaCodigoConcessao, bruto);
    const p = analisar(esquemaReabrirConcessao, corpo);
    const a = this.ator(req);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.servico.reabrirConcessao(a, codigo, p.motivo);
  }

  @Post(`${BASE_CONCESSOES}/:codigo/previsao`)
  @HttpCode(200)
  @Permissao(P.concessaoEncerrar)
  @AuditadoNoHandler('porta SGH_: SGH_AUDIT_CONCESSAO e SGH_TRILHA na mesma transação')
  previsao(@Param('codigo') bruto: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const codigo = analisar(esquemaCodigoConcessao, bruto);
    const p = analisar(esquemaPrevisaoConcessao, corpo);
    return this.servico.preverConcessao(this.ator(req), codigo, p.fimPrevisto);
  }

  // ── certificação ───────────────────────────────────────────────────────────────────────────────

  @Get(BASE_SBIS)
  @Permissao(P.sbisLer)
  @Auditar(EVENTOS_AUDITAVEIS.sbisConsultado.codigo)
  painel(@Req() req: RequisicaoAutorizada): Promise<PainelSbis> {
    return this.servico.painel(this.ator(req));
  }

  @Get(`${BASE_SBIS}/ciclos/:id`)
  @Permissao(P.sbisLer)
  @Auditar(EVENTOS_AUDITAVEIS.sbisConsultado.codigo)
  ciclo(@Param('id') bruto: string, @Req() req: RequisicaoAutorizada): Promise<CicloSbisDetalhe> {
    return this.servico.ciclo(this.ator(req), analisar(esquemaIdCiclo, bruto));
  }

  @Post(`${BASE_SBIS}/ciclos`)
  @HttpCode(201)
  @Permissao(P.sbisAvaliar)
  @AuditadoNoHandler('porta SGH_: SGH_AUDIT_SBIS_CICLO, SGH_AUDIT_SBIS_ITEM e SGH_TRILHA na mesma transação')
  abrir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<CicloSbisDetalhe> {
    return this.servico.abrirCiclo(this.ator(req), analisar(esquemaAbrirCiclo, corpo));
  }

  @Post(`${BASE_SBIS}/ciclos/:id/itens/:requisito`)
  @HttpCode(200)
  @Permissao(P.sbisAvaliar)
  @AuditadoNoHandler('porta SGH_: SGH_AUDIT_SBIS_ITEM e SGH_TRILHA na mesma transação')
  avaliar(
    @Param('id') id: string,
    @Param('requisito') requisito: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ItemCicloSbis> {
    return this.servico.avaliar(
      this.ator(req),
      analisar(esquemaIdCiclo, id),
      analisar(esquemaRequisito, requisito),
      analisar(esquemaAvaliarItem, corpo),
    );
  }

  @Post(`${BASE_SBIS}/ciclos/:id/itens/:requisito/corrigir`)
  @HttpCode(200)
  @Permissao(P.sbisAvaliar)
  @AuditadoNoHandler('porta SGH_: SGH_AUDIT_SBIS_ITEM e SGH_TRILHA na mesma transação')
  corrigir(
    @Param('id') id: string,
    @Param('requisito') requisito: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.servico.corrigir(
      this.ator(req),
      analisar(esquemaIdCiclo, id),
      analisar(esquemaRequisito, requisito),
      analisar(esquemaCorrigirItem, corpo).descricao,
    );
  }

  @Post(`${BASE_SBIS}/ciclos/:id/itens/:requisito/verificar`)
  @HttpCode(200)
  @Permissao(P.sbisAvaliar)
  @AuditadoNoHandler('porta SGH_: SGH_AUDIT_SBIS_ITEM e SGH_TRILHA na mesma transação')
  verificar(
    @Param('id') id: string,
    @Param('requisito') requisito: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.servico.verificar(
      this.ator(req),
      analisar(esquemaIdCiclo, id),
      analisar(esquemaRequisito, requisito),
    );
  }

  @Post(`${BASE_SBIS}/ciclos/:id/concluir`)
  @HttpCode(200)
  @Permissao(P.sbisAvaliar)
  @AuditadoNoHandler('porta SGH_: SGH_AUDIT_SBIS_CICLO e SGH_TRILHA na mesma transação')
  async concluir(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CicloSbisDetalhe> {
    const idCiclo = analisar(esquemaIdCiclo, id);
    const { senha, ...p } = analisar(esquemaConcluirCiclo, corpo);
    const a = this.ator(req);
    await reautenticar(this.sessoes, this.resolvedor, req, senha);
    return this.servico.concluir(a, idCiclo, p);
  }

  @Post(`${BASE_SBIS}/ciclos/:id/cancelar`)
  @HttpCode(200)
  @Permissao(P.sbisAvaliar)
  @AuditadoNoHandler('porta SGH_: SGH_AUDIT_SBIS_CICLO e SGH_TRILHA na mesma transação')
  cancelar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.cancelar(
      this.ator(req),
      analisar(esquemaIdCiclo, id),
      analisar(esquemaCancelarCiclo, corpo).motivo,
    );
  }

  // ── backup verificado ──────────────────────────────────────────────────────────────────────────

  @Get(BASE_BACKUP)
  @Permissao(M10.backupLer)
  @Auditar(EVENTOS_AUDITAVEIS.backupVerificadoConsultado.codigo)
  backup(@Req() req: RequisicaoAutorizada): Promise<BackupVerificado> {
    return this.servico.backup(this.ator(req));
  }

  @Post(`${BASE_BACKUP}/restauracoes`)
  @HttpCode(201)
  @Permissao(P.backupRegistrar)
  @AuditadoNoHandler('porta SGH_: SGH_AUDIT_RESTAURACAO e SGH_TRILHA na mesma transação')
  registrar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<{ id: string }> {
    return this.servico.registrarRestauracao(this.ator(req), analisar(esquemaRegistrarRestauracao, corpo));
  }
}
