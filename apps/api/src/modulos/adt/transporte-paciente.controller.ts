// Pedido de transporte do paciente (C1-066, 03-PEP linha 125). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/internacao/transportes/opcoes                    meios, posições, ambulâncias, setores, destinos, motivos
//   GET  /api/internacao/transportes/internacao/:id            a internação para o pedido (setor atual, alta, tipo)
//   GET  /api/internacao/transportes?situacao=&internacao=&paciente=   fila (abertos) ou histórico da internação
//   POST /api/internacao/transportes                           pede o transporte (alta, transferência, interno…)
//   POST /api/internacao/transportes/:id/agendar               { previsto, meio?, ambulancia?, posicao?, versao }
//   POST /api/internacao/transportes/:id/iniciar               { saida?, ambulancia?, versao } saída do paciente
//   POST /api/internacao/transportes/:id/concluir              { chegada?, retorno?, distanciaKm?, versao }
//   POST /api/internacao/transportes/:id/cancelar              { motivo, observacao?, versao } antes da saída
// Ler: quem consulta a internação; pedir e atender: quem movimenta o paciente (transferência de leito ou setor).
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
  PORTA_TRANSPORTE_PACIENTE,
  type PortaTransportePacientePropria,
} from './transporte-paciente-propria.js';

const TRILHA = 'pedido de transporte do paciente pelo executor (trilha na mesma transação)';

@Controller('internacao/transportes')
export class TransportePacienteController {
  constructor(
    @Optional()
    @Inject(PORTA_TRANSPORTE_PACIENTE)
    private readonly porta: PortaTransportePacientePropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaTransportePacientePropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('opcoes')
  @Permissao('internacao.internacao.ler')
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Get('internacao/:id')
  @Permissao('internacao.internacao.ler')
  internacao(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.internacao(c, id));
  }

  @Get()
  @Permissao('internacao.internacao.ler')
  listar(@Req() req: RequisicaoAutorizada, @Query() filtro: Record<string, unknown>) {
    return this.com(req, async (p, c) => ({ itens: await p.listar(c, filtro) }));
  }

  @Post()
  @HttpCode(201)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  solicitar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.solicitar(c, corpo));
  }

  @Post(':id/agendar')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  agendar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.agendar(c, id, corpo));
  }

  @Post(':id/iniciar')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  iniciar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.iniciar(c, id, corpo));
  }

  @Post(':id/concluir')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  concluir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.concluir(c, id, corpo));
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }
}
