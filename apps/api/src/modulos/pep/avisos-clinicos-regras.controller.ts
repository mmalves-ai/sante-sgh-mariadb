// Central de regras de aviso clínico (F3.3, 03-PEP L133). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/pep/avisos-clinicos/regras          tipos de aviso, regras, avisos emitidos recentes e opções de alvo
//   POST /api/pep/avisos-clinicos/regras/tipos    cria ou altera o tipo de aviso (o evento clínico)
//   POST /api/pep/avisos-clinicos/regras          cria ou altera a regra (evento, setor/especialidade, canal, alvos)
//   POST /api/pep/avisos-clinicos/regras/emitir   o evento clínico passa pelas regras e gera os avisos
// Ler: pep.admin.ler; gravar e emitir: pep.admin.editar. A gravação vai à trilha pelo executor (mesma transação).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_REGRAS_AVISO_CLINICO,
  type PortaRegrasAvisoClinicoPropria,
} from './avisos-clinicos-regras-propria.js';

const LER = 'pep.admin.ler';
const EDITAR = 'pep.admin.editar';

@Controller('pep/avisos-clinicos/regras')
export class AvisosClinicosRegrasController {
  constructor(
    @Optional()
    @Inject(PORTA_REGRAS_AVISO_CLINICO)
    private readonly porta: PortaRegrasAvisoClinicoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaRegrasAvisoClinicoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(LER)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painel(c));
  }

  @Post('tipos')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler('o tipo de aviso clínico vai à trilha pelo executor (mesma transação)')
  gravarTipo(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarTipo(c, corpo));
  }

  @Post()
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler('a regra de aviso clínico e a versão vão à trilha pelo executor (mesma transação)')
  gravarRegra(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarRegra(c, corpo));
  }

  @Post('emitir')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler('os avisos clínicos emitidos vão à trilha pelo executor (mesma transação)')
  emitir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.emitir(c, corpo));
  }
}
