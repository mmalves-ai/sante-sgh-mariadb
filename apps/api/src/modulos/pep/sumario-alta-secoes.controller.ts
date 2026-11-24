// Rotas das seções configuráveis do sumário de alta (F3.3, linha 03-PEP L124). Sem chave de liberação: só a
// permissão do cargo (ler para quem escreve o sumário; editar para a administração do prontuário).
//   GET /api/pep/sumario-alta/secoes?tipo=           cadastro (cliente e estabelecimento) e as que valem para o tipo
//   PUT /api/pep/sumario-alta/secoes                 inclui ou altera a seção (com a versão lida); ativo=false tira de uso
//   GET /api/pep/sumario-alta/atendimento/:a/secoes  as que valem para o atendimento (quem escreve o sumário)
//   GET /api/pep/sumario-alta/periodos               períodos de consulta do cliente
//   PUT /api/pep/sumario-alta/periodos               inclui ou altera o período (com a versão lida)
import {
  Body,
  Controller,
  Get,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { TIPOS_ATENDIMENTO_SECAO, type TipoAtendimentoSecao } from '@sgh/dominio-pep';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_SUMARIO_SECOES, type PortaSumarioSecoesPropria } from './sumario-alta-secoes-propria.js';

export const PERMISSOES_SUMARIO_SECOES = {
  ler: 'pep.admin.ler',
  editar: 'pep.admin.editar',
  escrever: 'pep.sumarioAlta.finalizar',
} as const;

export function tipoSecao(tipo: string | undefined): TipoAtendimentoSecao {
  return (TIPOS_ATENDIMENTO_SECAO as readonly string[]).includes(tipo ?? '')
    ? (tipo as TipoAtendimentoSecao)
    : 'todos';
}

@Controller('pep/sumario-alta')
export class SumarioAltaSecoesController {
  constructor(
    @Optional()
    @Inject(PORTA_SUMARIO_SECOES)
    private readonly porta: PortaSumarioSecoesPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaSumarioSecoesPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('secoes')
  @Permissao(PERMISSOES_SUMARIO_SECOES.ler)
  secoes(@Req() req: RequisicaoAutorizada, @Query('tipo') tipo?: string) {
    return this.com(req, async (p, c) => {
      const [itens, vigentes] = await Promise.all([p.componentes(c), p.vigentes(c, tipoSecao(tipo))]);
      return { itens, vigentes };
    });
  }

  @Put('secoes')
  @Permissao(PERMISSOES_SUMARIO_SECOES.editar)
  gravarSecao(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarComponente(c, corpo));
  }

  @Get('atendimento/:a/secoes')
  @Permissao(PERMISSOES_SUMARIO_SECOES.escrever)
  doAtendimento(@Req() req: RequisicaoAutorizada, @Param('a', ParseIntPipe) a: number) {
    return this.com(req, async (p, c) => ({ itens: await p.vigentesDoAtendimento(c, a) }));
  }

  @Get('periodos')
  @Permissao(PERMISSOES_SUMARIO_SECOES.ler)
  periodos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.periodos(c) }));
  }

  @Put('periodos')
  @Permissao(PERMISSOES_SUMARIO_SECOES.editar)
  gravarPeriodo(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarPeriodo(c, corpo));
  }
}
