// Programas de saúde e linhas de cuidado (F8, 02-CAD linha 11), sobre LinhasCuidadoPropria:
//   GET  /api/cadastros/linhas-cuidado                               catálogo com o painel (inscritos por estado), estados
//                                                                    e faixas etárias
//   POST /api/cadastros/linhas-cuidado                               inclui o programa
//   PUT  /api/cadastros/linhas-cuidado/:id                           altera ou inativa (versão lida; nunca apaga)
//   GET  /api/cadastros/linhas-cuidado/:id/inscritos?todos=          inscritos do programa no estabelecimento
//   GET  /api/cadastros/pacientes/:id/linhas-cuidado                 inscrições do paciente com a linha do tempo
//   POST /api/cadastros/pacientes/:id/linhas-cuidado                 inscreve o paciente
//   POST /api/cadastros/pacientes/:id/linhas-cuidado/:iid/estado     muda o estado (encerra no final, com motivo)
//   PUT  /api/cadastros/pacientes/:id/linhas-cuidado/:iid/referencia troca o profissional de referência
// Acesso pelos níveis de cada cargo: leitura e inscrição com as do paciente; o catálogo com cadastro.linhaCuidado.editar.
// Gravações pelo executor, com a trilha na mesma transação e a Idempotency-Key do pedido.
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
  esquemaLinha,
  type InscricaoDoPaciente,
  type InscritoDoPrograma,
  LINHAS_CUIDADO,
  type LinhasCuidadoPropria,
  type OpcoesLinhas,
} from './linhas-cuidado-proprio.js';

export const PERMISSAO_LINHA_CUIDADO_EDITAR = 'cadastro.linhaCuidado.editar';

const EVENTO = EVENTOS_AUDITAVEIS.pacienteGravadoMemoria.codigo;
const ID = z.number().int().positive();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo);
  if (!r.success)
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.');
  return r.data;
}

@Controller('cadastros')
export class LinhasCuidadoController {
  constructor(@Inject(LINHAS_CUIDADO) private readonly l: LinhasCuidadoPropria | null) {}

  private servico(): LinhasCuidadoPropria {
    if (!this.l)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Programas e linhas de cuidado só funcionam sobre o banco do cliente.',
      );
    return this.l;
  }

  private trilha(s: SessaoCadastro, op: string, tabela: string, paciente: number | null) {
    return linhaTrilha(s, EVENTO, 'cadastro.linha-cuidado', op, { tabela, paciente });
  }

  @Get('linhas-cuidado')
  @Permissao('cadastro.paciente.ler')
  async opcoes(@Req() req: RequisicaoAutorizada): Promise<OpcoesLinhas> {
    const s = sessaoDe(req);
    try {
      return await this.servico().opcoes(s.porta);
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  @Post('linhas-cuidado')
  @HttpCode(201)
  @Permissao(PERMISSAO_LINHA_CUIDADO_EDITAR)
  @AuditadoNoHandler('trilha na mesma transação do programa')
  async incluirLinha(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const e = validar(esquemaLinha, corpo);
    const ctx = contextoOperacao(s, 'cadastro.linhaCuidado.incluir');
    const t = this.trilha(s, 'cadastro.linhaCuidado.incluir', 'linha_cuidado', null);
    try {
      return { id: await this.servico().incluirLinha(s.porta, e, t, ctx.chaveIdempotencia) };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Put('linhas-cuidado/:id')
  @Permissao(PERMISSAO_LINHA_CUIDADO_EDITAR)
  @AuditadoNoHandler('trilha na mesma transação do programa')
  async alterarLinha(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const { versao, ativo, ...resto } = (corpo ?? {}) as Record<string, unknown>;
    const v = validar(z.object({ versao: ID, ativo: z.boolean() }), { versao, ativo });
    const e = validar(esquemaLinha, resto);
    const ctx = contextoOperacao(s, 'cadastro.linhaCuidado.alterar');
    const t = this.trilha(s, 'cadastro.linhaCuidado.alterar', 'linha_cuidado', null);
    try {
      return {
        id: await this.servico().alterarLinha(
          s.porta,
          { id: idDaRota(id), versao: v.versao, ativo: v.ativo, entrada: e },
          t,
          ctx.chaveIdempotencia,
        ),
      };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Get('linhas-cuidado/:id/inscritos')
  @Permissao('cadastro.paciente.ler')
  async inscritos(
    @Param('id') id: string,
    @Query('todos') todos: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: InscritoDoPrograma[] }> {
    const s = sessaoDe(req);
    try {
      return {
        itens: await this.servico().inscritos(s.porta, idDaRota(id), todos === '1' || todos === 'true'),
      };
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  @Get('pacientes/:id/linhas-cuidado')
  @Permissao('cadastro.paciente.ler')
  async doPaciente(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: InscricaoDoPaciente[] }> {
    const s = sessaoDe(req);
    try {
      return { itens: await this.servico().doPaciente(s.porta, idDaRota(id)) };
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  @Post('pacientes/:id/linhas-cuidado')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('trilha na mesma transação da inscrição e do histórico')
  async inscrever(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const paciente = idDaRota(id);
    const b = validar(
      z.object({ linha: ID, referencia: ID.nullable().optional(), vigenciaInicio: DATA }).strict(),
      corpo ?? {},
    );
    const ctx = contextoOperacao(s, 'cadastro.linhaCuidado.inscrever');
    const t = this.trilha(s, 'cadastro.linhaCuidado.inscrever', 'paciente_linha_cuidado', paciente);
    try {
      return {
        id: await this.servico().inscrever(
          s.porta,
          { paciente, linha: b.linha, referencia: b.referencia ?? null, vigenciaInicio: b.vigenciaInicio },
          t,
          ctx.chaveIdempotencia,
        ),
      };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Post('pacientes/:id/linhas-cuidado/:iid/estado')
  @HttpCode(200)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('trilha na mesma transação da mudança e do histórico, com o motivo')
  async mudarEstado(
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; encerrada: boolean }> {
    const s = sessaoDe(req);
    const paciente = idDaRota(id);
    const b = validar(
      z
        .object({
          versao: ID,
          estado: ID,
          data: DATA,
          motivo: z.string().trim().max(500).nullable().optional(),
        })
        .strict(),
      corpo ?? {},
    );
    const ctx = contextoOperacao(s, 'cadastro.linhaCuidado.mudarEstado');
    const t = this.trilha(s, 'cadastro.linhaCuidado.mudarEstado', 'paciente_linha_cuidado', paciente);
    try {
      return await this.servico().mudarEstado(
        s.porta,
        {
          paciente,
          id: idDaRota(iid),
          versao: b.versao,
          estado: b.estado,
          data: b.data,
          motivo: b.motivo ?? null,
        },
        t,
        ctx.chaveIdempotencia,
      );
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }

  @Put('pacientes/:id/linhas-cuidado/:iid/referencia')
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('trilha na mesma transação da troca e do histórico')
  async referencia(
    @Param('id') id: string,
    @Param('iid') iid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const paciente = idDaRota(id);
    const b = validar(z.object({ versao: ID, referencia: ID.nullable() }).strict(), corpo ?? {});
    const ctx = contextoOperacao(s, 'cadastro.linhaCuidado.referencia');
    const t = this.trilha(s, 'cadastro.linhaCuidado.referencia', 'paciente_linha_cuidado', paciente);
    try {
      return {
        id: await this.servico().alterarReferencia(
          s.porta,
          { paciente, id: idDaRota(iid), versao: b.versao, referencia: b.referencia },
          t,
          ctx.chaveIdempotencia,
        ),
      };
    } catch (x) {
      throw problemaDoCadastro(x);
    }
  }
}
