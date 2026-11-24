// SAME: protocolo de envio em lote entre setores e solicitação/empréstimo de prontuário (F3.9, 04-HOT L127 e L128).
// Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/same/tramite/apoio                         setores de trâmite, motivos, portadores, arquivos e setores
//   POST /api/same/tramite/setores                       inclui o setor de trâmite (arquivo, faturamento, unidade…)
//   GET  /api/same/tramite/protocolos?setor=&sentido=&abertos=  a fila de recebimento (entrada) ou os enviados (saída)
//   GET  /api/same/tramite/protocolos/:id                o lote com os itens e a conferência
//   POST /api/same/tramite/protocolos                    emite e envia o lote com os itens (um passo)
//   POST /api/same/tramite/protocolos/:id/receber        { itens: [{ item, aceito, motivo }], versao } item a item
//   POST /api/same/tramite/protocolos/:id/cancelar       { motivo, versao } antes da conferência (nada apagado)
//   GET  /api/same/tramite/solicitacoes                  a fila do arquivo (urgentes e mais antigas primeiro)
//   POST /api/same/tramite/solicitacoes                  pede volumes de pacientes com o motivo
//   GET  /api/same/tramite/emprestimos?paciente=&atrasados=  os do paciente, ou os em aberto (atrasados)
//   POST /api/same/tramite/emprestimos                   empresta o volume (prazo pelo motivo), atende a solicitação
//   POST /api/same/tramite/emprestimos/:id/devolver      { versao } devolve; o volume volta ao arquivo
//   POST /api/same/tramite/emprestimos/:id/cobrar        { versao } soma o aviso de atraso
// Tudo ligado para todos; quem pode ler e gravar é decidido pelas permissões do cargo (as do SAME).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_SAME_TRAMITE, type PortaSameTramitePropria } from './same-tramite-propria.js';

export const PERMISSOES_SAME_TRAMITE = { ler: 'same.movimento.ler', gravar: 'same.movimento.criar' } as const;

const inteiroOuNull = (v: string | undefined): number | null => {
  const n = Number(v);
  return v && Number.isSafeInteger(n) && n > 0 ? n : null;
};

@Controller('same/tramite')
export class SameTramiteController {
  constructor(
    @Optional() @Inject(PORTA_SAME_TRAMITE) private readonly porta: PortaSameTramitePropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaSameTramitePropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('apoio')
  @Permissao(PERMISSOES_SAME_TRAMITE.ler)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.apoio(c));
  }

  @Post('setores')
  @HttpCode(201)
  @Permissao(PERMISSOES_SAME_TRAMITE.gravar)
  setor(@Req() req: RequisicaoAutorizada, @Body() b: unknown) {
    return this.com(req, (p, c) => p.incluirSetorTramite(c, b));
  }

  @Get('protocolos')
  @Permissao(PERMISSOES_SAME_TRAMITE.ler)
  protocolos(
    @Req() req: RequisicaoAutorizada,
    @Query('setor') setor?: string,
    @Query('sentido') sentido?: string,
    @Query('abertos') abertos?: string,
  ) {
    return this.com(req, async (p, c) => ({
      itens: await p.protocolos(c, {
        setor: inteiroOuNull(setor),
        sentido: sentido === 'saida' ? 'saida' : 'entrada',
        abertos: abertos !== 'false',
      }),
    }));
  }

  @Get('protocolos/:id')
  @Permissao(PERMISSOES_SAME_TRAMITE.ler)
  protocolo(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.protocolo(c, id));
  }

  @Post('protocolos')
  @HttpCode(201)
  @Permissao(PERMISSOES_SAME_TRAMITE.gravar)
  emitir(@Req() req: RequisicaoAutorizada, @Body() b: unknown) {
    return this.com(req, (p, c) => p.emitirProtocolo(c, b));
  }

  @Post('protocolos/:id/receber')
  @HttpCode(200)
  @Permissao(PERMISSOES_SAME_TRAMITE.gravar)
  receber(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    return this.com(req, (p, c) => p.receber(c, id, b));
  }

  @Post('protocolos/:id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_SAME_TRAMITE.gravar)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    return this.com(req, (p, c) => p.cancelarProtocolo(c, id, b));
  }

  @Get('solicitacoes')
  @Permissao(PERMISSOES_SAME_TRAMITE.ler)
  solicitacoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.solicitacoesAbertas(c) }));
  }

  @Post('solicitacoes')
  @HttpCode(201)
  @Permissao(PERMISSOES_SAME_TRAMITE.gravar)
  solicitar(@Req() req: RequisicaoAutorizada, @Body() b: unknown) {
    return this.com(req, (p, c) => p.solicitar(c, b));
  }

  @Get('emprestimos')
  @Permissao(PERMISSOES_SAME_TRAMITE.ler)
  emprestimos(
    @Req() req: RequisicaoAutorizada,
    @Query('paciente') paciente?: string,
    @Query('atrasados') atrasados?: string,
  ) {
    return this.com(req, async (p, c) => ({
      itens: await p.emprestimos(c, { paciente: inteiroOuNull(paciente), atrasados: atrasados === 'true' }),
    }));
  }

  @Post('emprestimos')
  @HttpCode(201)
  @Permissao(PERMISSOES_SAME_TRAMITE.gravar)
  emprestar(@Req() req: RequisicaoAutorizada, @Body() b: unknown) {
    return this.com(req, (p, c) => p.emprestar(c, b));
  }

  @Post('emprestimos/:id/devolver')
  @HttpCode(200)
  @Permissao(PERMISSOES_SAME_TRAMITE.gravar)
  devolver(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    return this.com(req, (p, c) => p.devolver(c, id, b));
  }

  @Post('emprestimos/:id/cobrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_SAME_TRAMITE.gravar)
  cobrar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    const versao = Number((b as { versao?: unknown } | null)?.versao);
    if (!Number.isSafeInteger(versao) || versao < 1)
      throw new ErroProblema('entrada-invalida', 400, 'Entrada inválida', 'Informe a versão.', {
        campos: ['versao'],
      });
    return this.com(req, (p, c) => p.cobrar(c, id, versao));
  }
}
