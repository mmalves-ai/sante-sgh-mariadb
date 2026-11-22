// Patrimônio (M54, etapa 6; ficha, seção 7: "Bens patrimoniais", "Depreciação" e "Transferência, baixa e inventário"):
//   GET  /api/patrimonio/apoio                        domínios, grupos, centros, empresas, parâmetros e as ações permitidas
//   GET  /api/patrimonio/apoio/{depreciacao,movimentos,inventario}  o mesmo apoio, pela permissão de cada tela
//   GET  /api/patrimonio/bens                         página de bens (setor, situação, grupo, busca)
//   GET  /api/patrimonio/bens/codigo?codigo=          o bem pelo texto do QR ou pela plaqueta digitada
//   GET  /api/patrimonio/bens/:id                     detalhe (nota de origem, acumulada, pendência)
//   GET  /api/patrimonio/bens/:id/etiqueta            etiqueta ZPL com o QR
//   POST /api/patrimonio/bens                         cadastrar da nota fiscal de entrada ou da doação com termo
//   POST /api/patrimonio/bens/:id                     alterar os dados do bem (pela versão lida)
//   POST /api/patrimonio/bens/:id/baixa               baixa (crítica: senha de novo)
//   GET  /api/patrimonio/bens/:id/termo-baixa         termo de baixa do bem baixado (PDF/A pelo Gotenberg)
//   GET  /api/patrimonio/grupos                       W0-08: grupos do bem do cadastro (com os bens de cada um)
//   GET  /api/patrimonio/grupos/:codigo               o grupo com as versões anteriores
//   POST /api/patrimonio/grupos                       incluir grupo
//   PUT  /api/patrimonio/grupos/:codigo               alterar pela versão lida, com motivo (409 com versão velha)
//   POST /api/patrimonio/grupos/:codigo/{inativacao,reativacao}  com motivo
//   POST /api/patrimonio/grupos/:codigo/exclusao      só o nunca usado (409 com quantos bens e a oferta de inativar)
//   GET  /api/patrimonio/notas?competencia&busca      notas de entrada do mês (para o cadastro)
//   GET  /api/patrimonio/notas/:id/itens              itens da nota com as unidades sem bem
//   GET  /api/patrimonio/depreciacao?empresa&competencia   prévia ou cotas gravadas, com as parcelas
//   POST /api/patrimonio/depreciacao/calculo          calcular e gravar a competência
//   POST /api/patrimonio/depreciacao/estorno          estornar o último cálculo, com motivo e a senha de novo (W0-08;
//                                                     409 com o lote contábil exportado: cancele a exportação antes)
//   GET  /api/patrimonio/bens/:id/ajustes             ajustes de valor do bem, com os estornos (W0-08, M1)
//   POST /api/patrimonio/bens/:id/ajustes             revisão de estimativa, impairment (com laudo) ou reavaliação
//   POST /api/patrimonio/ajustes/:id/estorno          estornar o ajuste com motivo e a senha de novo (W0-08, M1)
//   GET  /api/patrimonio/bens/:id/laudos              laudos anexados ao bem (W0-08, achado 6)
//   POST /api/patrimonio/bens/:id/laudos              anexar o PDF do laudo (disco local, somente leitura)
//   GET  /api/patrimonio/laudos/:id/arquivo           o PDF do laudo, conferido pelo SHA-256
//   GET  /api/patrimonio/movimentos?situacao&bem      movimentos
//   POST /api/patrimonio/movimentos                   transferência (pendente), empréstimo, comodato, devolução
//   POST /api/patrimonio/movimentos/:id/decisao       aceitar ou recusar a transferência (quem recebe)
//   POST /api/patrimonio/movimentos/:id/cancelamento  cancelar o pedido (quem pediu)
//   GET  /api/patrimonio/inventarios                  inventários
//   GET  /api/patrimonio/inventarios/:id              leituras e divergências
//   POST /api/patrimonio/inventarios                  abrir
//   POST /api/patrimonio/inventarios/:id/leituras     ler o QR ou a plaqueta
//   POST /api/patrimonio/inventarios/:id/encerramento encerrar (as divergências ficam registradas)
//   POST /api/patrimonio/inventarios/:id/cancelamento cancelar o aberto com motivo (W0-08; as leituras ficam)
// As gravações exigem a chave `patrimonio` no estabelecimento (POL-3) e vão com a trilha de auditoria na mesma transação (com a
// porta em memória, o registrador da API registra). D-PERM-INV-546: o inventário (ler e contar) é da permissão de
// contar, para quem conta no celular ver o que já leu.
import { randomUUID } from 'node:crypto';
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
  type AjusteBem,
  esquemaAnexarLaudoBem,
  type LaudoBem,
  esquemaEstornarAjusteBem,
  esquemaRegistrarAjusteBem,
  type ApoioPatrimonio,
  type BemPatrimonial,
  type DepreciacaoCompetencia,
  type DetalheInventario,
  esquemaAbrirInventarioBens,
  esquemaCancelarInventario,
  esquemaAlterarBem,
  esquemaAlterarGrupoBem,
  esquemaCodigoGrupoBem,
  esquemaIncluirGrupoBem,
  esquemaMotivoGrupoBem,
  type GrupoBemCadastro,
  type ListaGruposBem,
  type GrupoBemDetalhe,
  esquemaCadastrarBem,
  esquemaCalcularDepreciacao,
  esquemaCancelarMovimento,
  esquemaConsultaBens,
  esquemaConsultaDepreciacao,
  esquemaEstornarDepreciacao,
  esquemaConsultaMovimentos,
  esquemaConsultaNotas,
  esquemaDecidirMovimento,
  esquemaLeituraInventario,
  esquemaRegistrarMovimento,
  esquemaSenhaReautenticacao,
  EVENTOS_AUDITAVEIS,
  type Inventario,
  type ItemNotaParaBem,
  type LeituraInventarioRegistrada,
  type ListaBens,
  type MovimentoBem,
  type NotaEntradaParaBem,
  PERMISSOES_PATRIMONIO_CODIGOS as P,
  type ResumoInventario,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { idDaRota, linhaTrilha, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { LiberacaoPep } from '../pep/liberacao-pep.js';
import {
  ARMAZEM_LAUDO_PATRIMONIO,
  type ArmazemLaudoPatrimonio,
  ArmazemLaudoMemoria,
} from './armazem-laudo.js';
import { htmlTermoBaixa } from './documentos.js';
import { PORTA_PATRIMONIO, type PortaPatrimonio } from './porta.js';
import { ServicoPatrimonio, type SessaoPatrimonio } from './servico.js';

/**
 * Regra 13 (D-ACEITE-546): os centros de custo por que a pessoa recebe a transferência: os do cadastro de centros de
 * custo do usuário (o escopo `centrosCusto` da sessão, o mesmo que restringe a requisição do estoque); `null` sem
 * centro cadastrado (sem restrição, como o escopo trata em todo o catálogo). O aceite lê só este escopo: o resto do
 * patrimônio não se restringe por centro (os escopos do módulo seguem vazios).
 */
function centrosQueRecebe(s: SessaoCadastro): ReadonlySet<number> | null {
  const lista = s.req.sgh?.sessao.escopos?.centrosCusto ?? [];
  return lista.length > 0 ? new Set(lista.map(Number).filter((n) => Number.isInteger(n))) : null;
}

/** Chave de liberação do patrimônio (ficha do M54, seção 12). */
export const CHAVE_LIBERACAO_PATRIMONIO = 'patrimonio';

const E = EVENTOS_AUDITAVEIS;
const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;

function invalido(erro: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): ErroProblema {
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    erro.issues[0]?.message ?? 'Confira os campos.',
    {
      campos: [...new Set(erro.issues.map((i) => i.path.map(String).join('.')))],
    },
  );
}

function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const d = esquema.safeParse(corpo);
  if (!d.success) throw invalido(d.error);
  return d.data;
}

/** Conversor HTML → PDF/A (Gotenberg); sem ele (testes), a rota devolve o HTML do documento. */
export const GERADOR_PDF_PATRIMONIO = Symbol('GERADOR_PDF_PATRIMONIO');
type GeradorPdf = (html: string, titulo: string) => Promise<Buffer>;
type Resposta = { header(n: string, v: string): unknown; send(b: unknown): unknown };

const esquemaCodigo = z
  .object({ codigo: z.string().trim().min(1, 'Leia o QR ou digite a plaqueta.').max(80) })
  .strict();

/** A baixa leva o motivo de baixa do cadastro (motivo_baixa_bem), pelo id. */
const esquemaMotivoBaixa = z
  .object({
    motivoBaixa: z
      .number({ error: 'Escolha o motivo da baixa.' })
      .int()
      .positive('Escolha o motivo da baixa.'),
  })
  .strict();

@Controller('patrimonio')
export class PatrimonioController {
  readonly servico: ServicoPatrimonio;
  private readonly liberacao: LiberacaoPep;

  constructor(
    @Inject(PORTA_PATRIMONIO) private readonly porta: PortaPatrimonio,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(GERADOR_PDF_PATRIMONIO) private readonly pdf: GeradorPdf | null = null,
    @Optional()
    @Inject(ARMAZEM_LAUDO_PATRIMONIO)
    private readonly armazemLaudo: ArmazemLaudoPatrimonio = new ArmazemLaudoMemoria(),
  ) {
    this.servico = new ServicoPatrimonio(porta);
    this.liberacao = new LiberacaoPep(configuracao, cache);
  }

  private sessao(s: SessaoCadastro): SessaoPatrimonio {
    const bruto = s.req.headers['idempotency-key'];
    const chave = Array.isArray(bruto) ? bruto[0] : bruto;
    return {
      rede: s.rede,
      hospital: s.hospital,
      porta: s.porta,
      chaveIdempotencia:
        typeof chave === 'string' && IDEMPOTENCIA.test(chave) ? chave : `patrimonio-${randomUUID()}`,
      login: s.login,
      centrosQueRecebe: centrosQueRecebe(s),
      pode: (c) => s.pode(c),
      trilha: (evento, operacao, tabela, id) =>
        linhaTrilha(s, evento, 'patrimonio', operacao, { tabela, id: id === null ? null : String(id) }),
    };
  }

  /** Com a porta em memória, a trilha da gravação é a do registrador da API (no núcleo, vai na transação). */
  private async trilhaMemoria(s: SessaoCadastro, evento: string, id: number | string): Promise<void> {
    if (this.porta.destino !== 'memoria') return;
    await this.trilha.registrar({
      evento,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, `patrimonio-${id}`).slice(0, 64),
      recurso: 'patrimonio',
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: String(id),
    });
  }

  private async gravando(req: RequisicaoAutorizada): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_PATRIMONIO);
    return s;
  }

  // ── Apoio e bens ──────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('apoio')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioBensLidos.codigo)
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioPatrimonio> {
    return this.apoioDe(req);
  }

  /**
   * D-APOIO-546: o mesmo apoio para quem só abre a depreciação, os movimentos ou o inventário (o gestor do setor que
   * aceita a transferência e quem conta no celular não consultam a ficha dos bens): uma rota por permissão.
   */
  @Get('apoio/depreciacao')
  @Permissao(P.depreciacaoLer)
  @Auditar(E.patrimonioBensLidos.codigo)
  async apoioDepreciacao(@Req() req: RequisicaoAutorizada): Promise<ApoioPatrimonio> {
    return this.apoioDe(req);
  }

  @Get('apoio/movimentos')
  @Permissao(P.movimentoLer)
  @Auditar(E.patrimonioBensLidos.codigo)
  async apoioMovimentos(@Req() req: RequisicaoAutorizada): Promise<ApoioPatrimonio> {
    return this.apoioDe(req);
  }

  @Get('apoio/inventario')
  @Permissao(P.inventarioContar)
  @Auditar(E.patrimonioBensLidos.codigo)
  async apoioInventario(@Req() req: RequisicaoAutorizada): Promise<ApoioPatrimonio> {
    return this.apoioDe(req);
  }

  private async apoioDe(req: RequisicaoAutorizada): Promise<ApoioPatrimonio> {
    const s = sessaoDe(req);
    const l = await this.liberacao.consultar(s, CHAVE_LIBERACAO_PATRIMONIO);
    return this.servico.apoio(this.sessao(s), l.ligada, {
      cadastrar: P.bemCadastrar,
      calcular: P.depreciacaoCalcular,
      registrar: P.movimentoRegistrar,
      aceitar: P.movimentoAceitar,
      baixar: P.bemBaixar,
      contar: P.inventarioContar,
    });
  }

  @Get('bens')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioBensLidos.codigo)
  async bens(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaBens> {
    return this.servico.listar(this.sessao(sessaoDe(req)), validar(esquemaConsultaBens, q));
  }

  @Get('bens/codigo')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioBensLidos.codigo)
  async porCodigo(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<BemPatrimonial> {
    return this.servico.porCodigo(this.sessao(sessaoDe(req)), validar(esquemaCodigo, q).codigo);
  }

  @Get('bens/:id')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioBensLidos.codigo)
  async bem(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<BemPatrimonial> {
    return this.servico.detalhe(this.sessao(sessaoDe(req)), idDaRota(id));
  }

  @Get('bens/:id/etiqueta')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioBensLidos.codigo)
  async etiqueta(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ plaqueta: string; zpl: string }> {
    return this.servico.etiqueta(this.sessao(sessaoDe(req)), idDaRota(id));
  }

  /** O termo de baixa do bem baixado, em PDF/A (ficha, seção 10, "Documento"). */
  @Get('bens/:id/termo-baixa')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioBensLidos.codigo)
  async termoBaixa(@Param('id') id: string, @Req() req: RequisicaoAutorizada, @Res() res: Resposta) {
    const s = this.sessao(sessaoDe(req));
    const t = await this.servico.termoBaixa(s, idDaRota(id));
    const grupo = (await this.servico.grupos(s)).find((g) => g.codigo === t.bem.grupo);
    const html = htmlTermoBaixa({
      ...t,
      ...(grupo ? { grupoNome: grupo.nome } : {}),
      estabelecimento: s.hospital,
      emitidoEm: new Date().toISOString(),
      emitidoPor: s.login,
    });
    const arquivo = `termo-baixa-${t.bem.plaqueta}`;
    if (!this.pdf) {
      res.header('content-type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    const pdf = await this.pdf(html, `Termo de baixa ${t.bem.plaqueta}`).catch(() => null);
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

  @Post('bens')
  @HttpCode(201)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('Trilha na transação do cadastro (uma linha por bem)')
  async cadastrar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ bens: BemPatrimonial[] }> {
    const s = await this.gravando(req);
    const ev = E.patrimonioBemCadastrado.codigo;
    const r = await this.servico.cadastrar(this.sessao(s), validar(esquemaCadastrarBem, corpo), ev);
    for (const b of r.bens) await this.trilhaMemoria(s, ev, b.id);
    return r;
  }

  @Post('bens/:id')
  @HttpCode(200)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('Trilha na transação da alteração do bem')
  async alterar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ bem: BemPatrimonial; mudou: boolean }> {
    const s = await this.gravando(req);
    const n = idDaRota(id);
    const ev = E.patrimonioBemAlterado.codigo;
    const r = await this.servico.alterar(this.sessao(s), n, validar(esquemaAlterarBem, corpo), ev);
    if (r.mudou) await this.trilhaMemoria(s, ev, n);
    return r;
  }

  @Post('bens/:id/baixa')
  @HttpCode(201)
  @Permissao(P.bemBaixar)
  @AuditadoNoHandler('Trilha na transação da baixa (com a senha de novo)')
  async baixar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ movimento: MovimentoBem; bem: BemPatrimonial }> {
    const s = await this.gravando(req);
    const o = typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {};
    const { senha } = validar(esquemaSenhaReautenticacao, { senha: o['senha'] });
    // O motivo de baixa do cadastro vem à parte do contrato do movimento (pedido: entrar em esquemaRegistrarMovimento).
    const { motivoBaixa } = validar(esquemaMotivoBaixa, { motivoBaixa: o['motivoBaixa'] });
    const resto = Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'senha' && k !== 'motivoBaixa'));
    const x = validar(esquemaRegistrarMovimento, { ...resto, tipo: 'baixa', bem: idDaRota(id) });
    if (!(this.porta.destino === 'memoria' && !req.sgh?.real))
      await reautenticar(this.sessoes, this.resolvedor, req, senha);
    const ev = E.patrimonioMovimentoRegistrado.codigo;
    const r = await this.servico.registrar(this.sessao(s), x, ev, motivoBaixa);
    await this.trilhaMemoria(s, ev, r.movimento.id);
    return r;
  }

  // ── Grupo do bem (W0-08, parte 4) ─────────────────────────────────────────────────────────────────────────────────

  /** Código do grupo da rota (formato inválido: o mesmo 404 do inexistente). */
  private codigoGrupo(v: string): string {
    const r = esquemaCodigoGrupoBem.safeParse(v);
    if (!r.success)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Grupo do bem não encontrado',
        'Grupo do bem não encontrado.',
      );
    return r.data;
  }

  @Get('grupos')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioBensLidos.codigo)
  async grupos(@Req() req: RequisicaoAutorizada): Promise<ListaGruposBem> {
    const s = this.sessao(sessaoDe(req));
    // Revisão W0-08: com as contas analíticas do plano (o combo da conta do grupo).
    return { grupos: await this.servico.grupos(s), contas: await this.servico.contasDoGrupo(s) };
  }

  @Get('grupos/:codigo')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioBensLidos.codigo)
  async grupo(@Param('codigo') codigo: string, @Req() req: RequisicaoAutorizada): Promise<GrupoBemDetalhe> {
    return this.servico.grupo(this.sessao(sessaoDe(req)), this.codigoGrupo(codigo));
  }

  @Post('grupos')
  @HttpCode(201)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('Trilha na transação da inclusão do grupo do bem')
  async incluirGrupo(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<GrupoBemCadastro> {
    const s = await this.gravando(req);
    const ev = E.patrimonioGrupoIncluido.codigo;
    const r = await this.servico.incluirGrupo(this.sessao(s), validar(esquemaIncluirGrupoBem, corpo), ev);
    await this.trilhaMemoria(s, ev, r.codigo);
    return r;
  }

  @Put('grupos/:codigo')
  @HttpCode(200)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('Trilha na transação da alteração do grupo do bem')
  async alterarGrupo(
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<GrupoBemCadastro> {
    const s = await this.gravando(req);
    const ev = E.patrimonioGrupoAlterado.codigo;
    const r = await this.servico.alterarGrupo(
      this.sessao(s),
      this.codigoGrupo(codigo),
      validar(esquemaAlterarGrupoBem, corpo),
      ev,
    );
    await this.trilhaMemoria(s, ev, r.codigo);
    return r;
  }

  @Post('grupos/:codigo/inativacao')
  @HttpCode(200)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('Trilha na transação da inativação do grupo do bem')
  async inativarGrupo(
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<GrupoBemCadastro> {
    return this.situacaoGrupo(codigo, corpo, req, false);
  }

  @Post('grupos/:codigo/reativacao')
  @HttpCode(200)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('Trilha na transação da reativação do grupo do bem')
  async reativarGrupo(
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<GrupoBemCadastro> {
    return this.situacaoGrupo(codigo, corpo, req, true);
  }

  private async situacaoGrupo(
    codigo: string,
    corpo: unknown,
    req: RequisicaoAutorizada,
    ativo: boolean,
  ): Promise<GrupoBemCadastro> {
    const s = await this.gravando(req);
    const ev = E.patrimonioGrupoInativado.codigo;
    const r = await this.servico.situacaoGrupo(
      this.sessao(s),
      this.codigoGrupo(codigo),
      validar(esquemaMotivoGrupoBem, corpo),
      ativo,
      ev,
    );
    await this.trilhaMemoria(s, ev, r.codigo);
    return r;
  }

  @Post('grupos/:codigo/exclusao')
  @HttpCode(200)
  @Permissao(P.bemCadastrar)
  @AuditadoNoHandler('Trilha (com o retrato da exclusão) na transação da exclusão do grupo do bem')
  async excluirGrupo(
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ codigo: string; excluido: true }> {
    const s = await this.gravando(req);
    const ev = E.patrimonioGrupoExcluido.codigo;
    const r = await this.servico.excluirGrupo(
      this.sessao(s),
      this.codigoGrupo(codigo),
      validar(esquemaMotivoGrupoBem, corpo),
      ev,
    );
    await this.trilhaMemoria(s, ev, r.codigo);
    return r;
  }

  @Get('notas')
  @Permissao(P.bemCadastrar)
  @Auditar(E.patrimonioBensLidos.codigo)
  async notas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ notas: NotaEntradaParaBem[]; truncado: boolean }> {
    return this.servico.notas(this.sessao(sessaoDe(req)), validar(esquemaConsultaNotas, q));
  }

  @Get('notas/:id/itens')
  @Permissao(P.bemCadastrar)
  @Auditar(E.patrimonioBensLidos.codigo)
  async itensDaNota(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ nota: NotaEntradaParaBem; itens: ItemNotaParaBem[] }> {
    return this.servico.itensDaNota(this.sessao(sessaoDe(req)), idDaRota(id));
  }

  // ── Depreciação ───────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('depreciacao')
  @Permissao(P.depreciacaoLer)
  @Auditar(E.patrimonioDepreciacaoLida.codigo)
  async depreciacao(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DepreciacaoCompetencia> {
    return this.servico.depreciacao(this.sessao(sessaoDe(req)), validar(esquemaConsultaDepreciacao, q));
  }

  @Post('depreciacao/calculo')
  @HttpCode(201)
  @Permissao(P.depreciacaoCalcular)
  @AuditadoNoHandler('Trilha na transação do cálculo (só totais)')
  async calcular(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<DepreciacaoCompetencia> {
    const s = await this.gravando(req);
    const ev = E.patrimonioDepreciacaoCalculada.codigo;
    const r = await this.servico.calcular(this.sessao(s), validar(esquemaCalcularDepreciacao, corpo), ev);
    await this.trilhaMemoria(s, ev, r.calculo?.id ?? 0);
    return r;
  }

  /** W0-08, parte 5: operação crítica (desfaz o lançamento do mês): pede a senha de novo, como a baixa. */
  @Post('depreciacao/estorno')
  @HttpCode(201)
  @Permissao(P.depreciacaoCalcular)
  @AuditadoNoHandler('Trilha na transação do estorno (com o motivo no estorno e a senha de novo)')
  async estornarDepreciacao(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DepreciacaoCompetencia> {
    const s = await this.gravando(req);
    const o = typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {};
    const { senha } = validar(esquemaSenhaReautenticacao, { senha: o['senha'] });
    const resto = Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'senha'));
    const x = validar(esquemaEstornarDepreciacao, resto);
    if (!(this.porta.destino === 'memoria' && !req.sgh?.real))
      await reautenticar(this.sessoes, this.resolvedor, req, senha);
    const ev = E.patrimonioDepreciacaoEstornada.codigo;
    const r = await this.servico.estornar(this.sessao(s), x, ev);
    await this.trilhaMemoria(s, ev, r.estornos[0]?.id ?? 0);
    return r;
  }

  // ── Ajustes de valor do bem (W0-08, M1; CPC 27 e CPC 01) ─────────────────────────────────────────────────────────

  @Get('bens/:id/ajustes')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioAjustesLidos.codigo)
  async ajustes(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<AjusteBem[]> {
    return this.servico.ajustes(this.sessao(sessaoDe(req)), idDaRota(id));
  }

  /** O ajuste muda a depreciação seguinte e o impairment vira lançamento: a permissão é a do cálculo da depreciação. */
  @Post('bens/:id/ajustes')
  @HttpCode(201)
  @Permissao(P.depreciacaoCalcular)
  @AuditadoNoHandler('Trilha na transação do ajuste (com o motivo e o laudo no ajuste)')
  async registrarAjuste(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AjusteBem> {
    const s = await this.gravando(req);
    const o = typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {};
    const x = validar(esquemaRegistrarAjusteBem, { ...o, bem: idDaRota(id) });
    const ev = E.patrimonioAjusteRegistrado.codigo;
    const r = await this.servico.registrarAjuste(this.sessao(s), x, ev);
    await this.trilhaMemoria(s, ev, r.id);
    return r;
  }

  // ── Laudos do bem (W0-08, achado 6 da revisão; CPC 01 e CPC 27; RDC 509) ───────────────────────────────────────

  @Get('bens/:id/laudos')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioLaudosLidos.codigo)
  async laudos(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<LaudoBem[]> {
    return this.servico.laudos(this.sessao(sessaoDe(req)), idDaRota(id));
  }

  /** Quem registra o ajuste anexa o laudo dele: a permissão é a do cálculo da depreciação. */
  @Post('bens/:id/laudos')
  @HttpCode(201)
  @Permissao(P.depreciacaoCalcular)
  @AuditadoNoHandler(
    'Trilha na transação do laudo (o PDF no armazenamento com retenção, pelo SHA-256)',
  )
  async anexarLaudo(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<LaudoBem> {
    const s = await this.gravando(req);
    const x = validar(esquemaAnexarLaudoBem, corpo);
    const ev = E.patrimonioLaudoAnexado.codigo;
    const r = await this.servico.anexarLaudo(this.sessao(s), idDaRota(id), x, this.armazemLaudo, ev);
    await this.trilhaMemoria(s, ev, r.id);
    return r;
  }

  @Get('laudos/:id/arquivo')
  @Permissao(P.bemLer)
  @Auditar(E.patrimonioLaudosLidos.codigo)
  async arquivoLaudo(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res() res: Resposta,
  ): Promise<void> {
    const { laudo, bytes } = await this.servico.arquivoLaudo(
      this.sessao(sessaoDe(req)),
      idDaRota(id),
      this.armazemLaudo,
    );
    res.header('content-type', 'application/pdf');
    res.header('content-disposition', `inline; filename="laudo-bem-${laudo.bem}-${laudo.id}.pdf"`);
    res.header('cache-control', 'no-store');
    res.header('x-sgh-sha256', laudo.sha256);
    res.send(Buffer.from(bytes));
  }

  /** Operação crítica (desfaz o lançamento da perda): pede a senha de novo, como o estorno da depreciação. */
  @Post('ajustes/:id/estorno')
  @HttpCode(201)
  @Permissao(P.depreciacaoCalcular)
  @AuditadoNoHandler('Trilha na transação do estorno do ajuste (com o motivo e a senha de novo)')
  async estornarAjuste(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AjusteBem> {
    const s = await this.gravando(req);
    const o = typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {};
    const { senha } = validar(esquemaSenhaReautenticacao, { senha: o['senha'] });
    const resto = Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'senha'));
    const x = validar(esquemaEstornarAjusteBem, resto);
    if (!(this.porta.destino === 'memoria' && !req.sgh?.real))
      await reautenticar(this.sessoes, this.resolvedor, req, senha);
    const n = idDaRota(id);
    const ev = E.patrimonioAjusteEstornado.codigo;
    const r = await this.servico.estornarAjuste(this.sessao(s), n, x, ev);
    await this.trilhaMemoria(s, ev, n);
    return r;
  }

  // ── Movimentos ────────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('movimentos')
  @Permissao(P.movimentoLer)
  @Auditar(E.patrimonioMovimentosLidos.codigo)
  async movimentos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<MovimentoBem[]> {
    const c = validar(esquemaConsultaMovimentos, q);
    return this.servico.movimentos(this.sessao(sessaoDe(req)), c);
  }

  @Post('movimentos')
  @HttpCode(201)
  @Permissao(P.movimentoRegistrar)
  @AuditadoNoHandler('Trilha na transação do movimento')
  async registrar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ movimento: MovimentoBem; bem: BemPatrimonial }> {
    const s = await this.gravando(req);
    const x = validar(esquemaRegistrarMovimento, corpo);
    if (x.tipo === 'baixa')
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Baixa à parte',
        'A baixa do bem tem rota e permissão próprias.',
        {
          campos: ['tipo'],
        },
      );
    const ev = E.patrimonioMovimentoRegistrado.codigo;
    const r = await this.servico.registrar(this.sessao(s), x, ev);
    await this.trilhaMemoria(s, ev, r.movimento.id);
    return r;
  }

  @Post('movimentos/:id/decisao')
  @HttpCode(200)
  @Permissao(P.movimentoAceitar)
  @AuditadoNoHandler('Trilha na transação da decisão da transferência')
  async decidir(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ movimento: MovimentoBem; bem: BemPatrimonial }> {
    const s = await this.gravando(req);
    const n = idDaRota(id);
    const ev = E.patrimonioMovimentoDecidido.codigo;
    const r = await this.servico.decidir(this.sessao(s), n, validar(esquemaDecidirMovimento, corpo), ev);
    await this.trilhaMemoria(s, ev, n);
    return r;
  }

  @Post('movimentos/:id/cancelamento')
  @HttpCode(200)
  @Permissao(P.movimentoRegistrar)
  @AuditadoNoHandler('Trilha na transação do cancelamento do pedido')
  async cancelar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ movimento: MovimentoBem }> {
    const s = await this.gravando(req);
    const n = idDaRota(id);
    const ev = E.patrimonioMovimentoCancelado.codigo;
    const r = await this.servico.cancelar(this.sessao(s), n, validar(esquemaCancelarMovimento, corpo), ev);
    await this.trilhaMemoria(s, ev, n);
    return r;
  }

  // ── Inventário ────────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('inventarios')
  @Permissao(P.inventarioContar)
  @Auditar(E.patrimonioInventarioLido.codigo)
  async inventarios(@Req() req: RequisicaoAutorizada): Promise<Inventario[]> {
    return this.servico.inventarios(this.sessao(sessaoDe(req)));
  }

  @Get('inventarios/:id')
  @Permissao(P.inventarioContar)
  @Auditar(E.patrimonioInventarioLido.codigo)
  async inventario(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheInventario> {
    return this.servico.inventario(this.sessao(sessaoDe(req)), idDaRota(id));
  }

  @Post('inventarios')
  @HttpCode(201)
  @Permissao(P.inventarioContar)
  @AuditadoNoHandler('Trilha na transação da abertura do inventário')
  async abrir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<DetalheInventario> {
    const s = await this.gravando(req);
    const ev = E.patrimonioInventarioAberto.codigo;
    const r = await this.servico.abrirInventario(
      this.sessao(s),
      validar(esquemaAbrirInventarioBens, corpo),
      ev,
    );
    await this.trilhaMemoria(s, ev, r.id);
    return r;
  }

  @Post('inventarios/:id/leituras')
  @HttpCode(201)
  @Permissao(P.inventarioContar)
  @AuditadoNoHandler('Trilha na transação da leitura')
  async ler(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ leitura: LeituraInventarioRegistrada; resumo: ResumoInventario }> {
    const s = await this.gravando(req);
    const ev = E.patrimonioInventarioLeitura.codigo;
    const r = await this.servico.ler(
      this.sessao(s),
      idDaRota(id),
      validar(esquemaLeituraInventario, corpo),
      ev,
    );
    await this.trilhaMemoria(s, ev, r.leitura.id);
    return r;
  }

  @Post('inventarios/:id/encerramento')
  @HttpCode(200)
  @Permissao(P.inventarioContar)
  @AuditadoNoHandler('Trilha na transação do encerramento (as divergências no resumo)')
  async encerrar(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheInventario> {
    const s = await this.gravando(req);
    const n = idDaRota(id);
    const ev = E.patrimonioInventarioEncerrado.codigo;
    const r = await this.servico.encerrar(this.sessao(s), n, ev);
    await this.trilhaMemoria(s, ev, n);
    return r;
  }

  @Post('inventarios/:id/cancelamento')
  @HttpCode(200)
  @Permissao(P.inventarioContar)
  @AuditadoNoHandler('Trilha na transação do cancelamento (com o motivo; as leituras ficam)')
  async cancelarInventario(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DetalheInventario> {
    const s = await this.gravando(req);
    const n = idDaRota(id);
    const ev = E.patrimonioInventarioCancelado.codigo;
    const r = await this.servico.cancelarInventario(
      this.sessao(s),
      n,
      validar(esquemaCancelarInventario, corpo),
      ev,
    );
    await this.trilhaMemoria(s, ev, n);
    return r;
  }
}
