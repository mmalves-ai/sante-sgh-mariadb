// Rotas do registro oncológico e da radioterapia (09-AREA linha 69), sobre a internação escolhida na tela da oncologia
// (o paciente e o atendimento vêm dela; o vínculo assistencial é conferido em toda leitura e gravação):
//   GET  /api/especialidades/oncologia/registro/cadastros              intenções, regiões, aparelhos e estádios
//   GET  /api/especialidades/oncologia/registro/busca?catalogo=&termo=  CID (C/D), topografia e morfologia (CID-O-3)
//   GET  /api/especialidades/oncologia/internacoes/:reg/registro       tumores, estadiamentos e planos do paciente (auditado)
//   POST /api/especialidades/oncologia/registro/tumores                 pep.oncologia.tumor.registrar (médico)
//   POST /api/especialidades/oncologia/registro/estadiamentos           pep.oncologia.tumor.estadiar (médico; TNM)
//   POST /api/especialidades/oncologia/registro/planos                  pep.radioterapia.plano.registrar (médico)
//   POST /api/especialidades/oncologia/registro/planos/:id/aprovacao    pep.radioterapia.plano.aprovar (físico informado)
//   POST /api/especialidades/oncologia/registro/planos/:id/encerramento pep.radioterapia.plano.encerrar (motivo)
//   POST /api/especialidades/oncologia/registro/planos/:id/sessoes      pep.radioterapia.sessao.registrar
//   POST /api/especialidades/oncologia/registro/aparelhos               pep.radioterapia.aparelho.incluir
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS as E, PERMISSOES_ESPECIALIDADES_CODIGOS as P } from '@sgh/contratos';
import { categoriaDoCbo } from '@sgh/dominio-pep';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { AcessoPacientePep } from '../pep/acesso-paciente.js';
import { ESTADO_PRONTUARIO } from '../pep/prontuario.controller.js';
import type { EstadoProntuario } from '../pep/sessao-prontuario.js';
import { PORTA_ESPECIALIDADES, type PortaEspecialidades } from './porta.js';
import {
  type Autor,
  type CatalogoBusca,
  esquemaAparelho,
  esquemaAprovacao,
  esquemaEncerramento,
  esquemaEstadiamento,
  esquemaPlano,
  esquemaSessao,
  esquemaTumor,
  PORTA_REGISTRO_ONCOLOGICO,
  type PortaRegistroOncologico,
  portaRegistroOncologicoIndisponivel,
} from './registro-oncologico.js';

const CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
function chaveIdempotencia(req: RequisicaoAutorizada): string {
  const bruto = req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof k !== 'string' || !CHAVE_IDEMPOTENCIA.test(k))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'A gravação precisa da Idempotency-Key.',
    );
  return k;
}
const CATALOGOS: readonly CatalogoBusca[] = ['topografia', 'morfologia', 'cid'];

@Controller()
export class RegistroOncologicoController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(PORTA_ESPECIALIDADES) private readonly especialidades: PortaEspecialidades,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Inject(ESTADO_PRONTUARIO) estado: EstadoProntuario,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
    @Optional()
    @Inject(PORTA_REGISTRO_ONCOLOGICO)
    private readonly porta: PortaRegistroOncologico = portaRegistroOncologicoIndisponivel(),
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  /** O paciente e o atendimento da internação, com o vínculo assistencial conferido. */
  private async daInternacao(s: SessaoCadastro, reg: number, permissao: string) {
    const i = await this.especialidades.internacao(s.porta, reg);
    if (!i)
      throw new ErroProblema('nao-encontrado', 404, 'Internação não encontrada', 'A internação não existe.');
    await this.acesso.exigirVinculo(s, i.paciente, permissao, 'pep.evolucao');
    return i;
  }

  /** Quem grava: o médico com o vínculo ativo (registro do tumor, estadiamento e plano são atos médicos). */
  private async autor(s: SessaoCadastro, reg: number): Promise<Autor> {
    const i = await this.daInternacao(s, reg, P.oncologiaRegistrar);
    const vs = await this.especialidades.vinculos(s.porta, s.login).catch(() => []);
    const v = vs.find((x) => x.ativo && categoriaDoCbo(x.cbo) === 'medico');
    if (!v)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Categoria profissional',
        'O registro oncológico e o plano de radioterapia são do médico: a sessão precisa do vínculo com o conselho ativo.',
        { codigo: 'categoria-nao-autorizada' },
      );
    return { paciente: i.paciente, internacao: i.internacao, profissional: v.vinculo };
  }

  @Get('especialidades/oncologia/registro/cadastros')
  @Permissao(P.oncologiaLer)
  cadastros(@Req() req: RequisicaoAutorizada) {
    return this.porta.cadastros(sessaoDe(req).porta);
  }

  @Get('especialidades/oncologia/registro/busca')
  @Permissao(P.oncologiaLer)
  async buscar(
    @Query('catalogo') catalogo: string | undefined,
    @Query('termo') termo: string | undefined,
    @Query('cid') cid: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const c = CATALOGOS.find((x) => x === catalogo);
    if (!c)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Catálogo inválido',
        'Use topografia, morfologia ou cid.',
      );
    const t = (termo ?? '').trim();
    if (t.length < 2) return { itens: [] };
    return { itens: await this.porta.buscar(sessaoDe(req).porta, c, t.slice(0, 60), cid?.slice(0, 10)) };
  }

  @Get('especialidades/oncologia/internacoes/:reg/registro')
  @Permissao(P.oncologiaLer)
  @Auditar(E.especialidadeLida.codigo)
  async doPaciente(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const i = await this.daInternacao(s, idDaRota(reg), P.oncologiaLer);
    return this.porta.doPaciente(s.porta, i.paciente);
  }

  @Post('especialidades/oncologia/registro/tumores')
  @HttpCode(201)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler('pep.oncologia.tumor.registrar pelo executor (trilha na mesma transação)')
  async registrarTumor(
    @Query('internacao') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const e = corpo(esquemaTumor, b);
    const r = await this.porta.registrarTumor(
      s.porta,
      await this.autor(s, idDaRota(reg)),
      e,
      chaveIdempotencia(req),
    );
    return { ok: true, ...r, mensagem: 'Tumor registrado: estadie em seguida.' };
  }

  @Post('especialidades/oncologia/registro/estadiamentos')
  @HttpCode(201)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler('pep.oncologia.tumor.estadiar pelo executor (trilha na mesma transação)')
  async estadiar(@Query('internacao') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaEstadiamento, b);
    const r = await this.porta.estadiar(
      s.porta,
      await this.autor(s, idDaRota(reg)),
      e,
      chaveIdempotencia(req),
    );
    return { ok: true, ...r, mensagem: 'Estadiamento registrado: o anterior fica na linha do tempo.' };
  }

  @Post('especialidades/oncologia/registro/planos')
  @HttpCode(201)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler('pep.radioterapia.plano.registrar pelo executor (trilha na mesma transação)')
  async planejar(@Query('internacao') reg: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaPlano, b);
    const r = await this.porta.planejar(
      s.porta,
      await this.autor(s, idDaRota(reg)),
      e,
      chaveIdempotencia(req),
    );
    return {
      ok: true,
      ...r,
      mensagem: `Plano de radioterapia ${r.numero ?? ''} em planejamento: aprove com o físico.`,
    };
  }

  @Post('especialidades/oncologia/registro/planos/:id/aprovacao')
  @HttpCode(200)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler('pep.radioterapia.plano.aprovar pelo executor (trilha na mesma transação)')
  async aprovar(
    @Param('id') id: string,
    @Query('internacao') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAprovacao, b);
    const r = await this.porta.aprovar(
      s.porta,
      await this.autor(s, idDaRota(reg)),
      { id: idDaRota(id), ...e },
      chaveIdempotencia(req),
    );
    return { ok: true, ...r, mensagem: 'Plano aprovado: as sessões podem ser registradas.' };
  }

  @Post('especialidades/oncologia/registro/planos/:id/encerramento')
  @HttpCode(200)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler(
    'pep.radioterapia.plano.encerrar pelo executor (trilha na mesma transação, com o motivo)',
  )
  async encerrar(
    @Param('id') id: string,
    @Query('internacao') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerramento, b);
    const r = await this.porta.encerrar(
      s.porta,
      await this.autor(s, idDaRota(reg)),
      { id: idDaRota(id), ...e },
      chaveIdempotencia(req),
    );
    return { ok: true, ...r, mensagem: 'Plano encerrado: fica no histórico com o motivo.' };
  }

  @Post('especialidades/oncologia/registro/planos/:id/sessoes')
  @HttpCode(201)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler('pep.radioterapia.sessao.registrar pelo executor (trilha na mesma transação)')
  async registrarSessao(
    @Param('id') id: string,
    @Query('internacao') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const e = corpo(esquemaSessao, b);
    const r = await this.porta.registrarSessao(
      s.porta,
      await this.autor(s, idDaRota(reg)),
      { ...e, plano: idDaRota(id) },
      chaveIdempotencia(req),
    );
    return {
      ok: true,
      ...r,
      mensagem:
        r.situacao === 'concluido' ? 'Última fração registrada: plano concluído.' : 'Sessão registrada.',
    };
  }

  @Post('especialidades/oncologia/registro/aparelhos')
  @HttpCode(201)
  @Permissao(P.oncologiaRegistrar)
  @AuditadoNoHandler('pep.radioterapia.aparelho.incluir pelo executor (trilha na mesma transação)')
  async incluirAparelho(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const r = await this.porta.incluirAparelho(s.porta, corpo(esquemaAparelho, b), chaveIdempotencia(req));
    return { ok: true, ...r, mensagem: 'Aparelho incluído.' };
  }
}
