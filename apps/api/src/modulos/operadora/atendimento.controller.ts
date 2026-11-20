// Rotas do atendimento ao beneficiário com protocolo e das contas do portal do prestador da operadora própria (M56,
// etapa 8, F7; ficha, seções 4, 6 e 7):
//   GET  /api/operadora/protocolos/apoio                 domínios, operadoras, parâmetros e a situação da fatia (vale
//                                                        também desligada)
//   GET  /api/operadora/protocolos                       os protocolos (busca, situação, instância, natureza, vencidos,
//                                                        apos), com as contagens
//   GET  /api/operadora/protocolos/consulta?numero       a situação pelo número (atendimento ou autorização)
//   GET  /api/operadora/protocolos/:id                   a ficha com o histórico, as ações e o texto da resposta por
//                                                        escrito (leitura na trilha: o relato e a resposta)
//   GET  /api/operadora/protocolos/:id/respostas/:resposta/anexo  W0-10: o anexo de uma resposta do prestador
//   POST /api/operadora/protocolos                       operadora.registrarProtocolo (número e prazo)
//   POST /api/operadora/protocolos/:id/analise           operadora.analisarProtocolo
//   POST /api/operadora/protocolos/:id/interacao         operadora.registrarInteracaoProtocolo
//   POST /api/operadora/protocolos/:id/prorrogacao       operadora.prorrogarProtocolo (só a ouvidoria, uma vez)
//   POST /api/operadora/protocolos/:id/resposta          operadora.responderProtocolo
//   POST /api/operadora/protocolos/:id/escrita           operadora.pedirEscritaProtocolo
//   POST /api/operadora/protocolos/:id/escrita/envio     operadora.enviarEscritaProtocolo
//   POST /api/operadora/protocolos/:id/encerrar          operadora.encerrarProtocolo
//   POST /api/operadora/protocolos/:id/cancelar          operadora.cancelarProtocolo
//   POST /api/operadora/protocolos/:id/reanalise         operadora.pedirReanaliseProtocolo (novo protocolo da ouvidoria)
//   GET  /api/operadora/portal/acessos                   as contas do portal (sem a senha), os domínios e os prestadores
//   POST /api/operadora/portal/acessos                   operadora.criarAcessoPortal (o código de ativação, uma vez)
//   POST /api/operadora/portal/acessos/:id               operadora.alterarAcessoPortal (funções e tipo de atendimento)
//   POST /api/operadora/portal/acessos/:id/reemissao     operadora.reemitirAcessoPortal (novo código; zera a senha)
//   POST /api/operadora/portal/acessos/:id/encerrar      operadora.encerrarAcessoPortal
// Os protocolos exigem a chave `operadora.atendimento`, e as contas a `operadora.portalPrestador`, que só valem com a do
// módulo (regra 1), menos o apoio e a lista das contas. Cada gravação muda as SGH_OPE_* da fatia com a SGH_TRILHA na
// mesma transação; nenhuma tabela legada é escrita. A resposta ao beneficiário não sai por mensagem nesta etapa (o meio
// é registrado; DP-44 (a)).
import {
  Body,
  Controller,
  Get,
  Header,
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
  type AcessosPortalPrestador,
  type ApoioProtocolos,
  CHAVE_OPERADORA_ATENDIMENTO,
  CHAVE_OPERADORA_PORTAL_PRESTADOR,
  type ChaveOperadora,
  type ConsultaProtocolo,
  esquemaAlterarAcessoPortal,
  esquemaAnalisarProtocolo,
  esquemaCancelarProtocolo,
  esquemaConsultaNumeroProtocolo,
  esquemaCriarAcessoPortal,
  esquemaEncerrarAcessoPortal,
  esquemaEncerrarProtocolo,
  esquemaEnviarEscritaProtocolo,
  esquemaFiltroProtocolos,
  esquemaInteracaoProtocolo,
  esquemaPedirEscritaProtocolo,
  esquemaProrrogarProtocolo,
  esquemaReanaliseProtocolo,
  esquemaReemitirAcessoPortal,
  esquemaRegistrarProtocoloOpe,
  esquemaResponderProtocolo,
  EVENTOS_AUDITAVEIS,
  type ProtocoloDetalhe,
  type Protocolos,
  type ResultadoAcessoPortal,
  type ResultadoProtocoloOpe,
  ROTULOS_SITUACAO_PROTOCOLO,
  ROTAS_OPERADORA_F7 as R,
  type SituacaoProtocoloOpe,
} from '@sgh/contratos';
import {
  conferirProrrogacao,
  conferirResposta,
  funcoesNormalizadas,
  prazoDaEscrita,
  prazoDoProtocolo,
  protocoloAtendimento,
  validadeDaAtivacao,
} from '@sgh/dominio-operadora';
import type { LinhaTrilha } from '@sgh/legado';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
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
import { ServicoSituacaoOperadora, type SujeitoOperadora } from './aplicacao/situacao.js';
import {
  type GravadorAtendimento,
  PORTA_ATENDIMENTO_OPERADORA,
  type PortaAtendimentoOperadora,
} from './atendimento-porta.js';
import {
  codigoDeAtivacao,
  recusaDoAtendimento,
  resumoDoProtocolo,
  rotuloDaGuia,
  ServicoAtendimentoOperadora,
  sha256,
} from './atendimento-servico.js';
import { PORTA_AUTORIZACAO_OPERADORA, type PortaAutorizacaoOperadora } from './autorizacao-porta.js';

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'operadora.atendimento';
const TABELA = 'SGH_OPE_PROTOCOLO';
const TABELA_ACESSO = 'SGH_OPE_PORTAL_ACESSO';
function filtro<T extends { safeParse(v: unknown): { success: boolean; data?: unknown } }>(
  esquema: T,
  q: unknown,
) {
  const r = esquema.safeParse(q ?? {});
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
  return r.data as T extends { safeParse(v: unknown): { data?: infer D } } ? Exclude<D, undefined> : never;
}

@Controller()
export class AtendimentoOperadoraController {
  readonly situacoes: ServicoSituacaoOperadora;
  readonly servico: ServicoAtendimentoOperadora;

  constructor(
    @Inject(PORTA_ATENDIMENTO_OPERADORA) private readonly porta: PortaAtendimentoOperadora,
    @Inject(PORTA_AUTORIZACAO_OPERADORA) private readonly autorizacoes: PortaAutorizacaoOperadora,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.situacoes = new ServicoSituacaoOperadora(fonte, cache);
    this.servico = new ServicoAtendimentoOperadora(porta, autorizacoes);
  }

  private sujeito(req: RequisicaoAutorizada, s: SessaoCadastro): SujeitoOperadora {
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      setor: req.sgh?.sessao.unidadeAtiva ?? null,
    };
  }

  /** A fatia vale (módulo e a chave ligados) ou 403 `recurso-desligado` com o motivo (nada é lido nem gravado). */
  private async exigir(req: RequisicaoAutorizada, chave: ChaveOperadora): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    await this.situacoes.exigir(this.sujeito(req, s), chave);
    return s;
  }

  private async fatia(req: RequisicaoAutorizada, s: SessaoCadastro, chave: string) {
    const situacao = await this.situacoes.situacao(this.sujeito(req, s));
    const f = situacao.fatias.find((x) => x.chave === chave);
    const ligada = f?.situacao === 'ligada';
    return { ligada, motivo: ligada ? null : (f?.motivo ?? situacao.modulo.motivo) };
  }

  /** Gravação SGH_ com a trilha na mesma transação (na memória, a trilha pelo registrador da API). */
  private async gravar<T extends { id: number }>(
    s: SessaoCadastro,
    evento: string,
    operacao: string,
    tabela: string,
    fn: (g: GravadorAtendimento) => Promise<T>,
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

  private resultado(
    id: number,
    versao: number,
    situacao: SituacaoProtocoloOpe,
    protocolo: string,
    mensagem: string,
  ): ResultadoProtocoloOpe {
    return { ok: true, id, versao, situacao, protocolo, mensagem };
  }

  // ── Protocolos ─────────────────────────────────────────────────────────────────────────────

  @Get(R.apoio.caminho)
  @Permissao(R.apoio.permissao)
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioProtocolos> {
    const s = sessaoDe(req);
    const f = await this.fatia(req, s, CHAVE_OPERADORA_ATENDIMENTO);
    return this.servico.apoio(s.porta, { ...f, podeRegistrar: s.pode(R.registrar.permissao) });
  }

  @Get(R.lista.caminho)
  @Permissao(R.lista.permissao)
  async lista(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Protocolos> {
    const f = filtro(esquemaFiltroProtocolos, q);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const [r, totais] = await Promise.all([
      this.porta.protocolos(s.porta, {
        ...(f.busca ? { busca: f.busca } : {}),
        ...(f.situacao ? { situacao: f.situacao } : {}),
        ...(f.instancia ? { instancia: f.instancia } : {}),
        ...(f.natureza ? { natureza: f.natureza } : {}),
        ...(f.vencidos ? { vencidos: true } : {}),
        ...(f.apos ? { apos: f.apos } : {}),
      }),
      this.porta.totais(s.porta),
    ]);
    return { itens: r.itens.map(resumoDoProtocolo), proxima: r.proxima, totais };
  }

  @Get(R.consulta.caminho)
  @Permissao(R.consulta.permissao)
  @Auditar(E.operadoraProtocoloConsultado.codigo)
  async consulta(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ConsultaProtocolo> {
    const f = filtro(esquemaConsultaNumeroProtocolo, q);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const r = await this.porta.consulta(s.porta, f.numero);
    if (!r) throw recusaDoAtendimento([{ codigo: 'protocolo-inexistente', campo: 'numero' }]);
    const rotulo =
      r.tipo === 'atendimento'
        ? (ROTULOS_SITUACAO_PROTOCOLO[r.situacao as SituacaoProtocoloOpe] ?? r.situacao)
        : rotuloDaGuia(r.situacao);
    return {
      tipo: r.tipo,
      id: r.id,
      protocolo: r.protocolo,
      situacao: r.situacao,
      situacaoRotulo: rotulo,
      abertoEm: r.abertoEm,
      prazoEm: r.prazoEm,
      vencido: r.vencido,
    };
  }

  @Get(R.ficha.caminho)
  @Permissao(R.ficha.permissao)
  @Auditar(E.operadoraProtocoloLido.codigo)
  async ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ProtocoloDetalhe> {
    const n = idDaRota(id);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    return this.servico.detalhe(s.porta, n);
  }

  /** W0-10: o anexo enviado pelo prestador pelo portal (só leitura; o registro não se edita). */
  @Get(R.anexoResposta.caminho)
  @Permissao(R.anexoResposta.permissao)
  @Auditar(E.operadoraProtocoloLido.codigo)
  @Header('cache-control', 'no-store')
  async anexoResposta(
    @Param('id') id: string,
    @Param('resposta') anexo: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { header(nome: string, valor: string): unknown },
  ): Promise<Buffer> {
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const x = await this.servico.anexoDaResposta(s.porta, idDaRota(id), idDaRota(anexo));
    res.header('content-type', x.tipo);
    res.header('content-disposition', `attachment; filename="${encodeURIComponent(x.nome)}"`);
    res.header('x-anexo-sha256', x.sha256);
    res.header('x-content-type-options', 'nosniff');
    return x.bytes;
  }

  @Post(R.registrar.caminho)
  @HttpCode(200)
  @Permissao(R.registrar.permissao)
  @AuditadoNoHandler(
    'operadora.registrarProtocolo (SGH_OPE_PROTOCOLO e o evento) com a SGH_TRILHA na mesma transação',
  )
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoProtocoloOpe> {
    const e = corpo(esquemaRegistrarProtocoloOpe, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const x = await this.servico.conferirRegistro(s.porta, e);
    let protocolo = '';
    const r = await this.gravar(
      s,
      E.operadoraProtocoloRegistrado.codigo,
      'operadora.registrarProtocolo',
      TABELA,
      async (g) => {
        protocolo = protocoloAtendimento(x.registroAns, x.registro.abertoEm, await g.proximoProtocolo());
        return g.registrar({ ...x.registro, protocolo, usuario: s.login });
      },
    );
    return this.resultado(
      r.id,
      r.versao,
      'aberto',
      protocolo,
      ServicoAtendimentoOperadora.mensagemDoRegistro(protocolo, x.registro.prazoTipo, x.registro.prazoEm),
    );
  }

  @Post(R.analisar.caminho)
  @HttpCode(200)
  @Permissao(R.analisar.permissao)
  @AuditadoNoHandler(
    'operadora.analisarProtocolo (SGH_OPE_PROTOCOLO e o evento) com a SGH_TRILHA na mesma transação',
  )
  async analisar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaAnalisarProtocolo, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const p = await this.servico.conferirAcao(s.porta, n, 'analisar');
    const r = await this.gravar(
      s,
      E.operadoraProtocoloAnalisado.codigo,
      'operadora.analisarProtocolo',
      TABELA,
      (g) => g.analisar({ id: n, versao: e.versao, usuario: s.login }),
    );
    return this.resultado(n, r.versao, 'em-analise', p.protocolo, 'Protocolo em análise.');
  }

  @Post(R.interagir.caminho)
  @HttpCode(200)
  @Permissao(R.interagir.permissao)
  @AuditadoNoHandler(
    'operadora.registrarInteracaoProtocolo (SGH_OPE_PROTOCOLO e o evento) com a SGH_TRILHA na mesma transação',
  )
  async interagir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaInteracaoProtocolo, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const p = await this.servico.conferirAcao(s.porta, n, 'interagir');
    const r = await this.gravar(
      s,
      E.operadoraProtocoloInteracao.codigo,
      'operadora.registrarInteracaoProtocolo',
      TABELA,
      (g) => g.interagir({ id: n, versao: e.versao, situacao: p.situacao, texto: e.texto, usuario: s.login }),
    );
    return this.resultado(n, r.versao, p.situacao, p.protocolo, 'Contato registrado no histórico.');
  }

  @Post(R.prorrogar.caminho)
  @HttpCode(200)
  @Permissao(R.prorrogar.permissao)
  @AuditadoNoHandler(
    'operadora.prorrogarProtocolo (SGH_OPE_PROTOCOLO e o evento) com a SGH_TRILHA na mesma transação',
  )
  async prorrogar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaProrrogarProtocolo, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const p = await this.servico.conferirAcao(s.porta, n, 'prorrogar');
    const x = conferirProrrogacao(
      {
        instancia: p.instancia as 'ouvidoria',
        situacao: p.situacao,
        abertoEm: p.abertoEm,
        prazoEm: p.prazoEm,
        prorrogadoAte: p.prorrogadoAte,
      },
      e.ate,
    );
    if (x.problemas.length) throw recusaDoAtendimento(x.problemas);
    const r = await this.gravar(
      s,
      E.operadoraProtocoloProrrogado.codigo,
      'operadora.prorrogarProtocolo',
      TABELA,
      (g) =>
        g.prorrogar({
          id: n,
          versao: e.versao,
          situacao: p.situacao,
          ate: x.prorrogadoAte,
          motivo: e.motivo,
          usuario: s.login,
        }),
    );
    return this.resultado(
      n,
      r.versao,
      p.situacao,
      p.protocolo,
      `Prazo prorrogado até ${e.ate.split('-').reverse().join('/')}.`,
    );
  }

  @Post(R.responder.caminho)
  @HttpCode(200)
  @Permissao(R.responder.permissao)
  @AuditadoNoHandler(
    'operadora.responderProtocolo (SGH_OPE_PROTOCOLO e o evento) com a SGH_TRILHA na mesma transação',
  )
  async responder(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaResponderProtocolo, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const p = await this.servico.conferirAcao(s.porta, n, 'responder');
    const problemas = conferirResposta({
      natureza: p.natureza as Parameters<typeof conferirResposta>[0]['natureza'],
      conclusao: e.conclusao,
      fundamento: e.fundamento ?? null,
    });
    if (problemas.length) throw recusaDoAtendimento(problemas);
    const { agora } = await this.porta.relogio(s.porta);
    const escritaPrazoEm =
      p.escritaPedida && p.escritaPedidaEm ? prazoDaEscrita(agora, p.escritaPedidaEm) : null;
    const r = await this.gravar(
      s,
      E.operadoraProtocoloRespondido.codigo,
      'operadora.responderProtocolo',
      TABELA,
      (g) =>
        g.responder({
          id: n,
          versao: e.versao,
          conclusao: e.conclusao,
          resposta: e.resposta,
          fundamento: e.fundamento ?? null,
          meio: e.meio,
          respondidoEm: agora,
          escritaPrazoEm,
          usuario: s.login,
        }),
    );
    return this.resultado(
      n,
      r.versao,
      'respondido',
      p.protocolo,
      escritaPrazoEm
        ? `Resposta registrada. A resposta por escrito sai até ${escritaPrazoEm.slice(0, 16).replace('T', ' ')}.`
        : 'Resposta registrada.',
    );
  }

  @Post(R.pedirEscrita.caminho)
  @HttpCode(200)
  @Permissao(R.pedirEscrita.permissao)
  @AuditadoNoHandler(
    'operadora.pedirEscritaProtocolo (SGH_OPE_PROTOCOLO e o evento) com a SGH_TRILHA na mesma transação',
  )
  async pedirEscrita(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaPedirEscritaProtocolo, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const p = await this.servico.conferirAcao(s.porta, n, 'pedirEscrita');
    const { agora } = await this.porta.relogio(s.porta);
    const escritaPrazoEm = p.respondidoEm ? prazoDaEscrita(p.respondidoEm, agora) : null;
    const r = await this.gravar(
      s,
      E.operadoraProtocoloEscritaPedida.codigo,
      'operadora.pedirEscritaProtocolo',
      TABELA,
      (g) =>
        g.pedirEscrita({
          id: n,
          versao: e.versao,
          situacao: p.situacao,
          pedidaEm: agora,
          escritaPrazoEm,
          usuario: s.login,
        }),
    );
    return this.resultado(
      n,
      r.versao,
      p.situacao,
      p.protocolo,
      escritaPrazoEm
        ? `Resposta por escrito pedida: sai até ${escritaPrazoEm.slice(0, 16).replace('T', ' ')}.`
        : 'Resposta por escrito pedida: o prazo começa na resposta.',
    );
  }

  @Post(R.enviarEscrita.caminho)
  @HttpCode(200)
  @Permissao(R.enviarEscrita.permissao)
  @AuditadoNoHandler(
    'operadora.enviarEscritaProtocolo (SGH_OPE_PROTOCOLO e o evento) com a SGH_TRILHA na mesma transação',
  )
  async enviarEscrita(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaEnviarEscritaProtocolo, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const p = await this.servico.conferirAcao(s.porta, n, 'enviarEscrita');
    const r = await this.gravar(
      s,
      E.operadoraProtocoloEscritaEnviada.codigo,
      'operadora.enviarEscritaProtocolo',
      TABELA,
      (g) => g.enviarEscrita({ id: n, versao: e.versao, meio: e.meio, usuario: s.login }),
    );
    return this.resultado(
      n,
      r.versao,
      'respondido',
      p.protocolo,
      'Envio da resposta por escrito registrado.',
    );
  }

  @Post(R.encerrar.caminho)
  @HttpCode(200)
  @Permissao(R.encerrar.permissao)
  @AuditadoNoHandler(
    'operadora.encerrarProtocolo (SGH_OPE_PROTOCOLO e o evento) com a SGH_TRILHA na mesma transação',
  )
  async encerrar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaEncerrarProtocolo, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const p = await this.servico.conferirAcao(s.porta, n, 'encerrar');
    const r = await this.gravar(
      s,
      E.operadoraProtocoloEncerrado.codigo,
      'operadora.encerrarProtocolo',
      TABELA,
      (g) => g.encerrar({ id: n, versao: e.versao, usuario: s.login }),
    );
    return this.resultado(n, r.versao, 'encerrado', p.protocolo, 'Protocolo encerrado.');
  }

  @Post(R.cancelar.caminho)
  @HttpCode(200)
  @Permissao(R.cancelar.permissao)
  @AuditadoNoHandler(
    'operadora.cancelarProtocolo (SGH_OPE_PROTOCOLO e o evento) com a SGH_TRILHA na mesma transação',
  )
  async cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaCancelarProtocolo, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const p = await this.servico.conferirAcao(s.porta, n, 'cancelar');
    const r = await this.gravar(
      s,
      E.operadoraProtocoloCancelado.codigo,
      'operadora.cancelarProtocolo',
      TABELA,
      (g) => g.cancelar({ id: n, versao: e.versao, motivo: e.motivo, usuario: s.login }),
    );
    return this.resultado(n, r.versao, 'cancelado', p.protocolo, 'Protocolo cancelado.');
  }

  @Post(R.reanalise.caminho)
  @HttpCode(200)
  @Permissao(R.reanalise.permissao)
  @AuditadoNoHandler(
    'operadora.pedirReanaliseProtocolo (o novo SGH_OPE_PROTOCOLO da ouvidoria e os eventos) com a SGH_TRILHA na mesma transação',
  )
  async reanalise(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaReanaliseProtocolo, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_ATENDIMENTO);
    const p = await this.servico.conferirAcao(s.porta, n, 'reanalise');
    // O novo protocolo da ouvidoria repete a demanda, o beneficiário e quem fez o contato do original.
    const x = await this.servico.conferirRegistro(s.porta, {
      operadora: p.operadora,
      instancia: 'ouvidoria',
      natureza: p.natureza as Parameters<typeof prazoDoProtocolo>[0]['natureza'],
      canal: e.canal,
      origem: e.origem,
      // O pedido do prestador pelo portal volta pela voz do beneficiário.
      solicitante: p.solicitante === 'prestador' ? 'beneficiario' : (p.solicitante as 'beneficiario'),
      ...(p.carteirinha ? { carteirinha: p.carteirinha } : {}),
      ...(p.solicitanteNome ? { solicitanteNome: p.solicitanteNome } : {}),
      origemProtocolo: n,
      urgente: false,
      altaComplexidade: false,
      assunto: `Reanálise do protocolo ${p.protocolo}`.slice(0, 200),
      relato: e.relato,
      escritaPedida: e.escritaPedida,
    });
    let protocolo = '';
    const r = await this.gravar(
      s,
      E.operadoraProtocoloReanalise.codigo,
      'operadora.pedirReanaliseProtocolo',
      TABELA,
      async (g) => {
        protocolo = protocoloAtendimento(x.registroAns, x.registro.abertoEm, await g.proximoProtocolo());
        return g.reanalise({
          id: n,
          versao: e.versao,
          situacao: p.situacao,
          usuario: s.login,
          novo: { ...x.registro, protocolo, usuario: s.login },
        });
      },
    );
    return this.resultado(
      r.id,
      r.versao,
      'aberto',
      protocolo,
      `Reanálise na ouvidoria: ${ServicoAtendimentoOperadora.mensagemDoRegistro(protocolo, x.registro.prazoTipo, x.registro.prazoEm)}`,
    );
  }

  // ── Contas do portal do prestador ─────────────────────────────────────────────────────────

  @Get(R.acessos.caminho)
  @Permissao(R.acessos.permissao)
  async acessos(@Req() req: RequisicaoAutorizada): Promise<AcessosPortalPrestador> {
    const s = sessaoDe(req);
    const f = await this.fatia(req, s, CHAVE_OPERADORA_PORTAL_PRESTADOR);
    const [prestadores, operadoras] = f.ligada
      ? await Promise.all([this.autorizacoes.prestadores(s.porta), this.autorizacoes.operadoras(s.porta)])
      : [[], []];
    return this.servico.acessos(
      s.porta,
      { ...f, podeEditar: s.pode(R.criarAcesso.permissao) },
      prestadores.map((p) => ({ id: p.id, nome: p.nome })),
      operadoras.map((o) => ({
        id: o.id,
        nome: o.nomeFantasia ?? o.razaoSocial,
        registroAns: o.registroAns,
      })),
    );
  }

  private resultadoAcesso(
    id: number,
    versao: number,
    situacao: ResultadoAcessoPortal['situacao'],
    mensagem: string,
    ativacao: { codigo: string; validade: string } | null = null,
  ): ResultadoAcessoPortal {
    return {
      ok: true,
      id,
      versao,
      situacao,
      codigoAtivacao: ativacao?.codigo ?? null,
      ativacaoValidaAte: ativacao?.validade ?? null,
      mensagem,
    };
  }

  @Post(R.criarAcesso.caminho)
  @HttpCode(200)
  @Permissao(R.criarAcesso.permissao)
  @AuditadoNoHandler(
    'operadora.criarAcessoPortal (SGH_OPE_PORTAL_ACESSO) com a SGH_TRILHA na mesma transação',
  )
  async criarAcesso(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAcessoPortal> {
    const e = corpo(esquemaCriarAcessoPortal, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_PORTAL_PRESTADOR);
    await this.servico.conferirCriacao(s.porta, e, e.operadora);
    const { agora } = await this.porta.relogio(s.porta);
    const codigo = codigoDeAtivacao();
    const validade = validadeDaAtivacao(agora);
    const r = await this.gravar(
      s,
      E.operadoraPortalAcessoCriado.codigo,
      'operadora.criarAcessoPortal',
      TABELA_ACESSO,
      (g) =>
        g.criarAcesso({
          operadora: e.operadora,
          prestador: e.prestador,
          login: e.login,
          nome: e.nome,
          funcoes: funcoesNormalizadas(e.funcoes).join(','),
          tipoAtendimento: e.tipoAtendimento,
          ativacaoResumo: sha256(codigo),
          ativacaoValidade: validade,
          usuario: s.login,
        }),
    );
    return this.resultadoAcesso(
      r.id,
      r.versao,
      'pendente',
      'Acesso criado. Entregue o código de ativação ao responsável no prestador: ele não aparece de novo.',
      { codigo, validade },
    );
  }

  @Post(R.alterarAcesso.caminho)
  @HttpCode(200)
  @Permissao(R.alterarAcesso.permissao)
  @AuditadoNoHandler(
    'operadora.alterarAcessoPortal (SGH_OPE_PORTAL_ACESSO) com a SGH_TRILHA na mesma transação',
  )
  async alterarAcesso(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaAlterarAcessoPortal, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_PORTAL_PRESTADOR);
    const a = await this.servico.acessoOu404(s.porta, n);
    await this.servico.conferirFuncoes(s.porta, e.funcoes, e.tipoAtendimento);
    const r = await this.gravar(
      s,
      E.operadoraPortalAcessoAlterado.codigo,
      'operadora.alterarAcessoPortal',
      TABELA_ACESSO,
      (g) =>
        g.alterarAcesso({
          id: n,
          versao: e.versao,
          funcoes: funcoesNormalizadas(e.funcoes).join(','),
          tipoAtendimento: e.tipoAtendimento,
          usuario: s.login,
        }),
    );
    return this.resultadoAcesso(n, r.versao, a.situacao, 'Funções do acesso alteradas.');
  }

  @Post(R.reemitirAcesso.caminho)
  @HttpCode(200)
  @Permissao(R.reemitirAcesso.permissao)
  @AuditadoNoHandler(
    'operadora.reemitirAcessoPortal (SGH_OPE_PORTAL_ACESSO) com a SGH_TRILHA na mesma transação',
  )
  async reemitirAcesso(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaReemitirAcessoPortal, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_PORTAL_PRESTADOR);
    await this.servico.acessoOu404(s.porta, n);
    const { agora } = await this.porta.relogio(s.porta);
    const codigo = codigoDeAtivacao();
    const validade = validadeDaAtivacao(agora);
    const r = await this.gravar(
      s,
      E.operadoraPortalAcessoReemitido.codigo,
      'operadora.reemitirAcessoPortal',
      TABELA_ACESSO,
      (g) =>
        g.reemitirAcesso({
          id: n,
          versao: e.versao,
          ativacaoResumo: sha256(codigo),
          ativacaoValidade: validade,
          usuario: s.login,
        }),
    );
    return this.resultadoAcesso(
      n,
      r.versao,
      'pendente',
      'Novo código de ativação. A senha e o segundo fator anteriores deixaram de valer.',
      { codigo, validade },
    );
  }

  @Post(R.encerrarAcesso.caminho)
  @HttpCode(200)
  @Permissao(R.encerrarAcesso.permissao)
  @AuditadoNoHandler(
    'operadora.encerrarAcessoPortal (SGH_OPE_PORTAL_ACESSO) com a SGH_TRILHA na mesma transação',
  )
  async encerrarAcesso(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaEncerrarAcessoPortal, b);
    const s = await this.exigir(req, CHAVE_OPERADORA_PORTAL_PRESTADOR);
    await this.servico.acessoOu404(s.porta, n);
    const r = await this.gravar(
      s,
      E.operadoraPortalAcessoEncerrado.codigo,
      'operadora.encerrarAcessoPortal',
      TABELA_ACESSO,
      (g) => g.encerrarAcesso({ id: n, versao: e.versao, motivo: e.motivo, usuario: s.login }),
    );
    return this.resultadoAcesso(n, r.versao, 'encerrado', 'Acesso encerrado.');
  }
}
