// Telas internas do portal do paciente (M50, etapa 1; ficha, seção 7): a conta do portal na ficha do paciente (situação,
// convite, bloqueio, desbloqueio com o acesso refeito, encerramento e o responsável sem cadastro no balcão) e a
// conferência dos responsáveis legais. Sessão interna (@Permissao, CSRF da plataforma); as ações críticas pedem a senha
// de novo (reautenticação), exceto na sessão sintética sem cookie de dev/ci. Prefixo `portal-paciente` (o
// `/api/portal/...` é o portal de resultados do M26).
//   GET  /api/portal-paciente/pacientes/:id/conta          portal.conta.ler
//   POST /api/portal-paciente/pacientes/:id/convite        portal.conta.convidar
//   POST /api/portal-paciente/pacientes/:id/responsavel    portal.conta.convidar + portal.vinculo.conferir (crítica)
//   POST /api/portal-paciente/contas/:conta/bloqueio       portal.conta.bloquear (crítica)
//   POST /api/portal-paciente/contas/:conta/desbloqueio    portal.conta.bloquear (crítica)
//   POST /api/portal-paciente/contas/:conta/encerramento   portal.conta.encerrar (crítica)
//   GET  /api/portal-paciente/contas/:conta/email/troca     portal.conta.ler (W0-10: o pedido pendente)
//   POST /api/portal-paciente/contas/:conta/email           portal.conta.trocarEmail (crítica; link no e-mail novo)
//   POST /api/portal-paciente/contas/:conta/email/troca/cancelamento   portal.conta.trocarEmail (crítica)
//   POST /api/portal-paciente/contas/:conta/segundo-fator/redefinicao  portal.conta.bloquear (crítica; convite novo)
//   GET  /api/portal-paciente/simulador/mensagens?conta=    portal.conta.ler (só dev/ci: a caixa do simulador)
//   GET  /api/portal-paciente/pacientes/:id/responsaveis   portal.vinculo.conferir (os vigentes do paciente)
//   GET  /api/portal-paciente/copias?pendentes=&paciente= · GET copias/:protocolo/atos · POST copias   portal.copia.conferir
//   POST /api/portal-paciente/copias/:protocolo/legitimidade|geracao|entrega   portal.copia.conferir (legitimidade e
//        entrega críticas, com reautenticação; a geração devolve o PDF)
//   GET  /api/portal-paciente/vinculos?situacao=&prontuario=&depoisDe=   portal.vinculo.conferir (uma página)
//   GET  /api/portal-paciente/vinculos/:id/prova           portal.vinculo.conferir
//   POST /api/portal-paciente/vinculos/:id/decisao         portal.vinculo.conferir (crítica)
//   POST /api/portal-paciente/vinculos/:id/encerramento    portal.vinculo.conferir (crítica)
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  esquemaBloquearContaPortal,
  esquemaConvidarContaPortal,
  esquemaConvidarResponsavelBalcao,
  esquemaDecidirVinculo,
  esquemaDesbloquearContaPortal,
  esquemaConferirLegitimidadeCopia,
  esquemaEncerrarContaPortal,
  esquemaEntregarCopia,
  esquemaFiltroFilaCopias,
  esquemaGerarCopia,
  esquemaPedirCopiaBalcao,
  esquemaEncerrarVinculo,
  esquemaRedefinirSegundoFatorPortal,
  esquemaTrocarEmailContaPortal,
  PERMISSOES_CODIGOS_PORTAL as P,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { exigir, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { CanalSimulador } from './aplicacao/canal.js';
import type { QuemInterno, ServicoPortalPaciente } from './aplicacao/servico.js';
import { SERVICO_PORTAL_PACIENTE } from './portal-paciente.controller.js';

interface Res {
  header(nome: string, valor: string | string[]): unknown;
}
const protocoloDaRota = (p: string): string => {
  if (!/^\d{4}-\d{6}$/.test(p))
    throw new ErroProblema('nao-encontrado', 404, 'Cópia não encontrada', 'Protocolo inválido.');
  return p;
};

const id = (v: string): number => {
  if (!/^[1-9]\d{0,17}$/.test(v)) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
  return Number(v);
};
const SITUACOES = new Set(['pendente', 'ativo', 'recusado', 'encerrado']);

/** O corpo sem a senha da reautenticação (os esquemas do contrato são estritos). */
function semSenha(b: unknown): { resto: Record<string, unknown>; senha: string | undefined } {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const { senha, ...resto } = o;
  return { resto, senha: typeof senha === 'string' ? senha : undefined };
}

@Controller('portal-paciente')
export class PortalPacienteInternoController implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(SERVICO_PORTAL_PACIENTE) private readonly portal: ServicoPortalPaciente,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
  ) {}

  /**
   * O job da vigência (maioridade, validade, óbito, unificação) só sobre o banco e fora de dev/ci (em dev a cópia é
   * compartilhada; o job é provado pelos testes). PORTAL_VIGENCIA=nao desliga; PORTAL_VIGENCIA_MS muda o intervalo.
   */
  onApplicationBootstrap(): void {
    const amb = (process.env['AMBIENTE'] ?? 'dev').trim();
    if (
      this.portal.destino !== 'legado' ||
      amb === 'dev' ||
      amb === 'ci' ||
      process.env['PORTAL_VIGENCIA'] === 'nao'
    )
      return;
    const ms = Math.min(
      Math.max(Number(process.env['PORTAL_VIGENCIA_MS'] ?? '') || 6 * 3_600_000, 60_000),
      86_400_000,
    );
    this.portal.iniciarVigia(ms);
  }

  onApplicationShutdown(): void {
    this.portal.pararVigia();
  }

  private quem(req: RequisicaoAutorizada): QuemInterno {
    const s = sessaoDe(req);
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      estacao: estacaoDaRequisicao(req),
      correlacao: correlacaoDaRequisicao(req, 'portal-paciente'),
      origem: null,
    };
  }

  private async reautenticado(req: RequisicaoAutorizada, senha: string | undefined): Promise<void> {
    if (this.portal.destino === 'memoria' && !req.sgh?.real) return;
    await reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  @Get('pacientes/:id/conta')
  @Header('cache-control', 'no-store')
  @Permissao(P.contaLer)
  async conta(@Param('id') paciente: string, @Req() req: RequisicaoAutorizada) {
    const q = this.quem(req);
    return {
      conta: await this.portal.contaDoPaciente(q, id(paciente)),
      ligado: await this.portal.ligado(q.hospital),
    };
  }

  @Post('pacientes/:id/convite')
  @HttpCode(201)
  @Permissao(P.contaConvidar)
  @AuditadoNoHandler('portal.criarConta: SGH_POR_CONTA com a SGH_TRILHA na mesma transação')
  convidar(@Param('id') paciente: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
    return this.portal.convidar(
      this.quem(req),
      corpo(esquemaConvidarContaPortal, { ...o, idPaciente: id(paciente) }),
    );
  }

  @Post('pacientes/:id/responsavel')
  @HttpCode(201)
  @Permissao(P.contaConvidar)
  @AuditadoNoHandler(
    'portal.vincularResponsavel (balcão): SGH_POR_CONTA e SGH_POR_RESPONSAVEL com a SGH_TRILHA',
  )
  async responsavel(@Param('id') titular: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    await exigir(sessaoDe(req), P.vinculoConferir, this.trilha);
    const { resto, senha } = semSenha(b);
    const e = corpo(esquemaConvidarResponsavelBalcao, { ...resto, idTitular: id(titular) });
    await this.reautenticado(req, senha);
    return this.portal.convidarResponsavel(this.quem(req), e);
  }

  @Post('contas/:conta/bloqueio')
  @HttpCode(200)
  @Permissao(P.contaBloquear)
  @AuditadoNoHandler('portal.bloquearConta: SGH_POR_CONTA com a SGH_TRILHA na mesma transação')
  async bloquear(@Param('conta') conta: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { resto, senha } = semSenha(b);
    const e = corpo(esquemaBloquearContaPortal, { ...resto, conta: String(id(conta)) });
    await this.reautenticado(req, senha);
    return this.portal.bloquear(this.quem(req), e);
  }

  @Post('contas/:conta/desbloqueio')
  @HttpCode(200)
  @Permissao(P.contaBloquear)
  @AuditadoNoHandler('portal.bloquearConta (desbloqueio ou acesso refeito): SGH_POR_CONTA com a SGH_TRILHA')
  async desbloquear(@Param('conta') conta: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { resto, senha } = semSenha(b);
    const e = corpo(esquemaDesbloquearContaPortal, { ...resto, conta: String(id(conta)) });
    await this.reautenticado(req, senha);
    return this.portal.desbloquear(this.quem(req), e);
  }

  @Post('contas/:conta/encerramento')
  @HttpCode(200)
  @Permissao(P.contaEncerrar)
  @AuditadoNoHandler(
    'portal.encerrarConta: SGH_POR_CONTA (e os vínculos) com a SGH_TRILHA na mesma transação',
  )
  async encerrar(@Param('conta') conta: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { resto, senha } = semSenha(b);
    const e = corpo(esquemaEncerrarContaPortal, { ...resto, conta: String(id(conta)) });
    await this.reautenticado(req, senha);
    return this.portal.encerrar(this.quem(req), e);
  }

  @Get('contas/:conta/email/troca')
  @Header('cache-control', 'no-store')
  @Permissao(P.contaLer)
  async trocaEmail(@Param('conta') conta: string, @Req() req: RequisicaoAutorizada) {
    return { troca: await this.portal.trocaEmailDaConta(this.quem(req), String(id(conta))) };
  }

  @Post('contas/:conta/email')
  @HttpCode(202)
  @Permissao(P.contaTrocarEmail)
  @AuditadoNoHandler('portal.trocarEmail (balcão): SGH_POR_TROCA_EMAIL com a SGH_TRILHA na mesma transação')
  async trocarEmail(@Param('conta') conta: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { resto, senha } = semSenha(b);
    const e = corpo(esquemaTrocarEmailContaPortal, { ...resto, conta: String(id(conta)) });
    await this.reautenticado(req, senha);
    return this.portal.trocarEmailNoBalcao(this.quem(req), e);
  }

  @Post('contas/:conta/email/troca/cancelamento')
  @HttpCode(204)
  @Permissao(P.contaTrocarEmail)
  @AuditadoNoHandler('portal.trocarEmail (cancelada no balcão): SGH_POR_TROCA_EMAIL com a SGH_TRILHA')
  async cancelarTrocaEmail(
    @Param('conta') conta: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    await this.reautenticado(req, semSenha(b).senha);
    await this.portal.cancelarTrocaEmailNoBalcao(this.quem(req), String(id(conta)));
  }

  @Post('contas/:conta/segundo-fator/redefinicao')
  @HttpCode(200)
  @Permissao(P.contaBloquear)
  @AuditadoNoHandler(
    'portal.bloquearConta (segundo fator redefinido, convite novo): SGH_POR_CONTA com a SGH_TRILHA',
  )
  async redefinirSegundoFator(
    @Param('conta') conta: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const { resto, senha } = semSenha(b);
    const e = corpo(esquemaRedefinirSegundoFatorPortal, { ...resto, conta: String(id(conta)) });
    await this.reautenticado(req, senha);
    return this.portal.redefinirSegundoFator(this.quem(req), e);
  }

  // ── W0-10 (M2): a fila da cópia do prontuário (portal e balcão) ──

  @Get('copias')
  @Header('cache-control', 'no-store')
  @Permissao(P.copiaConferir)
  filaCopias(
    @Query('pendentes') pendentes: string | undefined,
    @Query('paciente') paciente: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const f = corpo(esquemaFiltroFilaCopias, {
      pendentes: pendentes !== 'nao',
      ...(paciente ? { paciente: id(paciente) } : {}),
    });
    return this.portal.filaCopias(this.quem(req), f);
  }

  @Get('copias/:protocolo/atos')
  @Header('cache-control', 'no-store')
  @Permissao(P.copiaConferir)
  atosDaCopia(@Param('protocolo') protocolo: string, @Req() req: RequisicaoAutorizada) {
    return this.portal.atosDaCopia(this.quem(req), protocoloDaRota(protocolo));
  }

  @Post('copias')
  @HttpCode(201)
  @Permissao(P.copiaConferir)
  @AuditadoNoHandler(
    'portal.registrarPedidoTitular e portal.copiaProntuario (balcão): SGH_AUD_PEDIDO_TITULAR e SGH_AUD_COPIA_ATO com a SGH_TRILHA',
  )
  pedirCopia(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.portal.pedirCopiaNoBalcao(this.quem(req), corpo(esquemaPedirCopiaBalcao, b));
  }

  @Post('copias/:protocolo/legitimidade')
  @HttpCode(204)
  @Permissao(P.copiaConferir)
  @AuditadoNoHandler('portal.copiaProntuario (legitimidade): SGH_AUD_COPIA_ATO com a SGH_TRILHA')
  async legitimidadeCopia(
    @Param('protocolo') protocolo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const { resto, senha } = semSenha(b);
    const e = corpo(esquemaConferirLegitimidadeCopia, { ...resto, protocolo: protocoloDaRota(protocolo) });
    await this.reautenticado(req, senha);
    await this.portal.conferirLegitimidadeCopia(this.quem(req), e);
  }

  @Post('copias/:protocolo/geracao')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @Header('content-type', 'application/pdf')
  @Permissao(P.copiaConferir)
  @AuditadoNoHandler('portal.copiaProntuario (geração, com o hash): SGH_AUD_COPIA_ATO com a SGH_TRILHA')
  async gerarCopia(
    @Param('protocolo') protocolo: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: Res,
  ) {
    const p = protocoloDaRota(protocolo);
    const r = await this.portal.gerarCopia(this.quem(req), corpo(esquemaGerarCopia, { protocolo: p }));
    res.header('content-disposition', `attachment; filename="copia-prontuario-${p}.pdf"`);
    res.header('x-copia-sha256', r.hash);
    res.header('x-copia-paginas', String(r.paginas));
    return Buffer.from(r.pdf);
  }

  @Post('copias/:protocolo/entrega')
  @HttpCode(204)
  @Permissao(P.copiaConferir)
  @AuditadoNoHandler(
    'portal.copiaProntuario (entrega): SGH_AUD_COPIA_ATO e SGH_AUD_PEDIDO_TITULAR com a SGH_TRILHA',
  )
  async entregarCopia(
    @Param('protocolo') protocolo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const { resto, senha } = semSenha(b);
    const e = corpo(esquemaEntregarCopia, { ...resto, protocolo: protocoloDaRota(protocolo) });
    await this.reautenticado(req, senha);
    await this.portal.entregarCopia(this.quem(req), e);
  }

  /** Só dev/ci: as mensagens que o simulador recebeu (nenhuma sai do processo); fora dele, 404. */
  @Get('simulador/mensagens')
  @Header('cache-control', 'no-store')
  @Permissao(P.contaLer)
  simulador(@Query('conta') conta: string | undefined, @Req() req: RequisicaoAutorizada) {
    const amb = (process.env['AMBIENTE'] ?? 'dev').trim();
    if (!(this.portal.canal instanceof CanalSimulador) || (amb !== 'dev' && amb !== 'ci'))
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    return { mensagens: this.portal.canal.mensagens(this.quem(req).hospital, conta ? id(conta) : null) };
  }

  @Get('vinculos')
  @Header('cache-control', 'no-store')
  @Permissao(P.vinculoConferir)
  vinculos(
    @Query('situacao') situacao: string | undefined,
    @Query('prontuario') prontuario: string | undefined,
    @Query('depoisDe') depoisDe: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s =
      situacao && SITUACOES.has(situacao)
        ? (situacao as 'pendente')
        : situacao === 'todas'
          ? null
          : 'pendente';
    const numero = (v: string | undefined, campo: string): number | null => {
      const t = (v ?? '').trim();
      if (t === '') return null;
      if (!/^[1-9]\d{0,17}$/.test(t))
        throw new ErroProblema('entrada-invalida', 400, 'Filtro inválido', 'Use só números.', {
          codigo: 'filtro-invalido',
          campos: [campo],
        });
      return Number(t);
    };
    return this.portal.fila(this.quem(req), {
      situacao: s,
      prontuario: numero(prontuario, 'prontuario'),
      depoisDe: numero(depoisDe, 'depoisDe'),
    });
  }

  @Get('pacientes/:id/responsaveis')
  @Header('cache-control', 'no-store')
  @Permissao(P.vinculoConferir)
  responsaveis(@Param('id') paciente: string, @Req() req: RequisicaoAutorizada) {
    return this.portal.responsaveisDoPaciente(this.quem(req), id(paciente));
  }

  @Get('vinculos/:id/prova')
  @Header('cache-control', 'no-store')
  @Permissao(P.vinculoConferir)
  @AuditadoNoHandler('a leitura da prova (portal.vinculo.decidido, "prova-lida") na SGH_TRILHA')
  prova(@Param('id') vinculo: string, @Req() req: RequisicaoAutorizada) {
    return this.portal.prova(this.quem(req), id(vinculo));
  }

  @Post('vinculos/:id/decisao')
  @HttpCode(200)
  @Permissao(P.vinculoConferir)
  @AuditadoNoHandler(
    'portal.vincularResponsavel (decisão): SGH_POR_RESPONSAVEL com a SGH_TRILHA na mesma transação',
  )
  async decidir(@Param('id') vinculo: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { resto, senha } = semSenha(b);
    const e = corpo(esquemaDecidirVinculo, { ...resto, vinculo: String(id(vinculo)) });
    await this.reautenticado(req, senha);
    return this.portal.decidir(this.quem(req), e);
  }

  @Post('vinculos/:id/encerramento')
  @HttpCode(204)
  @Permissao(P.vinculoConferir)
  @AuditadoNoHandler('portal.vincularResponsavel (encerramento): SGH_POR_RESPONSAVEL com a SGH_TRILHA')
  async encerrarVinculo(@Param('id') vinculo: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { resto, senha } = semSenha(b);
    const e = corpo(esquemaEncerrarVinculo, { ...resto, vinculo: String(id(vinculo)) });
    await this.reautenticado(req, senha);
    await this.portal.encerrarVinculo(this.quem(req), e);
  }
}
