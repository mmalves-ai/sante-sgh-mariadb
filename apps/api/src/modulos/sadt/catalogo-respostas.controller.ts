// Respostas e textos padrão do catálogo do diagnóstico (F3.5, análise 05-SADT linha 3), ao lado da ficha do exame:
//   GET  /api/sadt/catalogo/grupos-resposta?termo        os grupos de respostas fechadas da rede, com as respostas
//   POST /api/sadt/catalogo/grupos-resposta[/:id]        inclui ou altera o grupo e as respostas (sai por inativação)
//   GET  /api/sadt/catalogo/textos-padrao?exame          os textos padrão do exame
//   POST /api/sadt/catalogo/textos-padrao                inclui ou altera (com id) o texto padrão do exame
// A ligação do grupo ao analito do exame é o vínculo "analito" da ficha (POST exames/:id/analito, grupoRespostaId).
// Ler: `sadt.catalogo.ler`; gravar: `sadt.catalogo.editar`. Toda gravação exige a Idempotency-Key e vai à trilha na
// mesma transação (Executor).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaGrupoResposta,
  esquemaTextoPadrao,
  type PortaRespostasSadtPropria,
  RESPOSTAS_SADT,
} from './catalogo-respostas-propria.js';

@Controller('api/sadt/catalogo')
export class CatalogoRespostasSadtController {
  constructor(@Optional() @Inject(RESPOSTAS_SADT) private readonly porta: PortaRespostasSadtPropria | null) {}

  private p(): PortaRespostasSadtPropria {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Catálogo indisponível',
        'As respostas e os textos padrão só existem com o banco do cliente.',
      );
    return this.porta;
  }

  @Get('grupos-resposta')
  @Permissao('sadt.catalogo.ler')
  grupos(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.p().grupos(sessaoDe(req).porta, String(termo ?? '').slice(0, 80));
  }

  @Post('grupos-resposta')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler(
    'o grupo de respostas e as respostas com a trilha_auditoria na mesma transação (Executor)',
  )
  incluirGrupo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().salvarGrupo(c, null, corpo(esquemaGrupoResposta, b));
  }

  @Post('grupos-resposta/:id')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler(
    'o grupo de respostas e as respostas com a trilha_auditoria na mesma transação (Executor)',
  )
  alterarGrupo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaGrupoResposta.partial(), b);
    if (!e.versao)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Falta a versão vista.');
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().salvarGrupo(c, idDaRota(id), b);
  }

  @Get('textos-padrao')
  @Permissao('sadt.catalogo.ler')
  textos(@Query('exame') exame: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.p().textos(sessaoDe(req).porta, idDaRota(String(exame ?? '')));
  }

  @Post('textos-padrao')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o texto padrão do exame com a trilha_auditoria na mesma transação (Executor)')
  texto(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const alteracao = Boolean(b && typeof b === 'object' && (b as Record<string, unknown>)['id']);
    const e = corpo(alteracao ? esquemaTextoPadrao.partial() : esquemaTextoPadrao, b);
    if (alteracao && !e.versao)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Falta a versão vista.');
    const c = contextoOperacao(sessaoDe(req), 'sadt.catalogo');
    return this.p().salvarTexto(c, b);
  }
}
