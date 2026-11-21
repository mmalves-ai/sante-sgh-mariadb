// Telas de Administração › Acesso do M10 (ficha seção 7), além de "Usuários":
//   GET  /api/administracao/acesso/permissoes              grupos, papéis SBIS, política de senha (só consulta)
//   GET  /api/administracao/acesso/permissoes/arvore       árvore do menu de origem (regra 5) com as opções do grupo/papel
//   POST /api/administracao/acesso/permissoes/conceder     acesso.concederOpcoesGrupo (ADR 0022) pela árvore
//   POST /api/administracao/acesso/permissoes/revogar      acesso.revogarOpcoesGrupo
//   GET  /api/administracao/acesso/grupos/propostas        proposta do mapa grupo → perfil (regra 6)
//   GET  /api/administracao/acesso/simulador               o que o usuário X pode fazer e por quê
//   GET  /api/administracao/acesso/termo                   termo vigente e aceites
//   GET  /api/administracao/acesso/termo/sessao            o termo da sessão (pendente?) — diálogo após o login
//   POST /api/administracao/acesso/termo/aceitar           acesso.aceitarTermo
//   GET  /api/administracao/acesso/termo/versoes           versões do termo e aceites de cada uma (W1-01)
//   GET  /api/administracao/acesso/termo/versoes/:id       texto e aceites (paginados) de uma versão, mesmo a anterior
//   POST /api/administracao/acesso/termo/publicar          acesso.publicarTermo (versão nova; senha e motivo)
//   GET  /api/administracao/acesso/quebras-de-vidro        aberturas e revisões
//   POST /api/administracao/acesso/quebras-de-vidro/:id/revisar   revisão (revisao_acesso_emergencial)
import { pareceRtf, rtfParaTexto, textoCorrido } from '@sgh/dominio-pep';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ArvorePermissoes,
  esquemaAceitarTermo,
  esquemaPedidoPublicarTermo,
  esquemaLogin,
  esquemaOpcoesArvore,
  esquemaRevisarQuebraVidro,
  esquemaSimular,
  EVENTOS_AUDITAVEIS,
  type ListaQuebrasVidro,
  type PainelPermissoes,
  PERMISSOES_ACESSO,
  PERMISSOES_M10_CODIGOS,
  type ResultadoSimulacao,
  type TermoDaSessao,
  type TermoVigente,
  type VersaoTermo,
  type VersoesTermo,
} from '@sgh/contratos';
import {
  conferirGestao,
  MINIMO_DO_NOVO,
  mensagemRecusaGestao,
  proporPerfilDoGrupo,
  reconstruirArvoreOpcoes,
} from '@sgh/dominio-acesso';
import { CATALOGO_COMPLETO } from '../../autorizacao/catalogo.js';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import {
  analisar,
  contextoOperacao,
  ctxDe,
  problema,
  reautenticado,
  sessaoDe,
  semSegredos,
  trilhaDe,
} from './comum.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from './fonte.js';

const C = PERMISSOES_M10_CODIGOS;
const DESCRICAO = new Map(CATALOGO_COMPLETO.map((p) => [p.codigo, p.descricao]));
const CATEGORIA = new Map(CATALOGO_COMPLETO.map((p) => [p.codigo, p.categoria ?? null]));
/**
 * Fonte em memória (dev/ci): o id do nó é o da opção do menu sintético, ligado às permissões pelo catálogo. No banco
 * próprio o nó é a acao_sistema, cujo código JÁ É a permissão (a sessão concede por acao_sistema.codigo): os dois
 * conjuntos de ids não têm relação e nunca se cruzam.
 */
const PERMISSOES_DA_OPCAO = new Map<number, string[]>();
for (const p of CATALOGO_COMPLETO)
  for (const o of p.opcoesLegado)
    PERMISSOES_DA_OPCAO.set(o, [...(PERMISSOES_DA_OPCAO.get(o) ?? []), p.codigo]);

const MOTIVO_ORIGEM: Readonly<Record<string, (o: Record<string, unknown>, grupo: string | null) => string>> =
  {
    'opcao-grupo': (o, g) => `o grupo ${g ?? ''} tem a opção ${String(o['opcao'])} do menu`,
    'opcao-papel': (o) => `um papel SBIS do usuário tem a opção ${String(o['opcao'])} do menu`,
    flag: (o) => `a permissão complementar ${String(o['flag'])} está ligada`,
    perfil: (o) => `o perfil ${String(o['perfil'])} do sistema novo concede`,
    'todos-os-perfis-de-pessoa': () => 'é um recurso de toda pessoa',
    'acesso-total': () => 'sessão de acesso total da plataforma',
  };

/**
 * M60.3 (ensaio do manual): o termo vigente vem em RTF do cadastro (como o outro sistema grava); a pessoa lê o texto
 * corrido, nunca os códigos do RTF. RTF ilegível: o texto como está.
 */
export function textoDoTermo(texto: string): string {
  if (!pareceRtf(texto)) return texto;
  try {
    return textoCorrido(rtfParaTexto(texto));
  } catch {
    return texto;
  }
}

@Controller('administracao/acesso')
export class PermissoesController {
  private cacheArvore: {
    em: number;
    hospital: string;
    valor: Awaited<ReturnType<FonteAdministracao['arvore']>>;
  } | null = null;

  /** Permissões de cada nó da árvore, conforme o destino (ver PERMISSOES_DA_OPCAO). */
  private permissoesDosNos(opcoes: readonly { id: number; nome: string }[]): (id: number) => string[] {
    if (this.fonte.destino === 'banco') {
      const codigo = new Map(opcoes.map((o) => [o.id, o.nome]));
      return (id) => {
        const c = codigo.get(id);
        return c ? [c] : [];
      };
    }
    return (id) => PERMISSOES_DA_OPCAO.get(id) ?? [];
  }

  constructor(
    @Inject(FONTE_ADMINISTRACAO) private readonly fonte: FonteAdministracao,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  /** A árvore do menu de origem em cache por poucos minutos (ficha, seção 4: metadado, muda raramente). */
  private async arvoreLida(req: RequisicaoAutorizada) {
    const c = ctxDe(req, 'acesso-permissoes');
    const agora = Date.now();
    if (this.cacheArvore && this.cacheArvore.hospital === c.hospital && agora - this.cacheArvore.em < 180_000)
      return this.cacheArvore.valor;
    const valor = await this.fonte.arvore(c).catch((e: unknown) => problema(e));
    this.cacheArvore = { em: agora, hospital: c.hospital, valor };
    return valor;
  }

  @Get('permissoes')
  @Permissao(PERMISSOES_ACESSO.permissaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.arvorePermissoesConsultada.codigo)
  async painel(@Req() req: RequisicaoAutorizada): Promise<PainelPermissoes> {
    const c = ctxDe(req, 'acesso-permissoes');
    const [grupos, papeis, pol, tipos] = await Promise.all([
      this.fonte.grupos(c),
      this.fonte.papeis(c),
      this.fonte.politica(c),
      this.fonte.tiposAcessoProntuario(c),
    ]).catch((e: unknown) => problema(e));
    return {
      grupos: grupos.map((g) => ({ ...g })).sort((a, b) => a.nome.localeCompare(b.nome)),
      papeis,
      politica: {
        trocaDias: pol.senha.periodoTrocaDias,
        reutilizacaoDias: pol.senha.periodoReutilizacaoDias,
        avisoDias: null,
        tentativasBloqueio: pol.limiteTentativas,
        minimoCaracteres: pol.senha.minimoCaracteres,
        exige: {
          alfanumerico: pol.senha.exigeLetra,
          numero: pol.senha.exigeNumero,
          especial: pol.senha.exigeEspecial,
          minuscula: pol.senha.exigeMinuscula,
          maiuscula: pol.senha.exigeMaiuscula,
        },
        termoPeriodico: pol.termoPeriodico,
        minimoDoNovo: MINIMO_DO_NOVO,
      },
      acessoProntuario: tipos,
      operacoes: ['acesso.concederOpcoesGrupo', 'acesso.revogarOpcoesGrupo'].map((operacao) => {
        const r = this.fonte.receita(operacao, c.hospital);
        return {
          operacao,
          rotulo: operacao.includes('conceder') ? 'Conceder opções ao grupo' : 'Retirar opções do grupo',
          ligada: r.ligada,
          motivo: r.motivo,
        };
      }),
    };
  }

  @Get('permissoes/arvore')
  @Permissao(PERMISSOES_ACESSO.permissaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.arvorePermissoesConsultada.codigo)
  async arvore(
    @Req() req: RequisicaoAutorizada,
    @Query('grupo') grupo?: string,
    @Query('papel') papel?: string,
    @Query('modulo') modulo?: string,
  ): Promise<ArvorePermissoes> {
    const c = ctxDe(req, 'acesso-permissoes');
    const { opcoes, modulos } = await this.arvoreLida(req);
    const idModulo = modulo === undefined || modulo === '' ? null : Number(modulo);
    if (idModulo !== null && !modulos.some((m) => m.id === idModulo))
      throw new ErroProblema('entrada-invalida', 400, 'Módulo inválido', 'Escolha um módulo da lista.');
    const a = reconstruirArvoreOpcoes(
      opcoes
        .filter((o) => idModulo === null || o.modulo === idModulo)
        .map((o) => ({
          id: o.id,
          modulo: o.modulo,
          indice: o.indice,
          nivel: o.nivel,
          ativo: o.ativo,
          titulo: o.titulo || o.nome,
        })),
    );
    let alvo: ArvorePermissoes['alvo'] = null;
    if (grupo) {
      const grupos = await this.fonte.grupos(c).catch((e: unknown) => problema(e));
      const g = grupos.find((x) => x.nome === grupo);
      if (!g) throw new ErroProblema('nao-encontrado', 404, 'Grupo não encontrado');
      alvo = {
        tipo: 'grupo',
        chave: grupo,
        ativo: g.ativo,
        opcoes: await this.fonte.opcoesDoGrupo(c, grupo),
      };
    } else if (papel !== undefined && papel !== '') {
      const n = Number(papel);
      if (!Number.isSafeInteger(n) || n <= 0)
        throw new ErroProblema('entrada-invalida', 400, 'Papel inválido');
      alvo = { tipo: 'papel', chave: String(n), ativo: true, opcoes: await this.fonte.opcoesDoPapel(c, n) };
    }
    const comArvore = new Set(idModulo === null ? [] : [...a.nos.keys()]);
    const permissoes = this.permissoesDosNos(opcoes);
    return {
      modulos: modulos
        .filter((m) => opcoes.some((o) => o.modulo === m.id))
        .map((m) => ({
          id: m.id,
          nome: m.nome,
          raizes: idModulo === m.id ? [...(a.raizes.get(m.id) ?? [])] : [],
        })),
      nos:
        idModulo === null
          ? []
          : [...a.nos.values()]
              .filter((n) => comArvore.has(n.id))
              .map((n) => ({
                ...n,
                filhos: [...n.filhos],
                permissao: permissoes(n.id)[0] ?? null,
              })),
      avisos: a.avisos.map((x) => ({ opcao: x.opcao, modulo: x.modulo, nivel: x.nivel })),
      alvo:
        alvo && idModulo !== null ? { ...alvo, opcoes: alvo.opcoes.filter((o) => comArvore.has(o)) } : alvo,
    };
  }

  private async opcoesArvore(req: RequisicaoAutorizada, corpo: unknown, conceder: boolean) {
    const p = analisar(esquemaOpcoesArvore, corpo);
    const s = sessaoDe(req);
    const r = conferirGestao(
      { login: s.login, perfis: s.perfis },
      conceder ? 'conceder-opcao' : 'revogar-opcao',
      null,
    );
    if (r)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Operação recusada',
        mensagemRecusaGestao(r, 'conceder-opcao'),
        {
          codigo: r,
        },
      );
    const operacao = conceder ? 'acesso.concederOpcoesGrupo' : 'acesso.revogarOpcoesGrupo';
    const reaut = await reautenticado(this.servico, this.resolvedor, req, p.senha);
    await this.fonte
      .executar(
        operacao,
        { grupo: p.grupo, opcoes: p.opcoes },
        contextoOperacao(req, 'acesso-permissoes', reaut),
      )
      .catch((e: unknown) => problema(e));
    // A mudança vale para todo o grupo: o estabelecimento inteiro recalcula (regra 4: poucos minutos no pior caso).
    await this.servico?.servicoAutorizacao?.invalidarEstabelecimento(s.rede, s.hospital);
    return { operacao, invalidado: 'estabelecimento' as const, destino: this.fonte.destino };
  }

  @Post('permissoes/conceder')
  @HttpCode(200)
  @Permissao(C.opcaoConceder)
  @AuditadoNoHandler('executor: a trilha na mesma transação da operação')
  conceder(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.opcoesArvore(req, corpo, true);
  }

  @Post('permissoes/revogar')
  @HttpCode(200)
  @Permissao(C.opcaoRevogar)
  @AuditadoNoHandler('executor: a trilha na mesma transação da operação')
  revogar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.opcoesArvore(req, corpo, false);
  }

  @Get('grupos/propostas')
  @Permissao(PERMISSOES_ACESSO.grupoLer)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async propostas(@Req() req: RequisicaoAutorizada) {
    const c = ctxDe(req, 'acesso-grupos');
    const grupos = await this.fonte.grupos(c).catch((e: unknown) => problema(e));
    const permissoes = this.permissoesDosNos((await this.arvoreLida(req)).opcoes);
    const saida = [];
    for (const g of grupos.sort((a, b) => a.nome.localeCompare(b.nome))) {
      // Falha de leitura não vira grupo sem permissões (proposta errada): sobe como problema.
      const ops = await this.fonte.opcoesDoGrupo(c, g.nome).catch((e: unknown) => problema(e));
      const perms = [...new Set(ops.flatMap((o) => permissoes(o)))];
      saida.push({
        ...proporPerfilDoGrupo({
          grupo: g.nome,
          usuariosAtivos: g.usuariosAtivos,
          permissoes: perms.map((codigo) => ({ codigo, categoria: CATEGORIA.get(codigo) ?? null })),
        }),
        ativo: g.ativo,
        usuariosAtivos: g.usuariosAtivos,
      });
    }
    return { grupos: saida };
  }

  @Get('simulador')
  @Permissao(C.simuladorLer)
  @Auditar(EVENTOS_AUDITAVEIS.simuladorConsultado.codigo)
  async simular(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
  ): Promise<ResultadoSimulacao> {
    const p = analisar(esquemaSimular, q);
    const login = esquemaLogin.parse(p.login);
    const s = sessaoDe(req);
    const a = this.servico?.servicoAutorizacao;
    if (!a) throw new ErroProblema('indisponivel', 503, 'Serviço de permissões indisponível');
    const f = await this.fonte
      .fichaUsuario(ctxDe(req, 'acesso-simulador'), login, false)
      .catch((e: unknown) => problema(e));
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Usuário não encontrado');
    const r = await a.explicar(s.hospital, login, s.rede);
    const termo = p.recurso.trim().toLowerCase();
    const candidatas = CATALOGO_COMPLETO.filter(
      (x) =>
        x.codigo.toLowerCase() === termo ||
        x.codigo.toLowerCase().includes(termo) ||
        x.descricao.toLowerCase().includes(termo),
    ).slice(0, 30);
    return semSegredos({
      login,
      grupo: f.grupo,
      perfis: [...r.perfis],
      avaliadas: candidatas.map((x) => {
        const pode = r.permissoes.has(x.codigo);
        const retirada = r.retiradas.find((y) => y.permissao === x.codigo);
        const motivos = pode
          ? (r.origens.get(x.codigo) ?? []).map((o) =>
              (MOTIVO_ORIGEM[o.tipo] ?? (() => o.tipo))(o as unknown as Record<string, unknown>, f.grupo),
            )
          : retirada
            ? [`retirada pela segregação: ${retirada.motivo}`]
            : x.opcoesLegado.length > 0
              ? [
                  `nem o grupo nem os papéis do usuário têm alguma das opções ${x.opcoesLegado.slice(0, 5).join(', ')} do menu`,
                ]
              : ['recurso do sistema novo concedido por perfil: o usuário não tem o perfil'];
        return { permissao: x.codigo, descricao: DESCRICAO.get(x.codigo) ?? x.codigo, pode, motivos };
      }),
      calculadaEm: new Date(r.calculadaEm).toISOString(),
    });
  }

  @Get('termo')
  @Permissao(C.termoLer)
  @Auditar(EVENTOS_AUDITAVEIS.termoConsultado.codigo)
  async termo(@Req() req: RequisicaoAutorizada): Promise<TermoVigente> {
    const t = await this.fonte.termoVigente(ctxDe(req, 'acesso-termo')).catch((e: unknown) => problema(e));
    if (!t) throw new ErroProblema('nao-encontrado', 404, 'Não há termo de uso vigente');
    return { id: t.id, texto: t.texto, desde: t.desde, aceites: t.aceites, ultimosAceites: [...t.ultimos] };
  }

  @Get('termo/sessao')
  @Permissao(C.termoAceitar)
  async termoDaSessao(@Req() req: RequisicaoAutorizada): Promise<TermoDaSessao> {
    const c = ctxDe(req, 'acesso-termo');
    const s = sessaoDe(req);
    const t = await this.fonte.termoVigente(c).catch((e: unknown) => problema(e));
    if (!t) return { pendente: false, termo: null, aceitePossivel: false, motivo: null };
    const aceito = await this.fonte.termoAceito(c, s.login, t.id).catch((e: unknown) => problema(e));
    const r = this.fonte.receita('acesso.aceitarTermo', c.hospital);
    return {
      pendente: !aceito,
      termo: aceito ? null : { id: t.id, texto: textoDoTermo(t.texto), desde: t.desde },
      aceitePossivel: r.ligada,
      motivo: r.ligada
        ? null
        : 'O aceite do termo ainda não foi liberado neste estabelecimento: procure o administrador do sistema.',
    };
  }

  @Post('termo/aceitar')
  @HttpCode(200)
  @Permissao(C.termoAceitar)
  @AuditadoNoHandler('executor: aceite_termo_uso e a trilha na mesma transação')
  async aceitar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const p = analisar(esquemaAceitarTermo, corpo);
    await this.fonte
      .executar('acesso.aceitarTermo', p, contextoOperacao(req, 'acesso-termo'))
      .catch((e: unknown) => problema(e));
    const id = this.resolvedor.idSessao(req);
    if (id && this.servico)
      await this.servico.marcarTermoAceito(id, this.resolvedor.rede(req)).catch(() => undefined);
    return { operacao: 'acesso.aceitarTermo', destino: this.fonte.destino };
  }

  @Get('termo/versoes')
  @Permissao(C.termoLer)
  @Auditar(EVENTOS_AUDITAVEIS.termoConsultado.codigo)
  async versoesTermo(@Req() req: RequisicaoAutorizada): Promise<VersoesTermo> {
    const c = ctxDe(req, 'acesso-termo');
    const vs = await this.fonte.versoesTermo(c).catch((e: unknown) => problema(e));
    const r = this.fonte.receita('acesso.publicarTermo', c.hospital);
    return {
      versoes: vs.map((v) => ({ ...v })),
      publicarPossivel: r.ligada,
      motivo: r.ligada ? null : r.motivo,
      destino: this.fonte.destino,
    };
  }

  @Get('termo/versoes/:id')
  @Permissao(C.termoLer)
  @Auditar(EVENTOS_AUDITAVEIS.termoConsultado.codigo)
  async versaoTermo(
    @Param('id') id: string,
    @Query('pagina') pagina: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<VersaoTermo> {
    const n = Number(id);
    const p = Number(pagina ?? 1);
    if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(p) || p <= 0 || p > 10_000)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Versão ou página inválida.');
    const v = await this.fonte
      .versaoTermo(ctxDe(req, 'acesso-termo'), n, p)
      .catch((e: unknown) => problema(e));
    if (!v) throw new ErroProblema('nao-encontrado', 404, 'Versão do termo inexistente');
    return { ...v, texto: textoDoTermo(v.texto), itens: [...v.itens], porPagina: 50 };
  }

  /**
   * W1-01 (parte 6b): publica a versão nova do termo pelo executor (acesso.publicarTermo, verde no pc): a anterior
   * sai de vigência com os aceites intactos e todos aceitam a nova no próximo acesso (a sessão lê o termo ativo).
   * Operação crítica: a senha de quem publica no próprio pedido; motivo e versão anterior na trilha (sem o texto).
   */
  @Post('termo/publicar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler('executor: termo_uso_versao (nova e a anterior fechada) e a trilha na mesma transação')
  async publicarTermo(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const { senha, ...p } = analisar(esquemaPedidoPublicarTermo, corpo);
    const reaut = await reautenticado(this.servico, this.resolvedor, req, senha);
    const r = await this.fonte
      .executar('acesso.publicarTermo', p, contextoOperacao(req, 'acesso-termo', reaut))
      .catch((e: unknown) => problema(e));
    return {
      id: Number(r['id'] ?? 0),
      anterior: p.termoAnterior,
      operacao: 'acesso.publicarTermo',
      destino: this.fonte.destino,
    };
  }

  @Get('quebras-de-vidro')
  @Permissao(C.quebraVidroLer)
  @Auditar(EVENTOS_AUDITAVEIS.quebrasVidroConsultadas.codigo)
  async quebras(@Req() req: RequisicaoAutorizada): Promise<ListaQuebrasVidro> {
    const q = await this.fonte.quebras(ctxDe(req, 'acesso-quebras')).catch((e: unknown) => problema(e));
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      itens: q.map((x) => ({
        id: x.id,
        login: x.login,
        idPaciente: x.idPaciente,
        prontuario: x.prontuario,
        motivo: x.motivo,
        justificativa: x.justificativa,
        inicio: iso(x.inicio),
        fim: iso(x.fim),
        revisao: x.revisao
          ? {
              classificacao: x.revisao.classificacao as 'justificado' | 'nao-justificado',
              por: x.revisao.por,
              em: x.revisao.em.toISOString(),
            }
          : null,
      })),
      pendentes: q.filter((x) => !x.revisao).length,
      destino: this.fonte.destino,
    };
  }

  @Post('quebras-de-vidro/:id/revisar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.emergenciaRevisar)
  @AuditadoNoHandler('executor: revisao_acesso_emergencial e a trilha na mesma transação')
  async revisar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    if (!/^\d{1,20}$/.test(id))
      throw new ErroProblema('nao-encontrado', 404, 'Acesso de emergência não encontrado');
    const p = analisar(esquemaRevisarQuebraVidro, corpo);
    const s = sessaoDe(req);
    const c = ctxDe(req, 'acesso-quebras');
    const eu = await this.fonte.fichaUsuario(c, s.login, false).catch(() => null);
    await this.fonte
      .revisarQuebra(
        c,
        {
          idEmergencia: id,
          idUsuario: eu?.id ?? s.usuario ?? 0,
          login: s.login,
          classificacao: p.classificacao,
        },
        trilhaDe(
          req,
          EVENTOS_AUDITAVEIS.emergenciaRevisada.codigo,
          'acesso.emergencia',
          'acesso.revisarEmergencia',
        ),
      )
      .catch((e: unknown) => problema(e));
    return { operacao: 'acesso.revisarEmergencia', destino: this.fonte.destino };
  }
}
