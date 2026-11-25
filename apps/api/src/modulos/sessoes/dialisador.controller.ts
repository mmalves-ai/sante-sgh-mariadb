// Reuso do dialisador na hemodiálise (03-PEP linha 146). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sessoes/dialisadores/em-uso                          a sala de reprocessamento (todos os em uso)
//   GET  /api/sessoes/dialisadores/pacientes/:id                   visão por paciente (com o histórico de reprocessamentos)
//   POST /api/sessoes/dialisadores                                 abre o dialisador do paciente
//   POST /api/sessoes/dialisadores/:id/reprocessamentos            registra o reprocessamento (resultado pelo domínio)
//   POST /api/sessoes/dialisadores/:id/descarte                    { motivo, versao } tira de uso
//   POST /api/sessoes/dialisadores/:id/desativacao                 { motivo, versao } aberto por engano
//   POST /api/sessoes/dialisadores/reprocessamentos/:id/cancelamento { motivo, versao } lançado por engano
// O reprocessamento é registro da enfermagem da diálise: lê quem vê a linha do tempo da enfermagem ou a agenda de
// sessões, e registra quem checa o cuidado de enfermagem (enfermeiro e técnico).
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
import { PERMISSOES_SESSOES } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_DIALISADOR, type PortaDialisadorPropria } from './dialisador-propria.js';

export const PERMISSOES_DIALISADOR = {
  ler: 'enfermagem.horario.ler',
  lerAgenda: PERMISSOES_SESSOES.ler,
  registrar: 'enfermagem.cuidado.checar',
} as const;

const AUDITORIA = 'dialisador e reprocessamento pelo executor (trilha na mesma transação)';

@Controller('sessoes/dialisadores')
export class DialisadorController {
  constructor(
    @Optional() @Inject(PORTA_DIALISADOR) private readonly porta: PortaDialisadorPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaDialisadorPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('em-uso')
  @Permissao(PERMISSOES_DIALISADOR.ler)
  @PermissaoOu(PERMISSOES_DIALISADOR.lerAgenda)
  emUso(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.emUso(c) }));
  }

  @Get('pacientes/:id')
  @Permissao(PERMISSOES_DIALISADOR.ler)
  @PermissaoOu(PERMISSOES_DIALISADOR.lerAgenda)
  doPaciente(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, async (p, c) => ({ itens: await p.doPaciente(c, id) }));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_DIALISADOR.registrar)
  @AuditadoNoHandler(AUDITORIA)
  abrir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.abrir(c, corpo));
  }

  @Post(':id/reprocessamentos')
  @HttpCode(201)
  @Permissao(PERMISSOES_DIALISADOR.registrar)
  @AuditadoNoHandler(AUDITORIA)
  reprocessar(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.reprocessar(c, id, corpo));
  }

  @Post(':id/descarte')
  @HttpCode(200)
  @Permissao(PERMISSOES_DIALISADOR.registrar)
  @AuditadoNoHandler(AUDITORIA)
  descartar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.descartar(c, id, corpo));
  }

  @Post(':id/desativacao')
  @HttpCode(200)
  @Permissao(PERMISSOES_DIALISADOR.registrar)
  @AuditadoNoHandler(AUDITORIA)
  desativar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.desativar(c, id, corpo));
  }

  @Post('reprocessamentos/:id/cancelamento')
  @HttpCode(200)
  @Permissao(PERMISSOES_DIALISADOR.registrar)
  @AuditadoNoHandler(AUDITORIA)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelarReprocessamento(c, id, corpo));
  }
}
