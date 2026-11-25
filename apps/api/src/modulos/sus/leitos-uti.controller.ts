// Leitos de UTI habilitados pelo SUS (F7, 06-SUS linha 59). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sus/leitos-uti                    habilitações do estabelecimento (vigentes, passadas e inativas)
//   GET  /api/sus/leitos-uti/opcoes             tipos de UTI do domínio SUS e unidades de internação
//   POST /api/sus/leitos-uti                    inclui (a nova quantidade encerra a anterior aberta na véspera)
//   POST /api/sus/leitos-uti/:id/vigencia       { vigenciaInicio, vigenciaFim, versao }
//   POST /api/sus/leitos-uti/:id/inativar       { versao } (nada apagado)
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
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_LEITOS_UTI, type PortaLeitosUtiPropria } from './leitos-uti-propria.js';

export const PERMISSOES_LEITOS_UTI = {
  ler: 'faturamento.susLeitoUti.ler',
  criar: 'faturamento.susLeitoUti.criar',
  editar: 'faturamento.susLeitoUti.editar',
} as const;
const TRILHA = 'habilitação de leitos de UTI pelo executor (trilha na mesma transação)';

@Controller('sus/leitos-uti')
export class LeitosUtiSusController {
  constructor(
    @Optional() @Inject(PORTA_LEITOS_UTI) private readonly porta: PortaLeitosUtiPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaLeitosUtiPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_LEITOS_UTI.ler)
  listar(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.listar(c) }));
  }

  @Get('opcoes')
  @Permissao(PERMISSOES_LEITOS_UTI.ler)
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_LEITOS_UTI.criar)
  @AuditadoNoHandler(TRILHA)
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluir(c, corpo));
  }

  @Post(':id/vigencia')
  @HttpCode(200)
  @Permissao(PERMISSOES_LEITOS_UTI.editar)
  @AuditadoNoHandler(TRILHA)
  vigencia(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.alterarVigencia(c, id, corpo));
  }

  @Post(':id/inativar')
  @HttpCode(200)
  @Permissao(PERMISSOES_LEITOS_UTI.editar)
  @AuditadoNoHandler(TRILHA)
  inativar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.inativar(c, id, corpo));
  }
}
