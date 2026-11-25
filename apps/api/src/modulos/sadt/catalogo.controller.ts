// Manutenção do catálogo de exames do diagnóstico (F3.5, análise 05-SADT linhas 1 a 3): uma ficha por exame.
//   GET  /api/sadt/catalogo/exames?termo&tipo                    lista (código, sigla, nome, tipo, situação)
//   GET  /api/sadt/catalogo/exames/:id                           a ficha inteira (vínculos, faixas e fórmulas)
//   POST /api/sadt/catalogo/exames                               inclui o exame
//   POST /api/sadt/catalogo/exames/:id                           altera o exame (versão vista; desativa sem apagar)
//   POST /api/sadt/catalogo/exames/:id/:tipo                     inclui ou altera o vínculo (setor, material,
//                                                                preparo, lateralidade, ligado, analito)
//   POST /api/sadt/catalogo/exames/:id/procedimentos             procedimento operacional do exame (versão, revisão,
//                                                                aprovação pela conta da sessão; nunca apagado)
//   GET  /api/sadt/catalogo/analitos?termo                       os analitos (campos de resultado) da rede
//   POST /api/sadt/catalogo/analitos[/:id]                       inclui ou altera o analito (sai por inativação)
//   GET  /api/sadt/catalogo/opcoes                               listas dos seletores (setor, material, analito...)
//   POST /api/sadt/catalogo/analitos-exame/:id/faixas            nova versão da faixa (uma ou várias, cobertura)
//   POST /api/sadt/catalogo/analitos-exame/:id/formulas          nova versão da fórmula de cálculo
// Ler: `sadt.catalogo.ler`; gravar: `sadt.catalogo.editar` (o cargo dá o nível de acesso; o administrador pode tudo).
// Toda gravação exige a Idempotency-Key e vai à trilha na mesma transação (Executor).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';
import { contextoOperacao, idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  CATALOGO_SADT,
  ESQUEMAS_VINCULO,
  esquemaExameCatalogo,
  esquemaFaixasCatalogo,
  esquemaParcialVinculo,
  esquemaAnalitoCatalogo,
  esquemaProcedimentoCatalogo,
  esquemaFormulaCatalogo,
  type PortaCatalogoSadtPropria,
  type TipoVinculo,
} from './catalogo-porta-propria.js';

const TIPOS = Object.keys(ESQUEMAS_VINCULO) as TipoVinculo[];

@Controller('api/sadt/catalogo')
export class CatalogoSadtController {
  constructor(@Optional() @Inject(CATALOGO_SADT) private readonly porta: PortaCatalogoSadtPropria | null) {}

  private p(): PortaCatalogoSadtPropria {
    if (!this.porta)
      throw semBancoDoCliente(
        'Catálogo indisponível',
        'O catálogo de exames só existe com o banco do cliente.',
      );
    return this.porta;
  }

  @Get('exames')
  @Permissao('sadt.catalogo.ler')
  listar(
    @Query('termo') termo: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.p().listar(sessaoDe(req).porta, String(termo ?? '').slice(0, 80), tipo ? String(tipo) : null);
  }

  @Get('opcoes')
  @Permissao('sadt.catalogo.ler')
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.p().opcoes(sessaoDe(req).porta);
  }

  @Get('exames/:id')
  @Permissao('sadt.catalogo.ler')
  ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.p().ficha(sessaoDe(req).porta, idDaRota(id));
  }

  @Post('exames')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o exame com a trilha_auditoria na mesma transação (Executor)')
  incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().salvarExame(c, null, corpo(esquemaExameCatalogo, b));
  }

  @Post('exames/:id')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o exame com a trilha_auditoria na mesma transação (Executor)')
  alterar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    // Alteração: só os campos enviados (o que a tela não mandou continua como está no banco).
    const e = corpo(esquemaExameCatalogo.partial(), b);
    if (!e.versao)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Falta a versão vista.');
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().salvarExame(c, idDaRota(id), b);
  }

  @Post('exames/:id/procedimentos')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler(
    'o procedimento operacional do exame com a trilha_auditoria na mesma transação (Executor)',
  )
  procedimento(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const alteracao = Boolean(b && typeof b === 'object' && (b as Record<string, unknown>)['id']);
    const e = corpo(alteracao ? esquemaProcedimentoCatalogo.partial() : esquemaProcedimentoCatalogo, b);
    if (alteracao && !e.versao)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Falta a versão vista.');
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().salvarProcedimento(c, idDaRota(id), b);
  }

  @Get('analitos')
  @Permissao('sadt.catalogo.ler')
  analitos(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.p().analitos(sessaoDe(req).porta, String(termo ?? '').slice(0, 80));
  }

  @Post('analitos')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o analito com a trilha_auditoria na mesma transação (Executor)')
  incluirAnalito(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().salvarAnalito(c, null, corpo(esquemaAnalitoCatalogo, b));
  }

  @Post('analitos/:id')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o analito com a trilha_auditoria na mesma transação (Executor)')
  alterarAnalito(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAnalitoCatalogo.partial(), b);
    if (!e.versao)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Falta a versão vista.');
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().salvarAnalito(c, idDaRota(id), b);
  }

  @Post('exames/:id/:tipo')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o vínculo do exame com a trilha_auditoria na mesma transação (Executor)')
  vinculo(
    @Param('id') id: string,
    @Param('tipo') tipo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    if (!(TIPOS as string[]).includes(tipo))
      throw new ErroProblema('nao-encontrado', 404, 'Vínculo desconhecido', `Use: ${TIPOS.join(', ')}.`);
    const t = tipo as TipoVinculo;
    const alteracao = Boolean(b && typeof b === 'object' && (b as Record<string, unknown>)['id']);
    const e = corpo(esquemaParcialVinculo(t, alteracao), b) as Record<string, unknown>;
    if (alteracao && !e['versao'])
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Falta a versão vista.');
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().salvarVinculo(c, t, idDaRota(id), b);
  }

  @Post('analitos-exame/:id/faixas')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a faixa de referência e a versão com a trilha_auditoria na mesma transação (Executor)')
  faixa(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().novaFaixa(c, idDaRota(id), corpo(esquemaFaixasCatalogo, b));
  }

  @Post('analitos-exame/:id/formulas')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a fórmula e as variáveis com a trilha_auditoria na mesma transação (Executor)')
  formula(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().novaFormula(c, idDaRota(id), corpo(esquemaFormulaCatalogo, b));
  }
}
