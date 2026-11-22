// CRUD genérico (M08; ficha, seção 7; cap-09 §9.5): uma API para todos os domínios do modelo próprio.
//   GET  /api/cadastros/dominios                                   índice (só os domínios que a pessoa lê)
//   GET  /api/cadastros/dominios/:modulo/:recurso                  descrição (campos, ações permitidas)
//   GET  …/:modulo/:recurso/itens?busca&ordem&direcao&pagina&porPagina&inativos   lista (no servidor, com teto)
//   GET  …/itens/:codigo   item (versão = coluna versao)          GET …/itens/:codigo/uso   uso pelas FKs
//   GET  …/opcoes/:campo   opções de um campo de referência       GET …/itens/:codigo/textos   (sem textos longos)
//   POST …/itens   incluir · PUT …/itens/:codigo   alterar · POST …/itens/:codigo/inativar · …/reativar (com motivo)
//   POST …/itens/:codigo/excluir   recusado: sem exclusão física (regra 4 do M08); inative
//   POST …/exportar   CSV (permissão `exportar`, trilha)
// A rota exige `config.dominio.ler` (guarda); cada handler confere a permissão do DOMÍNIO (`<modulo>.<recurso>.<acao>`)
// com as regras CASL, e a negação vai à trilha. As gravações passam pelo Executor da fonte (trilha, idempotência e
// trava otimista pela versao na mesma transação).
// Melhoria: a declaração vem dos metadados do banco próprio (dominios-catalogo.ts), sem declaração à mão, sem
// opções de menu do sistema de origem e sem a vigia de reconciliação de exclusões feitas por fora (ADR 0003).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import {
  type AcaoDominio,
  type DominioDescrito,
  esquemaConsultaLista,
  esquemaPedidoAlteracao,
  esquemaPedidoExportacao,
  esquemaPedidoInativacao,
  esquemaPedidoInclusao,
  esquemaPedidoReativacao,
  EVENTOS_AUDITAVEIS,
  type IndiceDominios,
  type ItemDominio,
  type ListaDominio,
  permissaoDoDominio,
  type ResultadoGravacao,
  rotaDoDominio,
  type TextosItem,
  type UsoItem,
} from '@sgh/contratos';
import { pode } from '@sgh/dominio-acesso';
import { avisoDeUso, decidirInativacao, gerarCsv, montarLista } from '@sgh/dominio-config';
import { ErroOperacao } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { destinoNoContrato } from './configuracao-fonte.js';
import { type DominioDeclarado, ErroValorCampo, valoresParaBanco } from './dominios-catalogo.js';
import { type ContextoDominio, FONTE_DOMINIOS, type FonteDominios } from './dominios-fonte.js';

interface RespostaCsv {
  header(nome: string, valor: string): RespostaCsv;
}

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;

/** Erro da gravação → Problem Details em português (sem nome de tabela nem valor de coluna). */
export function problemaDaGravacao(e: unknown, d?: DominioDeclarado): ErroProblema {
  if (e instanceof ErroProblema) return e;
  if (e instanceof ErroValorCampo)
    return new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.', {
      codigo: 'entrada-invalida',
      campos: [...e.campos],
    });
  if (!(e instanceof ErroOperacao)) throw e;
  const p = e.problema;
  const codigo = p.codigo ?? 'erro-interno';
  const rotulo = (campo: string) => d?.campos.find((c) => c.campo === campo)?.rotulo ?? campo;
  switch (codigo) {
    case 'conflito-versao':
      return new ErroProblema('conflito-de-versao', 409, p.title, p.detail, {
        alteradoPor: 'desconhecido',
        alteracoes: (p.colunas ?? []).map((campo) => ({
          campo,
          rotulo: rotulo(campo),
          lido: null,
          atual: null,
        })),
        codigo,
      });
    case 'registro-em-edicao':
      return new ErroProblema('registro-em-edicao', 409, p.title, p.detail, { codigo });
    case 'registro-inexistente':
      return new ErroProblema('nao-encontrado', 404, p.title, p.detail, { codigo });
    case 'entrada-invalida':
    case 'contexto-invalido':
    case 'idempotencia-divergente':
      return new ErroProblema('entrada-invalida', p.status, p.title, p.detail, {
        codigo,
        campos: [...(p.campos ?? [])],
      });
    case 'operacao-nao-liberada':
      return new ErroProblema('operacao-bloqueada', p.status, p.title, p.detail, { codigo });
    default:
      if (p.status === 409 || p.status === 422)
        return new ErroProblema('recusa-de-negocio', p.status, p.title, p.detail, {
          codigo,
          campos: [...(p.campos ?? [])],
        });
      if (p.status === 503) return new ErroProblema('indisponivel', 503, p.title, p.detail, { codigo });
      return new ErroProblema('erro-interno', 500, 'Erro inesperado');
  }
}

@Controller('cadastros/dominios')
export class DominiosController {
  constructor(
    @Inject(FONTE_DOMINIOS) private readonly fonte: FonteDominios,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
  ) {}

  private sessao(req: RequisicaoAutorizada) {
    const a = req.sgh;
    if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const hospital = a.sessao.estabelecimentoAtivo;
    if (!hospital) throw new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento');
    return { a, hospital, rede: a.sessao.rede ?? '', login: a.sessao.usuario.login ?? a.sessao.usuario.id };
  }

  private async declaracao(modulo: string, recurso: string): Promise<DominioDeclarado> {
    const d = (await this.fonte.catalogo()).find((x) => x.modulo === modulo && x.recurso === recurso);
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Domínio não encontrado');
    return d;
  }

  private permitidas(req: RequisicaoAutorizada, d: DominioDeclarado): AcaoDominio[] {
    const { a } = this.sessao(req);
    return d.acoes.filter((acao) => pode(a.ability, permissaoDoDominio(d, acao)));
  }

  /** A permissão do domínio; a negação vai à trilha antes do 403. */
  private async exigir(req: RequisicaoAutorizada, d: DominioDeclarado, acao: AcaoDominio): Promise<void> {
    if (d.acoes.includes(acao) && this.permitidas(req, d).includes(acao)) return;
    const { rede, hospital, login } = this.sessao(req);
    await this.trilha
      .registrar({
        evento: EVENTOS_AUDITAVEIS.permissaoNegada.codigo,
        rede,
        hospital,
        usuario: login,
        estacao: estacaoDaRequisicao(req),
        correlacao: correlacaoDaRequisicao(req, 'crud-generico'),
        recurso: permissaoDoDominio(d, acao),
        resultado: 'falha',
      })
      .catch(() => undefined);
    throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Você não tem permissão para esta ação.');
  }

  private contexto(req: RequisicaoAutorizada): ContextoDominio {
    const { a, hospital, login } = this.sessao(req);
    const bruto = req.headers?.['idempotency-key'];
    const chave = typeof bruto === 'string' ? bruto : '';
    if (!IDEMPOTENCIA.test(chave))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Falta a Idempotency-Key do pedido de gravação.',
      );
    return {
      hospital,
      usuarioId: a.sessao.usuario.id,
      login,
      correlacao: correlacaoDaRequisicao(req, 'crud-generico').slice(0, 64),
      chaveIdempotencia: chave,
    };
  }

  private descrever(req: RequisicaoAutorizada, d: DominioDeclarado): DominioDescrito {
    return {
      modulo: d.modulo,
      recurso: d.recurso,
      rotulo: { ...d.rotulo },
      subitem: d.subitem,
      rota: rotaDoDominio(d.modulo, d.recurso),
      natureza: d.natureza,
      ...(d.motivoSomenteLeitura ? { motivoSomenteLeitura: d.motivoSomenteLeitura } : {}),
      acoes: [...d.acoes],
      permitidas: this.permitidas(req, d),
      campos: d.campos.map((c) => {
        const { coluna, booleano, tabelaReferencia, ...campo } = c;
        void coluna;
        void booleano;
        void tabelaReferencia;
        return campo;
      }),
      campoCodigo: 'codigo',
      campoDescricao: 'descricao',
      campoSituacao: 'ativo',
      exportarExigeJustificativa: false,
      estados: {},
    };
  }

  @Get()
  @Permissao('config.dominio.ler')
  async indice(@Req() req: RequisicaoAutorizada): Promise<IndiceDominios> {
    const { a } = this.sessao(req);
    const lista = await this.fonte.catalogo().catch((e: unknown) => {
      throw problemaDaGravacao(e);
    });
    return {
      dominios: lista
        .filter((d) => pode(a.ability, permissaoDoDominio(d, 'ler')))
        .map((d) => ({
          modulo: d.modulo,
          recurso: d.recurso,
          rotulo: { ...d.rotulo },
          subitem: d.subitem,
          rota: rotaDoDominio(d.modulo, d.recurso),
          natureza: d.natureza,
          permitidas: this.permitidas(req, d),
          ...(d.motivoSomenteLeitura ? { motivoSomenteLeitura: d.motivoSomenteLeitura } : {}),
        })),
    };
  }

  @Get(':modulo/:recurso')
  @Permissao('config.dominio.ler')
  async descricao(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DominioDescrito> {
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    return this.descrever(req, d);
  }

  @Get(':modulo/:recurso/itens')
  @Permissao('config.dominio.ler')
  async lista(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaDominio> {
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    const consulta = esquemaConsultaLista.safeParse(q ?? {});
    if (!consulta.success) throw new ErroProblema('entrada-invalida', 400, 'Consulta inválida');
    const { hospital } = this.sessao(req);
    const lida = await this.fonte.listar(hospital, d, consulta.data.inativos === 'sim');
    const camposOrdenaveis = d.campos.map((c) => c.campo);
    return montarLista(lida.itens, consulta.data, {
      camposOrdenaveis,
      camposBusca: d.campos.filter((c) => c.tipo === 'texto').map((c) => c.campo),
      truncada: lida.truncada,
    });
  }

  private async exigirItem(
    req: RequisicaoAutorizada,
    d: DominioDeclarado,
    codigo: string,
  ): Promise<ItemDominio> {
    if (codigo.length === 0 || codigo.length > 120)
      throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    const i = await this.fonte.item(this.sessao(req).hospital, d, codigo);
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    return i;
  }

  @Get(':modulo/:recurso/itens/:codigo')
  @Permissao('config.dominio.ler')
  async item(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ItemDominio> {
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    return this.exigirItem(req, d, codigo);
  }

  @Get(':modulo/:recurso/itens/:codigo/textos')
  @Permissao('config.dominio.ler')
  async textos(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<TextosItem> {
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    await this.exigirItem(req, d, codigo);
    // Os textos do domínio são campos da própria descrição (sem texto longo à parte).
    return { textos: {} };
  }

  @Get(':modulo/:recurso/itens/:codigo/uso')
  @Permissao('config.dominio.ler')
  async uso(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<UsoItem> {
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    const referencias = await this.fonte.uso(this.sessao(req).hospital, d, codigo);
    return { emUso: referencias.some((x) => x.usos), referencias, aviso: avisoDeUso(referencias) };
  }

  @Get(':modulo/:recurso/opcoes/:campo')
  @Permissao('config.dominio.ler')
  async opcoes(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('campo') nome: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'ler');
    const campo = d.campos.find((c) => c.campo === nome && c.tipo === 'referencia');
    if (!campo) throw new ErroProblema('nao-encontrado', 404, 'Campo não encontrado');
    return { opcoes: await this.fonte.opcoes(this.sessao(req).hospital, d, campo) };
  }

  private resultado(d: DominioDeclarado, verbo: string, codigo: string): ResultadoGravacao {
    return {
      codigo,
      operacao: `${d.modulo}.${d.recurso}.${verbo}`,
      destino: destinoNoContrato(this.fonte.destino),
    };
  }

  @Post(':modulo/:recurso/itens')
  @HttpCode(201)
  @Permissao('config.dominio.ler')
  @AuditadoNoHandler('Executor: trilha na mesma transação da gravação do domínio')
  async incluir(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacao> {
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'criar');
    const p = esquemaPedidoInclusao.safeParse(corpo);
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    try {
      const valores = valoresParaBanco(d, p.data.valores, 'incluir');
      const g = await this.fonte.incluir(this.contexto(req), d, valores);
      return this.resultado(d, 'incluir', g.codigo);
    } catch (e) {
      throw problemaDaGravacao(e, d);
    }
  }

  @Put(':modulo/:recurso/itens/:codigo')
  @Permissao('config.dominio.ler')
  @AuditadoNoHandler('Executor: trilha na mesma transação da gravação do domínio')
  async alterar(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacao> {
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'editar');
    const p = esquemaPedidoAlteracao.safeParse(corpo);
    const versao = p.success ? Number(p.data.versao) : NaN;
    if (!p.success || !Number.isSafeInteger(versao) || versao <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    try {
      const valores = valoresParaBanco(d, p.data.valores, 'alterar');
      const g = await this.fonte.alterar(this.contexto(req), d, codigo, versao, valores);
      return this.resultado(d, 'alterar', g.codigo);
    } catch (e) {
      throw problemaDaGravacao(e, d);
    }
  }

  @Post(':modulo/:recurso/itens/:codigo/inativar')
  @HttpCode(200)
  @Permissao('config.dominio.ler')
  @AuditadoNoHandler('Executor: trilha na mesma transação da gravação do domínio')
  async inativar(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacao> {
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'inativar');
    const p = esquemaPedidoInativacao.safeParse(corpo);
    const versao = p.success ? Number(p.data.versao) : NaN;
    if (!p.success || !Number.isSafeInteger(versao) || versao <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    const atual = await this.exigirItem(req, d, codigo);
    const referencias = await this.fonte.uso(this.sessao(req).hospital, d, codigo);
    const decisao = decidirInativacao({
      ativo: atual.ativo,
      referencias,
      confirmado: p.data.confirmarEmUso === true,
    });
    if (decisao.tipo === 'ja-inativo')
      throw new ErroProblema('recusa-de-negocio', 409, 'Já inativo', 'O item já está inativo.', {
        codigo: 'ja-inativo',
      });
    if (decisao.tipo === 'confirmar')
      throw new ErroProblema('recusa-de-negocio', 409, 'Item em uso', decisao.aviso, { codigo: 'em-uso' });
    try {
      const g = await this.fonte.mudarSituacao(this.contexto(req), d, codigo, versao, false, p.data.motivo);
      return this.resultado(d, 'inativar', g.codigo);
    } catch (e) {
      throw problemaDaGravacao(e, d);
    }
  }

  @Post(':modulo/:recurso/itens/:codigo/reativar')
  @HttpCode(200)
  @Permissao('config.dominio.ler')
  @AuditadoNoHandler('Executor: trilha na mesma transação da gravação do domínio')
  async reativar(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacao> {
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'inativar');
    const p = esquemaPedidoReativacao.safeParse(corpo);
    const versao = p.success ? Number(p.data.versao) : NaN;
    if (!p.success || !Number.isSafeInteger(versao) || versao <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    const atual = await this.exigirItem(req, d, codigo);
    if (atual.ativo)
      throw new ErroProblema('recusa-de-negocio', 409, 'Já ativo', 'O item já está ativo.', {
        codigo: 'ja-ativo',
      });
    try {
      const g = await this.fonte.mudarSituacao(this.contexto(req), d, codigo, versao, true, p.data.motivo);
      return this.resultado(d, 'reativar', g.codigo);
    } catch (e) {
      throw problemaDaGravacao(e, d);
    }
  }

  @Post(':modulo/:recurso/itens/:codigo/excluir')
  @AuditadoNoHandler('não muda estado: a exclusão é sempre recusada (inativar é a ação auditada)')
  @HttpCode(200)
  @Permissao('config.dominio.ler')
  async excluir(@Param('modulo') m: string, @Param('recurso') r: string): Promise<never> {
    await this.declaracao(m, r);
    throw new ErroProblema(
      'recusa-de-negocio',
      409,
      'Exclusão não permitida',
      'Itens de domínio não são apagados: inative o item (os registros antigos continuam legíveis).',
      { codigo: 'exclusao-nao-permitida' },
    );
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
    const d = await this.declaracao(m, r);
    await this.exigir(req, d, 'exportar');
    const p = esquemaPedidoExportacao.safeParse(corpo ?? {});
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    const { rede, hospital, login } = this.sessao(req);
    const lida = await this.fonte.listar(hospital, d, true);
    try {
      await this.trilha.registrar({
        evento: EVENTOS_AUDITAVEIS.dominioExportado.codigo,
        rede,
        hospital,
        usuario: login,
        estacao: estacaoDaRequisicao(req),
        correlacao: correlacaoDaRequisicao(req, 'crud-exportacao'),
        recurso: permissaoDoDominio(d, 'exportar'),
        resultado: 'sucesso',
        chaveNaturalAlvo: `${d.modulo}.${d.recurso}:${lida.itens.length}`,
      });
    } catch {
      throw new ErroProblema(
        'trilha-indisponivel',
        503,
        'Trilha de auditoria indisponível',
        'A exportação não foi gerada porque não pôde ser registrada.',
      );
    }
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="${d.recurso}.csv"`);
    return gerarCsv(
      d.campos.filter((c) => c.campo !== 'codigo'),
      lida.itens,
    );
  }
}
