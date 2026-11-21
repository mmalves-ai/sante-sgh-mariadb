// Rotas da autorização de guias e da auditoria médica da operadora própria (M56, etapa 5, F4; ficha, seções 4, 6 e 7):
//   GET  /api/operadora/autorizacoes/apoio                 domínios, operadoras, prestadores da rede, a designação de quem
//                                                          está na tela e a situação da fatia (vale também desligada)
//   GET  /api/operadora/autorizacoes/procedimentos?busca   a terminologia TUSS (código ou trecho do nome; até 20)
//   GET  /api/operadora/autorizacoes                       os pedidos (busca, situação, vencidas, prestador, apos), com as
//                                                          contagens
//   GET  /api/operadora/autorizacoes/:id                   a ficha com os itens, o histórico, as críticas de hoje e o
//                                                          comunicado da negativa (leitura na trilha: conteúdo clínico)
//   GET  /api/operadora/autorizacoes/:id/anexos/:anexo     W0-10: um anexo da resposta do prestador ao complemento
//   POST /api/operadora/autorizacoes                       operadora.registrarAutorizacao (protocolo e prazo)
//   POST /api/operadora/autorizacoes/:id/complemento       operadora.pedirComplemento (auditor designado)
//   POST /api/operadora/autorizacoes/:id/complemento/resposta  operadora.responderComplemento
//   POST /api/operadora/autorizacoes/:id/decisao           operadora.decidirAutorizacao (senha e validade)
//   POST /api/operadora/autorizacoes/:id/junta             operadora.abrirJunta (médico auditor)
//   POST /api/operadora/autorizacoes/:id/junta/conclusao   operadora.concluirJunta (a decisão com o parecer da junta)
//   POST /api/operadora/autorizacoes/:id/cancelar          operadora.cancelarAutorizacao
//   GET  /api/operadora/auditores                          as designações (diretoria da operadora)
//   POST /api/operadora/auditores                          operadora.designarAuditor
//   POST /api/operadora/auditores/:id/encerrar             operadora.encerrarAuditor (W0-10: redistribuirPara)
//   POST /api/operadora/auditores/:id/alteracao            operadora.alterarAuditor (W0-10, com o motivo)
// Tudo exige a chave da fatia `operadora.autorizacao`, que só vale com a do módulo (regra 1), menos o apoio. Cada
// gravação muda as tabelas da operadora da fatia com a trilha_auditoria na mesma transação; nenhuma tabela de outro sistema é escrita.
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
  type ApoioAutorizacoes,
  type AuditoresOperadora,
  type AutorizacaoDetalhe,
  type Autorizacoes,
  CHAVE_OPERADORA_AUTORIZACAO,
  esquemaAbrirJunta,
  esquemaAlterarAuditor,
  esquemaBuscaProcedimento,
  esquemaCancelarAutorizacao,
  esquemaConcluirJunta,
  esquemaDecidirAutorizacao,
  esquemaDesignarAuditor,
  esquemaEncerrarAuditor,
  esquemaFiltroAutorizacoes,
  esquemaPedirComplemento,
  esquemaRegistrarAutorizacao,
  esquemaResponderComplemento,
  EVENTOS_AUDITAVEIS,
  type ResultadoAuditor,
  type ResultadoAutorizacao,
  ROTAS_OPERADORA_F4 as R,
} from '@sgh/contratos';
import { protocoloAtendimento, senhaAutorizacao, validadeDaSenha } from '@sgh/dominio-operadora';
import { ErroOperacao } from '@sgh/nucleo';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';

/**
 * W0-10: a recusa com os dependentes (ex.: auditor-com-autorizacoes, a contagem e os protocolos dos pedidos em
 * análise) chega à tela com a lista, para a decisão (a redistribuição).
 */
function recusaComDependentes(e: unknown): ErroProblema | null {
  if (!(e instanceof ErroOperacao) || !e.problema.dependentes?.length) return null;
  const p = e.problema;
  return new ErroProblema('recusa-de-negocio', 409, p.title, p.detail, {
    codigo: p.codigo ?? 'recusa-de-negocio',
    campos: [...(p.campos ?? [])],
    dependentes: (p.dependentes ?? []).map((x) => ({
      rotulo: x.rotulo,
      quantidade: x.quantidade,
      amostra: [...x.amostra],
      origem: x.origem,
    })),
  });
}
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
  type GravadorAutorizacao,
  PORTA_AUTORIZACAO_OPERADORA,
  type PortaAutorizacaoOperadora,
} from './autorizacao-porta.js';
import { auditorDe, resumoDe, ServicoAutorizacaoOperadora } from './autorizacao-servico.js';
import { contextoGravacao } from './contexto-gravacao.js';

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'operadora.autorizacao';
const TABELA = 'pedido_autorizacao_plano';

function filtro<T extends { safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } }>(
  esquema: T,
  q: unknown,
) {
  const r = esquema.safeParse(q ?? {});
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
  return r.data as T extends { safeParse(v: unknown): { data?: infer D } } ? Exclude<D, undefined> : never;
}

@Controller()
export class AutorizacaoOperadoraController {
  readonly situacoes: ServicoSituacaoOperadora;
  readonly servico: ServicoAutorizacaoOperadora;

  constructor(
    @Inject(PORTA_AUTORIZACAO_OPERADORA) private readonly porta: PortaAutorizacaoOperadora,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.situacoes = new ServicoSituacaoOperadora(fonte, cache);
    this.servico = new ServicoAutorizacaoOperadora(porta);
  }

  private sujeito(req: RequisicaoAutorizada, s: SessaoCadastro): SujeitoOperadora {
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      setor: req.sgh?.sessao.unidadeAtiva ?? null,
    };
  }

  /** A fatia vale (módulo e autorização ligados) ou 403 `recurso-desligado` com o motivo (nada é lido nem gravado). */
  private async exigirFatia(req: RequisicaoAutorizada): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    await this.situacoes.exigir(this.sujeito(req, s), CHAVE_OPERADORA_AUTORIZACAO);
    return s;
  }

  /** Gravação com a trilha na mesma transação (na memória, a trilha pelo registrador da API). */
  private async gravar<T extends { id: number }>(
    s: SessaoCadastro,
    evento: string,
    operacao: string,
    tabela: string,
    fn: (g: GravadorAutorizacao) => Promise<T>,
    motivo?: string,
  ): Promise<T> {
    // O motivo da tela (alteração do auditor) vai para a trilha da operação, na mesma transação.
    const linha = (r: T): RegistroTrilhaTela => ({
      ...linhaTrilha(s, evento, RECURSO, operacao, { tabela, id: String(r.id) }),
      ...(motivo ? { motivo } : {}),
    });
    const r = await this.porta.gravar(contextoGravacao(s, operacao), linha, fn).catch((e: unknown) => {
      throw recusaComDependentes(e) ?? problemaDoCadastro(e);
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
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioAutorizacoes> {
    const s = sessaoDe(req);
    const situacao = await this.situacoes.situacao(this.sujeito(req, s));
    const fatia = situacao.fatias.find((f) => f.chave === CHAVE_OPERADORA_AUTORIZACAO);
    const ligada = fatia?.situacao === 'ligada';
    return this.servico.apoio(s.porta, {
      ligada,
      motivo: ligada ? null : (fatia?.motivo ?? situacao.modulo.motivo),
      podeRegistrar: s.pode(R.registrar.permissao),
      podeDecidir: s.pode(R.decidir.permissao),
      podeDesignar: s.pode(R.designar.permissao),
      login: s.login,
    });
  }

  @Get(R.procedimentos.caminho)
  @Permissao(R.procedimentos.permissao)
  async procedimentos(@Query() q: Record<string, string | undefined>, @Req() req: RequisicaoAutorizada) {
    const f = filtro(esquemaBuscaProcedimento, q);
    const s = await this.exigirFatia(req);
    return { itens: await this.porta.buscarTuss(s.porta, f.busca) };
  }

  @Get(R.lista.caminho)
  @Permissao(R.lista.permissao)
  async lista(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Autorizacoes> {
    const f = filtro(esquemaFiltroAutorizacoes, q);
    const s = await this.exigirFatia(req);
    const [r, totais] = await Promise.all([
      this.porta.autorizacoes(s.porta, this.servico.filtro(f)),
      this.porta.totais(s.porta),
    ]);
    return { itens: r.itens.map(resumoDe), proxima: r.proxima, totais };
  }

  @Get(R.ficha.caminho)
  @Permissao(R.ficha.permissao)
  @Auditar(E.operadoraAutorizacaoLida.codigo)
  async ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<AutorizacaoDetalhe> {
    const n = idDaRota(id);
    const s = await this.exigirFatia(req);
    return this.servico.detalhe(s.porta, n);
  }

  /** W0-10: o anexo enviado pelo prestador pelo portal (só leitura; o registro não se edita). */
  @Get(R.anexo.caminho)
  @Permissao(R.anexo.permissao)
  @Auditar(E.operadoraAutorizacaoLida.codigo)
  @Header('cache-control', 'no-store')
  async anexo(
    @Param('id') id: string,
    @Param('anexo') anexo: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { header(nome: string, valor: string): unknown },
  ): Promise<Buffer> {
    const s = await this.exigirFatia(req);
    const x = await this.servico.anexoDoComplemento(s.porta, idDaRota(id), idDaRota(anexo));
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
    'operadora.registrarAutorizacao (pedido_autorizacao_plano, os itens e o evento) com a trilha_auditoria na mesma transação',
  )
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAutorizacao> {
    const e = corpo(esquemaRegistrarAutorizacao, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirRegistro(s.porta, e);
    let protocolo = '';
    const r = await this.gravar(
      s,
      E.operadoraAutorizacaoRegistrada.codigo,
      'operadora.registrarAutorizacao',
      TABELA,
      async (g) => {
        protocolo = protocoloAtendimento(x.registroAns, x.registro.solicitadaEm, await g.proximoProtocolo());
        return g.registrar({ ...x.registro, protocolo, usuario: s.login });
      },
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      situacao: 'em-analise',
      protocolo,
      senha: null,
      mensagem: ServicoAutorizacaoOperadora.mensagemDoRegistro(
        protocolo,
        x.registro.prazoTipo,
        x.registro.prazoEm,
      ),
      avisos: x.avisos,
    };
  }

  @Post(R.pedirComplemento.caminho)
  @HttpCode(200)
  @Permissao(R.pedirComplemento.permissao)
  @AuditadoNoHandler(
    'operadora.pedirComplemento (pedido_autorizacao_plano e o evento) com a trilha_auditoria na mesma transação',
  )
  async pedirComplemento(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAutorizacao> {
    const n = idDaRota(id);
    const e = corpo(esquemaPedirComplemento, b);
    const s = await this.exigirFatia(req);
    const a = await this.servico.conferirComplemento(s.porta, n, s.login);
    const r = await this.gravar(
      s,
      E.operadoraAutorizacaoComplementoPedido.codigo,
      'operadora.pedirComplemento',
      TABELA,
      (g) => g.pedirComplemento({ id: n, versao: e.versao, pedido: e.pedido, usuario: s.login }),
    );
    return {
      ok: true,
      id: n,
      versao: r.versao,
      situacao: 'pendente',
      protocolo: a.protocolo,
      senha: null,
      mensagem: 'Complemento pedido ao prestador. O prazo da resposta continua correndo.',
      avisos: [],
    };
  }

  @Post(R.responderComplemento.caminho)
  @HttpCode(200)
  @Permissao(R.responderComplemento.permissao)
  @AuditadoNoHandler(
    'operadora.responderComplemento (pedido_autorizacao_plano e o evento) com a trilha_auditoria na mesma transação',
  )
  async responderComplemento(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAutorizacao> {
    const n = idDaRota(id);
    const e = corpo(esquemaResponderComplemento, b);
    const s = await this.exigirFatia(req);
    const a = await this.servico.conferirResposta(s.porta, n);
    const r = await this.gravar(
      s,
      E.operadoraAutorizacaoComplementoRespondido.codigo,
      'operadora.responderComplemento',
      TABELA,
      (g) => g.responderComplemento({ id: n, versao: e.versao, resposta: e.resposta, usuario: s.login }),
    );
    return {
      ok: true,
      id: n,
      versao: r.versao,
      situacao: 'em-analise',
      protocolo: a.protocolo,
      senha: null,
      mensagem: 'Complemento registrado. O pedido voltou à análise do auditor.',
      avisos: [],
    };
  }

  @Post(R.abrirJunta.caminho)
  @HttpCode(200)
  @Permissao(R.abrirJunta.permissao)
  @AuditadoNoHandler(
    'operadora.abrirJunta (pedido_autorizacao_plano e o evento) com a trilha_auditoria na mesma transação',
  )
  async abrirJunta(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAutorizacao> {
    const n = idDaRota(id);
    const e = corpo(esquemaAbrirJunta, b);
    const s = await this.exigirFatia(req);
    const a = await this.servico.conferirJunta(s.porta, n, e, s.login);
    const r = await this.gravar(
      s,
      E.operadoraAutorizacaoJuntaAberta.codigo,
      'operadora.abrirJunta',
      TABELA,
      (g) =>
        g.abrirJunta({
          id: n,
          versao: e.versao,
          divergencia: e.divergencia,
          desempatador: e.desempatador,
          notificadosEm: e.notificadosEm,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: n,
      versao: r.versao,
      situacao: 'em-junta',
      protocolo: a.protocolo,
      senha: null,
      mensagem: 'Junta aberta. Registre o parecer do desempatador para concluir o pedido.',
      avisos: [],
    };
  }

  /** A decisão do auditor e a conclusão da junta: a mesma conferência, a senha na transação. */
  private async decidirOuConcluir(
    req: RequisicaoAutorizada,
    n: number,
    e: Parameters<ServicoAutorizacaoOperadora['conferirDecisao']>[2] & {
      versao: number;
      parecer: string;
      parecerDesempatador?: string;
    },
    junta: boolean,
  ): Promise<ResultadoAutorizacao> {
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirDecisao(s.porta, n, e, s.login, junta);
    const { resultado } = x;
    const autorizada = resultado.situacao !== 'negada';
    let senha: string | null = null;
    const r = await this.gravar(
      s,
      junta ? E.operadoraAutorizacaoJuntaConcluida.codigo : E.operadoraAutorizacaoDecidida.codigo,
      junta ? 'operadora.concluirJunta' : 'operadora.decidirAutorizacao',
      TABELA,
      async (g) => {
        senha = autorizada ? senhaAutorizacao(x.registroAns, await g.proximaSenha()) : null;
        return g.decidir({
          id: n,
          versao: e.versao,
          situacao: resultado.situacao,
          itens: resultado.itens,
          diarias: resultado.diarias,
          auditor: x.auditor.id,
          critica: resultado.situacao === 'autorizada' ? null : e.critica,
          fundamento: resultado.situacao === 'autorizada' ? null : e.fundamento,
          parecer: e.parecer,
          senha,
          senhaValidade: autorizada ? validadeDaSenha(x.hoje) : null,
          ...(junta ? { parecerJunta: e.parecerDesempatador ?? '' } : {}),
          usuario: s.login,
        });
      },
    );
    const mensagem =
      resultado.situacao === 'negada'
        ? 'Pedido negado. Entregue ao beneficiário o comunicado da negativa (na ficha).'
        : `${resultado.situacao === 'parcial' ? 'Pedido autorizado em parte' : 'Pedido autorizado'}, senha ${senha} válida até ${validadeDaSenha(x.hoje).split('-').reverse().join('/')}.`;
    return {
      ok: true,
      id: n,
      versao: r.versao,
      situacao: resultado.situacao,
      protocolo: x.a.protocolo,
      senha,
      mensagem,
      avisos: [],
    };
  }

  @Post(R.decidir.caminho)
  @HttpCode(200)
  @Permissao(R.decidir.permissao)
  @AuditadoNoHandler(
    'operadora.decidirAutorizacao (pedido_autorizacao_plano, os itens e o evento) com a trilha_auditoria na mesma transação',
  )
  async decidir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaDecidirAutorizacao, b);
    return this.decidirOuConcluir(req, n, e, false);
  }

  @Post(R.concluirJunta.caminho)
  @HttpCode(200)
  @Permissao(R.concluirJunta.permissao)
  @AuditadoNoHandler(
    'operadora.concluirJunta (pedido_autorizacao_plano, os itens e o evento) com a trilha_auditoria na mesma transação',
  )
  async concluirJunta(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idDaRota(id);
    const e = corpo(esquemaConcluirJunta, b);
    return this.decidirOuConcluir(req, n, e, true);
  }

  @Post(R.cancelar.caminho)
  @HttpCode(200)
  @Permissao(R.cancelar.permissao)
  @AuditadoNoHandler(
    'operadora.cancelarAutorizacao (pedido_autorizacao_plano e o evento) com a trilha_auditoria na mesma transação',
  )
  async cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAutorizacao> {
    const n = idDaRota(id);
    const e = corpo(esquemaCancelarAutorizacao, b);
    const s = await this.exigirFatia(req);
    const a = await this.servico.conferirCancelamento(s.porta, n);
    const r = await this.gravar(
      s,
      E.operadoraAutorizacaoCancelada.codigo,
      'operadora.cancelarAutorizacao',
      TABELA,
      (g) => g.cancelar({ id: n, versao: e.versao, motivo: e.motivo, usuario: s.login }),
    );
    return {
      ok: true,
      id: n,
      versao: r.versao,
      situacao: 'cancelada',
      protocolo: a.protocolo,
      senha: a.senha,
      mensagem: a.senha ? `Pedido cancelado. A senha ${a.senha} deixa de valer.` : 'Pedido cancelado.',
      avisos: [],
    };
  }

  @Get(R.auditores.caminho)
  @Permissao(R.auditores.permissao)
  async auditores(@Req() req: RequisicaoAutorizada): Promise<AuditoresOperadora> {
    const s = await this.exigirFatia(req);
    return { itens: (await this.porta.auditores(s.porta)).map(auditorDe) };
  }

  @Post(R.designar.caminho)
  @HttpCode(200)
  @Permissao(R.designar.permissao)
  @AuditadoNoHandler('operadora.designarAuditor (auditor_plano) com a trilha_auditoria na mesma transação')
  async designar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAuditor> {
    const e = corpo(esquemaDesignarAuditor, b);
    const s = await this.exigirFatia(req);
    const { conselho } = await this.servico.conferirDesignacao(s.porta, e);
    const r = await this.gravar(
      s,
      E.operadoraAuditorDesignado.codigo,
      'operadora.designarAuditor',
      'auditor_plano',
      (g) => g.designar({ ...e, conselho, usuario: s.login }),
    );
    return {
      ok: true,
      id: r.id,
      mensagem: `Auditor designado: ${e.nome} (${conselho} ${e.numero}/${e.uf}).`,
    };
  }

  @Post(R.encerrar.caminho)
  @HttpCode(200)
  @Permissao(R.encerrar.permissao)
  @AuditadoNoHandler('operadora.encerrarAuditor (auditor_plano) com a trilha_auditoria na mesma transação')
  async encerrar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAuditor> {
    const n = idDaRota(id);
    const e = corpo(esquemaEncerrarAuditor, b);
    const s = await this.exigirFatia(req);
    const a = await this.servico.conferirEncerramento(s.porta, n);
    const r = await this.gravar(
      s,
      E.operadoraAuditorEncerrado.codigo,
      'operadora.encerrarAuditor',
      'auditor_plano',
      (g) =>
        g.encerrar({
          id: n,
          versao: e.versao,
          motivo: e.motivo,
          usuario: s.login,
          redistribuirPara: e.redistribuirPara ?? null,
        }),
    );
    return {
      ok: true,
      id: r.id,
      mensagem:
        r.redistribuidos > 0
          ? `Designação de ${a.nome} encerrada. ${r.redistribuidos} pedido(s) em análise passaram ao auditor escolhido.`
          : `Designação de ${a.nome} encerrada.`,
    };
  }

  @Post(R.alterar.caminho)
  @HttpCode(200)
  @Permissao(R.alterar.permissao)
  @AuditadoNoHandler('operadora.alterarAuditor (auditor_plano) com a trilha_auditoria na mesma transação')
  async alterar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAuditor> {
    const n = idDaRota(id);
    const e = corpo(esquemaAlterarAuditor, b);
    const s = await this.exigirFatia(req);
    const { conselho } = await this.servico.conferirAlteracao(s.porta, n, e.categoria);
    const r = await this.gravar(
      s,
      E.operadoraAuditorAlterado.codigo,
      'operadora.alterarAuditor',
      'auditor_plano',
      (g) =>
        g.alterar({
          id: n,
          versao: e.versao,
          categoria: e.categoria,
          conselho,
          numero: e.numero,
          uf: e.uf,
          motivo: e.motivo,
          usuario: s.login,
        }),
      e.motivo,
    );
    return {
      ok: true,
      id: r.id,
      mensagem: `Designação de ${r.nome} alterada (${conselho} ${e.numero}/${e.uf}).`,
    };
  }
}
