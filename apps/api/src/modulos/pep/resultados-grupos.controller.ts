// Rotas dos grupos comparativos de resultados e dos filtros salvos (F3.3, linha 03-PEP L128). Sem chave de
// liberação: só a permissão do cargo (o cadastro de grupos é da administração do prontuário; ver e salvar os próprios
// filtros é de quem lê resultados). O comparativo do paciente fica na rota do prontuário (vínculo e leitura
// registrada): GET /api/pep/paciente/:p/resultados/comparativo.
//   GET    /api/pep/resultados/grupos                 grupos com os itens
//   PUT    /api/pep/resultados/grupos                 inclui ou altera o grupo (com a versão lida)
//   GET    /api/pep/resultados/exames?q=              exames e analitos para montar grupo ou filtro
//   GET    /api/pep/resultados/filtros                filtros do usuário da sessão
//   PUT    /api/pep/resultados/filtros                inclui ou altera o filtro (com a versão lida)
//   DELETE /api/pep/resultados/filtros/:id?versao=    remove o filtro do usuário
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_GRUPOS_RESULTADO, type PortaGruposResultadoPropria } from './resultados-grupos-propria.js';

export const PERMISSOES_GRUPOS_RESULTADO = {
  ler: 'pep.resultado.ler',
  editar: 'pep.admin.editar',
} as const;

@Controller('pep/resultados')
export class ResultadosGruposController {
  constructor(
    @Optional()
    @Inject(PORTA_GRUPOS_RESULTADO)
    private readonly porta: PortaGruposResultadoPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaGruposResultadoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('grupos')
  @Permissao(PERMISSOES_GRUPOS_RESULTADO.ler)
  grupos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.grupos(c) }));
  }

  @Put('grupos')
  @AuditadoNoHandler('executor: trilha na mesma transação dos grupos e filtros de resultado')
  @Permissao(PERMISSOES_GRUPOS_RESULTADO.editar)
  gravarGrupo(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarGrupo(c, corpo));
  }

  @Get('exames')
  @Permissao(PERMISSOES_GRUPOS_RESULTADO.ler)
  exames(@Req() req: RequisicaoAutorizada, @Query('q') q?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.buscarExames(c, String(q ?? '').slice(0, 80)) }));
  }

  @Get('filtros')
  @Permissao(PERMISSOES_GRUPOS_RESULTADO.ler)
  filtros(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.filtros(c) }));
  }

  @Put('filtros')
  @AuditadoNoHandler('executor: trilha na mesma transação dos grupos e filtros de resultado')
  @Permissao(PERMISSOES_GRUPOS_RESULTADO.ler)
  gravarFiltro(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarFiltro(c, corpo));
  }

  @Delete('filtros/:id')
  @AuditadoNoHandler('executor: trilha na mesma transação dos grupos e filtros de resultado')
  @Permissao(PERMISSOES_GRUPOS_RESULTADO.ler)
  excluirFiltro(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Query('versao', ParseIntPipe) versao: number,
  ) {
    return this.com(req, (p, c) => p.excluirFiltro(c, id, versao));
  }
}
