// Entrega de resultados (F3.5, 05-SADT linha 21): o balcão (visão por paciente e protocolo de entrega) e o cadastro
// do prazo de entrega por setor e exame, do exame restrito no portal e do perfil do portal.
//   GET  /api/sadt/entregas/balcao?busca=           o paciente pelo número do pedido ou do atendimento: o que está
//                                                    pronto, o que falta (com a previsão) e os protocolos já emitidos
//   POST /api/sadt/entregas                          registra a entrega (protocolo numerado)
//   GET  /api/sadt/entregas/protocolo/:id            o protocolo, para a impressão
//   POST /api/sadt/entregas/protocolo/:id/cancelar   cancela com o motivo (nunca apaga)
//   GET  /api/sadt/entregas/cadastro                 prazos, exames restritos e perfis do portal
//   POST /api/sadt/entregas/prazos                   inclui um prazo (substitui o anterior da mesma combinação)
//   POST /api/sadt/entregas/restricoes               inclui ou muda a restrição do exame no portal
//   POST /api/sadt/entregas/perfis                   inclui ou altera um perfil do portal (com os setores)
//   POST /api/sadt/entregas/:tipo/:id/desativar      desativa prazo, restrição ou perfil (nunca apaga)
// Balcão: ler com `sadt.laudo.ler`, entregar e cancelar com `sadt.laudo.imprimir`. Cadastro: `sadt.catalogo.ler` e
// `sadt.catalogo.editar`. O que vale em todos os estabelecimentos (`global: true`) só o administrador da plataforma
// cadastra ou desativa.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaCancelarEntrega,
  esquemaPerfilPortal,
  esquemaPrazoEntrega,
  esquemaRegistrarEntrega,
  esquemaRestricaoPortal,
  type ServicoEntregaResultado,
  type TipoCadastroEntrega,
  TIPOS_CADASTRO_ENTREGA,
} from './aplicacao/entrega-resultado-propria.js';

export const SERVICO_ENTREGA_RESULTADO = Symbol('SERVICO_ENTREGA_RESULTADO');

/** O administrador da plataforma (pode tudo, ADR 0002): só ele mexe no que vale em todos os estabelecimentos. */
const administradorDe = (req: RequisicaoAutorizada) => req.sgh?.sessao.usuario.ator === 'plataforma';

@Controller('sadt/entregas')
export class EntregaResultadoController {
  constructor(@Inject(SERVICO_ENTREGA_RESULTADO) private readonly servico: ServicoEntregaResultado | null) {}

  private get s(): ServicoEntregaResultado {
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'A entrega de resultados precisa do banco do cliente.');
    return this.servico;
  }

  @Get('balcao')
  @Permissao('sadt.laudo.ler')
  balcao(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.s.balcao(sessaoDe(req).porta, String(busca ?? ''));
  }

  @Get('cadastro')
  @Permissao('sadt.catalogo.ler')
  cadastro(@Req() req: RequisicaoAutorizada) {
    return this.s.cadastro(sessaoDe(req).porta);
  }

  @Get('protocolo/:id')
  @Permissao('sadt.laudo.ler')
  async protocolo(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const p = await this.s.protocolo(sessaoDe(req).porta, idDaRota(id));
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Protocolo não encontrado');
    return p;
  }

  @Post()
  @HttpCode(200)
  @Permissao('sadt.laudo.imprimir')
  @AuditadoNoHandler('o protocolo de entrega com a trilha_auditoria na mesma transação (Executor)')
  registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.registrar(sessaoDe(req).porta, corpo(esquemaRegistrarEntrega, b));
  }

  @Post('protocolo/:id/cancelar')
  @HttpCode(200)
  @Permissao('sadt.laudo.imprimir')
  @AuditadoNoHandler('o cancelamento com o motivo e a trilha_auditoria na mesma transação (Executor)')
  cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.cancelar(sessaoDe(req).porta, idDaRota(id), corpo(esquemaCancelarEntrega, b));
  }

  @Post('prazos')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o prazo com a trilha_auditoria na mesma transação (Executor)')
  prazo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirPrazo(sessaoDe(req).porta, corpo(esquemaPrazoEntrega, b));
  }

  @Post('restricoes')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a restrição com a trilha_auditoria na mesma transação (Executor)')
  restricao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.incluirRestricao(sessaoDe(req).porta, corpo(esquemaRestricaoPortal, b), {
      administrador: administradorDe(req),
    });
  }

  @Post('perfis')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('o perfil e os setores com a trilha_auditoria na mesma transação (Executor)')
  perfil(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.salvarPerfil(sessaoDe(req).porta, corpo(esquemaPerfilPortal, b), {
      administrador: administradorDe(req),
    });
  }

  @Post(':tipo/:id/desativar')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a desativação com a trilha_auditoria na mesma transação (Executor)')
  desativar(@Param('tipo') tipo: string, @Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    if (!(TIPOS_CADASTRO_ENTREGA as readonly string[]).includes(tipo))
      throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    return this.s.desativar(sessaoDe(req).porta, tipo as TipoCadastroEntrega, idDaRota(id), {
      administrador: administradorDe(req),
    });
  }
}
