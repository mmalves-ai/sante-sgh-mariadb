// Vínculos do paciente (F3.1): cobertura permanente, pré-cadastro da marcação e origem e indicação.
//   GET  /api/cadastros/vinculos/opcoes                          fontes, planos, tipos de indicação, parentescos, canais
//   GET  /api/cadastros/pacientes/:id/coberturas                 carteiras, situação no dia, proposta e avisos
//   POST /api/cadastros/pacientes/:id/coberturas                 incluir carteira
//   PUT  /api/cadastros/pacientes/:id/coberturas/:cid            alterar (validade, vigência, plano, titular, principal)
//   POST /api/cadastros/pacientes/:id/coberturas/:cid/encerrar   encerrar com motivo (nunca apagar)
//   GET|POST /api/cadastros/pacientes/:id/captacoes              origem e indicação do paciente
//   GET  /api/cadastros/captacoes/indicador?de&ate               indicador por canal e por tipo de indicação
//   GET|POST /api/cadastros/pre-cadastros                        pré-cadastros do estabelecimento; gravar na marcação
//   GET  /api/cadastros/pre-cadastros/:id/conversao              prévia da chegada (reaproveitar, cadastrar, conferir)
//   POST /api/cadastros/pre-cadastros/:id/converter              converter em paciente (escolhido conferido)
//   POST /api/cadastros/pre-cadastros/:id/cancelar               cancelar o pendente, com motivo (nada é apagado)
// Permissões pelos níveis de acesso de cada cargo (as mesmas do cadastro e da marcação); gravações pelo executor, com a
// trilha na mesma transação e a Idempotency-Key do pedido.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  contextoOperacao,
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from './comum.js';
import {
  type CadastroVinculosProprio,
  type CaptacaoDoPaciente,
  type CoberturasDoPaciente,
  esquemaAlterarCobertura,
  esquemaCaptacao,
  esquemaIncluirCobertura,
  esquemaPreCadastro,
  type IndicadorOrigem,
  type OpcoesVinculos,
  type PreCadastroResumo,
} from './paciente-vinculos-proprio.js';
import { semIndefinidos } from '../../entrada-exata.js';

export const VINCULOS_CADASTRO = Symbol('VINCULOS_CADASTRO');

const EVENTO = EVENTOS_AUDITAVEIS.pacienteGravadoMemoria.codigo;
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo);
  if (!r.success)
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.');
  return r.data;
}

@Controller('cadastros')
export class PacienteVinculosController {
  constructor(@Inject(VINCULOS_CADASTRO) private readonly v: CadastroVinculosProprio | null) {}

  private servico(): CadastroVinculosProprio {
    if (!this.v)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Coberturas, pré-cadastro e captação só funcionam sobre o banco do cliente.',
      );
    return this.v;
  }

  private trilha(s: SessaoCadastro, recurso: string, op: string, tabela: string, paciente: number | null) {
    return linhaTrilha(s, EVENTO, recurso, op, { tabela, paciente });
  }

  @Get('vinculos/opcoes')
  @Permissao('cadastro.paciente.ler')
  async opcoes(@Req() req: RequisicaoAutorizada): Promise<OpcoesVinculos> {
    const s = sessaoDe(req);
    try {
      return await this.servico().opcoes(s.porta);
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  @Get('pacientes/:id/coberturas')
  @Permissao('cadastro.paciente.ler')
  async coberturas(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<CoberturasDoPaciente> {
    const s = sessaoDe(req);
    try {
      return await this.servico().coberturas(s.porta, idDaRota(id));
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  @Post('pacientes/:id/coberturas')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('trilha na mesma transação da carteira')
  async incluirCobertura(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const paciente = idDaRota(id);
    const e = validar(esquemaIncluirCobertura, { ...(corpo as object), paciente });
    const ctx = contextoOperacao(s, 'cadastro.incluirCobertura');
    const t = this.trilha(
      s,
      'cadastro.cobertura',
      'cadastro.incluirCobertura',
      'cobertura_paciente',
      paciente,
    );
    try {
      return { id: await this.servico().incluirCobertura(s.porta, e, t, ctx.chaveIdempotencia) };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Put('pacientes/:id/coberturas/:cid')
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('trilha na mesma transação da carteira')
  async alterarCobertura(
    @Param('id') id: string,
    @Param('cid') cid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const paciente = idDaRota(id);
    const e = validar(esquemaAlterarCobertura, { ...(corpo as object), paciente, id: idDaRota(cid) });
    const ctx = contextoOperacao(s, 'cadastro.alterarCobertura');
    const t = this.trilha(
      s,
      'cadastro.cobertura',
      'cadastro.alterarCobertura',
      'cobertura_paciente',
      paciente,
    );
    try {
      await this.servico().alterarCobertura(s.porta, e, t, ctx.chaveIdempotencia);
      return { id: e.id };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Post('pacientes/:id/coberturas/:cid/encerrar')
  @HttpCode(200)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('trilha na mesma transação da carteira, com o motivo')
  async encerrarCobertura(
    @Param('id') id: string,
    @Param('cid') cid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const paciente = idDaRota(id);
    const b = validar(
      z.object({ versao: z.number().int().positive(), motivo: z.string().trim().min(3).max(400) }),
      corpo,
    );
    const ctx = contextoOperacao(s, 'cadastro.encerrarCobertura');
    const t = this.trilha(
      s,
      'cadastro.cobertura',
      'cadastro.encerrarCobertura',
      'cobertura_paciente',
      paciente,
    );
    try {
      await this.servico().encerrarCobertura(
        s.porta,
        { ...b, paciente, id: idDaRota(cid) },
        t,
        ctx.chaveIdempotencia,
      );
      return { id: idDaRota(cid) };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Get('pacientes/:id/captacoes')
  @Permissao('cadastro.paciente.ler')
  async captacoes(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: CaptacaoDoPaciente[] }> {
    const s = sessaoDe(req);
    try {
      return { itens: await this.servico().captacoesDoPaciente(s.porta, idDaRota(id)) };
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  @Post('pacientes/:id/captacoes')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('trilha na mesma transação da captação')
  async registrarCaptacao(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const paciente = idDaRota(id);
    const e = validar(esquemaCaptacao.omit({ estabelecimento: true, usuario: true }), {
      ...(corpo as object),
      paciente,
    });
    const ctx = contextoOperacao(s, 'cadastro.registrarCaptacao');
    const t = this.trilha(
      s,
      'cadastro.captacao',
      'cadastro.registrarCaptacao',
      'captacao_paciente',
      paciente,
    );
    try {
      return { id: await this.servico().registrarCaptacao(s.porta, e, t, ctx.chaveIdempotencia) };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Get('captacoes/indicador')
  @Permissao('cadastro.paciente.ler')
  async indicador(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadorOrigem> {
    const s = sessaoDe(req);
    const p = validar(
      z.object({ de: DATA, ate: DATA }).refine((x) => x.de <= x.ate),
      { de, ate },
    );
    try {
      return await this.servico().indicadorOrigem(s.porta, p.de, p.ate);
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  @Get('pre-cadastros')
  @Permissao('cadastro.paciente.ler')
  async preCadastros(
    @Query('situacao') situacao: string | undefined,
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: PreCadastroResumo[] }> {
    const s = sessaoDe(req);
    const f = validar(
      z.object({
        situacao: z.enum(['pendente', 'convertido', 'cancelado', 'expirado']).optional(),
        termo: z.string().max(60).optional(),
      }),
      { situacao, termo },
    );
    try {
      return { itens: await this.servico().preCadastros(s.porta, semIndefinidos(f)) };
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  @Post('pre-cadastros')
  @HttpCode(201)
  @Permissao('agenda.marcacao.agendar')
  @AuditadoNoHandler('trilha na mesma transação do pré-cadastro')
  async registrarPreCadastro(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const e = validar(esquemaPreCadastro.omit({ estabelecimento: true }), corpo);
    const ctx = contextoOperacao(s, 'cadastro.registrarPreCadastro');
    const t = this.trilha(s, 'cadastro.pre-cadastro', 'cadastro.registrarPreCadastro', 'pre_cadastro', null);
    try {
      return { id: await this.servico().registrarPreCadastro(s.porta, e, t, ctx.chaveIdempotencia) };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Get('pre-cadastros/:id/conversao')
  @Permissao('cadastro.paciente.ler')
  async conversao(
    @Param('id') id: string,
    @Query('paciente') paciente: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    try {
      return await this.servico().previaConversao(
        s.porta,
        idDaRota(id),
        paciente ? idDaRota(paciente) : null,
      );
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  @Post('pre-cadastros/:id/converter')
  @HttpCode(200)
  @Permissao('cadastro.paciente.criar')
  @AuditadoNoHandler('trilha na mesma transação da conversão')
  async converter(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ paciente: number; marcacoes: number; cobertura: number | null }> {
    const s = sessaoDe(req);
    const b = validar(
      z
        .object({
          paciente: z.number().int().positive().nullable().optional(),
          motivoDivergencia: z.string().trim().max(400).nullable().optional(),
        })
        .strict(),
      corpo ?? {},
    );
    const ctx = contextoOperacao(s, 'cadastro.converterPreCadastro');
    const t = this.trilha(
      s,
      'cadastro.pre-cadastro',
      'cadastro.converterPreCadastro',
      'pre_cadastro',
      b.paciente ?? null,
    );
    try {
      return await this.servico().converterPreCadastro(
        s.porta,
        semIndefinidos({ id: idDaRota(id), paciente: b.paciente, motivoDivergencia: b.motivoDivergencia }),
        t,
        ctx.chaveIdempotencia,
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Post('pre-cadastros/:id/cancelar')
  @HttpCode(200)
  @Permissao('agenda.marcacao.agendar')
  @AuditadoNoHandler('trilha na mesma transação do cancelamento')
  async cancelar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const b = validar(z.object({ motivo: z.string().trim().min(3).max(400) }).strict(), corpo ?? {});
    const ctx = contextoOperacao(s, 'cadastro.cancelarPreCadastro');
    const t = this.trilha(s, 'cadastro.pre-cadastro', 'cadastro.cancelarPreCadastro', 'pre_cadastro', null);
    try {
      await this.servico().cancelarPreCadastro(
        s.porta,
        { id: idDaRota(id), motivo: b.motivo },
        t,
        ctx.chaveIdempotencia,
      );
      return { id: idDaRota(id) };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }
}
