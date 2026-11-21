// Rotas do M59-F4 (ficha do M59, seção 7: "Saneamento dos grupos", /administracao/acesso/grupos/saneamento): o painel
// dos grupos de acesso amplo, os usuários de cada um (com a sugestão do destino pelo uso), o simulador do antes e do
// depois, o plano (decidir, aprovar pela área, descartar) e a aplicação pelas operações do executor do núcleo (troca de
// perfil, bloqueio e, na dissolução do perfil vazio, a retirada das ações em lotes). Leitura com acesso.grupo.ler; as
// ações com acesso.grupo.sanear. Toda gravação do plano vai à trilha_auditoria na mesma transação; aplicar e dissolver
// exigem a senha (reautenticação, SBIS-07) e a Idempotency-Key.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  esquemaAprovarItemSaneamento,
  esquemaDescartarItemSaneamento,
  esquemaDissolverGrupo,
  esquemaFiltroSimulacaoSaneamento,
  esquemaNovoItemSaneamento,
  EVENTOS_AUDITAVEIS,
  type ItemSaneamento,
  type PainelSaneamento,
  PERMISSOES_ACESSO,
  PERMISSOES_M59_F4_CODIGOS,
  type ResultadoAplicacaoSaneamento,
  type SimulacaoSaneamento,
  type UsuariosSaneamento,
} from '@sgh/contratos';
import { ErroOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { reautenticar } from '../../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../../autorizacao/resolvedor-sessao.js';
import { ErroProblema, tipoPorStatus } from '../../../problema.filter.js';
import type { ServicoSessao } from '../../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso.controller.js';
import { type AtorSaneamento, ErroSaneamento, type ServicoSaneamento } from './servico.js';

export const SERVICO_SANEAMENTO = Symbol('SERVICO_SANEAMENTO');

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,70}$/;
const ID = /^\d{1,18}$/;
const esquemaGrupo = z.string().trim().min(1).max(60);
const esquemaComSenha = <T extends z.ZodType>(e: T) =>
  z.object({ dados: e, senha: z.string().min(1).max(64) }).strict();
const esquemaSoSenha = z.object({ senha: z.string().min(1).max(64) }).strict();

@Controller('administracao/acesso/grupos/saneamento')
export class SaneamentoController {
  constructor(
    @Inject(SERVICO_SANEAMENTO) private readonly saneamento: ServicoSaneamento | null,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  private servico(): ServicoSaneamento {
    if (!this.saneamento) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    return this.saneamento;
  }

  private ator(req: RequisicaoAutorizada): AtorSaneamento {
    const s = req.sgh?.sessao;
    if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login)
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return {
      rede: s.rede,
      hospital: s.estabelecimentoAtivo,
      login: s.usuario.login,
      estacao: estacaoDaRequisicao(req).slice(0, 80) || null,
      correlacao: correlacaoDaRequisicao(req, 'acesso-saneamento'),
    };
  }

  private analisar<T extends z.ZodType>(esquema: T, corpo: unknown): z.infer<T> {
    const r = esquema.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        r.error.issues[0]?.message ?? undefined,
      );
    return r.data;
  }

  private id(bruto: string): string {
    if (!ID.test(bruto)) throw new ErroProblema('entrada-invalida', 400, 'Decisão inválida');
    return bruto;
  }

  private chave(req: RequisicaoAutorizada): string {
    const bruta = req.headers['idempotency-key'];
    const chave = Array.isArray(bruta) ? bruta[0] : bruta;
    if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'Falta a Idempotency-Key do pedido.',
      );
    return chave;
  }

  private problema(e: unknown): never {
    if (e instanceof ErroProblema) throw e;
    if (e instanceof ErroSaneamento) {
      const tipo = e.status === 409 ? 'recusa-de-negocio' : tipoPorStatus(e.status);
      throw new ErroProblema(tipo, e.status, 'Não foi possível concluir', e.detalhe, { codigo: e.codigo });
    }
    if (e instanceof ErroOperacao) {
      const p = e.problema;
      const tipo = p.status === 409 ? 'recusa-de-negocio' : tipoPorStatus(p.status);
      throw new ErroProblema(tipo, p.status, p.title, p.detail, {
        ...(p.codigo ? { codigo: p.codigo } : {}),
      });
    }
    throw e;
  }

  // ── leituras (acesso.grupo.ler) ──────────────────────────────────────────────────────────────

  @Get()
  @Permissao(PERMISSOES_ACESSO.grupoLer)
  @Auditar(EVENTOS_AUDITAVEIS.saneamentoConsultado.codigo)
  painel(@Req() req: RequisicaoAutorizada): Promise<PainelSaneamento> {
    return this.servico()
      .painel(this.ator(req))
      .catch((e: unknown) => this.problema(e));
  }

  @Get('plano')
  @Permissao(PERMISSOES_ACESSO.grupoLer)
  @Auditar(EVENTOS_AUDITAVEIS.saneamentoConsultado.codigo)
  plano(
    @Req() req: RequisicaoAutorizada,
    @Query('grupo') grupo?: string,
  ): Promise<{ itens: ItemSaneamento[] }> {
    const g = grupo === undefined || grupo === '' ? undefined : this.analisar(esquemaGrupo, grupo);
    return this.servico()
      .plano(this.ator(req), g)
      .then((itens) => ({ itens }))
      .catch((e: unknown) => this.problema(e));
  }

  @Get('simulacao')
  @Permissao(PERMISSOES_ACESSO.grupoLer)
  @Auditar(EVENTOS_AUDITAVEIS.saneamentoConsultado.codigo)
  simular(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
  ): Promise<SimulacaoSaneamento> {
    const f = this.analisar(esquemaFiltroSimulacaoSaneamento, q ?? {});
    return this.servico()
      .simular(this.ator(req), f.login, f.destino)
      .catch((e: unknown) => this.problema(e));
  }

  @Get('grupos/:grupo/usuarios')
  @Permissao(PERMISSOES_ACESSO.grupoLer)
  @Auditar(EVENTOS_AUDITAVEIS.saneamentoConsultado.codigo)
  usuarios(@Param('grupo') bruto: string, @Req() req: RequisicaoAutorizada): Promise<UsuariosSaneamento> {
    const grupo = this.analisar(esquemaGrupo, bruto);
    return this.servico()
      .usuarios(this.ator(req), grupo)
      .catch((e: unknown) => this.problema(e));
  }

  // ── plano (acesso.grupo.sanear) ──────────────────────────────────────────────────────────────

  @Post('plano')
  @HttpCode(201)
  @Permissao(PERMISSOES_M59_F4_CODIGOS.grupoSanear)
  @AuditadoNoHandler('trilha_auditoria na mesma transação do plano (acesso.saneamento.incluido)')
  incluir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ItemSaneamento> {
    const n = this.analisar(esquemaNovoItemSaneamento, corpo);
    return this.servico()
      .incluir(this.ator(req), n)
      .catch((e: unknown) => this.problema(e));
  }

  @Post('plano/:id/aprovar')
  @HttpCode(200)
  @Permissao(PERMISSOES_M59_F4_CODIGOS.grupoSanear)
  @AuditadoNoHandler('trilha_auditoria na mesma transação do plano (acesso.saneamento.aprovado)')
  async aprovar(
    @Param('id') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ItemSaneamento> {
    const id = this.id(bruto);
    const p = this.analisar(esquemaComSenha(esquemaAprovarItemSaneamento), corpo);
    // A aprovação da área tira acesso usado: crítica (SBIS-07), com a senha de quem aprova.
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.servico()
      .aprovar(this.ator(req), id, p.dados)
      .catch((e: unknown) => this.problema(e));
  }

  @Post('plano/:id/descartar')
  @HttpCode(200)
  @Permissao(PERMISSOES_M59_F4_CODIGOS.grupoSanear)
  @AuditadoNoHandler('trilha_auditoria na mesma transação do plano (acesso.saneamento.descartado)')
  descartar(
    @Param('id') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ItemSaneamento> {
    const id = this.id(bruto);
    this.analisar(esquemaDescartarItemSaneamento, corpo ?? {});
    return this.servico()
      .descartar(this.ator(req), id)
      .catch((e: unknown) => this.problema(e));
  }

  @Post('plano/:id/aplicar')
  @HttpCode(200)
  @Permissao(PERMISSOES_M59_F4_CODIGOS.grupoSanear)
  @AuditadoNoHandler(
    'executor: trilha_auditoria na mesma transação da operação; o plano também (acesso.saneamento.aplicado)',
  )
  async aplicar(
    @Param('id') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAplicacaoSaneamento> {
    const id = this.id(bruto);
    const p = this.analisar(esquemaSoSenha, corpo);
    const chave = this.chave(req);
    const reautenticadoEm = await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.servico()
      .aplicar(this.ator(req), id, { chaveIdempotencia: chave, reautenticadoEm })
      .catch((e: unknown) => this.problema(e));
  }

  @Post('grupos/:grupo/dissolver')
  @HttpCode(200)
  @Permissao(PERMISSOES_M59_F4_CODIGOS.grupoSanear)
  @AuditadoNoHandler(
    'executor: trilha_auditoria na mesma transação de cada lote; o plano também (acesso.saneamento.aplicado)',
  )
  async dissolver(
    @Param('grupo') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAplicacaoSaneamento> {
    const grupo = this.analisar(esquemaGrupo, bruto);
    const p = this.analisar(esquemaComSenha(esquemaDissolverGrupo), corpo);
    const chave = this.chave(req);
    const reautenticadoEm = await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.servico()
      .dissolver(this.ator(req), grupo, p.dados.motivo, { chaveIdempotencia: chave, reautenticadoEm })
      .catch((e: unknown) => this.problema(e));
  }
}
