// W1-01 (parte 11d; mercado l; D-W101-46): conferência do conselho no vínculo usuário–profissional (ficha do usuário).
//   GET  /api/acesso/gestao/usuarios/:login/conselho                registros do papel ativo, a última conferência de
//                                                                  cada, o efeito nos atos privativos e o histórico
//   POST /api/acesso/gestao/usuarios/:login/conselho/conferencias   conferência nova (situação, dia da consulta, fonte,
//                                                                  observação; reautenticação em diálogo)
// Grava SGH_ACESSO_CONSELHO_CONFER (1211) com a trilha (quem, observação e o valor anterior) na mesma transação SGH_;
// a autorização do usuário é recalculada na hora (o bloqueio dos atos privativos segue o parâmetro
// acesso.conselho.bloqueioAtosPrivativos). Ninguém confere o próprio registro (segregação). A consulta automática ao
// conselho fica desligada: depende de convênio ou credencial de consulta com cada conselho (dono).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  type ConselhoUsuarioTela,
  EVENTOS_AUDITAVEIS,
  esquemaConferirConselho,
  esquemaLogin,
  PERMISSOES_ACESSO,
} from '@sgh/contratos';
import {
  avaliarRegistroConselho,
  conselhoEfetivo,
  PADRAO_CONSELHO,
  type ParametrosConselho,
} from '@sgh/dominio-acesso';
import { conferenciasConselhoVigentes, ErroOperacao } from '@sgh/legado';
import { hojeNoEstabelecimento } from '../../autorizacao/conselho.js';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema, tipoPorStatus } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from './acesso.controller.js';
import { FONTE_GESTAO, type FonteGestao } from './gestao-fonte.js';

export const MOTIVO_CONSULTA_AUTOMATICA =
  'A consulta automática ao conselho depende do convênio ou da credencial de consulta com cada conselho (dono): até lá, a conferência é feita pela pessoa na fonte e registrada aqui.';

@Controller('acesso/gestao/usuarios/:login/conselho')
export class ConselhoGestaoController {
  constructor(
    @Inject(FONTE_GESTAO) private readonly fonte: FonteGestao,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  private gestor(req: RequisicaoAutorizada): { rede: string; hospital: string; login: string } {
    const s = req.sgh?.sessao;
    if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login)
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return { rede: s.rede, hospital: s.estabelecimentoAtivo, login: s.usuario.login };
  }

  private alvo(login: string): string {
    const r = esquemaLogin.safeParse(login);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Login inválido.');
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

  private async parametros(rede: string, hospital: string): Promise<ParametrosConselho> {
    const regra = this.sessoes?.servicoAutorizacao?.regraDoConselho ?? null;
    return regra ? regra(rede, hospital).catch(() => PADRAO_CONSELHO) : PADRAO_CONSELHO;
  }

  private async tela(
    rede: string,
    hospital: string,
    gestor: string,
    login: string,
  ): Promise<ConselhoUsuarioTela> {
    const u = await this.fonte.usuario(rede, hospital, login).catch((e: unknown) => this.problema(e));
    if (!u) throw new ErroProblema('nao-encontrado', 404, 'Usuário não encontrado');
    const [registros, historico, p] = await Promise.all([
      this.fonte.registrosConselho(rede, hospital, login).catch((e: unknown) => this.problema(e)),
      this.fonte.conferenciasConselho(rede, hospital, login).catch((e: unknown) => this.problema(e)),
      this.parametros(rede, hospital),
    ]);
    const hoje = hojeNoEstabelecimento(Date.now());
    const vigentes = conferenciasConselhoVigentes(historico);
    const avaliados = registros.map((r) => {
      const c = vigentes.get(r.registro) ?? null;
      const a = avaliarRegistroConselho(c, p, hoje);
      return {
        registro: r.registro,
        sigla: r.sigla,
        numero: r.numero,
        uf: r.uf,
        ocupacao: r.ocupacao,
        estado: a.estado,
        liberaAtosPrivativos: a.libera,
        motivo: a.motivo,
        ultima: c ? { situacao: c.situacao, conferidoEm: c.conferidoEm, fonte: c.fonte } : null,
      };
    });
    const efeito = conselhoEfetivo(
      registros.length > 0,
      registros.map((r) => {
        const c = vigentes.get(r.registro);
        return {
          registro: r.registro,
          conferencia: c ? { situacao: c.situacao, conferidoEm: c.conferidoEm } : null,
        };
      }),
      p,
      hoje,
    );
    return {
      login,
      parametros: {
        bloqueio: p.bloqueio,
        validadeDias: p.validadeDias,
        // Ligar o parâmetro não basta: sem o conector, a consulta automática continua desligada.
        consultaAutomatica: false,
        motivoConsultaAutomatica: MOTIVO_CONSULTA_AUTOMATICA,
      },
      registros: avaliados,
      atosPrivativos: efeito.conselho,
      motivoBloqueio: efeito.motivo,
      historico: historico.map((x) => ({
        id: x.id,
        registro: x.registro,
        situacao: x.situacao,
        conferidoEm: x.conferidoEm,
        fonte: x.fonte,
        observacao: x.observacao,
        criadoPor: x.criadoPor,
        criadoEm: x.criadoEm?.toISOString() ?? null,
      })),
      podeConferir: registros.length > 0 && gestor !== login,
    };
  }

  @Get()
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async ler(@Param('login') login: string, @Req() req: RequisicaoAutorizada): Promise<ConselhoUsuarioTela> {
    const g = this.gestor(req);
    return this.tela(g.rede, g.hospital, g.login, this.alvo(login));
  }

  @Post('conferencias')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'SGH_ACESSO_CONSELHO_CONFER e SGH_TRILHA (acesso.conselho.conferido: quem, observação e valor anterior) na mesma transação SGH_ (memória: registrador da API)',
  )
  async conferir(
    @Param('login') login: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    id: string;
    anterior: string | null;
    atual: string;
    destino: 'legado' | 'memoria';
    tela: ConselhoUsuarioTela;
  }> {
    const alvo = this.alvo(login);
    const r = esquemaConferirConselho.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        r.error.issues[0]?.message ?? undefined,
      );
    const g = this.gestor(req);
    if (g.login === alvo)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Operação recusada',
        'Ninguém confere o próprio registro no conselho (segregação de funções).',
        { codigo: 'propria-conferencia' },
      );
    await reautenticar(this.sessoes, this.resolvedor, req, r.data.senha);
    const feito = await this.fonte
      .registrarConferenciaConselho(
        g.rede,
        g.hospital,
        {
          hospital: g.hospital,
          login: alvo,
          registro: r.data.registro,
          situacao: r.data.situacao,
          conferidoEm: r.data.conferidoEm,
          fonte: r.data.fonte,
          observacao: r.data.observacao,
          por: g.login,
          hoje: hojeNoEstabelecimento(Date.now()),
        },
        {
          rede: g.rede,
          hospital: g.hospital,
          usuario: g.login,
          evento: EVENTOS_AUDITAVEIS.conselhoConferido.codigo,
          recurso: 'acesso.usuario',
          operacao: 'acesso.conferirConselho',
          resultado: 'sucesso',
          estacao: estacaoDaRequisicao(req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(req, 'acesso-conselho').slice(0, 64),
        },
      )
      .catch((e: unknown) => this.problema(e));
    // A permissão dos atos privativos muda na hora (sem esperar os 3 min do cache).
    await this.sessoes?.servicoAutorizacao?.invalidar(g.rede, g.hospital, alvo).catch(() => undefined);
    return {
      ...feito,
      destino: this.fonte.destino,
      tela: await this.tela(g.rede, g.hospital, g.login, alvo),
    };
  }
}
