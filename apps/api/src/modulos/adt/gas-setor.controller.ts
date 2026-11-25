// Gases medicinais: consumo por setor (C1-050, 05-SUP linha 30). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/internacao/gases/setores/opcoes                     setores do estabelecimento e gases cadastrados
//   GET  /api/internacao/gases/setores/consumos?de=&ate=&setor=   consumos do setor sem paciente no período
//   POST /api/internacao/gases/setores/consumos                   registra o consumo do setor sem paciente
//   POST /api/internacao/gases/setores/consumos/:id/encerrar      { fim?, quantidadeLitros?, versao } fim e volume
//   POST /api/internacao/gases/setores/consumos/:id/cancelar      { motivo, versao } lançado por engano (nada apagado)
//   GET  /api/internacao/gases/setores/apuracao?de=&ate=&setor=   por setor e gás: pacientes + setor, com as parcelas
// O registro do setor é da enfermagem (mesmas permissões do uso por paciente); a apuração lê o uso e o consumo.
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
import { PERMISSOES_GAS_MEDICINAL } from './gas-medicinal.controller.js';
import { PORTA_GAS_SETOR, type PortaGasSetorPropria } from './gas-setor-propria.js';

@Controller('internacao/gases/setores')
export class GasSetorController {
  constructor(
    @Optional() @Inject(PORTA_GAS_SETOR) private readonly porta: PortaGasSetorPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaGasSetorPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('opcoes')
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoLer)
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Get('consumos')
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoLer)
  consumos(@Req() req: RequisicaoAutorizada, @Query() filtro: Record<string, unknown>) {
    return this.com(req, async (p, c) => ({ itens: await p.consumos(c, filtro) }));
  }

  @Post('consumos')
  @HttpCode(201)
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoRegistrar)
  @AuditadoNoHandler('consumo de gás do setor pelo executor (trilha na mesma transação)')
  registrar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrar(c, corpo));
  }

  @Post('consumos/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoRegistrar)
  @AuditadoNoHandler('consumo de gás do setor pelo executor (trilha na mesma transação)')
  encerrar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.encerrar(c, id, corpo));
  }

  @Post('consumos/:id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoRegistrar)
  @AuditadoNoHandler('consumo de gás do setor pelo executor (trilha na mesma transação)')
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }

  @Get('apuracao')
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoLer)
  apuracao(@Req() req: RequisicaoAutorizada, @Query() filtro: Record<string, unknown>) {
    return this.com(req, (p, c) => p.apurar(c, filtro));
  }
}
