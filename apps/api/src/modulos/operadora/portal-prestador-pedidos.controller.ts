// C2-074 (08-SGO linha 113, F7): o portal do prestador além da autorização e das contas.
// Lado do prestador (sessão do portal conferida no handler, CSRF nas gravações; o prestador e a conta saem da sessão,
// nunca da tela):
//   GET  /api/portal-prestador/avisos                      os avisos que valem para ele agora (recorte pelo domínio)
//   GET  /api/portal-prestador/documentos-exigidos         as regras de documento do tipo e da natureza dele
//   GET  /api/portal-prestador/pedidos-cadastro            os pedidos dele, com a decisão e o motivo
//   POST /api/portal-prestador/pedidos-cadastro            o pedido de alteração do próprio cadastro
//   POST /api/portal-prestador/pedidos-cadastro/:id/cancelar  o cancelamento do pedido dele ainda não decidido
// Lado da operadora (usuário interno, permissão da rede credenciada):
//   GET  /api/operadora/portal-prestador/pedidos?situacao   a fila dos pedidos
//   POST /api/operadora/portal-prestador/pedidos/:id/decisao  analisar, aprovar ou recusar com motivo
//   GET  /api/operadora/portal-prestador/avisos ; POST (publicar) ; POST :id/retirar (inativa, nunca apaga)
//   GET  /api/operadora/portal-prestador/regras-arquivo ; POST (incluir) ; POST :id/inativar
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
} from '@nestjs/common';
import {
  CABECALHO_CSRF_PORTAL_PRESTADOR,
  CHAVE_OPERADORA_PORTAL_PRESTADOR,
  COOKIE_CSRF_PORTAL_PRESTADOR,
  COOKIE_PORTAL_PRESTADOR,
  COOKIE_PORTAL_PRESTADOR_DEV,
  EVENTOS_AUDITAVEIS,
} from '@sgh/contratos';
import {
  avisosDoPrestador,
  regrasDoPrestador,
  SITUACOES_PEDIDO_WEB_PRESTADOR,
  TIPOS_AVISO_PORTAL,
} from '@sgh/dominio-operadora';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao, Publica } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { lerCookie } from '../../sessao/cookies.js';
import { linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ServicoSituacaoOperadora } from './aplicacao/situacao.js';
import {
  PORTA_PORTAL_PRESTADOR_PEDIDOS,
  type PortaPortalPrestadorPedidosPropria,
} from './portal-prestador-pedidos-propria.js';
import {
  SERVICO_PORTAL_PRESTADOR,
  type ServicoPortalPrestador,
  type SessaoPortalPrestadorInterna,
} from './portal-prestador-servico.js';

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'operadora.portal-prestador.pedidos';
const PERM_LER = 'operadora.prestador.ler';
const PERM_EDITAR = 'operadora.prestador.editar';
const SEM_PREFIXO = new Set(['dev', 'ci']);

export const ROTAS_PORTAL_PRESTADOR_PEDIDOS = {
  avisosPortal: 'portal-prestador/avisos',
  documentosPortal: 'portal-prestador/documentos-exigidos',
  pedidosPortal: 'portal-prestador/pedidos-cadastro',
  cancelarPortal: 'portal-prestador/pedidos-cadastro/:id/cancelar',
  pedidos: 'operadora/portal-prestador/pedidos',
  decisao: 'operadora/portal-prestador/pedidos/:id/decisao',
  avisos: 'operadora/portal-prestador/avisos',
  retirarAviso: 'operadora/portal-prestador/avisos/:id/retirar',
  regras: 'operadora/portal-prestador/regras-arquivo',
  inativarRegra: 'operadora/portal-prestador/regras-arquivo/:id/inativar',
} as const;
const R = ROTAS_PORTAL_PRESTADOR_PEDIDOS;

const opc = <T extends z.ZodTypeAny>(t: T) => t.nullable().default(null);
const esquemaPedidoPortal = z
  .object({
    tipo: z.enum(['alteracao_cadastral', 'endereco', 'especialidade', 'qualificacao']),
    nome: z.string().trim().min(1).max(150),
    nomeFantasia: opc(z.string().trim().max(150)),
    cpf: opc(z.string().regex(/^[\d.-]{11,14}$/)),
    cnpj: opc(z.string().regex(/^[\d./-]{14,18}$/)),
    conselho: z
      .object({
        classe: opc(z.number().int().positive()),
        numero: opc(z.string().trim().max(20)),
        uf: opc(z.number().int().positive()),
      })
      .strict()
      .default({ classe: null, numero: null, uf: null }),
    cnes: opc(z.string().regex(/^\d{1,7}$/)),
    banco: z
      .object({
        banco: opc(z.number().int().positive()),
        agencia: opc(z.string().trim().max(10)),
        conta: opc(z.string().trim().max(20)),
      })
      .strict()
      .default({ banco: null, agencia: null, conta: null }),
    telefone: opc(z.string().trim().max(20)),
    email: opc(z.string().trim().max(254)),
    cep: opc(z.string().regex(/^\d{1,8}$/)),
    detalhes: opc(z.record(z.string(), z.unknown())),
  })
  .strict();
const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();
const esquemaDecisao = z
  .object({
    versao: z.number().int().positive(),
    acao: z.enum(['analisar', 'aprovar', 'recusar']),
    motivo: opc(z.string().trim().max(500)),
  })
  .strict();
const esquemaFiltro = z.object({ situacao: z.enum(SITUACOES_PEDIDO_WEB_PRESTADOR).optional() }).strict();
const instante = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/);
const esquemaAviso = z
  .object({
    tipo: z.enum(TIPOS_AVISO_PORTAL),
    titulo: z.string().trim().min(1).max(200),
    conteudo: z.string().trim().min(1).max(10_000),
    link: opc(z.string().trim().max(500)),
    exibirDe: instante,
    exibirAte: opc(instante),
    tipoPrestador: opc(z.number().int().positive()),
    prestador: opc(z.number().int().positive()),
    destaque: z.boolean().default(false),
  })
  .strict();
const esquemaRegra = z
  .object({
    operadora: z.number().int().positive(),
    tipoPrestador: opc(z.number().int().positive()),
    natureza: opc(z.enum(['fisica', 'juridica'])),
    descricao: z.string().trim().min(1).max(150),
    obrigatorio: z.boolean(),
    extensoes: opc(z.string().regex(/^[a-z0-9]{1,10}(,\s*[a-z0-9]{1,10})*$/i)),
    tamanhoMaximoKb: opc(z.number().int().positive().max(1_048_576)),
  })
  .strict();

interface Req {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string;
}
const um = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const idRota = (v: string): number => {
  if (!/^[1-9]\d{0,17}$/.test(v)) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
  return Number(v);
};
const so = (v: string | null) => (v ? v.replace(/\D/g, '') : null);
const pad = (v: string | null, n: number) => (v ? v.padStart(n, '0') : null);

@Controller()
export class PortalPrestadorPedidosController {
  private readonly situacoes: ServicoSituacaoOperadora;

  constructor(
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Inject(SERVICO_PORTAL_PRESTADOR) private readonly portal: ServicoPortalPrestador,
    @Inject(PORTA_PORTAL_PRESTADOR_PEDIDOS) private readonly porta: PortaPortalPrestadorPedidosPropria,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.situacoes = new ServicoSituacaoOperadora(fonte, cache);
  }

  // ── Sessão do portal ────────────────────────────────────────────────────────────────────────

  private async sessaoPortal(req: Req, escrita = false): Promise<SessaoPortalPrestadorInterna> {
    const nome = SEM_PREFIXO.has(this.configuracao.ambiente)
      ? COOKIE_PORTAL_PRESTADOR_DEV
      : COOKIE_PORTAL_PRESTADOR;
    const cookies = um(req.headers['cookie']) ?? undefined;
    const s = this.portal.sessao(
      lerCookie(cookies, nome),
      escrita
        ? {
            cookie: lerCookie(cookies, COOKIE_CSRF_PORTAL_PRESTADOR),
            cabecalho: um(req.headers[CABECALHO_CSRF_PORTAL_PRESTADOR]),
          }
        : undefined,
    );
    await this.portal.exigirContaComChave(s, CHAVE_OPERADORA_PORTAL_PRESTADOR);
    return s;
  }

  private ip(req: Req): string {
    return (req.ip ?? 'desconhecido').slice(0, 50);
  }

  private async prestadorDa(s: SessaoPortalPrestadorInterna) {
    const p = await this.porta.prestador(this.portal.contextoDe(s), s.prestador);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Prestador não encontrado');
    return p;
  }

  @Get(R.avisosPortal)
  @Header('cache-control', 'no-store')
  @Publica('os avisos à rede que valem para o prestador da sessão do portal (conferida no handler)')
  async avisosPortal(@Req() req: Req) {
    const s = await this.sessaoPortal(req);
    const c = this.portal.contextoDe(s);
    const [p, avisos, agora] = await Promise.all([
      this.prestadorDa(s),
      this.porta.avisos(c),
      this.porta.agora(c),
    ]);
    return {
      itens: avisosDoPrestador(avisos, { prestador: p.id, tipoPrestador: p.tipoPrestador }, agora).map(
        (a) => ({
          id: a.id,
          tipo: a.tipo,
          titulo: a.titulo,
          conteudo: a.conteudo,
          link: a.link,
          exibirDe: a.exibirDe,
          destaque: a.destaque,
        }),
      ),
    };
  }

  @Get(R.documentosPortal)
  @Header('cache-control', 'no-store')
  @Publica(
    'os documentos exigidos do prestador da sessão do portal pela regra da operadora (conferida no handler)',
  )
  async documentosPortal(@Req() req: Req) {
    const s = await this.sessaoPortal(req);
    const p = await this.prestadorDa(s);
    const regras = await this.porta.regras(this.portal.contextoDe(s), s.operadora);
    return {
      itens: regrasDoPrestador(regras, { tipoPrestador: p.tipoPrestador, natureza: p.pessoa }).map((r) => ({
        id: r.id,
        descricao: r.descricao,
        obrigatorio: r.obrigatorio,
        extensoes: r.extensoes,
        tamanhoMaximoKb: r.tamanhoMaximoKb,
      })),
    };
  }

  @Get(R.pedidosPortal)
  @Header('cache-control', 'no-store')
  @Publica('os pedidos de alteração do prestador da sessão do portal (só os dele)')
  async pedidosPortal(@Req() req: Req) {
    const s = await this.sessaoPortal(req);
    const itens = await this.porta.pedidos(this.portal.contextoDe(s), { prestador: s.prestador });
    // O portal não recebe os detalhes internos da análise nem a conta da operadora.
    return {
      itens: itens.map((p) => {
        const x: { -readonly [K in keyof typeof p]?: (typeof p)[K] } = { ...p };
        delete x.detalhes;
        delete x.conta;
        return x;
      }),
    };
  }

  @Post(R.pedidosPortal)
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @Publica('o pedido de alteração do próprio cadastro (sessão e CSRF do portal conferidos no handler)')
  @AuditadoNoHandler(
    'o pedido (pedido_web_prestador) com a trilha na mesma transação (operadora.portal.pedido-enviado)',
  )
  async enviarPedido(@Body() b: unknown, @Req() req: Req) {
    const s = await this.sessaoPortal(req, true);
    const e = corpo(esquemaPedidoPortal, b);
    const p = await this.prestadorDa(s);
    const r = await this.porta
      .registrarPedido(
        this.portal.contextoDe(s),
        {
          ...e,
          prestador: s.prestador,
          conta: s.acesso,
          pessoa: p.pessoa,
          tipoPrestador: p.tipoPrestador,
          cpf: p.pessoa === 'fisica' ? (so(e.cpf) ?? p.cpf) : null,
          cnpj: p.pessoa === 'juridica' ? (so(e.cnpj) ?? p.cnpj) : null,
          cnes: pad(e.cnes, 7),
          cep: pad(e.cep, 8),
        },
        (x) =>
          this.portal.linhaDoPortal(
            s,
            E.operadoraPortalPedidoEnviado.codigo,
            String(x.id),
            'sucesso',
            this.ip(req),
            'pedido_web_prestador',
          ),
      )
      .catch((x: unknown) => {
        throw problemaDoCadastro(x);
      });
    return {
      ok: true,
      ...r,
      mensagem: `Pedido ${r.numero} recebido. A operadora vai analisar e responder aqui.`,
    };
  }

  @Post(R.cancelarPortal)
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @Publica(
    'o cancelamento do pedido do próprio prestador ainda não decidido (sessão e CSRF conferidos no handler)',
  )
  @AuditadoNoHandler(
    'a situação do pedido com a trilha na mesma transação (operadora.portal.pedido-decidido)',
  )
  async cancelarPedido(@Param('id') id: string, @Body() b: unknown, @Req() req: Req) {
    const s = await this.sessaoPortal(req, true);
    const n = idRota(id);
    const e = corpo(esquemaVersao, b);
    return this.porta
      .decidirPedido(
        this.portal.contextoDe(s),
        { id: n, versao: e.versao, acao: 'cancelar', motivo: null, analista: null, dono: s.prestador },
        (x) =>
          this.portal.linhaDoPortal(
            s,
            E.operadoraPortalPedidoDecidido.codigo,
            String(x.id),
            'sucesso',
            this.ip(req),
            'pedido_web_prestador',
          ),
      )
      .catch((x: unknown) => {
        throw problemaDoCadastro(x);
      });
  }

  // ── Lado da operadora ───────────────────────────────────────────────────────────────────────

  private async exigir(req: RequisicaoAutorizada): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    await this.situacoes.exigir(
      { rede: s.rede, hospital: s.hospital, login: s.login, setor: req.sgh?.sessao.unidadeAtiva ?? null },
      CHAVE_OPERADORA_PORTAL_PRESTADOR,
    );
    return s;
  }

  private linha(s: SessaoCadastro, evento: string, operacao: string, tabela: string) {
    return (r: { id: number }) => linhaTrilha(s, evento, RECURSO, operacao, { tabela, id: String(r.id) });
  }

  private falha = (x: unknown): never => {
    throw problemaDoCadastro(x);
  };

  @Get(R.pedidos)
  @Permissao(PERM_LER)
  async pedidos(@Query() q: Record<string, string | undefined>, @Req() req: RequisicaoAutorizada) {
    const f = esquemaFiltro.safeParse(q ?? {});
    if (!f.success)
      throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
    const s = await this.exigir(req);
    return {
      itens: await this.porta
        .pedidos(s.porta, f.data.situacao ? { situacao: f.data.situacao } : {})
        .catch(this.falha),
    };
  }

  @Post(R.decisao)
  @HttpCode(200)
  @Permissao(PERM_EDITAR)
  @AuditadoNoHandler('a decisão do pedido (pedido_web_prestador) com a trilha na mesma transação')
  async decidir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idRota(id);
    const e = corpo(esquemaDecisao, b);
    const s = await this.exigir(req);
    return this.porta
      .decidirPedido(
        s.porta,
        { id: n, versao: e.versao, acao: e.acao, motivo: e.motivo, analista: s.porta.usuario ?? null },
        this.linha(
          s,
          E.operadoraPortalPedidoDecidido.codigo,
          'operadora.portal-prestador.pedido.decidir',
          'pedido_web_prestador',
        ),
      )
      .catch(this.falha);
  }

  @Get(R.avisos)
  @Permissao(PERM_LER)
  async avisos(@Req() req: RequisicaoAutorizada) {
    const s = await this.exigir(req);
    return { itens: await this.porta.avisos(s.porta).catch(this.falha) };
  }

  @Post(R.avisos)
  @HttpCode(200)
  @Permissao(PERM_EDITAR)
  @AuditadoNoHandler('o aviso (aviso_portal_prestador) com a trilha na mesma transação')
  async publicar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAviso, b);
    const s = await this.exigir(req);
    return this.porta
      .publicarAviso(
        s.porta,
        { ...e, documento: null },
        this.linha(
          s,
          E.operadoraPortalAvisoPublicado.codigo,
          'operadora.portal-prestador.aviso.publicar',
          'aviso_portal_prestador',
        ),
      )
      .catch(this.falha);
  }

  @Post(R.retirarAviso)
  @HttpCode(200)
  @Permissao(PERM_EDITAR)
  @AuditadoNoHandler('a retirada do aviso (inativado, nunca apagado) com a trilha na mesma transação')
  async retirar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idRota(id);
    const e = corpo(esquemaVersao, b);
    const s = await this.exigir(req);
    return this.porta
      .retirarAviso(
        s.porta,
        { id: n, versao: e.versao },
        this.linha(
          s,
          E.operadoraPortalAvisoPublicado.codigo,
          'operadora.portal-prestador.aviso.retirar',
          'aviso_portal_prestador',
        ),
      )
      .catch(this.falha);
  }

  @Get(R.regras)
  @Permissao(PERM_LER)
  async regras(@Query('operadora') operadora: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = await this.exigir(req);
    return { itens: await this.porta.regras(s.porta, idRota(operadora ?? '')).catch(this.falha) };
  }

  @Post(R.regras)
  @HttpCode(200)
  @Permissao(PERM_EDITAR)
  @AuditadoNoHandler('a regra de arquivo (regra_arquivo_prestador) com a trilha na mesma transação')
  async incluirRegra(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaRegra, b);
    const s = await this.exigir(req);
    return this.porta
      .incluirRegra(
        s.porta,
        e,
        this.linha(
          s,
          E.operadoraPortalRegraArquivo.codigo,
          'operadora.portal-prestador.regra.incluir',
          'regra_arquivo_prestador',
        ),
      )
      .catch(this.falha);
  }

  @Post(R.inativarRegra)
  @HttpCode(200)
  @Permissao(PERM_EDITAR)
  @AuditadoNoHandler('a inativação da regra (nunca apagada) com a trilha na mesma transação')
  async inativarRegra(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const n = idRota(id);
    const e = corpo(esquemaVersao, b);
    const s = await this.exigir(req);
    return this.porta
      .inativarRegra(
        s.porta,
        { id: n, versao: e.versao },
        this.linha(
          s,
          E.operadoraPortalRegraArquivo.codigo,
          'operadora.portal-prestador.regra.inativar',
          'regra_arquivo_prestador',
        ),
      )
      .catch(this.falha);
  }
}
