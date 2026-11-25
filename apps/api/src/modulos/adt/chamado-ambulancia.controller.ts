// Chamado de ambulância e maqueiro do transporte interno (C2-068, 04-INT linha 83). Rotas (porta própria; sem banco do
// cliente, 503):
//   GET  /api/internacao/ambulancias/opcoes                 categorias, ambulâncias, trajetos, destinos, motivos, equipe
//   GET  /api/internacao/ambulancias?situacao=&paciente=&atendimento=   fila (abertos) ou histórico do paciente
//   POST /api/internacao/ambulancias                        pede a ambulância (atendimento, categoria, destino…)
//   POST /api/internacao/ambulancias/:id/aprovar            { ambulancia, equipe[], versao }
//   POST /api/internacao/ambulancias/:id/reprovar           { motivo, versao }
//   POST /api/internacao/ambulancias/:id/sair               { kmInicial, saida?, motivoAtraso?, versao }
//   POST /api/internacao/ambulancias/:id/concluir           { kmFinal, fim?, motivoAtraso?, versao } e a cobrança
//   POST /api/internacao/ambulancias/:id/cobrar             { versao } lança a remoção pendente na conta
//   POST /api/internacao/ambulancias/:id/cancelar           { motivo, justificativa?, versao } antes da saída
//   GET  /api/internacao/maqueiros/transportes              pedidos internos em aberto com o maqueiro
//   POST /api/internacao/maqueiros/transportes/:id          { maqueiro, versao } designa o maqueiro
// Ler: quem consulta a internação; pedir e atender: quem movimenta o paciente (as mesmas do pedido de transporte).
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
  PORTA_CHAMADO_AMBULANCIA,
  type PortaChamadoAmbulanciaPropria,
} from './chamado-ambulancia-propria.js';

const TRILHA = 'chamado de ambulância e maqueiro pelo executor (trilha na mesma transação)';

@Controller('internacao')
export class ChamadoAmbulanciaController {
  constructor(
    @Optional()
    @Inject(PORTA_CHAMADO_AMBULANCIA)
    private readonly porta: PortaChamadoAmbulanciaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaChamadoAmbulanciaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('ambulancias/opcoes')
  @Permissao('internacao.internacao.ler')
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Get('ambulancias')
  @Permissao('internacao.internacao.ler')
  listar(@Req() req: RequisicaoAutorizada, @Query() filtro: Record<string, unknown>) {
    return this.com(req, async (p, c) => ({ itens: await p.listar(c, filtro) }));
  }

  @Post('ambulancias')
  @HttpCode(201)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  solicitar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.solicitar(c, corpo));
  }

  @Post('ambulancias/:id/aprovar')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  aprovar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.aprovar(c, id, corpo));
  }

  @Post('ambulancias/:id/reprovar')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  reprovar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.reprovar(c, id, corpo));
  }

  @Post('ambulancias/:id/sair')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  sair(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.sair(c, id, corpo));
  }

  @Post('ambulancias/:id/concluir')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  concluir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.concluir(c, id, corpo));
  }

  @Post('ambulancias/:id/cobrar')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  cobrar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cobrar(c, id, corpo));
  }

  @Post('ambulancias/:id/cancelar')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }

  @Get('maqueiros/transportes')
  @Permissao('internacao.internacao.ler')
  internos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.internos(c) }));
  }

  @Post('maqueiros/transportes/:id')
  @HttpCode(200)
  @Permissao('leitos.transferencia.criar')
  @AuditadoNoHandler(TRILHA)
  maqueiro(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.designarMaqueiro(c, id, corpo));
  }
}
