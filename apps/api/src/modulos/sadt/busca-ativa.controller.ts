// Busca ativa de resultados (F8, 05-SADT linha 24). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sadt/busca-ativa/apoio                 canais de contato, equipe, resultados do contato e desfechos
//   GET  /api/sadt/busca-ativa?situacao=&paciente=   a fila (abertos por padrão; "todos": também os encerrados)
//   GET  /api/sadt/busca-ativa/candidatos            os liberados depois da alta e os pendentes na alta fora da fila
//   POST /api/sadt/busca-ativa/abrir                 abre os casos dos candidatos (um por requisição)
//   GET  /api/sadt/busca-ativa/:id                   o caso com exames, tentativas de contato e equipe
//   POST /api/sadt/busca-ativa/:id/contatos          registra a tentativa de contato
//   POST /api/sadt/busca-ativa/:id/concluir          encerra com o desfecho
//   POST /api/sadt/busca-ativa/:id/cancelar          cancela com o motivo
// Leitura: `sadt.resultado.ler`; gravação: quem comunica resultado crítico (`sadt.avisoCritico.comunicar`).
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
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { BUSCA_ATIVA_RESULTADO, type PortaBuscaAtivaPropria } from './busca-ativa-propria.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';

export const PERMISSOES_BUSCA_ATIVA = {
  ler: 'sadt.resultado.ler',
  gravar: 'sadt.avisoCritico.comunicar',
} as const;

const idOuNulo = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Parâmetro inválido');
  return n;
};

@Controller('api/sadt/busca-ativa')
export class BuscaAtivaResultadoController {
  constructor(
    @Optional()
    @Inject(BUSCA_ATIVA_RESULTADO)
    private readonly porta: PortaBuscaAtivaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaBuscaAtivaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta)
      throw semBancoDoCliente(
        'Busca ativa indisponível',
        'A busca ativa de resultados só existe com o banco do cliente.',
      );
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('apoio')
  @Permissao(PERMISSOES_BUSCA_ATIVA.ler)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.apoio(c));
  }

  @Get()
  @Permissao(PERMISSOES_BUSCA_ATIVA.ler)
  fila(
    @Req() req: RequisicaoAutorizada,
    @Query('situacao') situacao?: string,
    @Query('paciente') paciente?: string,
  ) {
    const s = situacao === 'todos' ? 'todos' : null;
    return this.com(req, async (p, c) => ({
      itens: await p.fila(c, { situacao: s, paciente: idOuNulo(paciente) }),
    }));
  }

  @Get('candidatos')
  @Permissao(PERMISSOES_BUSCA_ATIVA.ler)
  candidatos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({
      itens: (await p.candidatos(c)).map((k) => ({
        requisicao: k.requisicao,
        paciente: k.paciente,
        motivo: k.motivo,
        prazoEm: k.prazoEm.toISOString(),
        exames: k.itens.length,
      })),
    }));
  }

  @Post('abrir')
  @HttpCode(200)
  @Permissao(PERMISSOES_BUSCA_ATIVA.gravar)
  @AuditadoNoHandler('abertura dos casos de busca ativa pelo executor (trilha na mesma transação)')
  abrir(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.abrirPendentes(c));
  }

  @Get(':id')
  @Permissao(PERMISSOES_BUSCA_ATIVA.ler)
  detalhe(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.detalhe(c, id));
  }

  @Post(':id/contatos')
  @HttpCode(200)
  @Permissao(PERMISSOES_BUSCA_ATIVA.gravar)
  @AuditadoNoHandler('tentativa de contato da busca ativa pelo executor (trilha na mesma transação)')
  contato(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarContato(c, id, corpo));
  }

  @Post(':id/concluir')
  @HttpCode(200)
  @Permissao(PERMISSOES_BUSCA_ATIVA.gravar)
  @AuditadoNoHandler('conclusão da busca ativa pelo executor (trilha na mesma transação)')
  concluir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.concluir(c, id, corpo));
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_BUSCA_ATIVA.gravar)
  @AuditadoNoHandler('cancelamento da busca ativa pelo executor (trilha na mesma transação)')
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }
}
