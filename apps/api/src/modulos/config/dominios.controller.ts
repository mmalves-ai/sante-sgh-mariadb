// CRUD genérico (M08; ficha, seção 7; cap-09 §9.5): uma API para todos os domínios declarados.
//   GET  /api/cadastros/dominios                                   índice (só os domínios que a pessoa lê)
//   GET  /api/cadastros/dominios/:modulo/:recurso                  descrição (campos, ações permitidas, estados)
//   GET  …/:modulo/:recurso/itens?busca&ordem&direcao&pagina&porPagina&inativos   lista (no servidor, com teto)
//   GET  …/itens/:codigo   item (versão = colunas mostradas)      GET …/itens/:codigo/uso   uso pelas FKs
//   GET  …/opcoes/:campo   opções de um campo de referência
//   POST …/itens   incluir · PUT …/itens/:codigo   alterar · POST …/itens/:codigo/inativar   inativar
//   GET  …/itens/:codigo/textos   textos longos em leitura (correção do M14)
//   POST …/itens/:codigo/reativar   desfaz a inativação: só no novo (correção do M14) ou, W0-02, na coluna de situação do
//                                   legado (receita reativar<Recurso>), com motivo
//   POST …/itens/:codigo/excluir    W0-02: exclusão física (só no domínio que declara `excluir`; crítica: reautenticação),
//                                   com o verificador de dependências (409 com-dependentes) e o retrato (D-CRUD-SNAP)
//   POST …/exportar   CSV (permissão `exportar`, trilha; justificativa quando há dado pessoal)
//   GET  /api/cadastros/dominios/vigia/exclusoes-fora   revisão do W0-02: o relatório da vigia de reconciliação
//                                   (exclusões feitas por fora; permissão de ver os parâmetros; trilha)
// A rota exige `config.dominio.ler` (guarda); cada handler confere a permissão do DOMÍNIO
// (`<modulo>.<recurso>.<acao>`, com as opções do legado da declaração) com as mesmas regras CASL; a negação
// vai à trilha. As gravações passam pelo EXECUTOR (receita genérica; Idempotency-Key obrigatória): com o
// núcleo, a SGH_TRILHA vai na mesma transação; com a fonte em memória (sessão sintética), o registrador da
// trilha da API registra. Nenhum nome de tabela do legado sai na resposta.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ACOES_DOMINIO,
  type AcaoDominio,
  type DeclaracaoDominio,
  type DominioDescrito,
  esquemaConsultaLista,
  esquemaPedidoAlteracao,
  esquemaPedidoExclusao,
  esquemaPedidoExportacao,
  esquemaPedidoInativacao,
  esquemaPedidoInclusao,
  esquemaPedidoReativacao,
  EVENTOS_AUDITAVEIS,
  type RelatorioVigiaReconciliacao,
  aplicarLegenda,
  rotuloDaLegenda,
  type TextosItem,
  type IndiceDominios,
  type ItemDominio,
  lerVersao,
  type ListaDominio,
  operacaoDoDominio,
  permissaoDoDominio,
  permissoesExigidasDoDominio,
  type ResultadoGravacao,
  rotaDoDominio,
  SUBITENS_DOMINIOS,
  type UsoItem,
  type VerboDominio,
} from '@sgh/contratos';
import { avisoDeUso, conferirExportacao, gerarCsv, montarLista } from '@sgh/dominio-config';
import { filtroDeEscopo, pode } from '@sgh/dominio-acesso';
import {
  camposDescritos,
  type ContextoOperacao,
  declaracao,
  DECLARACOES,
  ErroEscopo,
  ErroOperacao,
  exclusaoProtegida,
  gravarEventoCrud,
  inativarSoNoNovo,
  itemDoDominio,
  rotuloDaTabelaDeDominio,
  vigiaLigada,
  listarDominio,
  operacao,
  opcoesDoCampo,
  reativarSoNoNovo,
  textosLongosDoItem,
  temDadoPessoal,
  TETO_TEXTO_LONGO,
  usoDoItem,
  valoresDaChave,
} from '@sgh/legado';
import { Permissao, AuditadoNoHandler } from '../../autorizacao/decoradores.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { CACHE_CONFIG, type CacheConfig } from './cache-config.js';
import { chaveDeRecursoNaSessao } from './chave-recurso.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from './configuracao-fonte.js';
import { FONTE_DOMINIOS, type FonteDominios } from './dominios-fonte.js';
import {
  INTERVALO_VIGIA_RECONCILIACAO_MS,
  VIGIA_RECONCILIACAO,
  type VigiaReconciliacaoCrud,
} from './vigia-reconciliacao.js';

interface RespostaCsv {
  header(nome: string, valor: string): RespostaCsv;
}

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;

/** M14: o código da rota casa com a chave da declaração (inteiro, texto ou composta com "|"). */
export function codigoValido(d: DeclaracaoDominio, codigo: string): boolean {
  if (codigo.length === 0 || codigo.length > 120) return false;
  try {
    valoresDaChave(d, codigo);
    return true;
  } catch {
    return false;
  }
}

/** M14: filtro da lista pela referência (`ref.<campo>=<valor>`: os itens do mestre na tela mestre-detalhe). */
function filtrosDeReferencia(d: DeclaracaoDominio, q: Readonly<Record<string, string>>): [string, string][] {
  const r: [string, string][] = [];
  for (const [k, v] of Object.entries(q)) {
    const m = /^ref\.([a-zA-Z0-9]{1,40})$/.exec(k);
    if (!m || typeof v !== 'string' || v.length > 40) continue;
    const c = d.colunas.find((x) => x.campo === m[1]);
    if (!c) throw new ErroProblema('entrada-invalida', 400, 'Filtro inválido');
    r.push([c.campo, v]);
  }
  return r;
}

/** Erro do executor → Problem Details em português (sem nome de tabela nem valor de coluna). */
export function problemaDaGravacao(
  e: unknown,
  d: DeclaracaoDominio,
  lido?: Readonly<Record<string, unknown>> | null,
  atual?: ItemDominio | null,
): ErroProblema {
  if (e instanceof ErroProblema) return e;
  if (e instanceof ErroEscopo) return new ErroProblema('sem-permissao', 403, 'Fora do seu escopo');
  if (!(e instanceof ErroOperacao)) throw e;
  const p = e.problema;
  const codigo = p.codigo ?? 'erro-interno';
  const rotulo = (campo: string) =>
    d.colunas.find((c) => c.campo === campo)?.rotulo ?? (campo === 'situacao' ? 'Situação' : campo);
  switch (codigo) {
    case 'conflito-versao': {
      const campos = p.colunas ?? [];
      return new ErroProblema('conflito-de-versao', 409, p.title, p.detail, {
        alteradoPor: 'desconhecido',
        alteracoes: campos.map((campo) => ({
          campo,
          rotulo: rotulo(campo),
          lido: lido?.[campo] === undefined || lido[campo] === null ? null : String(lido[campo]),
          atual:
            campo === 'situacao'
              ? atual
                ? atual.ativo
                  ? 'Ativo'
                  : 'Inativo'
                : null
              : atual?.valores[campo] === undefined || atual.valores[campo] === null
                ? null
                : String(atual.valores[campo]),
        })),
        codigo,
      });
    }
    case 'registro-em-edicao':
      return new ErroProblema('registro-em-edicao', 409, p.title, p.detail, { codigo });
    case 'registro-inexistente':
      return new ErroProblema('nao-encontrado', 404, p.title, p.detail, { codigo });
    case 'entrada-invalida':
      return new ErroProblema('entrada-invalida', 400, p.title, p.detail, {
        codigo,
        campos: [...(p.campos ?? [])],
      });
    case 'operacao-nao-liberada':
    case 'operacao-bloqueada':
      return new ErroProblema('operacao-bloqueada', p.status, p.title, p.detail, { codigo });
    case 'schema-divergente':
      return new ErroProblema('indisponivel', 503, p.title, p.detail, { codigo });
    case 'contexto-invalido':
    case 'idempotencia-divergente':
      return new ErroProblema('entrada-invalida', p.status, p.title, p.detail, { codigo });
    // W0-02 (D-CRUD-ORFAOS): a recusa da exclusão com a lista dos dependentes (rótulo, quantidade e amostra; nunca o
    // nome da tabela) e a oferta de inativar.
    case 'com-dependentes':
    case 'vinculo-concorrente':
      return new ErroProblema('recusa-de-negocio', 409, 'Exclusão recusada', p.detail, {
        codigo,
        dependentes: (p.dependentes ?? []).map((x) => ({
          rotulo: x.rotulo,
          quantidade: x.quantidade,
          amostra: [...x.amostra],
          origem: x.origem,
        })),
        total: (p.dependentes ?? []).reduce((s, x) => s + x.quantidade, 0),
        podeInativar: p.podeInativar === true,
      });
    // W0-02: a recusa do gatilho do banco (exceção _BD/_BIUD): a mensagem do catálogo das exceções, legível.
    case 'recusa-do-gatilho':
      return new ErroProblema('recusa-de-negocio', 409, 'Exclusão recusada', p.detail, { codigo });
    default:
      if (p.status === 409)
        return new ErroProblema('recusa-de-negocio', 409, p.title, p.detail, {
          codigo,
          campos: [...(p.campos ?? [])],
        });
      return new ErroProblema('erro-interno', 500, 'Erro inesperado');
  }
}

/** Motivo da ação de escrita recusada quando a liberação não pôde ser conferida (falha fechada). */
const MOTIVO_SEM_CONFERENCIA = 'Não foi possível conferir a liberação desta gravação agora.';

/** O texto do motivo de um problema (o detalhe, ou o título). */
function motivoDoProblema(e: ErroProblema): string {
  return e.detalhe || e.titulo || MOTIVO_SEM_CONFERENCIA;
}

@Controller('cadastros/dominios')
export class DominiosController implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(FONTE_DOMINIOS) private readonly fonte: FonteDominios,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) private readonly cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(VIGIA_RECONCILIACAO) private readonly vigia: VigiaReconciliacaoCrud | null = null,
  ) {}

  /** Revisão do W0-02: o despertar da vigia de reconciliação (só com a fonte do banco; o parâmetro liga por estabelecimento). */
  onModuleInit(): void {
    this.vigia?.iniciar();
  }

  onModuleDestroy(): void {
    this.vigia?.parar();
  }

  /** Para os testes: a vigia de reconciliação deste controlador (null sem a vigia). */
  get vigiaReconciliacao(): VigiaReconciliacaoCrud | null {
    return this.vigia;
  }

  /**
   * Revisão do W0-02 (D-CRUD-SEM-GATILHO): o relatório "exclusões feitas fora do sistema" (os achados da vigia de
   * reconciliação), com a permissão de ver os parâmetros (quem liga a vigia) e a trilha da consulta. Antes da rota
   * `:modulo/:recurso` (a estática vale primeiro).
   */
  @Get('vigia/exclusoes-fora')
  @Permissao('config.parametro.ler')
  @AuditadoNoHandler('trilha própria registrada antes de a resposta sair')
  async exclusoesFora(
    @Query('desde') desde: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RelatorioVigiaReconciliacao> {
    const { rede, hospital, login } = this.sessao(req);
    const inicio = desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? new Date(`${desde}T00:00:00`) : undefined;
    const disponivel = this.fonte.destino === 'legado' && this.vigia !== null;
    const ligada = disponivel
      ? await this.fonte.ler(rede, hospital, (l) => vigiaLigada(l, hospital)).catch(() => false)
      : false;
    const linhas = disponivel
      ? await this.vigia!.relatorio(hospital, rotuloDaTabelaDeDominio, inicio).catch((e: unknown) => {
          throw problemaDaGravacao(e, DECLARACOES[0]!);
        })
      : [];
    try {
      await this.trilha.registrar({
        evento: EVENTOS_AUDITAVEIS.vigiaReconciliacaoConsultada.codigo,
        rede,
        hospital,
        usuario: login,
        estacao: estacaoDaRequisicao(req),
        correlacao: correlacaoDaRequisicao(req, 'vigia-reconciliacao'),
        recurso: 'crud.vigiaReconciliacao',
        resultado: 'sucesso',
        idAlvo: String(linhas.length),
      });
    } catch {
      throw new ErroProblema(
        'trilha-indisponivel',
        503,
        'Trilha de auditoria indisponível',
        'O relatório não foi mostrado porque a consulta não pôde ser registrada.',
      );
    }
    const u = this.vigia?.ultima(hospital) ?? null;
    return {
      ligada,
      disponivel,
      intervaloMinutos: Math.round(INTERVALO_VIGIA_RECONCILIACAO_MS / 60_000),
      ultimaRodada: u
        ? { em: u.em, tabelas: u.tabelas, achados: u.achados, ...(u.erro ? { erro: u.erro } : {}) }
        : null,
      linhas: linhas.map((x) => ({
        rotulo: x.rotulo,
        detectadoEm: x.detectadoEm,
        contagemAntes: x.contagemAntes,
        contagemDepois: x.contagemDepois,
        foraDoSistema: x.foraDoSante,
        chaves: [...x.chaves],
      })),
    };
  }

  /**
   * M47 (etapa 2): o domínio com chave de recurso só grava com ela ligada para a sessão (POL-3; os cadastros da agência
   * transfusional com a `agencia.completa`, DP-21). Sem chave declarada, null (nada a conferir).
   */
  private async chaveDesligada(req: RequisicaoAutorizada, d: DeclaracaoDominio): Promise<string | null> {
    const chave = d.publico.chaveRecurso;
    if (!chave) return null;
    const r = await chaveDeRecursoNaSessao(this.configuracao, this.cache, req, chave);
    return r.ligada ? null : (r.motivo ?? 'Cadastro em consulta.');
  }

  private sessao(req: RequisicaoAutorizada) {
    const a = req.sgh;
    if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const hospital = a.sessao.estabelecimentoAtivo;
    if (!hospital) throw new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento');
    return { a, hospital, rede: a.sessao.rede ?? '', login: a.sessao.usuario.login ?? a.sessao.usuario.id };
  }

  private declaracao(modulo: string, recurso: string): DeclaracaoDominio {
    const d =
      /^[a-z]+$/.test(modulo) && /^[a-z][A-Za-z0-9]+$/.test(recurso)
        ? declaracao(`${modulo}.${recurso}`)
        : undefined;
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Domínio não encontrado');
    return d;
  }

  /** Permissão do domínio (mesmas regras CASL da tela); a negação vai à trilha própria. */
  private async exigir(req: RequisicaoAutorizada, d: DeclaracaoDominio, acao: AcaoDominio): Promise<void> {
    const { a, hospital, rede, login } = this.sessao(req);
    const exigidas = permissoesExigidasDoDominio(d.publico, acao);
    const codigo = exigidas.find((x) => !pode(a.ability, x)) ?? permissaoDoDominio(d.publico, acao);
    if (d.publico.acoes.includes(acao) && exigidas.every((x) => pode(a.ability, x))) return;
    await this.trilha
      .registrar({
        evento: EVENTOS_AUDITAVEIS.permissaoNegada.codigo,
        rede,
        hospital,
        usuario: login,
        estacao: estacaoDaRequisicao(req),
        correlacao: correlacaoDaRequisicao(req, 'negada'),
        recurso: codigo.slice(0, 80),
        resultado: 'falha',
      })
      .catch(() => undefined);
    throw new ErroProblema(
      'sem-permissao',
      403,
      'Sem permissão',
      'Seu perfil não permite esta ação neste domínio.',
    );
  }

  private filtro(req: RequisicaoAutorizada, d: DeclaracaoDominio) {
    return filtroDeEscopo(permissaoDoDominio(d.publico, 'ler'), req.sgh?.sessao.escopos);
  }

  private descrever(req: RequisicaoAutorizada, d: DeclaracaoDominio, hospital: string): DominioDescrito {
    const a = req.sgh!;
    const situacao = d.situacao ? 'situacao' : undefined;
    const estados: Record<string, string> = {};
    for (const verbo of ['incluir', 'alterar', 'inativar', 'reativar', 'excluir'] as const) {
      const op = operacaoDoDominio(d.publico, verbo);
      const e = this.fonte.estado(op, hospital);
      if (e) estados[verbo] = e;
    }
    return {
      modulo: d.publico.modulo,
      recurso: d.publico.recurso,
      rotulo: d.publico.rotulo,
      subitem: SUBITENS_DOMINIOS[d.publico.subitem],
      rota: rotaDoDominio(d.publico.modulo, d.publico.recurso),
      natureza: d.publico.natureza,
      ...(d.publico.motivoSomenteLeitura ? { motivoSomenteLeitura: d.publico.motivoSomenteLeitura } : {}),
      ...(d.publico.semInclusao ? { semInclusao: d.publico.semInclusao } : {}),
      acoes: [...d.publico.acoes],
      permitidas: ACOES_DOMINIO.filter(
        (x) =>
          d.publico.acoes.includes(x) &&
          permissoesExigidasDoDominio(d.publico, x).every((c) => pode(a.ability, c)),
      ),
      campos: camposDescritos(d, (coluna) => this.fonte.aConfirmar(d.tabela, coluna)),
      campoCodigo: d.colunas.find((c) => c.coluna === d.chave)?.campo ?? 'codigo',
      campoDescricao: d.descricao,
      ...(situacao ? { campoSituacao: situacao } : {}),
      exportarExigeJustificativa: temDadoPessoal(d),
      estados,
      ...(d.situacaoSoNoNovo ? { inativacaoSoNoNovo: true } : {}),
      ...(d.situacao && d.publico.acoes.includes('inativar') ? { reativaNaSituacao: true } : {}),
      ...(d.publico.acoes.includes('excluir') && exclusaoProtegida(d) ? { exclusaoProtegida: true } : {}),
      ...(d.publico.semExclusao ? { semExclusao: d.publico.semExclusao } : {}),
      marco: d.publico.marco,
      ...(d.textosLongos?.length
        ? {
            textosLongos: d.textosLongos.map((c) => ({
              campo: c.campo,
              rotulo: c.rotulo,
              ...(c.editavel && d.publico.acoes.includes('editar')
                ? { editavel: true, maxBytes: c.maxBytes ?? TETO_TEXTO_LONGO }
                : {}),
              ...(c.obrigatorio && c.editavel ? { obrigatorio: true } : {}),
            })),
          }
        : {}),
      ...(rotuloDaLegenda(d.legenda) ? { legenda: rotuloDaLegenda(d.legenda)! } : {}),
    };
  }

  @Get()
  @Permissao('config.dominio.ler')
  indice(@Req() req: RequisicaoAutorizada): IndiceDominios {
    const { a, hospital } = this.sessao(req);
    return {
      dominios: DECLARACOES.filter((d) => pode(a.ability, permissaoDoDominio(d.publico, 'ler'))).map((d) => {
        const x = this.descrever(req, d, hospital);
        return {
          modulo: x.modulo,
          recurso: x.recurso,
          rotulo: x.rotulo,
          subitem: x.subitem,
          rota: x.rota,
          natureza: x.natureza,
          permitidas: x.permitidas,
          ...(x.motivoSomenteLeitura ? { motivoSomenteLeitura: x.motivoSomenteLeitura } : {}),
          ...(x.marco ? { marco: x.marco } : {}),
        };
      }),
    };
  }

  @Get(':modulo/:recurso')
  @Permissao('config.dominio.ler')
  async descricao(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DominioDescrito> {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    const descrito = this.descrever(req, d, this.sessao(req).hospital);
    const recusadas = await this.recusadas(req, d, descrito.permitidas);
    return Object.keys(recusadas).length > 0 ? { ...descrito, recusadas } : descrito;
  }

  /**
   * M38 (campo 7; D-FAIXA-38): as ações de escrita que a permissão deixa e o executor recusaria agora (a mesma
   * conferência do passo 0, sem abrir transação), com o motivo. Falha fechada: sem resposta, recusada.
   */
  private async recusadas(
    req: RequisicaoAutorizada,
    d: DeclaracaoDominio,
    permitidas: readonly AcaoDominio[],
  ): Promise<Partial<Record<AcaoDominio | 'reativar', string>>> {
    const { rede, hospital, login, a } = this.sessao(req);
    const grupo = a.sessao.grupoLegado;
    const setor = a.sessao.unidadeAtiva;
    const quem = {
      rede,
      hospital,
      usuarioLegado: login,
      traceId: 'liberacao',
      idempotencyKey: 'liberacao-consulta',
      ...(setor !== null && setor !== undefined ? { setor: String(setor) } : {}),
      ...(grupo ? { grupo } : {}),
    } as ContextoOperacao;
    const verbos = {
      criar: 'incluir',
      editar: 'alterar',
      inativar: 'inativar',
      excluir: 'excluir',
      reativar: 'reativar',
    } as const;
    const desligada = await this.chaveDesligada(req, d);
    const r: Partial<Record<AcaoDominio | 'reativar', string>> = {};
    // Revisão do W0-02: a reativação (permissão de inativar) tem a liberação da operação reativar<Recurso>, separada.
    for (const acao of ['criar', 'editar', 'inativar', 'excluir', 'reativar'] as const) {
      if (!permitidas.includes(acao === 'reativar' ? 'inativar' : acao)) continue;
      if (acao === 'reativar' && !d.situacao && !d.situacaoSoNoNovo) continue;
      if (desligada) {
        r[acao] = desligada;
        continue;
      }
      if ((acao === 'inativar' || acao === 'reativar') && d.situacaoSoNoNovo && !d.situacao) {
        try {
          await this.exigirLiberacaoSoNoNovo(
            d,
            quem,
            acao === 'reativar' ? 'Reativação desligada' : 'Inativação desligada',
          );
        } catch (e) {
          r[acao] = e instanceof ErroProblema ? motivoDoProblema(e) : MOTIVO_SEM_CONFERENCIA;
        }
        continue;
      }
      const consultar = this.fonte.executor.liberacao?.bind(this.fonte.executor);
      if (!consultar) continue;
      try {
        const lib = await consultar(operacao(operacaoDoDominio(d.publico, verbos[acao])), quem);
        if (!lib.pode) r[acao] = lib.motivo ?? MOTIVO_SEM_CONFERENCIA;
      } catch {
        r[acao] = MOTIVO_SEM_CONFERENCIA;
      }
    }
    return r;
  }

  @Get(':modulo/:recurso/itens')
  @Permissao('config.dominio.ler')
  async lista(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Query() consulta: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaDominio> {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    const refs = filtrosDeReferencia(d, consulta);
    const semRef = Object.fromEntries(Object.entries(consulta).filter(([k]) => !k.startsWith('ref.')));
    const c = esquemaConsultaLista.safeParse(semRef);
    if (!c.success) throw new ErroProblema('entrada-invalida', 400, 'Consulta inválida');
    const { rede, hospital } = this.sessao(req);
    try {
      const lida = await this.fonte.ler(rede, hospital, (l) => listarDominio(l, d, this.filtro(req, d)));
      // Correção do M14 (regras 7, 9 e 13): a legenda do novo e o código em uso sem linha ("a confirmar").
      const itens = (aplicarLegenda(d.legenda, lida.itens, d.descricao) as ItemDominio[]).filter((i) =>
        refs.every(([campo, v]) => String(i.valores[campo] ?? '') === v),
      );
      return montarLista(itens, c.data, {
        camposOrdenaveis: d.colunas.filter((x) => x.naLista).map((x) => x.campo),
        camposBusca: d.colunas.filter((x) => x.tipo === 'texto').map((x) => x.campo),
        truncada: lida.truncada,
      });
    } catch (e) {
      throw problemaDaGravacao(e, d);
    }
  }

  @Get(':modulo/:recurso/itens/:codigo')
  @Permissao('config.dominio.ler')
  async item(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ItemDominio> {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    const { rede, hospital } = this.sessao(req);
    if (!codigoValido(d, codigo)) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    let i: ItemDominio | null;
    try {
      i = await this.fonte.ler(rede, hospital, (l) => itemDoDominio(l, d, codigo, this.filtro(req, d)));
    } catch (e) {
      throw problemaDaGravacao(e, d);
    }
    // Troca do código na URL para item fora do escopo: o mesmo 404 do inexistente (nada vaza).
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    return i;
  }

  /** Correção do M14: os textos longos do item (fórmula, valores de referência, modelo de laudo), em leitura. */
  @Get(':modulo/:recurso/itens/:codigo/textos')
  @Permissao('config.dominio.ler')
  async textos(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<TextosItem> {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    if (!d.textosLongos?.length || !codigoValido(d, codigo))
      throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    const { rede, hospital } = this.sessao(req);
    let t: Record<string, string | null> | null;
    try {
      t = await this.fonte.ler(rede, hospital, (l) => textosLongosDoItem(l, d, codigo, this.filtro(req, d)));
    } catch (e) {
      throw problemaDaGravacao(e, d);
    }
    if (!t) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    return { textos: t };
  }

  @Get(':modulo/:recurso/itens/:codigo/uso')
  @Permissao('config.dominio.ler')
  async uso(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<UsoItem> {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'inativar');
    if (!codigoValido(d, codigo)) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    const { rede, hospital } = this.sessao(req);
    const refs = await this.fonte.ler(rede, hospital, (l) => usoDoItem(l, d, codigo));
    const referencias = refs.map((x) => ({ regra: x.regra, usos: x.usos }));
    return { emUso: referencias.some((x) => x.usos), referencias, aviso: avisoDeUso(referencias) };
  }

  @Get(':modulo/:recurso/opcoes/:campo')
  @Permissao('config.dominio.ler')
  async opcoes(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('campo') campo: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    if (!d.colunas.some((c) => c.campo === campo && c.referencia))
      throw new ErroProblema('nao-encontrado', 404, 'Campo sem opções');
    const { rede, hospital } = this.sessao(req);
    return { opcoes: await this.fonte.ler(rede, hospital, (l) => opcoesDoCampo(l, d, campo, declaracao)) };
  }

  private contextoOperacao(req: RequisicaoAutorizada): ContextoOperacao {
    const { rede, hospital, login } = this.sessao(req);
    const bruto = req.headers['idempotency-key'];
    const chave = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'Falta a Idempotency-Key do pedido de gravação.',
      );
    return {
      rede,
      hospital,
      traceId: correlacaoDaRequisicao(req, 'crud-generico'),
      usuarioLegado: login,
      idempotencyKey: chave,
      estacao: estacaoDaRequisicao(req).slice(0, 80),
    };
  }

  /** Executa a operação da receita genérica; na fonte em memória, a trilha vai ao registrador da API. */
  private async gravar(
    req: RequisicaoAutorizada,
    d: DeclaracaoDominio,
    verbo: VerboDominio,
    entrada: unknown,
    lido?: Readonly<Record<string, unknown>> | null,
    codigoAlvo?: string,
    reautenticadoEm?: number,
  ): Promise<ResultadoGravacao> {
    const ctx = {
      ...this.contextoOperacao(req),
      ...(reautenticadoEm !== undefined ? { reautenticadoEm } : {}),
    };
    const nome = operacaoDoDominio(d.publico, verbo);
    const desligada = await this.chaveDesligada(req, d);
    if (desligada)
      throw new ErroProblema('recurso-desligado', 403, 'Cadastro em consulta', desligada, {
        codigo: 'recurso-desligado',
      });
    let codigo: string;
    try {
      const r = await this.fonte.executor.executar(operacao(nome), ctx.hospital, entrada, ctx);
      codigo = String(r.resultado['codigo'] ?? '');
    } catch (e) {
      let atual: ItemDominio | null = null;
      if (e instanceof ErroOperacao && e.problema.codigo === 'conflito-versao' && codigoAlvo)
        atual = await this.fonte
          .ler(ctx.rede, ctx.hospital, (l) => itemDoDominio(l, d, codigoAlvo))
          .catch(() => null);
      throw problemaDaGravacao(e, d, lido, atual);
    }
    if (this.fonte.destino === 'memoria')
      await this.trilha.registrar({
        evento: EVENTOS_AUDITAVEIS.dominioGravado.codigo,
        rede: ctx.rede,
        hospital: ctx.hospital,
        usuario: ctx.usuarioLegado,
        estacao: ctx.estacao ?? '',
        correlacao: ctx.traceId,
        recurso: `${d.publico.modulo}.${d.publico.recurso}`,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: codigo,
      });
    return { codigo, operacao: nome, destino: this.fonte.destino };
  }

  @Post(':modulo/:recurso/itens')
  @HttpCode(201)
  @Permissao('config.dominio.ler')
  @AuditadoNoHandler(
    'executor: SGH_TRILHA na mesma transação da receita genérica (memória: registrador da API)',
  )
  async incluir(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'criar');
    const p = esquemaPedidoInclusao.safeParse(corpo);
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    return this.gravar(req, d, 'incluir', p.data.valores);
  }

  @Put(':modulo/:recurso/itens/:codigo')
  @Permissao('config.dominio.ler')
  @AuditadoNoHandler(
    'executor: SGH_TRILHA na mesma transação da receita genérica (memória: registrador da API)',
  )
  async alterar(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'editar');
    const p = esquemaPedidoAlteracao.safeParse(corpo);
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    await this.dentroDoEscopo(req, d, codigo);
    return this.gravar(
      req,
      d,
      'alterar',
      { codigo, versao: p.data.versao, valores: p.data.valores },
      lerVersao(p.data.versao)?.valores,
      codigo,
    );
  }

  @Post(':modulo/:recurso/itens/:codigo/inativar')
  @HttpCode(200)
  @Permissao('config.dominio.ler')
  @AuditadoNoHandler(
    'executor: SGH_TRILHA na mesma transação da receita genérica (memória: registrador da API)',
  )
  async inativar(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'inativar');
    const p = esquemaPedidoInativacao.safeParse(corpo);
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    await this.dentroDoEscopo(req, d, codigo);
    // M14 (regra 11): sem coluna de situação provada, a inativação vale só no novo (nada no legado).
    if (d.situacaoSoNoNovo)
      return this.inativarNoNovo(
        req,
        d,
        codigo,
        p.data.versao,
        p.data.confirmarEmUso === true,
        p.data.motivo,
      );
    // Revisão do W0-02: o motivo vai ao registro do evento (SGH_CRUD_EVENTO), com o valor anterior.
    return this.gravar(
      req,
      d,
      'inativar',
      {
        codigo,
        versao: p.data.versao,
        motivo: p.data.motivo,
        ...(p.data.confirmarEmUso ? { confirmarEmUso: true } : {}),
      },
      lerVersao(p.data.versao)?.valores,
      codigo,
    );
  }

  /** M14: inativação só no novo (SGH_CFG_DOMINIO_SITUACAO + SGH_TRILHA na mesma transação SGH_). */
  private async inativarNoNovo(
    req: RequisicaoAutorizada,
    d: DeclaracaoDominio,
    codigo: string,
    versao: string,
    confirmarEmUso: boolean,
    motivo: string,
  ): Promise<ResultadoGravacao> {
    const ctx = this.contextoOperacao(req);
    const nome = `${d.publico.modulo}.inativarNoNovo`;
    await this.exigirLiberacaoSoNoNovo(d, ctx, 'Inativação desligada');
    try {
      await this.fonte.gravarSgh(ctx.rede, ctx.hospital, async (e) => {
        // Revisão do W0-02: o motivo e o valor anterior da inativação só no novo vão ao registro do evento.
        await gravarEventoCrud(e, {
          hospital: ctx.hospital,
          operacao: nome,
          recurso: `${d.publico.modulo}.${d.publico.recurso}`,
          evento: 'inativado',
          tabela: d.tabela,
          chave: codigo,
          motivo,
          valorAnterior: lerVersao(versao)?.valores ?? null,
          idempotencia: ctx.idempotencyKey,
          estacao: ctx.estacao ?? null,
          usuario: ctx.usuarioLegado,
        });
        return inativarSoNoNovo(
          e,
          d,
          { codigo, versao, confirmarEmUso, usuario: ctx.usuarioLegado },
          {
            rede: ctx.rede,
            hospital: ctx.hospital,
            usuario: ctx.usuarioLegado,
            evento: `${d.publico.modulo}.${d.publico.recurso}.inativadoNoNovo`,
            recurso: `${d.publico.modulo}.${d.publico.recurso}`,
            operacao: nome,
            resultado: 'sucesso',
            estacao: ctx.estacao ?? null,
            correlacao: ctx.traceId.slice(0, 64),
          },
        );
      });
    } catch (e) {
      let atual: ItemDominio | null = null;
      if (e instanceof ErroOperacao && e.problema.codigo === 'conflito-versao')
        atual = await this.fonte
          .ler(ctx.rede, ctx.hospital, (l) => itemDoDominio(l, d, codigo))
          .catch(() => null);
      if (e instanceof Error && /SGH_UQ_CFG_DOMINIO_SITUACAO/.test(e.message))
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'O item já está inativo',
          'Outra pessoa já o inativou.',
          {
            codigo: 'ja-inativo',
          },
        );
      throw problemaDaGravacao(e, d, lerVersao(versao)?.valores, atual);
    }
    if (this.fonte.destino === 'memoria')
      await this.trilha.registrar({
        evento: EVENTOS_AUDITAVEIS.dominioGravado.codigo,
        rede: ctx.rede,
        hospital: ctx.hospital,
        usuario: ctx.usuarioLegado,
        estacao: ctx.estacao ?? '',
        correlacao: ctx.traceId,
        recurso: `${d.publico.modulo}.${d.publico.recurso}`,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: codigo,
      });
    return { codigo, operacao: nome, destino: this.fonte.destino };
  }

  /**
   * A gravação só no novo segue a liberação do domínio (a mesma chave da inclusão ou da alteração dele): fora de
   * desenvolvimento, sem operação provada e liberada, fica desligada (POL-3), com o motivo. Correção do M14:
   * falha FECHADO — sem resposta da liberação (erro ao ler as liberações, conexão, método ausente) não grava.
   */
  private async exigirLiberacaoSoNoNovo(
    d: DeclaracaoDominio,
    ctx: ContextoOperacao,
    titulo: string,
  ): Promise<void> {
    const irmas = (['incluir', 'alterar'] as const)
      .map((v) => operacaoDoDominio(d.publico, v))
      .filter((n) => d.publico.acoes.includes(n.includes('.incluir') ? 'criar' : 'editar'));
    const livre = this.fonte.destino === 'memoria' || ['dev', 'ci'].includes(process.env['AMBIENTE'] ?? '');
    const desligada = (motivo: string, codigo = 'operacao-nao-liberada') =>
      new ErroProblema('operacao-bloqueada', 403, titulo, motivo, { codigo });
    if (!irmas[0]) {
      if (!livre)
        throw desligada('Este cadastro ainda não tem operação de gravação liberada neste estabelecimento.');
      return;
    }
    const consultar = this.fonte.executor.liberacao?.bind(this.fonte.executor);
    let lib: Awaited<ReturnType<NonNullable<typeof consultar>>> | null;
    try {
      lib = consultar ? await consultar(operacao(irmas[0]), ctx) : null;
    } catch {
      lib = null;
    }
    if (lib && !lib.pode) throw desligada(lib.motivo ?? '', lib.codigo ?? 'operacao-nao-liberada');
    if (!lib && !livre)
      throw desligada('Não foi possível conferir a liberação deste cadastro agora: nada foi gravado.');
  }

  @Post(':modulo/:recurso/itens/:codigo/reativar')
  @HttpCode(200)
  @Permissao('config.dominio.ler')
  @AuditadoNoHandler('SGH_TRILHA na mesma transação SGH_ da reativação (núcleo)')
  async reativar(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacao> {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'inativar');
    const p = esquemaPedidoReativacao.safeParse(corpo);
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    await this.dentroDoEscopo(req, d, codigo);
    // W0-02: o domínio que inativa pela coluna de situação do legado reativa pela receita (grava a letra de ativo como
    // o legado grava), com motivo e trilha.
    if (d.situacao)
      return this.gravar(
        req,
        d,
        'reativar',
        { codigo, versao: p.data.versao, motivo: p.data.motivo },
        lerVersao(p.data.versao)?.valores,
        codigo,
      );
    if (!d.situacaoSoNoNovo)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Reativação indisponível',
        'Este cadastro não tem inativação.',
        { codigo: 'sem-inativacao' },
      );
    const ctx = this.contextoOperacao(req);
    const nome = `${d.publico.modulo}.reativarNoNovo`;
    await this.exigirLiberacaoSoNoNovo(d, ctx, 'Reativação desligada');
    try {
      await this.fonte.gravarSgh(ctx.rede, ctx.hospital, async (e) => {
        // W0-02: o motivo e o valor anterior da reativação só no novo também vão ao registro do evento.
        await gravarEventoCrud(e, {
          hospital: ctx.hospital,
          operacao: nome,
          recurso: `${d.publico.modulo}.${d.publico.recurso}`,
          evento: 'reativado',
          tabela: d.tabela,
          chave: codigo,
          motivo: p.data.motivo,
          valorAnterior: lerVersao(p.data.versao)?.valores ?? null,
          idempotencia: ctx.idempotencyKey,
          estacao: ctx.estacao ?? null,
          usuario: ctx.usuarioLegado,
        });
        return reativarSoNoNovo(
          e,
          d,
          { codigo, versao: p.data.versao, usuario: ctx.usuarioLegado },
          {
            rede: ctx.rede,
            hospital: ctx.hospital,
            usuario: ctx.usuarioLegado,
            evento: `${d.publico.modulo}.${d.publico.recurso}.reativadoNoNovo`,
            recurso: `${d.publico.modulo}.${d.publico.recurso}`,
            operacao: nome,
            resultado: 'sucesso',
            estacao: ctx.estacao ?? null,
            correlacao: ctx.traceId.slice(0, 64),
          },
        );
      });
    } catch (e) {
      let atual: ItemDominio | null = null;
      if (e instanceof ErroOperacao && e.problema.codigo === 'conflito-versao')
        atual = await this.fonte
          .ler(ctx.rede, ctx.hospital, (l) => itemDoDominio(l, d, codigo))
          .catch(() => null);
      throw problemaDaGravacao(e, d, lerVersao(p.data.versao)?.valores, atual);
    }
    if (this.fonte.destino === 'memoria')
      await this.trilha.registrar({
        evento: EVENTOS_AUDITAVEIS.dominioReativadoNoNovo.codigo,
        rede: ctx.rede,
        hospital: ctx.hospital,
        usuario: ctx.usuarioLegado,
        estacao: ctx.estacao ?? '',
        correlacao: ctx.traceId,
        recurso: `${d.publico.modulo}.${d.publico.recurso}`,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: codigo,
      });
    return { codigo, operacao: nome, destino: this.fonte.destino };
  }

  /**
   * W0-02: exclusão física do item nunca usado (só no domínio que declara `excluir`). Operação crítica: a senha vem no
   * corpo (reautenticação, SBIS-07) e nunca chega à entrada da operação. Com dependentes: 409 `com-dependentes` com a
   * lista (rótulo, quantidade, amostra) e a oferta de inativar; gatilho que recusa: 409 com a mensagem dele.
   */
  @Post(':modulo/:recurso/itens/:codigo/excluir')
  @HttpCode(200)
  @Permissao('config.dominio.ler')
  @AuditadoNoHandler(
    'executor: SGH_TRILHA, SGH_CRUD_EVENTO (motivo e valor anterior) e SGH_HIST_EXCLUSAO na mesma transação',
  )
  async excluir(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacao> {
    const d = this.declaracao(m, r);
    await this.exigir(req, d, 'excluir');
    let senha: string | undefined;
    if (corpo && typeof corpo === 'object' && 'senha' in corpo) {
      const { senha: x, ...resto } = corpo as Record<string, unknown>;
      senha = typeof x === 'string' ? x : undefined;
      corpo = resto;
    }
    const p = esquemaPedidoExclusao.safeParse(corpo);
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe o motivo.');
    await this.dentroDoEscopo(req, d, codigo);
    // Na sessão sintética (memória, dev/ci) não há senha a conferir: a crítica só reautentica com a sessão real.
    // Revisão do W0-02: a sessão REAL sobre a fonte em memória (o e2e, dev) confere a senha como os demais
    // controladores (prescrição, farmácia, pacientes).
    let reautenticadoEm: number | undefined;
    if (this.fonte.destino === 'memoria' && !req.sgh?.real) reautenticadoEm = Date.now();
    else {
      if (!this.resolvedor)
        throw new ErroProblema(
          'reautenticacao-necessaria',
          401,
          'Confirme a senha',
          'Entre com o seu usuário.',
        );
      reautenticadoEm = await reautenticar(this.sessoes, this.resolvedor, req, senha);
    }
    return this.gravar(
      req,
      d,
      'excluir',
      { codigo, versao: p.data.versao, motivo: p.data.motivo },
      lerVersao(p.data.versao)?.valores,
      codigo,
      reautenticadoEm,
    );
  }

  /** A gravação só alcança item do escopo da pessoa (mesmo 404 do inexistente). */
  private async dentroDoEscopo(
    req: RequisicaoAutorizada,
    d: DeclaracaoDominio,
    codigo: string,
  ): Promise<void> {
    if (!codigoValido(d, codigo)) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    if (!d.escopos) return;
    const { rede, hospital } = this.sessao(req);
    const i = await this.fonte
      .ler(rede, hospital, (l) => itemDoDominio(l, d, codigo, this.filtro(req, d)))
      .catch((e) => {
        throw problemaDaGravacao(e, d);
      });
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
  }

  @Post(':modulo/:recurso/exportar')
  @HttpCode(200)
  @Permissao('config.dominio.ler')
  @AuditadoNoHandler('trilha própria registrada antes de a resposta sair (sem trilha, sem dado)')
  async exportar(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: RespostaCsv,
  ): Promise<string> {
    const d = this.declaracao(m, r);
    // Permissão de exportar ANTES de qualquer leitura (a negação vai à trilha).
    await this.exigir(req, d, 'exportar');
    const p = esquemaPedidoExportacao.safeParse(corpo ?? {});
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    const { a, rede, hospital, login } = this.sessao(req);
    const pessoal = temDadoPessoal(d);
    const justificativas = pessoal
      ? new Set(
          (
            await this.fonte.ler(rede, hospital, (l) =>
              listarDominio(l, declaracao('auditoria.justificativaExportacao')!),
            )
          ).itens
            .filter((i) => i.ativo)
            .map((i) => Number(i.codigo)),
        )
      : new Set<number>();
    const recusa = conferirExportacao({
      podeExportar:
        d.publico.acoes.includes('exportar') && pode(a.ability, permissaoDoDominio(d.publico, 'exportar')),
      temDadoPessoal: pessoal,
      justificativa: p.data.justificativa,
      justificativasValidas: justificativas,
    });
    if (recusa === 'sem-permissao') await this.exigir(req, d, 'exportar');
    if (recusa)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Justificativa obrigatória',
        'Escolha a justificativa da exportação.',
        { codigo: recusa },
      );
    const lida = await this.fonte.ler(rede, hospital, (l) => listarDominio(l, d, this.filtro(req, d)));
    // Lista cortada pelo teto: exportar só uma parte sem avisar enganaria quem recebe o arquivo.
    if (lida.truncada)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Exportação incompleta',
        'O domínio tem mais itens do que o teto da leitura: a exportação foi recusada para não sair pela metade.',
        { codigo: 'lista-truncada' },
      );
    const justificativa =
      pessoal && p.data.justificativa !== undefined && p.data.justificativa !== null
        ? `justificativa:${String(p.data.justificativa)};`
        : '';
    try {
      await this.trilha.registrar({
        evento: EVENTOS_AUDITAVEIS.dominioExportado.codigo,
        rede,
        hospital,
        usuario: login,
        estacao: estacaoDaRequisicao(req),
        correlacao: correlacaoDaRequisicao(req, 'exportacao'),
        recurso: `${d.publico.modulo}.${d.publico.recurso}`,
        resultado: 'sucesso',
        idAlvo: String(lida.itens.length),
        // Código da justificativa escolhida (PRTIPO_JUSTIF_EXPORTACAO) e a contagem: o auditor sabe qual foi.
        chaveNaturalAlvo: `${justificativa}linhas:${lida.itens.length}`,
      });
    } catch {
      throw new ErroProblema(
        'trilha-indisponivel',
        503,
        'Trilha de auditoria indisponível',
        'A exportação não foi feita porque não pôde ser registrada.',
      );
    }
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header('content-disposition', `attachment; filename="${d.publico.recurso}.csv"`);
    // BOM do UTF-8: o Excel em pt-BR abre os acentos certos.
    return `\uFEFF${gerarCsv(
      d.colunas
        .filter((c) => !(d.chaveComposta ?? [d.chave]).includes(c.coluna))
        .map((c) => ({ campo: c.campo, rotulo: c.rotulo })),
      lida.itens,
    )}`;
  }
}
