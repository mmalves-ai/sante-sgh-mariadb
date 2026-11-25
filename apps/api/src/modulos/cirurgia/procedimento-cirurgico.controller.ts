// Cadastro do procedimento cirúrgico (F3.4, 04-CC linha 91). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/cirurgia/procedimentos-cirurgicos?q=&todos=1     a lista (busca; os fora de uso só com todos=1)
//   GET  /api/cirurgia/procedimentos-cirurgicos/apoio          opções dos combos (grupo, porte, especialidade...)
//   GET  /api/cirurgia/procedimentos-cirurgicos/:id            um procedimento
//   POST /api/cirurgia/procedimentos-cirurgicos                inclui
//   PUT  /api/cirurgia/procedimentos-cirurgicos/:id            altera com a versão lida
//   POST /api/cirurgia/procedimentos-cirurgicos/:id/uso        { ativo, versao } tira de uso ou volta (nada apagado)
// Permissão: as mesmas das tabelas do bloco (salas e grade), cirurgia.sala.ler e cirurgia.sala.editar: quem mantém
// as tabelas do centro cirúrgico mantém o procedimento.
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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_PROCEDIMENTO_CIRURGICO,
  type PortaProcedimentoCirurgicoPropria,
} from './procedimento-cirurgico-propria.js';

export const PERMISSOES_PROCEDIMENTO_CIRURGICO = {
  ler: 'cirurgia.sala.ler',
  editar: 'cirurgia.sala.editar',
} as const;

@Controller('cirurgia/procedimentos-cirurgicos')
export class ProcedimentoCirurgicoController {
  constructor(
    @Optional()
    @Inject(PORTA_PROCEDIMENTO_CIRURGICO)
    private readonly porta: PortaProcedimentoCirurgicoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaProcedimentoCirurgicoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_PROCEDIMENTO_CIRURGICO.ler)
  listar(@Req() req: RequisicaoAutorizada, @Query('q') q?: string, @Query('todos') todos?: string) {
    return this.com(req, (p, c) => p.listar(c, { q: (q ?? '').slice(0, 60), todos: todos === '1' }));
  }

  @Get('apoio')
  @Permissao(PERMISSOES_PROCEDIMENTO_CIRURGICO.ler)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.apoio(c));
  }

  @Get(':id')
  @Permissao(PERMISSOES_PROCEDIMENTO_CIRURGICO.ler)
  obter(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.obter(c, id));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_PROCEDIMENTO_CIRURGICO.editar)
  @AuditadoNoHandler('procedimento cirúrgico pelo executor (trilha na mesma transação)')
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluir(c, corpo));
  }

  @Put(':id')
  @Permissao(PERMISSOES_PROCEDIMENTO_CIRURGICO.editar)
  @AuditadoNoHandler('procedimento cirúrgico pelo executor (trilha na mesma transação)')
  alterar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.alterar(c, id, corpo));
  }

  @Post(':id/uso')
  @HttpCode(200)
  @Permissao(PERMISSOES_PROCEDIMENTO_CIRURGICO.editar)
  @AuditadoNoHandler('procedimento cirúrgico pelo executor (trilha na mesma transação)')
  uso(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.definirUso(c, id, corpo));
  }
}
