// Rotas das declarações periódicas da operadora (08-SGO L110; F78.08): TPS apurada, conferência cadastral da base da
// ANS e DMED. Tudo ligado, controlado só pelo cargo (as permissões dos envios à ANS, concedidas por perfil em
// permissoes/operadora.ts):
//   GET  operadora/ans/declaracoes/:op/tps                     operadora.ans.ler
//   POST operadora/ans/declaracoes/:op/tps                     operadora.ans.gerar   apura o trimestre
//   POST operadora/ans/declaracoes/tps/:id/passo               operadora.ans.gerar   guia, pagamento ou cancelamento
//   GET  operadora/ans/declaracoes/:op/conferencias            operadora.ans.ler
//   POST operadora/ans/declaracoes/:op/conferencias            operadora.ans.gerar   importa a base devolvida
//   GET  operadora/ans/declaracoes/conferencias/:id/itens      operadora.ans.ler
//   POST operadora/ans/declaracoes/divergencias/:id/tratar     operadora.ans.gerar
//   GET  operadora/ans/declaracoes/:op/dmed                    operadora.ans.ler
//   POST operadora/ans/declaracoes/:op/dmed                    operadora.ans.gerar   gera a declaração do ano
//   GET  operadora/ans/declaracoes/dmed/:id/itens              operadora.ans.ler
//   GET  operadora/ans/declaracoes/dmed/:id/arquivo            operadora.ans.ler
//   POST operadora/ans/declaracoes/dmed/:id/passo              operadora.ans.gerar   entrega com recibo, resultado
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  type Gravado,
  PORTA_DECLARACOES_ANS,
  type PortaDeclaracoesAnsPropria,
} from './ans-declaracoes-propria.js';

const LER = 'operadora.ans.ler';
const GERAR = 'operadora.ans.gerar';
const AUD = 'operadora.declaracoes.gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const versao = z.number().int().positive();
const esquemaApurar = z.object({
  ano: z.number().int().min(2000).max(2100),
  trimestre: z.number().int().min(1).max(4),
});
const esquemaPassoTps = z.object({
  versao,
  para: z.enum(['guia_emitida', 'paga', 'cancelada']),
  nossoNumero: z.string().max(50).nullable().optional(),
  vencimento: data.nullable().optional(),
  dataPagamento: data.nullable().optional(),
  valorPago: z.number().nonnegative().nullable().optional(),
});
const esquemaImportar = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
  nome: z.string().min(1).max(255),
  // Até cerca de 30 MB de texto (a base de uma operadora grande).
  base64: z.string().min(4).max(40_000_000),
});
const esquemaTratar = z.object({
  versao,
  para: z.enum(['corrigir_cadastro', 'retificar_ans', 'corrigida', 'ignorada']),
  justificativa: z.string().max(500).nullable(),
});
const esquemaDmed = z.object({
  anoCalendario: z.number().int().min(2009).max(2100),
  retifica: z.number().int().positive().nullable(),
  responsavelCpf: z.string().min(11).max(14),
  responsavelNome: z.string().min(1).max(150),
  responsavelDdd: z
    .string()
    .regex(/^\d{2}$/)
    .nullable(),
  responsavelTelefone: z.string().max(20).nullable(),
  responsavelEmail: z.string().email().max(254).nullable(),
});
const esquemaPassoDmed = z.object({
  versao,
  para: z.enum(['transmitida', 'aceita', 'rejeitada', 'cancelada']),
  recibo: z.string().max(30).nullable(),
});

@Controller()
export class DeclaracoesAnsController {
  constructor(@Inject(PORTA_DECLARACOES_ANS) private readonly porta: PortaDeclaracoesAnsPropria) {}

  private trilha(s: SessaoCadastro, evento: string, tabela: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.declaracoes', evento, { tabela, id: String(r.id) });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operadora/ans/declaracoes/:op/tps')
  @Permissao(LER)
  apuracoesTps(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.apuracoesTps(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/ans/declaracoes/:op/tps')
  @HttpCode(201)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  apurarTps(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const x = corpo(esquemaApurar, b);
    return this.ok(
      this.porta.apurarTps(
        s.porta,
        idDaRota(op),
        x.ano,
        x.trimestre,
        this.trilha(s, 'operadora.tps.apurada', 'apuracao_taxa_saude_suplementar'),
      ),
    );
  }

  @Post('operadora/ans/declaracoes/tps/:id/passo')
  @HttpCode(200)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  passoTps(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { versao: v, ...x } = corpo(esquemaPassoTps, b);
    return this.ok(
      this.porta.passoTps(
        s.porta,
        idDaRota(id),
        v,
        x,
        this.trilha(s, `operadora.tps.${x.para}`, 'apuracao_taxa_saude_suplementar'),
      ),
    );
  }

  @Get('operadora/ans/declaracoes/:op/conferencias')
  @Permissao(LER)
  conferencias(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.conferencias(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/ans/declaracoes/:op/conferencias')
  @HttpCode(201)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  importarConferencia(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.importarConferencia(
        s.porta,
        idDaRota(op),
        corpo(esquemaImportar, b),
        this.trilha(s, 'operadora.conferencia-ans.importada', 'conferencia_cadastral_ans'),
      ),
    );
  }

  @Get('operadora/ans/declaracoes/conferencias/:id/itens')
  @Permissao(LER)
  divergencias(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.divergencias(sessaoDe(req).porta, idDaRota(id)));
  }

  @Post('operadora/ans/declaracoes/divergencias/:id/tratar')
  @HttpCode(200)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  tratar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { versao: v, ...x } = corpo(esquemaTratar, b);
    return this.ok(
      this.porta.tratarDivergencia(
        s.porta,
        idDaRota(id),
        v,
        x,
        this.trilha(s, 'operadora.conferencia-ans.tratada', 'conferencia_cadastral_ans_item'),
      ),
    );
  }

  @Get('operadora/ans/declaracoes/:op/dmed')
  @Permissao(LER)
  declaracoes(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.declaracoes(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/ans/declaracoes/:op/dmed')
  @HttpCode(201)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  gerarDmed(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gerarDmed(
        s.porta,
        idDaRota(op),
        corpo(esquemaDmed, b),
        this.trilha(s, 'operadora.dmed.gerada', 'declaracao_servicos_medicos'),
      ),
    );
  }

  @Get('operadora/ans/declaracoes/dmed/:id/itens')
  @Permissao(LER)
  itensDmed(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.itensDeclaracao(sessaoDe(req).porta, idDaRota(id)));
  }

  @Get('operadora/ans/declaracoes/dmed/:id/arquivo')
  @Permissao(LER)
  async arquivoDmed(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const r = await this.ok(this.porta.arquivoDeclaracao(sessaoDe(req).porta, idDaRota(id)));
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Arquivo não encontrado');
    return r;
  }

  @Post('operadora/ans/declaracoes/dmed/:id/passo')
  @HttpCode(200)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  passoDmed(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { versao: v, ...x } = corpo(esquemaPassoDmed, b);
    return this.ok(
      this.porta.passoDmed(
        s.porta,
        idDaRota(id),
        v,
        x,
        this.trilha(s, `operadora.dmed.${x.para}`, 'declaracao_servicos_medicos'),
      ),
    );
  }
}
