// Limites do pedido de exame (F8, 05-SADT linha 6): cota por período, intervalo de repetição (inclusive no mesmo dia)
// e bloqueio pelo último resultado. O pedido de exames confere tudo na hora (POST /api/sadt/pedidos/avaliar) e na
// gravação; aqui fica o cadastro.
//   GET  /api/sadt/limites                          cotas (com o uso no período), intervalos e bloqueios
//   POST /api/sadt/limites/cotas                    inclui uma cota
//   POST /api/sadt/limites/intervalos               inclui um intervalo (sem conflitante: a repetição do exame)
//   POST /api/sadt/limites/resultados               inclui um bloqueio pelo último resultado
//   POST /api/sadt/limites/:tipo/:id/desativar      desativa (nunca apaga)
// Ler: `sadt.catalogo.ler`; gravar: `sadt.catalogo.editar` (o cargo dá o acesso; o administrador pode tudo). O bloqueio
// pelo resultado é do estabelecimento da sessão; o de alcance global (`global: true`) só o administrador da plataforma
// cadastra ou desativa.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaBloqueioResultado,
  esquemaCota,
  esquemaIntervalo,
  type ServicoLimitesExame,
  TIPOS_LIMITE,
  type TipoCadastroLimite,
} from './aplicacao/limites-exame-propria.js';

export const SERVICO_LIMITES_EXAME = Symbol('SERVICO_LIMITES_EXAME');

/** O administrador da plataforma (pode tudo, ADR 0002): só ele cadastra ou desativa a regra de alcance global. */
const administradorDe = (req: RequisicaoAutorizada) => req.sgh?.sessao.usuario.ator === 'plataforma';

@Controller('sadt/limites')
export class LimitesExameController {
  constructor(@Inject(SERVICO_LIMITES_EXAME) private readonly servico: ServicoLimitesExame | null) {}

  private get s(): ServicoLimitesExame {
    if (!this.servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Os limites do pedido de exame precisam do banco do cliente.',
      );
    return this.servico;
  }

  @Get()
  @Permissao('sadt.catalogo.ler')
  listar(@Req() req: RequisicaoAutorizada) {
    return this.s.listar(sessaoDe(req).porta);
  }

  @Post('cotas')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a cota com a trilha_auditoria na mesma transação (Executor)')
  cota(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirCota(sessaoDe(req).porta, corpo(esquemaCota, b));
  }

  @Post('intervalos')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o intervalo com a trilha_auditoria na mesma transação (Executor)')
  intervalo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirIntervalo(sessaoDe(req).porta, corpo(esquemaIntervalo, b));
  }

  @Post('resultados')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o bloqueio com a trilha_auditoria na mesma transação (Executor)')
  resultado(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirBloqueioResultado(sessaoDe(req).porta, corpo(esquemaBloqueioResultado, b), {
      administrador: administradorDe(req),
    });
  }

  @Post(':tipo/:id/desativar')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a desativação com a trilha_auditoria na mesma transação (Executor)')
  desativar(@Param('tipo') tipo: string, @Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    if (!(tipo in TIPOS_LIMITE)) throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    return this.s.desativar(sessaoDe(req).porta, tipo as TipoCadastroLimite, idDaRota(id), {
      administrador: administradorDe(req),
    });
  }
}
