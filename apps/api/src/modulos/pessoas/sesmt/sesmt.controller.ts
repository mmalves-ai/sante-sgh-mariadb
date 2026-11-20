// Telas do SESMT (M52.5; ficha do M52, seção 7; `Gestão de pessoas > SESMT`): ASO e exames ocupacionais, CAT, riscos e
// EPI, vacinação do colaborador. Cada tela tem o apoio e a busca do colaborador sob a própria permissão de leitura:
//   GET  /api/pessoas/sesmt/{aso|cat|riscos|vacinas}/apoio            domínios, liberação, ações e parâmetros
//   GET  /api/pessoas/sesmt/{aso|cat|riscos|vacinas}/colaboradores    busca pelo nome ou matrícula (sem CPF)
//   GET  /api/pessoas/sesmt/painel                                    pendências dos ativos (ASO, vacinas, EPI, CAT)
//   GET  /api/pessoas/sesmt/aso/:vinculo  ; POST (ASO e exames; retificação)          dado de saúde: leitura auditada
//   GET  /api/pessoas/sesmt/vacinas/:vinculo ; POST (dose ou anti-HBs; retificação)   dado de saúde: leitura auditada
//   GET  /api/pessoas/sesmt/acidentes ; GET :id ; POST ; POST :id/profilaxia | sorologia | cat | encerramento
//   GET  /api/pessoas/sesmt/acidentes/:id/cat/pdf                     a CAT em PDF/A
//   GET  /api/pessoas/sesmt/riscos ; GET riscos/fatores ; POST riscos ; POST riscos/:id/encerramento
//   GET  /api/pessoas/sesmt/epi/:vinculo ; POST (entrega, dosímetro ou quimioterápico)
//   POST /api/pessoas/sesmt/epi/entregas/:id/assinatura ; GET epi/entregas/:id/comprovante/pdf
//   W0-06: POST acidentes/:id/retificacao | anulacao | esocial (S-2210) ; POST epi/entregas/:id/cancelamento
// Regra 16: nenhuma rota daqui abre o PEP, e as permissões do PEP não abrem estas. Toda gravação leva a
// Idempotency-Key (guarda) e a trilha; o estabelecimento vem da sessão.
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
  type AcidenteResposta,
  type ApoioSesmt,
  type BuscaColaboradoresSesmt,
  type CarteiraVacinas,
  type EpiDoColaborador,
  esquemaAnularAcidente,
  esquemaAssinaturaEpi,
  esquemaBuscaColaboradorSesmt,
  esquemaBuscaFatorRisco,
  esquemaCancelarEpi,
  esquemaEmitirCat,
  esquemaEncerrarAcidente,
  esquemaEncerrarLinhaRisco,
  esquemaFiltroAcidentes,
  esquemaFiltroRiscos,
  esquemaFiltroSesmt,
  esquemaGerarCatEsocial,
  esquemaLinhaRisco,
  esquemaProfilaxia,
  esquemaRegistrarAcidente,
  esquemaRegistrarAso,
  esquemaRegistrarVacinaColaborador,
  esquemaRegistroEpi,
  esquemaRetificarAcidente,
  esquemaSorologia,
  EVENTOS_AUDITAVEIS,
  type FatoresRisco,
  type ListaAcidentes,
  type MapaRiscos,
  type PainelSesmt,
  type PppColaborador,
  type ProntuarioOcupacional,
  type ResultadoGeracaoEsocial,
  type ResultadoSesmt,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { idDaRota, sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import type { CifraCpf } from '../cifra-cpf.js';
import { PORTA_ESOCIAL, type PortaEsocial } from '../esocial/porta-esocial.js';
import { ServicoEsocial } from '../esocial/servico-esocial.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from '../folha/porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from '../folha/porta-folha.js';
import { CIFRA_CPF_PESSOAS } from '../pessoas.controller.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_RUBRICAS, type PortaRubricas } from '../rubricas/porta-rubricas.js';
import { htmlCat, htmlComprovanteEpi, htmlPpp } from './documentos-sesmt.js';
import { PORTA_SESMT, type PortaSesmt } from './porta-sesmt.js';
import { ServicoSesmt } from './servico-sesmt.js';

export const GERADOR_PDF_SESMT = Symbol('GERADOR_PDF_SESMT');
type GeradorPdf = (html: string, titulo: string) => Promise<Buffer>;
type Resposta = { header(n: string, v: string): unknown; send(b: unknown): unknown };

const E = EVENTOS_AUDITAVEIS;
const NA_TABELA = (t: string) => `${t} com a SGH_TRILHA na mesma transação`;

@Controller('pessoas/sesmt')
export class SesmtController {
  readonly servico: ServicoSesmt;

  constructor(
    @Inject(PORTA_SESMT) porta: PortaSesmt,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(GERADOR_PDF_SESMT) private readonly pdf: GeradorPdf | null = null,
    // W0-06: a fila do eSocial do S-2210 (retificação e anulação da CAT); a transmissão fica desligada aqui.
    @Optional() @Inject(PORTA_ESOCIAL) esocial: PortaEsocial | null = null,
    @Optional() @Inject(PORTA_FOLHA) folha: PortaFolha | null = null,
    @Optional() @Inject(PORTA_CALCULO_FOLHA) calculo: PortaCalculoFolha | null = null,
    @Optional() @Inject(PORTA_RUBRICAS) rubricas: PortaRubricas | null = null,
    @Optional() @Inject(CIFRA_CPF_PESSOAS) cifra: CifraCpf | null = null,
  ) {
    const fila =
      esocial && folha && calculo && rubricas
        ? new ServicoEsocial(esocial, folha, calculo, rubricas, pessoas, cifra, trilha, configuracao, cache)
        : null;
    this.servico = new ServicoSesmt(porta, pessoas, trilha, configuracao, cache, fila);
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

  private busca(q: Record<string, string>, req: RequisicaoAutorizada): Promise<BuscaColaboradoresSesmt> {
    const f = corpo(esquemaBuscaColaboradorSesmt, q);
    return this.servico.buscarColaboradores(sessaoDe(req), f.termo, f.estado);
  }

  // ── Apoio e busca por tela ──────────────────────────────────────────────────────────────────────────────────

  @Get('aso/apoio')
  @Permissao('pessoas.ocupacional.ler')
  apoioAso(@Req() req: RequisicaoAutorizada): Promise<ApoioSesmt> {
    return this.servico.apoioTela(sessaoDe(req));
  }
  @Get('cat/apoio')
  @Permissao('pessoas.acidente.ler')
  apoioCat(@Req() req: RequisicaoAutorizada): Promise<ApoioSesmt> {
    return this.servico.apoioTela(sessaoDe(req));
  }
  @Get('riscos/apoio')
  @Permissao('pessoas.risco.ler')
  apoioRiscos(@Req() req: RequisicaoAutorizada): Promise<ApoioSesmt> {
    return this.servico.apoioTela(sessaoDe(req));
  }
  @Get('vacinas/apoio')
  @Permissao('pessoas.vacinacao.ler')
  apoioVacinas(@Req() req: RequisicaoAutorizada): Promise<ApoioSesmt> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('aso/colaboradores')
  @Permissao('pessoas.ocupacional.ler')
  buscaAso(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    return this.busca(q, req);
  }
  @Get('cat/colaboradores')
  @Permissao('pessoas.acidente.ler')
  buscaCat(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    return this.busca(q, req);
  }
  @Get('riscos/colaboradores')
  @Permissao('pessoas.risco.ler')
  buscaRiscos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    return this.busca(q, req);
  }
  @Get('vacinas/colaboradores')
  @Permissao('pessoas.vacinacao.ler')
  buscaVacinas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    return this.busca(q, req);
  }

  // ── Painel e prontuário ocupacional ─────────────────────────────────────────────────────────────────────────

  @Get('painel')
  @Permissao('pessoas.ocupacional.ler')
  @Auditar(E.pessoasOcupacionalLido.codigo)
  painel(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<PainelSesmt> {
    return this.servico.painel(sessaoDe(req), corpo(esquemaFiltroSesmt, q));
  }

  @Get('aso/:vinculo')
  @Permissao('pessoas.ocupacional.ler')
  @Auditar(E.pessoasOcupacionalLido.codigo)
  prontuario(@Param('vinculo') v: string, @Req() req: RequisicaoAutorizada): Promise<ProntuarioOcupacional> {
    return this.servico.prontuario(sessaoDe(req), idDaRota(v));
  }

  @Post('aso/:vinculo')
  @HttpCode(200)
  @Permissao('pessoas.ocupacional.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_OCUPACIONAL'))
  registrarAso(
    @Param('vinculo') v: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.registrarAso(
      sessaoDe(req),
      corpo(esquemaRegistrarAso, { ...(b as object), vinculo: idDaRota(v) }),
    );
  }

  // ── Vacinas ─────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('vacinas/:vinculo')
  @Permissao('pessoas.vacinacao.ler')
  @Auditar(E.pessoasOcupacionalLido.codigo)
  carteira(@Param('vinculo') v: string, @Req() req: RequisicaoAutorizada): Promise<CarteiraVacinas> {
    return this.servico.carteira(sessaoDe(req), idDaRota(v));
  }

  @Post('vacinas/:vinculo')
  @HttpCode(200)
  @Permissao('pessoas.vacinacao.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_VACINA'))
  registrarVacina(
    @Param('vinculo') v: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.registrarVacina(
      sessaoDe(req),
      corpo(esquemaRegistrarVacinaColaborador, { ...(b as object), vinculo: idDaRota(v) }),
    );
  }

  // ── Acidentes e CAT ─────────────────────────────────────────────────────────────────────────────────────────

  @Get('acidentes')
  @Permissao('pessoas.acidente.ler')
  @Auditar(E.pessoasOcupacionalLido.codigo)
  acidentes(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaAcidentes> {
    return this.servico.listarAcidentes(sessaoDe(req), corpo(esquemaFiltroAcidentes, q));
  }

  @Get('acidentes/:id')
  @Permissao('pessoas.acidente.ler')
  @Auditar(E.pessoasOcupacionalLido.codigo)
  acidente(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<AcidenteResposta> {
    return this.servico.acidente(sessaoDe(req), idDaRota(id));
  }

  @Post('acidentes')
  @HttpCode(200)
  @Permissao('pessoas.acidente.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ACIDENTE e SGH_PES_ACID_SOROLOGIA'))
  registrarAcidente(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSesmt> {
    return this.servico.registrarAcidente(sessaoDe(req), corpo(esquemaRegistrarAcidente, b));
  }

  @Post('acidentes/:id/profilaxia')
  @HttpCode(200)
  @Permissao('pessoas.acidente.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ACIDENTE'))
  profilaxia(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.profilaxia(
      sessaoDe(req),
      corpo(esquemaProfilaxia, { ...(b as object), acidente: idDaRota(id) }),
    );
  }

  @Post('acidentes/:id/sorologia')
  @HttpCode(200)
  @Permissao('pessoas.acidente.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ACID_SOROLOGIA'))
  sorologia(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.sorologia(
      sessaoDe(req),
      corpo(esquemaSorologia, { ...(b as object), acidente: idDaRota(id) }),
    );
  }

  @Post('acidentes/:id/cat')
  @HttpCode(200)
  @Permissao('pessoas.acidente.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ACIDENTE'))
  emitirCat(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.emitirCat(
      sessaoDe(req),
      corpo(esquemaEmitirCat, { ...(b as object), acidente: idDaRota(id) }),
    );
  }

  @Post('acidentes/:id/encerramento')
  @HttpCode(200)
  @Permissao('pessoas.acidente.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ACIDENTE'))
  encerrar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.encerrarAcidente(
      sessaoDe(req),
      corpo(esquemaEncerrarAcidente, { ...(b as object), acidente: idDaRota(id) }),
    );
  }

  @Get('acidentes/:id/cat/pdf')
  @Permissao('pessoas.acidente.ler')
  @Auditar(E.pessoasOcupacionalLido.codigo)
  async catPdf(@Param('id') id: string, @Req() req: RequisicaoAutorizada, @Res() res: Resposta) {
    const d = await this.servico.dadosCat(sessaoDe(req), idDaRota(id));
    return this.enviarPdf(
      res,
      htmlCat(d.acidente, d.dominios),
      `CAT ${d.acidente.catNumero}`,
      `cat-${d.acidente.id}`,
    );
  }

  // ── Riscos e EPI ────────────────────────────────────────────────────────────────────────────────────────────

  @Get('riscos')
  @Permissao('pessoas.risco.ler')
  riscos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<MapaRiscos> {
    return this.servico.mapaRiscos(sessaoDe(req), corpo(esquemaFiltroRiscos, q));
  }

  @Get('riscos/fatores')
  @Permissao('pessoas.risco.ler')
  fatores(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<FatoresRisco> {
    return this.servico.fatoresRisco(sessaoDe(req), corpo(esquemaBuscaFatorRisco, q).termo);
  }

  @Post('riscos')
  @HttpCode(200)
  @Permissao('pessoas.risco.editar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_RISCO_FUNCAO'))
  incluirRisco(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSesmt> {
    return this.servico.incluirLinhaRisco(sessaoDe(req), corpo(esquemaLinhaRisco, b));
  }

  @Post('riscos/:id/encerramento')
  @HttpCode(200)
  @Permissao('pessoas.risco.editar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_RISCO_FUNCAO'))
  encerrarRisco(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.encerrarLinhaRisco(
      sessaoDe(req),
      corpo(esquemaEncerrarLinhaRisco, { ...(b as object), id: idDaRota(id) }),
    );
  }

  @Get('epi/:vinculo')
  @Permissao('pessoas.risco.ler')
  @Auditar(E.pessoasOcupacionalLido.codigo)
  epi(@Param('vinculo') v: string, @Req() req: RequisicaoAutorizada): Promise<EpiDoColaborador> {
    return this.servico.epiDoColaborador(sessaoDe(req), idDaRota(v));
  }

  @Get('epi/:vinculo/ppp')
  @Permissao('pessoas.risco.ler')
  @Auditar(E.pessoasOcupacionalLido.codigo)
  ppp(@Param('vinculo') v: string, @Req() req: RequisicaoAutorizada): Promise<PppColaborador> {
    return this.servico.ppp(sessaoDe(req), idDaRota(v));
  }

  @Get('epi/:vinculo/ppp/pdf')
  @Permissao('pessoas.risco.ler')
  @Auditar(E.pessoasOcupacionalLido.codigo)
  async pppPdf(@Param('vinculo') v: string, @Req() req: RequisicaoAutorizada, @Res() res: Resposta) {
    const s = sessaoDe(req);
    const d = await this.servico.ppp(s, idDaRota(v));
    return this.enviarPdf(
      res,
      htmlPpp(d, s.login),
      `PPP ${d.colaborador.nome}`,
      `ppp-${d.colaborador.vinculo}`,
    );
  }

  @Post('epi/:vinculo')
  @HttpCode(200)
  @Permissao('pessoas.epi.entregar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_EPI_ENTREGA'))
  registrarEpi(
    @Param('vinculo') v: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.registrarEpi(
      sessaoDe(req),
      corpo(esquemaRegistroEpi, { ...(b as object), vinculo: idDaRota(v) }),
    );
  }

  // ── W0-06: retificação e anulação do acidente e da CAT (S-2210 na fila do eSocial), cancelamento do EPI ──────

  @Post('acidentes/:id/retificacao')
  @HttpCode(200)
  @Permissao('pessoas.acidente.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ACIDENTE e SGH_PES_CORRECAO'))
  retificarAcidente(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.retificarAcidente(
      sessaoDe(req),
      corpo(esquemaRetificarAcidente, { ...(b as object), acidente: idDaRota(id) }),
    );
  }

  @Post('acidentes/:id/anulacao')
  @HttpCode(200)
  @Permissao('pessoas.acidente.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ACIDENTE e SGH_PES_CORRECAO'))
  anularAcidente(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.anularAcidente(
      sessaoDe(req),
      corpo(esquemaAnularAcidente, { ...(b as object), acidente: idDaRota(id) }),
    );
  }

  @Post('acidentes/:id/esocial')
  @HttpCode(200)
  @Permissao('pessoas.acidente.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ESOCIAL_EVENTO'))
  gerarCatEsocial(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGeracaoEsocial> {
    return this.servico.gerarCatEsocial(
      sessaoDe(req),
      corpo(esquemaGerarCatEsocial, { ...(b as object), acidente: idDaRota(id) }),
    );
  }

  @Post('epi/entregas/:id/cancelamento')
  @HttpCode(200)
  @Permissao('pessoas.epi.entregar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_EPI_ENTREGA e SGH_PES_CORRECAO'))
  cancelarEpi(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.cancelarEpi(
      sessaoDe(req),
      corpo(esquemaCancelarEpi, { ...(b as object), entrega: idDaRota(id) }),
    );
  }

  @Post('epi/entregas/:id/assinatura')
  @HttpCode(200)
  @Permissao('pessoas.epi.entregar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_EPI_ENTREGA'))
  assinar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSesmt> {
    return this.servico.assinarEpi(
      sessaoDe(req),
      corpo(esquemaAssinaturaEpi, { ...(b as object), entrega: idDaRota(id) }),
    );
  }

  @Get('epi/entregas/:id/comprovante/pdf')
  @Permissao('pessoas.risco.ler')
  @Auditar(E.pessoasOcupacionalLido.codigo)
  async comprovantePdf(@Param('id') id: string, @Req() req: RequisicaoAutorizada, @Res() res: Resposta) {
    const d = await this.servico.dadosComprovante(sessaoDe(req), idDaRota(id));
    return this.enviarPdf(
      res,
      htmlComprovanteEpi(d.entrega, d.colaborador),
      `Comprovante de entrega de EPI ${d.entrega.id}`,
      `comprovante-epi-${d.entrega.id}`,
    );
  }
}
