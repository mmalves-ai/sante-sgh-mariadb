// Rotas das obrigações da operadora própria com a ANS (M56, etapa 7, F6; ficha, seções 4, 6, 7 e 8, regra 7):
//   GET  /api/operadora/ans/apoio                        operadoras, obrigações, domínios do SIB, valores da TPS, destino
//                                                        e a situação da fatia (vale também desligada)
//   GET  /api/operadora/ans/envios                       os envios (operadora, obrigação, competência, situação, apos),
//                                                        com as contagens
//   GET  /api/operadora/ans/envios/:id                   a ficha com os quadros, os itens e o histórico (leitura na trilha)
//   GET  /api/operadora/ans/envios/:id/arquivo           o arquivo gerado com o SHA-256 (leitura na trilha)
//   POST /api/operadora/ans/previa                       o que o arquivo traria, com as pendências (nada gravado)
//   POST /api/operadora/ans/envios                       operadora.gerarEnvioAns (SIB, SIP, DIOPS, TPS, monitoramento)
//   POST /api/operadora/ans/envios/:id/envio             operadora.transmitirEnvioAns (recibo só na ANS, em produção)
//   POST /api/operadora/ans/envios/:id/retorno           operadora.registrarRetornoAns (itens aceitos e rejeitados, CCO)
//   POST /api/operadora/ans/envios/:id/pagamento         operadora.pagarGruAns (TPS e ressarcimento)
//   GET  /api/operadora/ans/sib/pendencias               os beneficiários com pendência para o SIB (leitura na trilha)
//   GET  /api/operadora/ans/sib/beneficiarios/:id        o complemento do beneficiário para o SIB (leitura na trilha)
//   PUT  /api/operadora/ans/sib/beneficiarios/:id        operadora.alterarComplementoSib
//   POST /api/operadora/ans/ressarcimento                operadora.registrarAvisoRessarcimento (análise de cada atendimento)
//   POST /api/operadora/ans/envios/:id/itens/:item/decisao  operadora.decidirAtendimentoRessarcimento
// Tudo exige a chave da fatia `operadora.ans`, que só vale com a do módulo (regra 1), menos o apoio. Cada gravação muda
// as SGH_OPE_ENVIO_ANS* (e o complemento do SIB) com a SGH_TRILHA na mesma transação; nenhuma tabela legada é escrita;
// fora de `producao` o destino é o simulador (regra 7).
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
} from '@nestjs/common';
import {
  type ApoioAns,
  type ArquivoEnvioAns,
  CHAVE_OPERADORA_ANS,
  type ComplementoSib,
  esquemaComplementoSib,
  esquemaDecidirItemRessarcimento,
  esquemaFiltroEnviosAns,
  esquemaFiltroPendenciasSib,
  esquemaGerarEnvioAns,
  esquemaPagamentoGru,
  esquemaPreviaEnvioAns,
  esquemaRegistrarAvisoRessarcimento,
  esquemaRegistrarRetornoAns,
  esquemaTransmitirEnvioAns,
  type EnvioAnsDetalhe,
  type EnviosAns,
  EVENTOS_AUDITAVEIS,
  OBRIGACOES_ANS,
  type PendenciasSib,
  type PreviaEnvioAns,
  type ResultadoEnvioAns,
  ROTAS_OPERADORA_F6 as R,
} from '@sgh/contratos';
import type { LinhaTrilha } from '@sgh/legado';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { type GravadorAns, PORTA_ANS_OPERADORA, type PortaAnsOperadora } from './ans-porta.js';
import { ServicoAnsOperadora } from './ans-servico.js';
import { ServicoSituacaoOperadora, type SujeitoOperadora } from './aplicacao/situacao.js';

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'operadora.ans';
const TABELA = 'SGH_OPE_ENVIO_ANS';

function filtro<T extends { safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } }>(
  esquema: T,
  q: unknown,
) {
  const r = esquema.safeParse(q ?? {});
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
  return r.data as T extends { safeParse(v: unknown): { data?: infer D } } ? Exclude<D, undefined> : never;
}

@Controller()
export class AnsOperadoraController {
  readonly situacoes: ServicoSituacaoOperadora;
  readonly servico: ServicoAnsOperadora;

  constructor(
    @Inject(PORTA_ANS_OPERADORA) private readonly porta: PortaAnsOperadora,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(CONFIGURACAO) cfg: Configuracao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.situacoes = new ServicoSituacaoOperadora(fonte, cache);
    this.servico = new ServicoAnsOperadora(porta, cfg?.ambiente ?? 'dev');
  }

  private sujeito(req: RequisicaoAutorizada, s: SessaoCadastro): SujeitoOperadora {
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      setor: req.sgh?.sessao.unidadeAtiva ?? null,
    };
  }

  /** A fatia vale (módulo e envios à ANS ligados) ou 403 `recurso-desligado` com o motivo. */
  private async exigirFatia(req: RequisicaoAutorizada): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    await this.situacoes.exigir(this.sujeito(req, s), CHAVE_OPERADORA_ANS);
    return s;
  }

  /** Gravação SGH_ com a trilha na mesma transação (na memória, a trilha pelo registrador da API). */
  private async gravar<T extends { id: number }>(
    s: SessaoCadastro,
    evento: string,
    operacao: string,
    fn: (g: GravadorAns) => Promise<T>,
    tabela = TABELA,
  ): Promise<T> {
    const linha = (r: T): LinhaTrilha =>
      linhaTrilha(s, evento, RECURSO, operacao, { tabela, id: String(r.id) });
    const r = await this.porta.gravarSgh(s.porta, linha, fn).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (this.porta.destino === 'memoria')
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
        recurso: RECURSO,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: String(r.id),
      });
    return r;
  }

  @Get(R.apoio.caminho)
  @Permissao(R.apoio.permissao)
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioAns> {
    const s = sessaoDe(req);
    const situacao = await this.situacoes.situacao(this.sujeito(req, s));
    const fatia = situacao.fatias.find((f) => f.chave === CHAVE_OPERADORA_ANS);
    const vale = fatia?.situacao === 'ligada';
    return this.servico.apoio(s.porta, {
      vale,
      motivo: vale ? null : (fatia?.motivo ?? situacao.modulo.motivo),
    });
  }

  @Get(R.lista.caminho)
  @Permissao(R.lista.permissao)
  async lista(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EnviosAns> {
    const f = filtro(esquemaFiltroEnviosAns, q);
    const s = await this.exigirFatia(req);
    return this.servico.lista(s.porta, f);
  }

  @Get(R.ficha.caminho)
  @Permissao(R.ficha.permissao)
  @Auditar(E.operadoraAnsLido.codigo)
  async ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<EnvioAnsDetalhe> {
    const n = idDaRota(id);
    const s = await this.exigirFatia(req);
    req.sghAlvo = { tabelaAlvo: TABELA, idAlvo: String(n) };
    return this.servico.detalhe(s.porta, n);
  }

  @Get(R.arquivo.caminho)
  @Permissao(R.arquivo.permissao)
  @Auditar(E.operadoraAnsLido.codigo)
  async arquivo(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ArquivoEnvioAns> {
    const n = idDaRota(id);
    const s = await this.exigirFatia(req);
    req.sghAlvo = { tabelaAlvo: TABELA, idAlvo: String(n) };
    return this.servico.arquivo(s.porta, n);
  }

  @Post(R.previa.caminho)
  @HttpCode(200)
  @Permissao(R.previa.permissao)
  @Auditar(E.operadoraAnsLido.codigo)
  async previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaEnvioAns> {
    const e = corpo(esquemaPreviaEnvioAns, b);
    const s = await this.exigirFatia(req);
    return (await this.servico.montar(s.porta, e)).previa;
  }

  @Post(R.gerar.caminho)
  @HttpCode(200)
  @Permissao(R.gerar.permissao)
  @AuditadoNoHandler(
    'operadora.gerarEnvioAns (SGH_OPE_ENVIO_ANS, os itens, o substituído e o evento) com a SGH_TRILHA na mesma transação',
  )
  async gerar(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEnvioAns & { mensagem: string }> {
    const e = corpo(esquemaGerarEnvioAns, b);
    const s = await this.exigirFatia(req);
    const g = await this.servico.gerar(s.porta, e);
    const r = await this.gravar(s, E.operadoraAnsGerado.codigo, 'operadora.gerarEnvioAns', (x) =>
      x.gerar({ ...g, usuario: s.login }),
    );
    return {
      id: r.id,
      versao: r.versao,
      situacao: 'gerado',
      mensagem: `${OBRIGACOES_ANS[e.obrigacao].rotulo} da competência ${e.competencia} gerado: ${g.registros} registro(s), arquivo ${g.arquivo?.nome ?? ''}.`,
    };
  }

  @Post(R.registrarAviso.caminho)
  @HttpCode(200)
  @Permissao(R.registrarAviso.permissao)
  @AuditadoNoHandler(
    'operadora.registrarAvisoRessarcimento (SGH_OPE_ENVIO_ANS, os atendimentos e o evento) com a SGH_TRILHA na mesma transação',
  )
  async registrarAviso(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEnvioAns & { mensagem: string }> {
    const e = corpo(esquemaRegistrarAvisoRessarcimento, b);
    const s = await this.exigirFatia(req);
    const g = await this.servico.registrarAviso(s.porta, e);
    const r = await this.gravar(
      s,
      E.operadoraAnsAvisoRegistrado.codigo,
      'operadora.registrarAvisoRessarcimento',
      (x) => x.gerar({ ...g, usuario: s.login }),
    );
    const sugeridas = g.itens.filter((i) => i.sugestao).length;
    return {
      id: r.id,
      versao: r.versao,
      situacao: 'gerado',
      mensagem: `Aviso ${e.aviso} registrado com ${g.registros} atendimento(s); ${sugeridas} com motivo de impugnação sugerido. Prazo da impugnação: ${g.aviso?.prazo.split('-').reverse().join('/') ?? ''}.`,
    };
  }

  @Post(R.decidirItem.caminho)
  @HttpCode(200)
  @Permissao(R.decidirItem.permissao)
  @AuditadoNoHandler(
    'operadora.decidirAtendimentoRessarcimento (SGH_OPE_ENVIO_ANS_ITEM e o evento) com a SGH_TRILHA na mesma transação',
  )
  async decidirItem(
    @Param('id') id: string,
    @Param('item') item: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEnvioAns & { mensagem: string }> {
    const n = idDaRota(id);
    const i = idDaRota(item);
    const e = corpo(esquemaDecidirItemRessarcimento, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirDecisao(s.porta, n, i, e);
    const r = await this.gravar(
      s,
      E.operadoraAnsItemDecidido.codigo,
      'operadora.decidirAtendimentoRessarcimento',
      (g) =>
        g.decidir({
          id: n,
          versao: e.versao,
          item: i,
          decisao: e.decisao,
          motivo: e.motivo,
          justificativa: e.justificativa,
          texto: x.texto,
          usuario: s.login,
        }),
    );
    return { id: n, versao: r.versao, situacao: 'gerado', mensagem: x.texto };
  }

  @Post(R.transmitir.caminho)
  @HttpCode(200)
  @Permissao(R.transmitir.permissao)
  @AuditadoNoHandler(
    'operadora.transmitirEnvioAns (SGH_OPE_ENVIO_ANS e o evento) com a SGH_TRILHA na mesma transação',
  )
  async transmitir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEnvioAns & { mensagem: string }> {
    const n = idDaRota(id);
    const e = corpo(esquemaTransmitirEnvioAns, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirTransmissao(s.porta, n, e);
    const r = await this.gravar(s, E.operadoraAnsTransmitido.codigo, 'operadora.transmitirEnvioAns', (g) =>
      g.transmitir({
        id: n,
        versao: e.versao,
        recibo: x.recibo,
        arquivo: x.arquivo,
        texto: x.texto,
        usuario: s.login,
      }),
    );
    return { id: n, versao: r.versao, situacao: 'enviado', mensagem: x.texto };
  }

  @Post(R.retorno.caminho)
  @HttpCode(200)
  @Permissao(R.retorno.permissao)
  @AuditadoNoHandler(
    'operadora.registrarRetornoAns (SGH_OPE_ENVIO_ANS, os itens, o complemento do SIB e o evento) com a SGH_TRILHA na mesma transação',
  )
  async retorno(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEnvioAns & { mensagem: string }> {
    const n = idDaRota(id);
    const e = corpo(esquemaRegistrarRetornoAns, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirRetorno(s.porta, n, e);
    const r = await this.gravar(s, E.operadoraAnsRetorno.codigo, 'operadora.registrarRetornoAns', (g) =>
      g.retorno({
        id: n,
        versao: e.versao,
        situacao: x.situacao,
        resumo: e.resumo ?? null,
        itens: x.itens,
        sib: x.envio.obrigacao === 'SIB',
        texto: x.texto,
        usuario: s.login,
      }),
    );
    return { id: n, versao: r.versao, situacao: x.situacao, mensagem: x.texto };
  }

  @Post(R.pagar.caminho)
  @HttpCode(200)
  @Permissao(R.pagar.permissao)
  @AuditadoNoHandler(
    'operadora.pagarGruAns (SGH_OPE_ENVIO_ANS e o evento) com a SGH_TRILHA na mesma transação',
  )
  async pagar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoEnvioAns & { mensagem: string }> {
    const n = idDaRota(id);
    const e = corpo(esquemaPagamentoGru, b);
    const s = await this.exigirFatia(req);
    const envio = await this.servico.conferirPagamento(s.porta, n, e);
    const r = await this.gravar(s, E.operadoraAnsPago.codigo, 'operadora.pagarGruAns', (g) =>
      g.pagar({ id: n, versao: e.versao, gru: e.gru, valor: e.valor, data: e.data, usuario: s.login }),
    );
    return {
      id: n,
      versao: r.versao,
      situacao: envio.situacao,
      mensagem: `GRU ${e.gru} registrada: R$ ${e.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em ${e.data.split('-').reverse().join('/')}.`,
    };
  }

  @Get(R.pendenciasSib.caminho)
  @Permissao(R.pendenciasSib.permissao)
  @Auditar(E.operadoraAnsLido.codigo)
  async pendenciasSib(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PendenciasSib> {
    const f = filtro(esquemaFiltroPendenciasSib, q);
    const s = await this.exigirFatia(req);
    req.sghAlvo = { tabelaAlvo: 'SGH_OPE_BENEF_SIB', idAlvo: String(f.operadora) };
    return this.servico.pendenciasSib(s.porta, f.operadora, f.apos ?? 0);
  }

  @Get(R.complementoSib.caminho)
  @Permissao(R.complementoSib.permissao)
  @Auditar(E.operadoraAnsLido.codigo)
  async complementoSib(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ComplementoSib> {
    const n = idDaRota(id);
    const s = await this.exigirFatia(req);
    req.sghAlvo = { tabelaAlvo: 'SGH_OPE_BENEF_SIB', idAlvo: String(n) };
    return this.servico.complemento(s.porta, n);
  }

  @Put(R.gravarComplementoSib.caminho)
  @HttpCode(200)
  @Permissao(R.gravarComplementoSib.permissao)
  @AuditadoNoHandler(
    'operadora.alterarComplementoSib (SGH_OPE_BENEF_SIB) com a SGH_TRILHA na mesma transação',
  )
  async gravarComplementoSib(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ComplementoSib> {
    const n = idDaRota(id);
    const e = corpo(esquemaComplementoSib, b);
    const s = await this.exigirFatia(req);
    await this.servico.conferirComplemento(s.porta, n, e);
    await this.gravar(
      s,
      E.operadoraAnsComplementoSib.codigo,
      'operadora.alterarComplementoSib',
      (g) => g.complemento({ ...e, beneficiario: n, usuario: s.login }),
      'SGH_OPE_BENEF_SIB',
    );
    return this.servico.complemento(s.porta, n);
  }
}
