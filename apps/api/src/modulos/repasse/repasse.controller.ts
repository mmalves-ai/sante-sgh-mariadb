// Repasse médico (M33; ficha, seções 4, 5 e 7). Telas de trabalho sobre as mesmas regras, lançamentos e RPAs do outro
// sistema; o que ele não tem (versão de regra com aprovação, memória de cálculo, apuração com segregação, ligação do
// estorno) em SGH_:
//   GET  /api/repasse/apoio | indicadores
//   GET  /api/repasse/regras?convenio&data&procedimento&profissional&depoisDe (keyset) ; GET prestadores?termo
//   POST regras/simular | regras/versoes | regras/versoes/:id/decisao ; GET regras/versoes
//   GET  /api/repasse/apuracoes ; POST apuracoes | apuracoes/:id/decisao | apuracoes/:id/lancamentos
//   GET  /api/repasse/apuracoes/:id/demonstrativo/:prestador (+ /pdf: PDF/A pelo Gotenberg)
//   GET  /api/repasse/lancamentos ; POST lancamentos
//   GET  /api/repasse/rpas ; POST rpas/previa | rpas (crítica: com a senha) ; GET rpas/:id/pdf (o RPA emitido, PDF/A)
//   GET  /api/repasse/meu-extrato?competencia | meu-extrato/conta?competencia (só o próprio médico: o vínculo do
//        usuário com o profissional, no servidor)
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type ApoioRepasse,
  type ApuracaoResposta,
  type ContaDoMedicoResposta,
  type DemonstrativoResposta,
  esquemaApurarRepasse,
  esquemaDecidirApuracao,
  esquemaDecidirRegraRepasse,
  esquemaEmitirRpa,
  esquemaLancarEventoRepasse,
  esquemaProporRegraRepasse,
  esquemaSimularRepasse,
  EVENTOS_AUDITAVEIS,
  type ExtratoRepasseResposta,
  type GravacaoRepasse,
  type IndicadorRepasse,
  type LancamentoRepasseResposta,
  type ListaRegrasRepasse,
  type PrestadorRepasseResposta,
  type PreviaRpaResposta,
  type ResultadoRepasse,
  type RpaResposta,
  type SimulacaoRepasseResposta,
  type VersaoRegraResposta,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { exigir, idDaRota, type SessaoCadastro, sessaoDe as sessaoCadastroDe } from '../cadastro/comum.js';
import { comPedido } from './pedido.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { htmlDemonstrativo, htmlRpaEmitido } from './documentos.js';
import { PORTA_REPASSE, type PortaRepasse } from './porta.js';
import { ServicoRepasse } from './servico.js';

export const GERADOR_PDF_REPASSE = Symbol('GERADOR_PDF_REPASSE');
type GeradorPdf = (html: string, titulo: string) => Promise<Buffer>;
type Resposta = { header(n: string, v: string): unknown; send(b: unknown): unknown };

const E = EVENTOS_AUDITAVEIS;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const competenciaOu = (v: string | undefined, hoje: string) => {
  const c = (v ?? '').trim() || hoje.slice(0, 7);
  if (!COMPETENCIA.test(c))
    throw new ErroProblema('entrada-invalida', 400, 'Competência inválida', 'Use AAAA-MM.');
  return c;
};
const dataOu = (v: string | undefined, padrao: string) => {
  const d = (v ?? '').trim() || padrao;
  if (!DATA.test(d)) throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return d;
};
const esquemaLancarApuracao = z.object({ evento: z.number().int().min(1).max(32_767) }).strict();
/** A senha da reautenticação da emissão do RPA (operação crítica) vem junto do pedido e sai antes do Zod do RPA. */
const esquemaSenha = z.object({ senha: z.string().max(200).optional() });
const competenciaOuNula = (v: string | undefined) => {
  const c = (v ?? '').trim();
  if (!c) return null;
  if (!COMPETENCIA.test(c))
    throw new ErroProblema('entrada-invalida', 400, 'Competência inválida', 'Use AAAA-MM.');
  return c;
};

/** A sessão com a Idempotency-Key do pedido no contexto da porta: o reenvio do mesmo pedido não grava de novo. */
const sessaoDe = (req: Parameters<typeof sessaoCadastroDe>[0]): SessaoCadastro =>
  comPedido(sessaoCadastroDe(req));

@Controller('repasse')
export class RepasseController {
  readonly servico: ServicoRepasse;

  constructor(
    @Inject(PORTA_REPASSE) private readonly porta: PortaRepasse,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(GERADOR_PDF_REPASSE) private readonly pdf: GeradorPdf | null = null,
  ) {
    this.servico = new ServicoRepasse(porta, trilha, configuracao, cache);
  }

  /** A senha conferida de novo (M05); só a porta em memória sem sessão real (dev/ci sem login) dispensa. */
  private async reautenticado(req: RequisicaoAutorizada, senha: string | undefined): Promise<number> {
    return this.porta.destino === 'memoria' && !req.sgh?.real
      ? Date.now()
      : reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  private async enviarPdf(res: Resposta, html: string, titulo: string, arquivo: string) {
    if (!this.pdf) {
      res.header('content-type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    const pdf = await this.pdf(html, titulo).catch(() => null);
    if (!pdf)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Gerador de PDF indisponível',
        'O conversor de PDF/A não respondeu.',
      );
    res.header('content-type', 'application/pdf');
    res.header('content-disposition', `attachment; filename="${arquivo}.pdf"`);
    return res.send(pdf);
  }

  // ── Apoio e indicadores ──────────────────────────────────────────────────────────────────────────────────────

  @Get('apoio')
  @Permissao('repasse.extrato.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioRepasse> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('gravacao')
  @Permissao('repasse.extrato.ler')
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoRepasse> {
    return this.servico.gravacao(sessaoDe(req));
  }

  @Get('indicadores')
  @Permissao('repasse.apuracao.ler')
  @Auditar(E.repasseLido.codigo)
  async indicadores(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadorRepasse[]> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(s.porta);
    return this.servico.indicadores(s, dataOu(q['de'], `${hoje.slice(0, 4)}-01-01`), dataOu(q['ate'], hoje));
  }

  // ── Regras e simulador ───────────────────────────────────────────────────────────────────────────────────────

  @Get('regras')
  @Permissao('repasse.regra.ler')
  async regras(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaRegrasRepasse> {
    const s = sessaoDe(req);
    const convenio = inteiroOuNulo(q['convenio']);
    if (convenio === null)
      throw new ErroProblema('entrada-invalida', 400, 'Convênio obrigatório', 'Escolha o convênio.');
    const hoje = await this.porta.hoje(s.porta);
    return this.servico.regras(s, {
      convenio,
      data: dataOu(q['data'], hoje),
      depoisDe: inteiroOuNulo(q['depoisDe']) ?? 0,
      procedimento: inteiroOuNulo(q['procedimento']),
      profissional: inteiroOuNulo(q['profissional']),
    });
  }

  @Get('prestadores')
  @Permissao('repasse.extrato.ler')
  async prestadores(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PrestadorRepasseResposta[]> {
    const s = sessaoDe(req);
    // A busca é das telas do setor (regras, lançamentos e RPA): o médico do extrato não a usa.
    if (!['repasse.regra.ler', 'repasse.lancamento.ler', 'repasse.rpa.ler'].some((c) => s.pode(c)))
      await exigir(s, 'repasse.lancamento.ler', this.trilha);
    return this.servico.prestadores(s, termo ?? '');
  }

  @Post('regras/simular')
  @HttpCode(200)
  @Permissao('repasse.regra.ler')
  @AuditadoNoHandler(
    'o simulador não grava; a versão simulada é marcada em regra_repasse_versao com a trilha',
  )
  simular(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<SimulacaoRepasseResposta> {
    return this.servico.simular(sessaoDe(req), corpo(esquemaSimularRepasse, b));
  }

  @Get('regras/versoes')
  @Permissao('repasse.regra.ler')
  versoes(@Req() req: RequisicaoAutorizada): Promise<VersaoRegraResposta[]> {
    return this.servico.versoes(sessaoDe(req));
  }

  @Post('regras/versoes')
  @HttpCode(200)
  @Permissao('repasse.regra.propor')
  @AuditadoNoHandler('versão de regra em regra_repasse_versao com a trilha na mesma transação')
  propor(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoRepasse> {
    return this.servico.proporRegra(sessaoDe(req), corpo(esquemaProporRegraRepasse, b));
  }

  @Post('regras/versoes/:id/decisao')
  @HttpCode(200)
  @Permissao('repasse.regra.aprovar')
  @AuditadoNoHandler('decisão em regra_repasse_versao e repasse.incluirRegra pelo executor')
  decidirRegra(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRepasse> {
    return this.servico.decidirRegra(
      sessaoDe(req),
      corpo(esquemaDecidirRegraRepasse, { ...((b ?? {}) as object), versao: idDaRota(id) }),
    );
  }

  // ── Apuração e demonstrativo ─────────────────────────────────────────────────────────────────────────────────

  @Get('apuracoes')
  @Permissao('repasse.apuracao.ler')
  async apuracao(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ApuracaoResposta> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(s.porta);
    return this.servico.apuracao(s, inteiroOuNulo(q['empresa']) ?? 1, competenciaOu(q['competencia'], hoje));
  }

  @Post('apuracoes')
  @HttpCode(200)
  @Permissao('repasse.apuracao.apurar')
  @AuditadoNoHandler('apuração e memória de cálculo em SGH_ com a trilha na mesma transação')
  apurar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoRepasse> {
    return this.servico.apurar(sessaoDe(req), corpo(esquemaApurarRepasse, b));
  }

  @Post('apuracoes/:id/decisao')
  @HttpCode(200)
  @Permissao('repasse.apuracao.ler')
  @AuditadoNoHandler('transição da apuração em apuracao_repasse (a permissão de agir conferida no serviço)')
  decidirApuracao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRepasse> {
    return this.servico.decidirApuracao(
      sessaoDe(req),
      corpo(esquemaDecidirApuracao, { ...((b ?? {}) as object), apuracao: idDaRota(id) }),
    );
  }

  @Post('apuracoes/:id/lancamentos')
  @HttpCode(200)
  @Permissao('repasse.lancamento.criar')
  @AuditadoNoHandler('repasse.lancarEvento (origem apuração) pelo executor, um por beneficiário')
  lancarApuracao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRepasse> {
    return this.servico.lancarApuracao(sessaoDe(req), idDaRota(id), corpo(esquemaLancarApuracao, b).evento);
  }

  @Get('apuracoes/:id/demonstrativo/:prestador')
  @Permissao('repasse.apuracao.ler')
  @Auditar(E.repasseLido.codigo)
  demonstrativo(
    @Param('id') id: string,
    @Param('prestador') prestador: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DemonstrativoResposta> {
    return this.servico.demonstrativo(sessaoDe(req), idDaRota(id), idDaRota(prestador));
  }

  @Get('apuracoes/:id/demonstrativo/:prestador/pdf')
  @Permissao('repasse.apuracao.ler')
  @Auditar(E.repasseLido.codigo)
  async demonstrativoPdf(
    @Param('id') id: string,
    @Param('prestador') prestador: string,
    @Req() req: RequisicaoAutorizada,
    @Res() res: Resposta,
  ) {
    const d = await this.servico.demonstrativo(sessaoDe(req), idDaRota(id), idDaRota(prestador));
    return this.enviarPdf(
      res,
      htmlDemonstrativo(d),
      `Demonstrativo ${d.competencia}`,
      `demonstrativo-${d.competencia}-${d.prestador}`,
    );
  }

  // ── Lançamentos e RPA ────────────────────────────────────────────────────────────────────────────────────────

  @Get('lancamentos')
  @Permissao('repasse.lancamento.ler')
  async lancamentos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<LancamentoRepasseResposta[]> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(s.porta);
    const prestador = inteiroOuNulo(q['prestador']);
    return this.servico.lancamentos(s, {
      empresa: inteiroOuNulo(q['empresa']) ?? 1,
      competencia: competenciaOu(q['competencia'], hoje),
      ...(prestador ? { prestador } : {}),
    });
  }

  @Post('lancamentos')
  @HttpCode(200)
  @Permissao('repasse.lancamento.criar')
  @AuditadoNoHandler('repasse.lancarEvento pelo executor (trilha na mesma transação)')
  lancar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoRepasse> {
    return this.servico.lancar(sessaoDe(req), corpo(esquemaLancarEventoRepasse, b));
  }

  @Get('rpas')
  @Permissao('repasse.rpa.ler')
  async rpas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<RpaResposta[]> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(s.porta);
    return this.servico.rpas(s, {
      empresa: inteiroOuNulo(q['empresa']) ?? 1,
      competencia: competenciaOu(q['competencia'], hoje),
    });
  }

  @Post('rpas/previa')
  @HttpCode(200)
  @Permissao('repasse.rpa.ler')
  @Auditar(E.repasseLido.codigo)
  previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaRpaResposta> {
    return this.servico.previaRpa(sessaoDe(req), corpo(esquemaEmitirRpa, b));
  }

  @Post('rpas')
  @HttpCode(200)
  @Permissao('repasse.rpa.emitir')
  @AuditadoNoHandler('repasse.emitirRpa pelo executor, com o título do financeiro na mesma transação')
  async emitir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoRepasse> {
    const { senha, ...dados } = (b ?? {}) as Record<string, unknown>;
    const x = corpo(esquemaSenha, { senha });
    const e = corpo(esquemaEmitirRpa, dados);
    // Operação crítica: a senha conferida ANTES de calcular e gravar (nunca o relógio do servidor no lugar dela).
    const reautenticadoEm = await this.reautenticado(req, x.senha);
    return this.servico.emitirRpa(sessaoDe(req), e, reautenticadoEm);
  }

  @Get('rpas/:id/pdf')
  @Permissao('repasse.rpa.ler')
  @Auditar(E.repasseLido.codigo)
  async rpaPdf(@Param('id') id: string, @Req() req: RequisicaoAutorizada, @Res() res: Resposta) {
    const r = await this.servico.rpaEmitido(sessaoDe(req), idDaRota(id));
    return this.enviarPdf(
      res,
      htmlRpaEmitido(r),
      `RPA ${r.rpa.serie} ${r.rpa.numero}`,
      `rpa-${r.rpa.serie}-${r.rpa.numero}`,
    );
  }

  // ── Extrato do médico ───────────────────────────────────────────────────────────────────────────────────────

  @Get('meu-extrato')
  @Permissao('repasse.extrato.ler')
  @Auditar(E.repasseLido.codigo)
  async extrato(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ExtratoRepasseResposta> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(s.porta);
    return this.servico.extrato(s, {
      desde: dataOu(q['desde'], `${Number(hoje.slice(0, 4)) - 1}${hoje.slice(4)}`),
      competencia: competenciaOuNula(q['competencia']),
    });
  }

  @Get('meu-extrato/conta')
  @Permissao('repasse.extrato.ler')
  @Auditar(E.repasseLido.codigo)
  async contaDoMedico(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ContaDoMedicoResposta> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(s.porta);
    return this.servico.contaDoMedico(s, competenciaOu(q['competencia'], hoje));
  }
}
