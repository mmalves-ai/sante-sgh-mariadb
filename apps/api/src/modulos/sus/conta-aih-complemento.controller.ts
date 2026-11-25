// Complemento da conta da AIH (F7, 06-SUS linha 58). Rotas (porta própria; sem banco do cliente, 503):
//   GET /api/sus/aih/:aih/complemento    a equipe, os diagnósticos secundários e os incrementos da última conta, com
//                                         as opções da tela (procedimentos, atividades, credores, habilitações)
//   PUT /api/sus/aih/:aih/complemento    { versao, diagnosticos[], equipe[], incrementos[] }  grava as três listas
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Put,
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_CONTA_AIH_COMPLEMENTO,
  type PortaContaAihComplementoPropria,
} from './conta-aih-complemento-propria.js';

const LER = 'faturamento.sus.ler';
const REGISTRAR = 'faturamento.susAih.registrar';
const TRILHA = 'complemento da conta da AIH pelo executor (trilha na mesma transação)';

@Controller('sus/aih')
export class ContaAihComplementoController {
  constructor(
    @Optional()
    @Inject(PORTA_CONTA_AIH_COMPLEMENTO)
    private readonly porta: PortaContaAihComplementoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaContaAihComplementoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get(':aih/complemento')
  @Permissao(LER)
  consultar(@Req() req: RequisicaoAutorizada, @Param('aih', ParseIntPipe) aih: number) {
    return this.com(req, (p, c) => p.consultar(c, aih));
  }

  @Put(':aih/complemento')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(TRILHA)
  salvar(@Req() req: RequisicaoAutorizada, @Param('aih', ParseIntPipe) aih: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvar(c, aih, corpo));
  }
}
