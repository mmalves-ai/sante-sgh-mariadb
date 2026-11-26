// Rotas do desconto em folha da mensalidade (08-SGO L97, C3-028):
//   GET  /api/operadora/desconto-folha/contratantes?operadora&termo  contratantes que descontam em folha (busca remota)
//   GET  /api/operadora/desconto-folha/remessas?operadora             remessas do estabelecimento
//   GET  /api/operadora/desconto-folha/remessas/:id                   a remessa com os itens
//   GET  /api/operadora/desconto-folha/remessas/:id/arquivo           o arquivo da remessa (CSV) para a contratante
//   POST /api/operadora/desconto-folha/previa                         prévia da remessa (nada é gravado)
//   POST /api/operadora/desconto-folha/remessas                       gera a remessa da competência
//   POST /api/operadora/desconto-folha/remessas/:id/envio             marca enviada
//   POST /api/operadora/desconto-folha/remessas/:id/retorno           lê o retorno e baixa as cobranças descontadas
//   POST /api/operadora/desconto-folha/remessas/:id/conferencia       confere (os não descontados seguem na cobrança)
//   POST /api/operadora/desconto-folha/remessas/:id/cancelamento      cancela (só antes do retorno)
// Leitura com operadora.cobranca.ler; gravação com operadora.cobranca.gerar. Cada gravação vai pelo Executor com a
// trilha na mesma transação e a Idempotency-Key do pedido.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { TIPOS_REMESSA_FOLHA } from '@sgh/dominio-operadora';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import {
  contextoOperacao,
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  type Gravado,
  PORTA_DESCONTO_FOLHA,
  type PortaDescontoFolhaPropria,
} from './desconto-folha-propria.js';

const LER = 'operadora.cobranca.ler';
const GERAR = 'operadora.cobranca.gerar';
const AUD = 'operadora.desconto-folha gravado com a trilha_auditoria na mesma transação (porta própria)';

const id = z.number().int().positive();
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const esquemaPrevia = z.object({ operadora: id, contratante: id, competencia });
const esquemaGerar = esquemaPrevia.extend({
  tipo: z.enum(TIPOS_REMESSA_FOLHA),
  observacao: z.string().max(1000).nullable(),
});
const esquemaVersao = z.object({ versao: id });
const esquemaRetorno = z.object({
  versao: id,
  texto: z.string().min(1).max(2_000_000),
  creditoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const esquemaCancelamento = z.object({ versao: id, motivo: z.string().min(1).max(500) });

@Controller()
export class DescontoFolhaOperadoraController {
  constructor(@Inject(PORTA_DESCONTO_FOLHA) private readonly porta: PortaDescontoFolhaPropria) {}

  private trilha(s: SessaoCadastro, evento: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.desconto-folha', evento, {
        tabela: 'remessa_desconto_folha',
        id: String(r.id),
      });
  }
  private ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }
  private ctx(s: SessaoCadastro, rotulo: string) {
    return { ...s.porta, ...contextoOperacao(s, rotulo) };
  }

  @Get('operadora/desconto-folha/contratantes')
  @Permissao(LER)
  contratantes(
    @Query('operadora') op: string | undefined,
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.ok(
      this.porta.contratantes(sessaoDe(req).porta, idDaRota(String(op ?? '')), String(termo ?? '')),
    );
  }

  @Get('operadora/desconto-folha/remessas')
  @Permissao(LER)
  remessas(@Query('operadora') op: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.remessas(sessaoDe(req).porta, op ? idDaRota(op) : null));
  }

  @Get('operadora/desconto-folha/remessas/:id')
  @Permissao(LER)
  remessa(@Param('id') n: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.remessa(sessaoDe(req).porta, idDaRota(n)));
  }

  @Get('operadora/desconto-folha/remessas/:id/arquivo')
  @Permissao(LER)
  arquivo(@Param('id') n: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.arquivo(sessaoDe(req).porta, idDaRota(n)));
  }

  @Post('operadora/desconto-folha/previa')
  @HttpCode(200)
  @Permissao(LER)
  previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.previa(sessaoDe(req).porta, corpo(esquemaPrevia, b)));
  }

  @Post('operadora/desconto-folha/remessas')
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  gerar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gerar(
        this.ctx(s, 'desconto-folha-gerar'),
        corpo(esquemaGerar, b),
        this.trilha(s, 'operadora.desconto-folha.gerada'),
      ),
    );
  }

  @Post('operadora/desconto-folha/remessas/:id/envio')
  @HttpCode(200)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  enviar(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaVersao, b);
    return this.ok(
      this.porta.enviar(
        this.ctx(s, 'desconto-folha-envio'),
        idDaRota(n),
        e.versao,
        this.trilha(s, 'operadora.desconto-folha.enviada'),
      ),
    );
  }

  @Post('operadora/desconto-folha/remessas/:id/retorno')
  @HttpCode(200)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  retorno(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.lerRetorno(
        this.ctx(s, 'desconto-folha-retorno'),
        idDaRota(n),
        corpo(esquemaRetorno, b),
        this.trilha(s, 'operadora.desconto-folha.retorno'),
      ),
    );
  }

  @Post('operadora/desconto-folha/remessas/:id/conferencia')
  @HttpCode(200)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  conferir(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaVersao, b);
    return this.ok(
      this.porta.conferir(
        this.ctx(s, 'desconto-folha-conferencia'),
        idDaRota(n),
        e.versao,
        this.trilha(s, 'operadora.desconto-folha.conferida'),
      ),
    );
  }

  @Post('operadora/desconto-folha/remessas/:id/cancelamento')
  @HttpCode(200)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  cancelar(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.cancelar(
        this.ctx(s, 'desconto-folha-cancelamento'),
        idDaRota(n),
        corpo(esquemaCancelamento, b),
        this.trilha(s, 'operadora.desconto-folha.cancelada'),
      ),
    );
  }
}
