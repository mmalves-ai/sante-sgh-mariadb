// Cópia do prontuário no balcão (F3, 03-PEP L131). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/pep/copias-prontuario?paciente=&situacao=     fila do balcão (em aberto) ou visão por paciente
//   POST /api/pep/copias-prontuario                         { paciente, solicitanteTipo, ... } pedido novo
//   POST /api/pep/copias-prontuario/:pedido/acao            { versao, acao, motivo?, autorizacaoArquivo? }
//   POST /api/pep/copias-prontuario/:pedido/entrega         { versao, recebedorNome, vinculo, tipoDocumento, ... }
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
import {
  PORTA_COPIA_PRONTUARIO_BALCAO,
  type PortaCopiaProntuarioBalcaoPropria,
} from './copia-prontuario-balcao-propria.js';

/** Quem lê o prontuário vê os pedidos; quem pode exportar o prontuário registra pedido, decisão e entrega. */
export const PERMISSOES_COPIA_PRONTUARIO_BALCAO = {
  ler: 'pep.prontuario.ler',
  gravar: 'pep.prontuario.exportar',
} as const;

@Controller('pep/copias-prontuario')
export class CopiaProntuarioBalcaoController {
  constructor(
    @Optional()
    @Inject(PORTA_COPIA_PRONTUARIO_BALCAO)
    private readonly porta: PortaCopiaProntuarioBalcaoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaCopiaProntuarioBalcaoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_COPIA_PRONTUARIO_BALCAO.ler)
  pedidos(@Req() req: RequisicaoAutorizada, @Query() consulta: unknown) {
    return this.com(req, (p, c) => p.pedidos(c, consulta));
  }

  @Post()
  @HttpCode(200)
  @Permissao(PERMISSOES_COPIA_PRONTUARIO_BALCAO.gravar)
  @AuditadoNoHandler('pedido de cópia do prontuário registrado pelo executor (trilha na mesma transação)')
  pedir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.pedir(c, corpo));
  }

  @Post(':pedido/acao')
  @HttpCode(200)
  @Permissao(PERMISSOES_COPIA_PRONTUARIO_BALCAO.gravar)
  @AuditadoNoHandler('decisão sobre o pedido de cópia gravada pelo executor (trilha na mesma transação)')
  acao(
    @Req() req: RequisicaoAutorizada,
    @Param('pedido', ParseIntPipe) pedido: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.acao(c, pedido, corpo));
  }

  @Post(':pedido/entrega')
  @HttpCode(200)
  @Permissao(PERMISSOES_COPIA_PRONTUARIO_BALCAO.gravar)
  @AuditadoNoHandler('entrega da cópia do prontuário gravada pelo executor (trilha na mesma transação)')
  entregar(
    @Req() req: RequisicaoAutorizada,
    @Param('pedido', ParseIntPipe) pedido: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.entregar(c, pedido, corpo));
  }
}
