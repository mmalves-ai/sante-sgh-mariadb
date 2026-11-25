// Projeto como centro de resultado (C2-107, 07-FIN linha 128). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/financeiro/projetos                              projetos com o resumo e as escolhas (centros, produtos)
//   GET  /api/financeiro/projetos/documentos?origem=&busca=    documentos que podem ser apropriados, com o valor livre
//   GET  /api/financeiro/projetos/:id                          o projeto com etapas, centros, produtos, apropriações e
//                                                              o resultado (orçado × realizado, receita − despesa)
//   POST /api/financeiro/projetos                              cria o projeto (com etapas, centros e produtos)
//   POST /api/financeiro/projetos/:id                          altera o projeto inteiro { …, versao }
//   POST /api/financeiro/projetos/:id/apropriacoes             apropria título, lançamento, consumo ou contrato
//   POST /api/financeiro/projetos/apropriacoes/:id/estornar    estorna a apropriação { versao, motivo }
// Ler: quem consulta o orçamento (financeiro.orcamento.ler); gravar: quem edita o orçamento
// (financeiro.orcamento.editar), como o orçamento empresarial.
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
import { ORIGENS_APROPRIACAO, type OrigemApropriacao } from '@sgh/dominio-financeiro';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_PROJETO_RESULTADO, type PortaProjetoResultadoPropria } from './projeto-resultado-propria.js';

const TRILHA = 'projeto como centro de resultado pelo executor (trilha na mesma transação)';

@Controller('financeiro/projetos')
export class ProjetoResultadoController {
  constructor(
    @Optional()
    @Inject(PORTA_PROJETO_RESULTADO)
    private readonly porta: PortaProjetoResultadoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaProjetoResultadoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao('financeiro.orcamento.ler')
  projetos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.projetos(c));
  }

  @Get('documentos')
  @Permissao('financeiro.orcamento.ler')
  documentos(
    @Req() req: RequisicaoAutorizada,
    @Query('origem') origem: string | undefined,
    @Query('busca') busca: string | undefined,
  ) {
    if (!(ORIGENS_APROPRIACAO as readonly string[]).includes(origem ?? ''))
      throw new ErroProblema('entrada-invalida', 400, 'Origem inválida', 'Escolha a origem do documento.');
    return this.com(req, (p, c) => p.documentos(c, origem as OrigemApropriacao, (busca ?? '').slice(0, 40)));
  }

  @Get(':id')
  @Permissao('financeiro.orcamento.ler')
  projeto(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.projeto(c, id));
  }

  @Post()
  @HttpCode(201)
  @Permissao('financeiro.orcamento.editar')
  @AuditadoNoHandler(TRILHA)
  criar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvarProjeto(c, null, corpo));
  }

  @Post('apropriacoes/:id/estornar')
  @HttpCode(200)
  @Permissao('financeiro.orcamento.editar')
  @AuditadoNoHandler(TRILHA)
  estornar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.estornar(c, id, corpo));
  }

  @Post(':id/apropriacoes')
  @HttpCode(201)
  @Permissao('financeiro.orcamento.editar')
  @AuditadoNoHandler(TRILHA)
  apropriar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.apropriar(c, id, corpo));
  }

  @Post(':id')
  @HttpCode(200)
  @Permissao('financeiro.orcamento.editar')
  @AuditadoNoHandler(TRILHA)
  alterar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvarProjeto(c, id, corpo));
  }
}
