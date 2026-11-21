// Tela de treinamentos e capacitações (M52.6; ficha do M52, seção 7; `Gestão de pessoas > Treinamentos e
// capacitações`; `pessoas.treinamento.ler` / `.registrar`; regra 20):
//   GET  /api/pessoas/treinamentos/apoio                      liberação, ações, unidades e o alerta de vencimento
//   GET  /api/pessoas/treinamentos/situacao                   colaboradores ativos com as pendências dos obrigatórios
//   GET  /api/pessoas/treinamentos/colaboradores              busca pelo nome ou matrícula (sem CPF; a inscrição)
//   GET  /api/pessoas/treinamentos/colaboradores/:vinculo     a ficha: cursos, histórico e POPs com a ciência
//   GET  /api/pessoas/treinamentos/cursos ; POST ; POST :id   o catálogo (inclusão, alteração, inativação)
//   GET  /api/pessoas/treinamentos/turmas ; GET :id ; POST    as turmas e a lista de presença
//   POST /api/pessoas/treinamentos/turmas/:id/inscricoes | participacao | encerramento | cancelamento
//   POST /api/pessoas/treinamentos/turmas/:id/alteracao       W0-06: alterar a turma aberta, com motivo
//   POST /api/pessoas/treinamentos/turmas/:id/inscricoes/:vinculo/retirada   W0-06: retirar inscrição por engano
//   POST /api/pessoas/treinamentos/turmas/:id/participacao/:vinculo/correcao W0-06: corrigir presença, com motivo
//   GET  /api/pessoas/treinamentos/turmas/:id/lista/pdf       a lista de presença em PDF/A (para a assinatura)
//   GET  /api/pessoas/treinamentos/pops ; GET pops/:codigo ; POST pops ; POST pops/:id/revogacao
// Toda gravação leva a Idempotency-Key (guarda) e a trilha na transação; o estabelecimento vem da sessão.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type ApoioTreinamento,
  esquemaAlterarCurso,
  esquemaAlterarTurma,
  esquemaCancelarTurma,
  esquemaCorrigirParticipacao,
  esquemaRetirarInscricao,
  esquemaCurso,
  esquemaEncerrarTurma,
  esquemaFiltroSituacaoTreinamento,
  esquemaFiltroTurmas,
  esquemaInscricao,
  esquemaParticipacao,
  esquemaRevogarPop,
  esquemaTurma,
  esquemaVersaoPop,
  type FichaTreinamento,
  type ListaCursos,
  type ListaPops,
  type ListaTurmas,
  type PainelTreinamento,
  type PopDetalhe,
  type ResultadoF6,
  type TurmaResposta,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { idDaRota, sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { htmlListaPresenca } from './documentos-f6.js';
import { PORTA_TREINAMENTO, type PortaTreinamento } from './porta-treinamento.js';
import { ServicoTreinamento } from './servico-treinamento.js';

export const GERADOR_PDF_F6 = Symbol('GERADOR_PDF_F6');
export type GeradorPdfF6 = (html: string, titulo: string) => Promise<Buffer>;
export type RespostaF6 = { header(n: string, v: string): unknown; send(b: unknown): unknown };

const NA_TABELA = (t: string) => `${t} com a trilha_auditoria na mesma transação`;
const esquemaBusca = z
  .object({ termo: z.string().trim().min(2).max(60), estado: z.enum(['ativo', 'todos']).default('ativo') })
  .strict();

/** O PDF/A pelo Gotenberg; sem o conversor (testes), o HTML. */
export async function enviarPdfF6(
  pdf: GeradorPdfF6 | null,
  res: RespostaF6,
  html: string,
  titulo: string,
  arquivo: string,
) {
  if (!pdf) {
    res.header('content-type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  const b = await pdf(html, titulo).catch(() => null);
  if (!b)
    throw new ErroProblema(
      'indisponivel',
      503,
      'Gerador de PDF indisponível',
      'O conversor de PDF/A não respondeu.',
    );
  res.header('content-type', 'application/pdf');
  res.header('content-disposition', `attachment; filename="${arquivo}.pdf"`);
  return res.send(b);
}

@Controller('pessoas/treinamentos')
export class TreinamentoController {
  readonly servico: ServicoTreinamento;

  constructor(
    @Inject(PORTA_TREINAMENTO) porta: PortaTreinamento,
    @Inject(PORTA_PESSOAS) private readonly pessoas: PortaPessoas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(GERADOR_PDF_F6) private readonly pdf: GeradorPdfF6 | null = null,
  ) {
    this.servico = new ServicoTreinamento(porta, pessoas, trilha, configuracao, cache);
  }

  @Get('apoio')
  @Permissao('pessoas.treinamento.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioTreinamento> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('situacao')
  @Permissao('pessoas.treinamento.ler')
  painel(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<PainelTreinamento> {
    return this.servico.painel(sessaoDe(req), corpo(esquemaFiltroSituacaoTreinamento, q));
  }

  @Get('colaboradores')
  @Permissao('pessoas.treinamento.ler')
  async busca(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaBusca, q);
    const [r, unidades] = await Promise.all([
      this.pessoas.listarVinculos(s.porta, { termo: f.termo, estado: f.estado, limite: 20 }),
      this.pessoas.unidades(s.porta),
    ]);
    const nomes = new Map(unidades.map((u) => [u.codigo, u.nome]));
    return {
      itens: r.itens.map((v) => ({
        vinculo: v.id,
        nome: v.nome,
        matricula: v.matricula,
        cargo: v.cargo,
        funcao: v.funcao,
        unidadeNome: v.unidade !== null ? (nomes.get(v.unidade) ?? null) : null,
        desligamento: v.desligamento,
      })),
    };
  }

  @Get('colaboradores/:vinculo')
  @Permissao('pessoas.treinamento.ler')
  ficha(@Param('vinculo') v: string, @Req() req: RequisicaoAutorizada): Promise<FichaTreinamento> {
    return this.servico.ficha(sessaoDe(req), idDaRota(v));
  }

  // ── Cursos ──────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('cursos')
  @Permissao('pessoas.treinamento.ler')
  cursos(@Req() req: RequisicaoAutorizada): Promise<ListaCursos> {
    return this.servico.cursos(sessaoDe(req));
  }

  @Post('cursos')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('curso'))
  incluirCurso(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoF6> {
    return this.servico.incluirCurso(sessaoDe(req), corpo(esquemaCurso, b));
  }

  @Post('cursos/:id')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('curso'))
  alterarCurso(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.alterarCurso(
      sessaoDe(req),
      corpo(esquemaAlterarCurso, { ...(b as object), curso: idDaRota(id) }),
    );
  }

  // ── Turmas ──────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('turmas')
  @Permissao('pessoas.treinamento.ler')
  turmas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaTurmas> {
    return this.servico.turmas(sessaoDe(req), corpo(esquemaFiltroTurmas, q));
  }

  @Get('turmas/:id')
  @Permissao('pessoas.treinamento.ler')
  turma(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<TurmaResposta> {
    return this.servico.turma(sessaoDe(req), idDaRota(id));
  }

  @Get('turmas/:id/lista/pdf')
  @Permissao('pessoas.treinamento.ler')
  async listaPdf(@Param('id') id: string, @Req() req: RequisicaoAutorizada, @Res() res: RespostaF6) {
    const d = await this.servico.listaPresenca(sessaoDe(req), idDaRota(id));
    return enviarPdfF6(
      this.pdf,
      res,
      htmlListaPresenca(d.turma, d.hoje),
      `Lista de presença ${d.turma.cursoCodigo}`,
      `lista-presenca-${d.turma.id}`,
    );
  }

  @Post('turmas')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('turma_treinamento'))
  abrirTurma(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoF6> {
    return this.servico.abrirTurma(sessaoDe(req), corpo(esquemaTurma, b));
  }

  @Post('turmas/:id/inscricoes')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('presenca_treinamento'))
  inscrever(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.inscrever(
      sessaoDe(req),
      corpo(esquemaInscricao, { ...(b as object), treinamento: idDaRota(id) }),
    );
  }

  @Post('turmas/:id/participacao')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('presenca_treinamento e ciencia_procedimento'))
  participacao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.registrarParticipacao(
      sessaoDe(req),
      corpo(esquemaParticipacao, { ...(b as object), treinamento: idDaRota(id) }),
    );
  }

  @Post('turmas/:id/alteracao')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('turma_treinamento (valor anterior na trilha)'))
  alterarTurma(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.alterarTurma(
      sessaoDe(req),
      corpo(esquemaAlterarTurma, { ...(b as object), treinamento: idDaRota(id) }),
    );
  }

  @Post('turmas/:id/inscricoes/:vinculo/retirada')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('presenca_treinamento (exclusão lógica)'))
  retirarInscricao(
    @Param('id') id: string,
    @Param('vinculo') vinculo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.retirarInscricao(
      sessaoDe(req),
      corpo(esquemaRetirarInscricao, {
        ...(b as object),
        treinamento: idDaRota(id),
        vinculo: idDaRota(vinculo),
      }),
    );
  }

  @Post('turmas/:id/participacao/:vinculo/correcao')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('presenca_treinamento (valor anterior na trilha)'))
  corrigirParticipacao(
    @Param('id') id: string,
    @Param('vinculo') vinculo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.corrigirParticipacao(
      sessaoDe(req),
      corpo(esquemaCorrigirParticipacao, {
        ...(b as object),
        treinamento: idDaRota(id),
        vinculo: idDaRota(vinculo),
      }),
    );
  }

  @Post('turmas/:id/encerramento')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('turma_treinamento'))
  encerrar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.encerrarTurma(
      sessaoDe(req),
      corpo(esquemaEncerrarTurma, { ...(b as object), treinamento: idDaRota(id) }),
    );
  }

  @Post('turmas/:id/cancelamento')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('turma_treinamento'))
  cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.cancelarTurma(
      sessaoDe(req),
      corpo(esquemaCancelarTurma, { ...(b as object), treinamento: idDaRota(id) }),
    );
  }

  // ── POP ─────────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('pops')
  @Permissao('pessoas.treinamento.ler')
  pops(@Req() req: RequisicaoAutorizada): Promise<ListaPops> {
    return this.servico.pops(sessaoDe(req));
  }

  @Get('pops/:codigo')
  @Permissao('pessoas.treinamento.ler')
  pop(@Param('codigo') codigo: string, @Req() req: RequisicaoAutorizada): Promise<PopDetalhe> {
    if (!/^[A-Z0-9][A-Z0-9._-]{1,19}$/.test(codigo))
      throw new ErroProblema('entrada-invalida', 400, 'Código inválido', 'O código do POP não é válido.');
    return this.servico.popDetalhe(sessaoDe(req), codigo);
  }

  @Post('pops')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('documento_qualidade_versao'))
  publicarPop(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoF6> {
    return this.servico.publicarPop(sessaoDe(req), corpo(esquemaVersaoPop, b));
  }

  @Post('pops/:id/revogacao')
  @HttpCode(200)
  @Permissao('pessoas.treinamento.registrar')
  @AuditadoNoHandler(NA_TABELA('documento_qualidade_versao'))
  revogarPop(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    return this.servico.revogarPop(
      sessaoDe(req),
      corpo(esquemaRevogarPop, { ...(b as object), pop: idDaRota(id) }),
    );
  }
}
