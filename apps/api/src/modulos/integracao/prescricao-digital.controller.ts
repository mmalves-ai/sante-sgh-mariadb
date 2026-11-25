// Rotas da prescrição digital por plataforma externa (F8, 08-INTG L132; sem chave de liberação: só a permissão):
//   GET  /api/integracoes/prescricao-digital/plataformas           plataformas ativas (sistema externo com parceiro API)
//   GET  /api/integracoes/prescricao-digital/pacientes?busca=      pacientes com receita (nome ou prontuário)
//   GET  /api/integracoes/prescricao-digital/paciente/:p           visão por paciente: receitas, assinatura e envios
//   GET  /api/integracoes/prescricao-digital/envios?situacao=      envios do estabelecimento (acompanhamento)
//   POST /api/integracoes/prescricao-digital/envios                envia a receita assinada (fila de saída)
//   POST /api/integracoes/prescricao-digital/envios/:id/cancelar   cancela o envio (motivo e versão lida)
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
import { SITUACOES_PRESCRICAO_DIGITAL } from '@sgh/dominio-integracao';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import type { ContextoComunicacao } from './comunicacao-base-propria.js';
import {
  PORTA_PRESCRICAO_DIGITAL,
  type PortaPrescricaoDigitalPropria,
} from './prescricao-digital-propria.js';

export const PERMISSOES_PRESCRICAO_DIGITAL = {
  ler: 'pep.prescricaoDigital.ler',
  enviar: 'pep.prescricaoDigital.enviar',
} as const;
const TRILHA = 'envio e cancelamento da prescrição digital pelo executor (trilha na mesma transação)';

@Controller('integracoes/prescricao-digital')
export class PrescricaoDigitalController {
  constructor(
    @Optional()
    @Inject(PORTA_PRESCRICAO_DIGITAL)
    private readonly porta: PortaPrescricaoDigitalPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaPrescricaoDigitalPropria, c: ContextoComunicacao) => Promise<T>,
  ): Promise<T> {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta as ContextoComunicacao).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('plataformas')
  @Permissao(PERMISSOES_PRESCRICAO_DIGITAL.ler)
  plataformas(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.plataformas(c) }));
  }

  @Get('pacientes')
  @Permissao(PERMISSOES_PRESCRICAO_DIGITAL.ler)
  pacientes(@Req() req: RequisicaoAutorizada, @Query('busca') busca?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.pacientes(c, (busca ?? '').slice(0, 100)) }));
  }

  @Get('paciente/:p')
  @Permissao(PERMISSOES_PRESCRICAO_DIGITAL.ler)
  doPaciente(@Req() req: RequisicaoAutorizada, @Param('p', ParseIntPipe) paciente: number) {
    return this.com(req, async (p, c) => ({ receitas: await p.doPaciente(c, paciente) }));
  }

  @Get('envios')
  @Permissao(PERMISSOES_PRESCRICAO_DIGITAL.ler)
  envios(@Req() req: RequisicaoAutorizada, @Query('situacao') situacao?: string) {
    const s = (SITUACOES_PRESCRICAO_DIGITAL as readonly string[]).includes(situacao ?? '') ? situacao! : null;
    return this.com(req, async (p, c) => ({ itens: await p.envios(c, s) }));
  }

  @Post('envios')
  @HttpCode(201)
  @Permissao(PERMISSOES_PRESCRICAO_DIGITAL.enviar)
  @AuditadoNoHandler(TRILHA)
  enviar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.enviar(c, corpo));
  }

  @Post('envios/:id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_PRESCRICAO_DIGITAL.enviar)
  @AuditadoNoHandler(TRILHA)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }
}
