// Gases medicinais por tempo de uso (F3.4, 04-INT linha 82). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/internacao/gases/atendimentos/:atd/usos          usos do paciente no atendimento (visão por paciente)
//   GET  /api/internacao/gases/internacoes/:reg/atendimento    o atendimento da internação (atalho da internação)
//   POST /api/internacao/gases/usos                            inicia (ou troca fluxo/local continuando o anterior)
//   POST /api/internacao/gases/usos/:id/encerrar               { fim?, versao } fim e horas apuradas
//   POST /api/internacao/gases/usos/:id/cancelar               { motivo, versao } lançado por engano (nada apagado)
//   POST /api/internacao/gases/atendimentos/:atd/lancar-conta  lança os usos encerrados na conta aberta
//   GET  /api/internacao/gases/regras?gas=                     regras de cobrança do gás (com faixas e simultâneos)
//   POST /api/internacao/gases/regras                          inclui a regra (conferida pelo domínio)
//   POST /api/internacao/gases/regras/:id/encerrar             { vigenciaFim, versao } encerra a vigência
// O uso é registro da enfermagem à beira do leito (C1-074): lê quem vê a linha do tempo do turno e registra quem
// checa o cuidado de enfermagem (enfermeiro e técnico); `enfermagem.dispositivo.*` é dos aparelhos da beira do leito,
// não do paciente. A regra é condição contratual; o lançamento é do faturamento.
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
import { AuditadoNoHandler, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_GAS_MEDICINAL, type PortaGasMedicinalPropria } from './gas-medicinal-propria.js';

export const PERMISSOES_GAS_MEDICINAL = {
  usoLer: 'enfermagem.horario.ler',
  usoRegistrar: 'enfermagem.cuidado.checar',
  regraLer: 'convenio.contrato.ler',
  regraEditar: 'convenio.contrato.editar',
  lancar: 'faturamento.item.lancar',
} as const;

@Controller('internacao/gases')
export class GasMedicinalController {
  constructor(
    @Optional() @Inject(PORTA_GAS_MEDICINAL) private readonly porta: PortaGasMedicinalPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaGasMedicinalPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('atendimentos/:atd/usos')
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoLer)
  // O faturamento lança os gases na conta: lê os usos do paciente para conferir o que vai lançar (C1-074).
  @PermissaoOu(PERMISSOES_GAS_MEDICINAL.lancar)
  usos(@Req() req: RequisicaoAutorizada, @Param('atd', ParseIntPipe) atd: number) {
    return this.com(req, async (p, c) => ({ itens: await p.usos(c, atd) }));
  }

  @Get('internacoes/:reg/atendimento')
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoLer)
  // O faturamento lança os gases na conta: lê os usos do paciente para conferir o que vai lançar (C1-074).
  @PermissaoOu(PERMISSOES_GAS_MEDICINAL.lancar)
  atendimentoDaInternacao(@Req() req: RequisicaoAutorizada, @Param('reg', ParseIntPipe) reg: number) {
    return this.com(req, (p, c) => p.atendimentoDaInternacao(c, reg));
  }

  @Post('usos')
  @HttpCode(201)
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoRegistrar)
  @AuditadoNoHandler('uso, regra e lançamento do gás pelo executor (trilha na mesma transação)')
  iniciar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.iniciar(c, corpo));
  }

  @Post('usos/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoRegistrar)
  @AuditadoNoHandler('uso, regra e lançamento do gás pelo executor (trilha na mesma transação)')
  encerrar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.encerrar(c, id, corpo));
  }

  @Post('usos/:id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_GAS_MEDICINAL.usoRegistrar)
  @AuditadoNoHandler('uso, regra e lançamento do gás pelo executor (trilha na mesma transação)')
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }

  @Post('atendimentos/:atd/lancar-conta')
  @HttpCode(200)
  @Permissao(PERMISSOES_GAS_MEDICINAL.lancar)
  @AuditadoNoHandler('uso, regra e lançamento do gás pelo executor (trilha na mesma transação)')
  lancar(@Req() req: RequisicaoAutorizada, @Param('atd', ParseIntPipe) atd: number) {
    return this.com(req, (p, c) => p.lancarNaConta(c, atd));
  }

  @Get('regras')
  @Permissao(PERMISSOES_GAS_MEDICINAL.regraLer)
  regras(@Req() req: RequisicaoAutorizada, @Query('gas', ParseIntPipe) gas: number) {
    return this.com(req, async (p, c) => ({ itens: await p.regras(c, gas) }));
  }

  @Post('regras')
  @HttpCode(201)
  @Permissao(PERMISSOES_GAS_MEDICINAL.regraEditar)
  @AuditadoNoHandler('uso, regra e lançamento do gás pelo executor (trilha na mesma transação)')
  incluirRegra(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirRegra(c, corpo));
  }

  @Post('regras/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_GAS_MEDICINAL.regraEditar)
  @AuditadoNoHandler('uso, regra e lançamento do gás pelo executor (trilha na mesma transação)')
  encerrarRegra(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.encerrarRegra(c, id, corpo));
  }
}
