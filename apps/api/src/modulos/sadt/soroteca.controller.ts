// Soroteca (F8, 05-SADT linha 9): guarda da amostra em equipamento e rack, retirada com motivo, devolução, prazo de
// descarte pela regra e expurgo registrado (nada se apaga).
//   GET  /api/sadt/soroteca                         equipamentos, racks (mapa e posição sugerida), regras, motivos,
//                                                   guardas ativas e vencidas
//   GET  /api/sadt/soroteca/amostras/:codigo        a amostra pela etiqueta: guarda, movimentos, prazo e as do paciente
//   POST /api/sadt/soroteca/equipamentos            inclui geladeira, freezer ou armário
//   POST /api/sadt/soroteca/suportes                inclui rack ou caixa com linhas e colunas
//   POST /api/sadt/soroteca/regras                  inclui regra de prazo de descarte
//   POST /api/sadt/soroteca/:tipo/:id/desativar     desativa o cadastro (nunca apaga)
//   POST /api/sadt/soroteca/guardas                 guarda a amostra (sem posição: a primeira livre do rack)
//   POST /api/sadt/soroteca/guardas/:id/retirar     retirada com motivo
//   POST /api/sadt/soroteca/guardas/:id/devolver    devolução da retirada provisória
//   POST /api/sadt/soroteca/expurgo                 descarte das vencidas escolhidas, com motivo
// Ler: `sadt.amostra.ler`; cadastro: `sadt.catalogo.editar`; guardar, retirar e devolver: `sadt.amostra.receber`;
// expurgo: `sadt.amostra.rejeitar` (o cargo dá o acesso; o administrador pode tudo).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaDevolver,
  esquemaEquipamento,
  esquemaExpurgo,
  esquemaGuardar,
  esquemaRegraDescarte,
  esquemaRetirar,
  esquemaSuporte,
  type ServicoSoroteca,
  TIPOS_CADASTRO_SOROTECA,
  type TipoCadastroSoroteca,
} from './aplicacao/soroteca-propria.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';

export const SERVICO_SOROTECA = Symbol('SERVICO_SOROTECA');

@Controller('sadt/soroteca')
export class SorotecaController {
  constructor(@Inject(SERVICO_SOROTECA) private readonly servico: ServicoSoroteca | null) {}

  private get s(): ServicoSoroteca {
    if (!this.servico) throw semBancoDoCliente('A soroteca precisa do banco do cliente.');
    return this.servico;
  }

  @Get()
  @Permissao('sadt.amostra.ler')
  painel(@Req() req: RequisicaoAutorizada) {
    return this.s.painel(sessaoDe(req).porta);
  }

  @Get('amostras/:codigo')
  @Permissao('sadt.amostra.ler')
  amostra(@Param('codigo') codigo: string, @Req() req: RequisicaoAutorizada) {
    return this.s.amostra(sessaoDe(req).porta, codigo);
  }

  @Post('equipamentos')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o equipamento com a trilha_auditoria na mesma transação (Executor)')
  equipamento(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirEquipamento(sessaoDe(req).porta, corpo(esquemaEquipamento, b));
  }

  @Post('suportes')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o rack com a trilha_auditoria na mesma transação (Executor)')
  suporte(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirSuporte(sessaoDe(req).porta, corpo(esquemaSuporte, b));
  }

  @Post('regras')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a regra de descarte com a trilha_auditoria na mesma transação (Executor)')
  regra(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirRegra(sessaoDe(req).porta, corpo(esquemaRegraDescarte, b));
  }

  @Post('guardas')
  @HttpCode(200)
  @Permissao('sadt.amostra.receber')
  @AuditadoNoHandler('a guarda e o movimento de entrada com a trilha_auditoria na mesma transação (Executor)')
  guardar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.guardar(sessaoDe(req).porta, corpo(esquemaGuardar, b));
  }

  @Post('guardas/:id/retirar')
  @HttpCode(200)
  @Permissao('sadt.amostra.receber')
  @AuditadoNoHandler('a retirada e o movimento com a trilha_auditoria na mesma transação (Executor)')
  retirar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.retirar(sessaoDe(req).porta, idDaRota(id), corpo(esquemaRetirar, b));
  }

  @Post('guardas/:id/devolver')
  @HttpCode(200)
  @Permissao('sadt.amostra.receber')
  @AuditadoNoHandler('a devolução e o movimento com a trilha_auditoria na mesma transação (Executor)')
  devolver(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.devolver(sessaoDe(req).porta, idDaRota(id), corpo(esquemaDevolver, b));
  }

  @Post('expurgo')
  @HttpCode(200)
  @Permissao('sadt.amostra.rejeitar')
  @AuditadoNoHandler('o descarte e os movimentos com a trilha_auditoria na mesma transação (Executor)')
  expurgar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.expurgar(sessaoDe(req).porta, corpo(esquemaExpurgo, b));
  }

  @Post(':tipo/:id/desativar')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a desativação com a trilha_auditoria na mesma transação (Executor)')
  desativar(@Param('tipo') tipo: string, @Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    if (!(tipo in TIPOS_CADASTRO_SOROTECA))
      throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    return this.s.desativar(sessaoDe(req).porta, tipo as TipoCadastroSoroteca, idDaRota(id));
  }
}
