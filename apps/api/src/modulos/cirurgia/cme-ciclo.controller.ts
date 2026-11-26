// Ciclo de esterilização pelos testes dos indicadores e rejeição no reprocessamento (CME; F7, 04-CME linha 116;
// RDC 15/2012). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/cirurgia/cme/ciclos                         ciclos recentes, tipos de indicador, motivos, fases e rejeições
//   GET  /api/cirurgia/cme/ciclos/:id/testes              o ciclo com os testes, os indicadores e os pacotes da carga
//   POST /api/cirurgia/cme/ciclos/:id/testes              registra o teste de um indicador
//   POST /api/cirurgia/cme/ciclos/:id/encerrar            conclui ou libera pelos testes (só com indicador aprovado)
//   POST /api/cirurgia/cme/rejeicoes                      rejeita o pacote ou o ciclo (recolhimento dos distribuídos)
//   POST /api/cirurgia/cme/rejeicoes/:id/recolher         o pacote distribuído do ciclo rejeitado volta à CME
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { PERMISSOES_CME } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_CME_CICLO, type PortaCmeCicloPropria } from './cme-ciclo-propria.js';

@Controller('cirurgia/cme')
export class CmeCicloController {
  constructor(
    @Optional()
    @Inject(PORTA_CME_CICLO)
    private readonly porta: PortaCmeCicloPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaCmeCicloPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('ciclos')
  @Permissao(PERMISSOES_CME.ler)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painelCiclos(c));
  }

  @Get('ciclos/:id/testes')
  @Permissao(PERMISSOES_CME.ler)
  ciclo(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.ciclo(c, id));
  }

  @Post('ciclos/:id/testes')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('teste do indicador do ciclo pelo executor (trilha na mesma transação)')
  teste(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarTeste(c, id, corpo));
  }

  @Post('ciclos/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('desfecho do ciclo pelos testes, pelo executor (trilha na mesma transação)')
  encerrar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.encerrar(c, id, corpo));
  }

  @Post('rejeicoes')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('rejeição no reprocessamento pelo executor (trilha na mesma transação)')
  rejeitar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.rejeitar(c, corpo));
  }

  @Post('rejeicoes/:id/recolher')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME.operar)
  @AuditadoNoHandler('recolhimento do pacote do ciclo rejeitado pelo executor (trilha na mesma transação)')
  recolher(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.recolher(c, id, corpo));
  }
}
