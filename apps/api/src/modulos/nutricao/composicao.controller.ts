// Composição nutricional dos alimentos (F8, 04-HOT linha 142). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/nutricao/composicao/grupos                         grupos com alimento vigente
//   GET  /api/nutricao/composicao/alimentos?termo=&grupo=        alimentos vigentes (descrição ou código na fonte)
//   GET  /api/nutricao/composicao/alimentos/:id?porcao=          o alimento com os nutrientes por 100 g e na porção
//   POST /api/nutricao/composicao/alimentos/:id/genero           { genero: id | null, versao } liga ao gênero do estoque
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
import { PERMISSOES_NUTRICAO_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_COMPOSICAO, type PortaComposicaoPropria } from './composicao-propria.js';

export const PERMISSOES_COMPOSICAO = {
  ler: P.mapaLer,
  /** Quem mantém as preparações do cardápio liga o alimento ao gênero do estoque. */
  ligar: P.mapaFechar,
} as const;

const inteiroOuNull = (v: string | undefined, campo: string): number | null => {
  if (v === undefined || v === '') return null;
  if (!/^\d{1,9}$/.test(v)) throw new ErroProblema('entrada-invalida', 400, `Informe ${campo} válido`);
  return Number(v);
};

@Controller('nutricao/composicao')
export class ComposicaoController {
  constructor(
    @Optional()
    @Inject(PORTA_COMPOSICAO)
    private readonly porta: PortaComposicaoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaComposicaoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('grupos')
  @Permissao(PERMISSOES_COMPOSICAO.ler)
  grupos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.grupos(c) }));
  }

  @Get('alimentos')
  @Permissao(PERMISSOES_COMPOSICAO.ler)
  alimentos(
    @Req() req: RequisicaoAutorizada,
    @Query('termo') termo?: string,
    @Query('grupo') grupo?: string,
  ) {
    const t = (termo ?? '').trim().slice(0, 60);
    const g = inteiroOuNull(grupo, 'o grupo');
    if (t.length < 2 && g === null)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Digite ao menos 2 letras do alimento ou escolha o grupo',
      );
    return this.com(req, async (p, c) => ({ itens: await p.alimentos(c, t, g) }));
  }

  @Get('alimentos/:id')
  @Permissao(PERMISSOES_COMPOSICAO.ler)
  alimento(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Query('porcao') porcao?: string,
  ) {
    const g = porcao === undefined || porcao === '' ? 100 : Number(porcao.replace(',', '.'));
    return this.com(req, (p, c) => p.alimento(c, id, g));
  }

  @Post('alimentos/:id/genero')
  @HttpCode(200)
  @Permissao(PERMISSOES_COMPOSICAO.ligar)
  @AuditadoNoHandler(
    'ligação do alimento da composição ao gênero do estoque pelo executor (trilha na mesma transação)',
  )
  ligarGenero(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.ligarGenero(c, id, corpo));
  }
}
