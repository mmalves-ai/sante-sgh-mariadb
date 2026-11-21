// W1-01 (parte 9b): API das CONTAS DORMENTES (gestor de acessos, mesma permissão das telas de acesso).
//   GET  /api/acesso/gestao/contas-dormentes             prévia de hoje, poupadas, exceções vigentes e histórico
//   POST /api/acesso/gestao/contas-dormentes/excecoes    incluir, trocar o prazo ou retirar a exceção (reautenticação)
//   POST /api/acesso/gestao/contas-dormentes/rodar       rodar agora (bloqueio pelo executor; reautenticação)
// A exceção grava a linha nova do histórico de exceções com a trilha (motivo e valor anterior) na mesma transação; a
// rodada bloqueia pelo executor (acesso.bloquearUsuario) e registra cada bloqueio e a rodada na trilha. Nada de senha,
// hash ou dado de pessoa na resposta: só login, tipo, dias e situação. O despertar diário liga no onModuleInit.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
  Post,
  Req,
} from '@nestjs/common';
import {
  type ContaDormenteTela,
  type ContasDormentesGestaoTela,
  EVENTOS_AUDITAVEIS,
  esquemaExcecaoDormencia,
  esquemaRodarContasDormentes,
  PERMISSOES_ACESSO,
  type RodadaContasDormentesTela,
} from '@sgh/contratos';
import type { ContaDormente } from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';
import type { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema, tipoPorStatus } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from './acesso.controller.js';
import {
  type DespertarContasDormentes,
  SERVICO_CONTAS_DORMENTES,
  type ServicoContasDormentes,
} from './contas-dormentes.js';
import { FONTE_GESTAO, type FonteGestao } from './gestao-fonte.js';
import { excecoesDormenciaVigentes } from './historico-vigente.js';

export const DESPERTAR_CONTAS_DORMENTES = Symbol('DESPERTAR_CONTAS_DORMENTES');

const tela = (c: ContaDormente): ContaDormenteTela => ({
  login: c.login,
  tipo: c.tipo,
  situacao: c.situacao,
  diasSemAcesso: c.diasSemAcesso,
  limiteDias: c.limiteDias,
  ultimoAcesso: c.ultimoAcesso,
  ...(c.motivoExcecao ? { motivoExcecao: c.motivoExcecao } : {}),
});

@Controller('acesso/gestao/contas-dormentes')
export class ContasDormentesController implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(FONTE_GESTAO) private readonly fonte: FonteGestao,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional()
    @Inject(SERVICO_CONTAS_DORMENTES)
    private readonly dormentes: ServicoContasDormentes | null = null,
    @Optional()
    @Inject(DESPERTAR_CONTAS_DORMENTES)
    private readonly despertar: DespertarContasDormentes | null = null,
  ) {}

  onModuleInit(): void {
    this.despertar?.iniciar();
  }

  onModuleDestroy(): void {
    this.despertar?.parar();
  }

  /** Para os testes: o despertar deste controlador (null sem ele). */
  get despertarDormentes(): DespertarContasDormentes | null {
    return this.despertar;
  }

  private servico(): ServicoContasDormentes {
    if (!this.dormentes) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    return this.dormentes;
  }

  private sessao(req: RequisicaoAutorizada): { rede: string; hospital: string; login: string } {
    const s = req.sgh?.sessao;
    if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login)
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return { rede: s.rede, hospital: s.estabelecimentoAtivo, login: s.usuario.login };
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

  private problema(e: unknown): never {
    if (e instanceof ErroProblema) throw e;
    if (e instanceof ErroOperacao) {
      const p = e.problema;
      const tipo = p.status === 409 ? 'recusa-de-negocio' : tipoPorStatus(p.status);
      throw new ErroProblema(tipo, p.status, p.title, p.detail, p.codigo ? { codigo: p.codigo } : {});
    }
    throw e;
  }

  @Get()
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async ler(@Req() req: RequisicaoAutorizada): Promise<ContasDormentesGestaoTela> {
    const s = this.servico();
    const { rede, hospital } = this.sessao(req);
    const [a, historico] = await Promise.all([
      s.previa(rede, hospital).catch((e: unknown) => this.problema(e)),
      this.fonte.historicoExcecoesDormencia(rede, hospital).catch((e: unknown) => this.problema(e)),
    ]);
    return {
      hoje: a.hoje,
      parametros: { ...a.parametros },
      previa: a.previa.map(tela),
      poupadas: a.poupadas.map(tela),
      excecoes: excecoesDormenciaVigentes(historico).map((x) => ({
        login: x.login,
        ate: x.ate,
        motivo: x.motivo,
      })),
      historico: historico.map((x) => ({
        login: x.login,
        ate: x.ate,
        situacao: x.situacao,
        motivo: x.motivo,
        criadoPor: x.criadoPor,
        criadoEm: x.criadoEm?.toISOString() ?? null,
      })),
      bloqueio: { ...s.bloqueio(hospital) },
    };
  }

  @Post('excecoes')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'exceção de dormência e trilha (motivo e valor anterior) na mesma transação (memória: registrador da API)',
  )
  async excecao(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: string; anterior: string | null; atual: string | null; destino: 'banco' | 'memoria' }> {
    this.servico();
    const p = this.analisar(esquemaExcecaoDormencia, corpo);
    const { rede, hospital, login } = this.sessao(req);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    const r = await this.fonte
      .registrarExcecaoDormencia(
        rede,
        hospital,
        {
          hospital,
          login: p.login,
          ate: p.retirar ? null : p.ate,
          retirar: p.retirar,
          motivo: p.motivo,
          por: login,
        },
        {
          rede,
          hospital,
          usuario: login,
          evento: EVENTOS_AUDITAVEIS.contaDormenteExcecao.codigo,
          recurso: 'acesso.usuario',
          operacao: 'acesso.excecaoContaDormente',
          resultado: 'sucesso',
          estacao: estacaoDaRequisicao(req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(req, 'acesso-dormentes').slice(0, 64),
        },
      )
      .catch((e: unknown) => this.problema(e));
    return { ...r, destino: this.fonte.destino === 'memoria' ? 'memoria' : 'banco' };
  }

  @Post('rodar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'cada bloqueio (acesso.conta-dormente.bloqueada) e a rodada (acesso.contas-dormentes.rodada) na trilha pela rotina',
  )
  async rodar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<RodadaContasDormentesTela> {
    const s = this.servico();
    const p = this.analisar(esquemaRodarContasDormentes, corpo);
    const { rede, hospital } = this.sessao(req);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    try {
      const r = await s.rodada(rede, hospital);
      return {
        hoje: r.hoje,
        ligada: r.ligada,
        motivo: r.motivo,
        bloqueadas: r.bloqueadas.map(tela),
        poupadas: r.poupadas.map(tela),
        falhas: r.falhas,
      };
    } catch (e) {
      if (e instanceof Error && e.message === 'rodada-em-andamento')
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Rodada em andamento',
          'Aguarde a rodada atual terminar.',
          {
            codigo: 'rodada-em-andamento',
          },
        );
      return this.problema(e);
    }
  }
}
