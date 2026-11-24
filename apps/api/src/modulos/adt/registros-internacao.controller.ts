// Registros da internação além do retrato da admissão (F3.4, 04-INT linhas 65, 67 e 68):
//   GET  /api/internacoes/:reg/registros                    diagnósticos, acidente e guias (inicial e prorrogações)
//   POST /api/internacoes/:reg/diagnosticos                 internacao.registrarDiagnostico
//   POST /api/internacoes/:reg/diagnosticos/:seq/retirada   internacao.retirarDiagnostico (motivo; nunca apaga)
//   POST /api/internacoes/:reg/acidentes                    internacao.registrarAcidente
//   POST /api/internacoes/:reg/guias/:seq/correcao          internacao.corrigirGuia (motivo; sem linha nova)
//   GET  /api/cadastros/estrutura/unidades/:id/operadores   quem opera a unidade (admitir, transferir, dar alta)
//   POST /api/cadastros/estrutura/unidades/:id/operadores   internacao.definirOperadoresUnidade (lista inteira)
// A guia e a prorrogação continuam pela rota da guia (POST /api/internacoes/:reg/guias), que agora grava o histórico.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ApoiosAdt, ctxAdt } from './apoios.js';
import { PORTA_ADT, type PortaAdt } from './porta.js';
import { PortaAdtPropria } from './porta-propria.js';
import {
  esquemaCorrigirGuia,
  esquemaDefinirOperadoresUnidade,
  esquemaRegistrarAcidente,
  esquemaRegistrarDiagnostico,
  esquemaRetirarDiagnostico,
  lerOperadoresDaUnidade,
  lerRegistrosDaInternacao,
  type OperadorDaUnidade,
  type RegistrosDaInternacao,
} from './registros-internacao.js';

const naoEncontrado = (o: string) =>
  new ErroProblema(
    'registro-inexistente',
    404,
    `${o} não encontrada`,
    `${o} não existe neste estabelecimento.`,
  );

@Controller()
export class RegistrosInternacaoController {
  private readonly apoios: ApoiosAdt;

  constructor(
    @Inject(PORTA_ADT) private readonly porta: PortaAdt,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoios = new ApoiosAdt(porta, trilha, configuracao, cache);
  }

  private propria(): PortaAdtPropria {
    if (this.porta instanceof PortaAdtPropria) return this.porta;
    throw new ErroProblema(
      'indisponivel',
      503,
      'Indisponível',
      'Os registros da internação exigem o banco do cliente.',
    );
  }

  @Get('internacoes/:reg/registros')
  @Permissao('internacao.internacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.internacaoLida.codigo)
  async registros(
    @Param('reg') reg: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistrosDaInternacao> {
    const id = idDaRota(reg);
    const r = await this.propria().lerNoEstabelecimento(ctxAdt(sessaoDe(req)), (l, est, fuso) =>
      lerRegistrosDaInternacao(l, est, fuso, id),
    );
    if (!r) throw naoEncontrado('Internação');
    req.sghAlvo = { tabelaAlvo: 'internacao', idAlvo: String(id) };
    return r;
  }

  @Post('internacoes/:reg/diagnosticos')
  @HttpCode(201)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler('internacao.registrarDiagnostico pelo executor (trilha na mesma transação)')
  diagnostico(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaRegistrarDiagnostico, { ...(b as object), internacao: idDaRota(reg) });
    return this.apoios.adt.executar(
      sessaoDe(req),
      'internacao.registrarDiagnostico',
      e,
      'Diagnóstico registrado.',
    );
  }

  @Post('internacoes/:reg/diagnosticos/:seq/retirada')
  @HttpCode(200)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler('internacao.retirarDiagnostico pelo executor (trilha na mesma transação)')
  retirarDiagnostico(
    @Param('reg') reg: string,
    @Param('seq') seq: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const e = corpo(esquemaRetirarDiagnostico, {
      ...(b as object),
      internacao: idDaRota(reg),
      sequencia: idDaRota(seq),
    });
    return this.apoios.adt.executar(
      sessaoDe(req),
      'internacao.retirarDiagnostico',
      e,
      'Diagnóstico retirado.',
    );
  }

  @Post('internacoes/:reg/guias/:seq/correcao')
  @HttpCode(200)
  @Permissao('internacao.guia.editar')
  @AuditadoNoHandler('internacao.corrigirGuia pelo executor (trilha na mesma transação)')
  corrigirGuia(
    @Param('reg') reg: string,
    @Param('seq') seq: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const e = corpo(esquemaCorrigirGuia, {
      ...(b as object),
      internacao: idDaRota(reg),
      sequencia: idDaRota(seq),
    });
    return this.apoios.adt.executar(sessaoDe(req), 'internacao.corrigirGuia', e, 'Guia corrigida.');
  }

  @Post('internacoes/:reg/acidentes')
  @HttpCode(201)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler('internacao.registrarAcidente pelo executor (trilha na mesma transação)')
  acidente(@Param('reg') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaRegistrarAcidente, { ...(b as object), internacao: idDaRota(reg) });
    return this.apoios.adt.executar(sessaoDe(req), 'internacao.registrarAcidente', e, 'Acidente registrado.');
  }

  @Get('cadastros/estrutura/unidades/:id/operadores')
  @Permissao('organizacao.leito.ler')
  @Auditar(EVENTOS_AUDITAVEIS.estruturaConsultada.codigo)
  async operadores(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<OperadorDaUnidade[]> {
    const u = idDaRota(id);
    const r = await this.propria().lerNoEstabelecimento(ctxAdt(sessaoDe(req)), (l, est) =>
      lerOperadoresDaUnidade(l, est, u),
    );
    if (!r) throw naoEncontrado('Unidade de internação');
    return r;
  }

  @Post('cadastros/estrutura/unidades/:id/operadores')
  @HttpCode(200)
  @Permissao('organizacao.leito.editar')
  @AuditadoNoHandler('internacao.definirOperadoresUnidade pelo executor (trilha na mesma transação)')
  definirOperadores(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaDefinirOperadoresUnidade, { ...(b as object), unidade: idDaRota(id) });
    return this.apoios.adt.executar(
      sessaoDe(req),
      'internacao.definirOperadoresUnidade',
      e,
      'Operadores da unidade gravados.',
    );
  }
}
