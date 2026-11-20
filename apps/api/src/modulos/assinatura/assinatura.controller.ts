// Assinatura ICP-Brasil, etapa 1 (M49; ficha, seções 5, 7 e 8). Rotas:
//   GET  /api/documento/certificados                      (Meu certificado: vinculados, provedores, conferências)
//   POST /api/documento/certificados                      (A1/A3: a parte pública do certificado)
//   POST /api/documento/certificados/nuvem                (certificado em nuvem: autorização no provedor)
//   POST /api/documento/certificados/:id/desvincular      (só inativa)
//   POST /api/documento/certificados/:id/teste            (assinatura de conferência: nuvem → provedor; A1/A3 → desafio)
//   GET  /api/documento/assinatura/retorno?state&code     (volta do provedor: troca o código, vincula ou assina e valida)
//   POST /api/documento/assinatura/agente                 (resposta do agente local)
//   GET|PUT /api/documento/assinatura/politica ; POST .../politica/remocao
//   GET|PUT /api/documento/assinatura/provedores ; PUT .../:codigo/segredo (senha) ; POST .../:codigo/teste
//   GET  /api/documento/simulador-psc/v0/oauth/authorize[/confirmar]  (SÓ dev/ci: a página do provedor simulado)
//   GET  /api/documento/simulador-agente/certificado ; POST .../assinar (SÓ dev/ci: o agente local A1/A3 simulado, etapa 3)
// Toda escrita só em SGH_, com a SGH_TRILHA na mesma transação; o segredo vai ao cofre e nunca volta.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA,
  type AutorizacaoPsc,
  type CertificadoVinculadoResumo,
  type DesafioAgenteLocal,
  esquemaDefinirPoliticaAssinatura,
  esquemaRemoverPoliticaAssinatura,
  esquemaRespostaAgenteLocal,
  esquemaSalvarProvedorPsc,
  esquemaSegredoProvedor,
  esquemaVincularCertificado,
  esquemaVincularNuvem,
  EVENTOS_AUDITAVEIS,
  type MeuCertificadoResposta,
  type PoliticasAssinaturaResposta,
  type ProvedoresPscResposta,
  type ResultadoFluxoAssinatura,
  type TesteConexaoProvedor,
} from '@sgh/contratos';
import { z } from 'zod';
import { CPF_SINTETICO_SESSAO } from '@sgh/dominio-documento';
import { AuditadoNoHandler, Auditar, Permissao, Publica } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { type ConfigServicoAssinatura, ServicoAssinaturaIcp } from './aplicacao/servico.js';
import { type ParametrosAutorizacao } from './infra/simulador.js';
import { PORTA_ASSINATURA_ICP, type PortaAssinaturaIcp } from './porta.js';
import { SERVICO_ASSINATURA_ICP } from './simbolos.js';

export const CONFIG_ASSINATURA_ICP = Symbol('CONFIG_ASSINATURA_ICP');

type Resposta = {
  status(c: number): Resposta;
  header(n: string, v: string): Resposta;
  send(b?: unknown): unknown;
};

const E = EVENTOS_AUDITAVEIS;
const CODIGO = /^[a-z][a-z0-9-]{1,29}$/;
const STATE = /^[A-Za-z0-9_-]{32,128}$/;
const esquemaSenha = z.object({ senha: z.string().max(200).optional() }).passthrough();
const TELA_CERTIFICADO = '/conta/certificado';
/** Etapa 2: a volta do lote de documentos cai na tela de assinar. */
const TELA_DOCUMENTOS = '/pep/assinaturas';
/** M50.6: a volta da assinatura dos documentos digitalizados (a tela da digitalização certificada). */
const TELA_DIGITALIZACAO = '/same/digitalizacao';

const codigoDaRota = (c: string) => {
  if (!CODIGO.test(c))
    throw new ErroProblema('entrada-invalida', 400, 'Código inválido', 'Código do provedor.');
  return c;
};

const html = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Controller('documento')
export class AssinaturaIcpController {
  readonly servico: ServicoAssinaturaIcp;

  constructor(
    @Inject(PORTA_ASSINATURA_ICP) porta: PortaAssinaturaIcp,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Inject(CONFIG_ASSINATURA_ICP) private readonly cfg: ConfigServicoAssinatura,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    // Etapa 2: o mesmo serviço das rotas dos documentos (a volta do provedor conclui o lote de documentos).
    @Optional() @Inject(SERVICO_ASSINATURA_ICP) compartilhado: ServicoAssinaturaIcp | null = null,
  ) {
    this.servico = compartilhado ?? new ServicoAssinaturaIcp(porta, trilha, cfg, configuracao);
    this.porta = porta;
  }

  private readonly porta: PortaAssinaturaIcp;

  // ── Meu certificado ───────────────────────────────────────────────────────────────────────────────────────

  @Get('certificados')
  @Permissao('documento.certificado.vincular')
  meus(@Req() req: RequisicaoAutorizada): Promise<MeuCertificadoResposta> {
    return this.servico.meuCertificado(sessaoDe(req));
  }

  @Post('certificados')
  @HttpCode(200)
  @Permissao('documento.certificado.vincular')
  @AuditadoNoHandler(
    'certificado em SGH_ACESSO_CERTIFICADO com a SGH_TRILHA na mesma transação; a recusa vai à trilha',
  )
  vincular(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<CertificadoVinculadoResumo> {
    return this.servico.vincularArquivo(sessaoDe(req), corpo(esquemaVincularCertificado, b));
  }

  @Post('certificados/nuvem')
  @HttpCode(200)
  @Permissao('documento.certificado.vincular')
  @AuditadoNoHandler('o pedido em SGH_DOC_PEDIDO_ASSINATURA; o vínculo é auditado na volta do provedor')
  nuvem(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<AutorizacaoPsc> {
    return this.servico.iniciarVinculoNuvem(sessaoDe(req), corpo(esquemaVincularNuvem, b).provedor);
  }

  @Post('certificados/:id/desvincular')
  @HttpCode(200)
  @Permissao('documento.certificado.vincular')
  @AuditadoNoHandler('inativação em SGH_ACESSO_CERTIFICADO com a SGH_TRILHA na mesma transação')
  desvincular(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CertificadoVinculadoResumo> {
    return this.servico.desvincular(sessaoDe(req), idDaRota(id));
  }

  @Post('certificados/:id/teste')
  @HttpCode(200)
  @Permissao('documento.certificado.vincular')
  @AuditadoNoHandler(
    'o pedido em SGH_DOC_PEDIDO_ASSINATURA; a assinatura e a validação na volta, com a trilha',
  )
  teste(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AutorizacaoPsc | DesafioAgenteLocal> {
    return this.servico.iniciarTeste(sessaoDe(req), idDaRota(id));
  }

  @Get('assinatura/retorno')
  @Permissao('documento.certificado.vincular')
  @AuditadoNoHandler('vínculo ou assinatura com a validação em SGH_, com a SGH_TRILHA; a recusa vai à trilha')
  async retorno(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res() res: Resposta,
  ): Promise<void> {
    const state = q['state'] ?? '';
    if (!STATE.test(state))
      throw new ErroProblema('entrada-invalida', 400, 'Volta inválida', 'Falta o state.');
    const code = (q['code'] ?? '').slice(0, 2048) || null;
    const r = await this.servico.retornoPsc(sessaoDe(req), { state, code, erro: q['error'] ?? null });
    this.redirecionar(res, r);
  }

  private redirecionar(res: Resposta, r: ResultadoFluxoAssinatura): void {
    const p = new URLSearchParams({ finalidade: r.finalidade, resultado: r.ok ? 'ok' : 'recusa' });
    if (r.motivo) p.set('motivo', r.motivo);
    if (r.assinatura) p.set('assinatura', String(r.assinatura));
    if (r.lote) {
      p.set('assinados', String(r.lote.assinados));
      p.set('pendentes', String(r.lote.pendentes));
      p.set('recusados', String(r.lote.recusados));
    }
    const tela =
      r.finalidade === 'documento'
        ? TELA_DOCUMENTOS
        : r.finalidade === 'digitalizacao'
          ? TELA_DIGITALIZACAO
          : TELA_CERTIFICADO;
    res.status(302).header('location', `${tela}?${p.toString()}`).send();
  }

  @Post('assinatura/agente')
  @HttpCode(200)
  @Permissao('documento.certificado.vincular')
  @AuditadoNoHandler('assinatura e validação em SGH_DOC_ASSINATURA e SGH_DOC_VALIDACAO com a SGH_TRILHA')
  agente(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFluxoAssinatura> {
    return this.servico.respostaAgente(sessaoDe(req), corpo(esquemaRespostaAgenteLocal, b));
  }

  // ── Política por tipo de documento ────────────────────────────────────────────────────────────────────────

  @Get('assinatura/politica')
  @Permissao('documento.politica.ler')
  politica(@Req() req: RequisicaoAutorizada): Promise<PoliticasAssinaturaResposta> {
    return this.servico.politicas(sessaoDe(req));
  }

  @Put('assinatura/politica')
  @Permissao('documento.politica.editar')
  @AuditadoNoHandler('regra em SGH_DOC_POLITICA_ASSIN com a SGH_TRILHA na mesma transação')
  definirPolitica(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PoliticasAssinaturaResposta> {
    return this.servico.definirPolitica(sessaoDe(req), corpo(esquemaDefinirPoliticaAssinatura, b));
  }

  @Post('assinatura/politica/remocao')
  @HttpCode(200)
  @Permissao('documento.politica.editar')
  @AuditadoNoHandler('linha inativa em SGH_DOC_POLITICA_ASSIN com a SGH_TRILHA na mesma transação')
  removerPolitica(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PoliticasAssinaturaResposta> {
    return this.servico.removerPolitica(sessaoDe(req), corpo(esquemaRemoverPoliticaAssinatura, b));
  }

  // ── Provedores e cofre ────────────────────────────────────────────────────────────────────────────────────

  // Leitura sem trilha, como a da política (a trilha de "provedor alterado" é só de alteração).
  @Get('assinatura/provedores')
  @Permissao('documento.provedor.ler')
  provedores(@Req() req: RequisicaoAutorizada): Promise<ProvedoresPscResposta> {
    return this.servico.provedores(sessaoDe(req));
  }

  @Put('assinatura/provedores')
  @Permissao('documento.provedor.editar')
  @AuditadoNoHandler('provedor em SGH_DOC_PROVEDOR_PSC (só a referência do segredo) com a SGH_TRILHA')
  salvarProvedor(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ProvedoresPscResposta> {
    const { senha, ...resto } = corpo(esquemaSenha, b);
    // Trocar o endereço ou o client_id com o segredo definido pede a senha de novo (o serviço decide quando).
    return this.servico.salvarProvedor(sessaoDe(req), corpo(esquemaSalvarProvedorPsc, resto), () =>
      this.confirmarSenha(req, senha),
    );
  }

  /** Operação crítica: a senha conferida de novo; só a sessão sintética sem login real dispensa. */
  private async confirmarSenha(req: RequisicaoAutorizada, senha: string | undefined): Promise<void> {
    if (this.porta.destino === 'memoria' && !req.sgh?.real) return;
    await reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  @Put('assinatura/provedores/:codigo/segredo')
  @Permissao('documento.provedor.editar')
  @AuditadoNoHandler('o segredo vai ao cofre; a trilha registra a troca, nunca o valor')
  async segredo(
    @Param('codigo') codigo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ProvedoresPscResposta> {
    const { senha, ...resto } = corpo(esquemaSenha, b);
    await this.confirmarSenha(req, senha);
    return this.servico.definirSegredo(
      sessaoDe(req),
      codigoDaRota(codigo),
      corpo(esquemaSegredoProvedor, resto),
    );
  }

  @Post('assinatura/provedores/:codigo/teste')
  @HttpCode(200)
  @Permissao('documento.provedor.editar')
  @Auditar(E.provedorAssinaturaTestado.codigo)
  testar(@Param('codigo') codigo: string, @Req() req: RequisicaoAutorizada): Promise<TesteConexaoProvedor> {
    return this.servico.testarConexao(sessaoDe(req), codigoDaRota(codigo));
  }

  // ── Simulador do provedor (só dev/ci) ─────────────────────────────────────────────────────────────────────

  private exigirSimulador() {
    if (this.cfg.modo !== 'simulador' || !this.cfg.simulador)
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    return this.cfg.simulador;
  }

  // ── Etapa 3: o agente local A1/A3 SIMULADO (só dev/ci; o E2E faz o papel do agente das estações por ele) ──

  @Get('simulador-agente/certificado')
  @Publica('SÓ dev/ci (modo simulador): o certificado A3 sintético do agente local simulado; 404 fora dele')
  certificadoAgenteSimulado(): { certificado: string } {
    const sim = this.exigirSimulador();
    return { certificado: Buffer.from(sim.agente(CPF_SINTETICO_SESSAO).certificado).toString('base64') };
  }

  @Post('simulador-agente/assinar')
  @HttpCode(200)
  @Publica('SÓ dev/ci (modo simulador): o agente local simulado assina os hashes do desafio; 404 fora dele')
  @AuditadoNoHandler('nada é gravado: o simulador assina os hashes com a chave sintética')
  assinarNoAgenteSimulado(@Body() b: unknown): {
    assinaturas: { hash: string; assinatura: string }[];
    certificado: string;
  } {
    const sim = this.exigirSimulador();
    const p = corpo(
      z
        .object({
          desafio: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
          hashes: z
            .array(z.string().regex(/^[0-9a-f]{64}$/))
            .min(1)
            .max(200),
          algoritmo: z.literal('sha256'),
        })
        .strict(),
      b,
    );
    return sim.assinarNoAgente(CPF_SINTETICO_SESSAO, p.hashes);
  }

  @Get('simulador-psc/v0/oauth/authorize')
  @Permissao('documento.certificado.vincular')
  autorizarSimulado(@Query() q: Record<string, string>, @Res() res: Resposta): void {
    this.exigirSimulador();
    const campos = [
      'response_type',
      'client_id',
      'redirect_uri',
      'scope',
      'state',
      'code_challenge',
      'code_challenge_method',
    ]
      .map((k) => `<input type="hidden" name="${k}" value="${html((q[k] ?? '').slice(0, 300))}">`)
      .join('');
    res
      .status(200)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Provedor simulado</title></head><body>` +
          `<main><h1>Provedor de certificado simulado</h1><p>Ambiente de teste: nenhum certificado real.</p>` +
          `<form method="get" action="authorize/confirmar">${campos}` +
          `<label for="cpf">CPF do titular</label> <input id="cpf" name="cpf" inputmode="numeric" maxlength="14" required>` +
          ` <button type="submit" name="decisao" value="autorizar">Autorizar</button>` +
          ` <button type="submit" name="decisao" value="negar" formnovalidate>Negar</button></form></main></body></html>`,
      );
  }

  @Get('simulador-psc/v0/oauth/authorize/confirmar')
  @Permissao('documento.certificado.vincular')
  confirmarSimulado(@Query() q: Record<string, string>, @Res() res: Resposta): void {
    const sim = this.exigirSimulador();
    const p = q as ParametrosAutorizacao & { cpf?: string; decisao?: string };
    const destino =
      p.decisao === 'negar'
        ? `${p.redirect_uri ?? TELA_CERTIFICADO}?${new URLSearchParams({ state: p.state ?? '', error: 'access_denied' }).toString()}`
        : sim.autorizar(p, p.cpf ?? '');
    if (!voltaDoSimuladorAceita(destino)) throw new ErroProblema('entrada-invalida', 400, 'Volta inválida');
    res.status(302).header('location', destino).send();
  }
}

/**
 * As voltas que o provedor SIMULADO aceita (nada de redirecionamento aberto): a do hospital e a tela de retorno do portal
 * do médico externo (W0-10, M6: o redirect_uri do portal; a sessão dele é o cookie do portal, SameSite=Strict).
 */
export function voltaDoSimuladorAceita(destino: string): boolean {
  return (
    destino.startsWith('/api/documento/assinatura/retorno') ||
    destino.startsWith(`${PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA}?`)
  );
}
