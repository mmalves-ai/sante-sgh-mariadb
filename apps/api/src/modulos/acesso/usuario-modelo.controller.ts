// W1-01 (parte 12a; mercado n): "Aplicar acessos de…" a partir de um usuário-modelo, na ficha do usuário.
//   POST /api/acesso/gestao/usuarios/:login/modelo/previa   a diferença (grupo, papéis SBIS, perfis do Sante), sem gravar
//   POST /api/acesso/gestao/usuarios/:login/modelo/aplicar  grava o plano que a prévia mostrou (motivo e senha)
// A regra é a do domínio (planoDoModelo, conferirAplicarModelo; D-W101-47): privilégio de gestão só nominal, perfil do
// conselho não se copia, pares segregados não se acumulam, ninguém no próprio acesso. Cada passo grava pela via de
// sempre: grupo e papel SBIS pela receita do executor do legado (TBUSERS.GRUPO, TBUSERS_TBPAPEL, com a trilha do
// legado), perfil do Sante em SGH_ACESSO_PERFIL_USUARIO com a SGH_TRILHA. Os passos não formam uma transação só
// (legado e SGH_ são gravações distintas): o resultado diz, passo a passo, o que foi feito e o que foi recusado.
import { createHash, randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  esquemaAplicarModelo,
  esquemaLogin,
  esquemaPreviaModelo,
  EVENTOS_AUDITAVEIS,
  type PassoModeloTela,
  PERMISSOES_ACESSO,
  type PreviaModeloTela,
  type ResultadoModeloTela,
} from '@sgh/contratos';
import {
  type ContaModelo,
  conferirAplicarModelo,
  type ModoModelo,
  passosDoPlano,
  type PlanoModelo,
  planoDoModelo,
  textoCanonicoDoPlano,
} from '@sgh/dominio-acesso';
import { type ContextoOperacao, ErroOperacao, type TrilhaGestao } from '@sgh/legado';
import type { z } from 'zod';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from './acesso.controller.js';
import { FONTE_GESTAO, type FonteGestao } from './gestao-fonte.js';
import { PERFIS_DA_TELA } from './gestao.controller.js';
import { exigirGestorRestante } from './ultimo-gestor.js';

interface Lido {
  readonly conta: ContaModelo;
  readonly id: number;
}

@Controller('acesso/gestao/usuarios/:login/modelo')
export class UsuarioModeloController {
  constructor(
    @Inject(FONTE_GESTAO) private readonly fonte: FonteGestao,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

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

  private alvo(bruto: string): string {
    const r = esquemaLogin.safeParse(bruto);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Login inválido');
    return r.data;
  }

  /** A conta ao vivo: grupo, papéis SBIS e as concessões nominais não revogadas que ainda valem (ou começam). */
  private async ler(rede: string, hospital: string, login: string, agora: number): Promise<Lido> {
    const u = await this.fonte.usuario(rede, hospital, login);
    if (!u) throw new ErroProblema('nao-encontrado', 404, 'Usuário não encontrado', `Login ${login}.`);
    const [papeis, historico] = await Promise.all([
      this.fonte.papeisDoUsuario(rede, hospital, login),
      this.fonte.historicoPerfis(rede, hospital, login),
    ]);
    return {
      id: u.id,
      conta: {
        login: u.login,
        ativo: u.ativo,
        bloqueado: u.bloqueado,
        grupo: u.grupo,
        papeis: papeis.map((p) => ({ papel: p.papel, nome: p.nome, ativo: p.ativo })),
        perfis: historico
          .filter((h) => !h.revogadoEm && (!h.fim || h.fim.getTime() > agora))
          .map((h) => ({ id: h.id, perfil: h.perfil, fim: h.fim?.toISOString() ?? null })),
      },
    };
  }

  /** Lê as duas contas, confere a segregação e calcula o plano (o mesmo na prévia e na gravação). */
  private async planejar(
    req: RequisicaoAutorizada,
    alvoLogin: string,
    modeloLogin: string,
    modo: ModoModelo,
  ): Promise<{ plano: PlanoModelo; conferencia: string; alvo: Lido }> {
    const { rede, hospital, login: operador } = this.sessao(req);
    const a = this.servico?.servicoAutorizacao;
    if (!a) throw new ErroProblema('indisponivel', 503, 'Serviço de permissões indisponível');
    const agora = Date.now();
    const [alvo, modelo, grupos, eu] = await Promise.all([
      this.ler(rede, hospital, alvoLogin, agora),
      this.ler(rede, hospital, modeloLogin, agora),
      this.fonte.grupos(rede, hospital),
      a.explicar(hospital, operador, rede),
    ]);
    const recusa = conferirAplicarModelo(
      { login: operador, perfis: [...eu.origensPerfis.keys()] },
      modelo.conta,
      alvo.conta,
    );
    if (recusa)
      throw new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', recusa.mensagem, {
        codigo: recusa.codigo,
      });
    const ativos = new Set(grupos.filter((g) => g.ativo).map((g) => g.nome));
    const plano = planoDoModelo(modelo.conta, alvo.conta, modo, ativos);
    // Perfil que a tela não oferece (fora do catálogo) não se concede por modelo.
    const conceder = plano.perfisConceder.filter((p) => PERFIS_DA_TELA.includes(p.perfil));
    const final: PlanoModelo =
      conceder.length === plano.perfisConceder.length ? plano : { ...plano, perfisConceder: conceder };
    const conferencia = createHash('sha256')
      .update(textoCanonicoDoPlano(modelo.conta.login, alvo.conta.login, modo, final))
      .digest('hex');
    return { plano: final, conferencia, alvo };
  }

  @Post('previa')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.mapaConsultado.codigo)
  async previa(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PreviaModeloTela> {
    const alvo = this.alvo(bruto);
    const p = this.analisar(esquemaPreviaModelo, corpo);
    const { plano, conferencia } = await this.planejar(req, alvo, p.modelo, p.modo);
    return {
      alvo,
      modelo: p.modelo,
      modo: p.modo,
      ...plano,
      passos: passosDoPlano(plano),
      conferencia,
    };
  }

  @Post('aplicar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.modeloAplicado.codigo)
  async aplicar(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoModeloTela> {
    const alvoLogin = this.alvo(bruto);
    const p = this.analisar(esquemaAplicarModelo, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    const { plano, conferencia, alvo } = await this.planejar(req, alvoLogin, p.modelo, p.modo);
    if (conferencia !== p.conferencia)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Prévia desatualizada',
        'Os acessos do modelo ou do usuário mudaram depois da prévia: confira a diferença de novo.',
        { codigo: 'previa-desatualizada' },
      );
    if (passosDoPlano(plano) === 0)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Nada a aplicar',
        'O usuário já tem os acessos do modelo.',
        {
          codigo: 'nada-a-aplicar',
        },
      );
    const reautenticadoEm = await reautenticar(this.servico, this.resolvedor, req, p.senha);
    const motivo = `Acessos de ${p.modelo}: ${p.motivo}`.slice(0, 200);
    const estacao = estacaoDaRequisicao(req).slice(0, 80);
    const correlacao = correlacaoDaRequisicao(req, 'acesso-modelo').slice(0, 64);
    const ctx = (): ContextoOperacao => ({
      rede,
      hospital,
      traceId: correlacao,
      usuarioLegado: operador,
      idempotencyKey: `modelo:${randomUUID()}`,
      estacao,
      reautenticadoEm,
    });
    const trilha = (evento: string, operacao: string): TrilhaGestao => ({
      rede,
      hospital,
      usuario: operador,
      evento,
      recurso: 'acesso.perfil',
      operacao,
      resultado: 'sucesso',
      estacao,
      correlacao,
    });
    const passos: PassoModeloTela[] = [];
    const passo = async (acao: PassoModeloTela['acao'], item: string, f: () => Promise<unknown>) => {
      try {
        await f();
        passos.push({ acao, item, feito: true, erro: null });
      } catch (e: unknown) {
        passos.push({ acao, item, feito: false, erro: mensagemDoErro(e) });
      }
    };
    const executar = (op: string, entrada: unknown) => this.fonte.executar(op, hospital, entrada, ctx());
    const login = alvo.conta.login;

    if (plano.grupo) {
      const grupo = plano.grupo.para;
      await passo('trocar-grupo', grupo, async () => {
        await exigirGestorRestante(this.fonte, rede, hospital, {
          tipo: 'trocar-grupo',
          login,
          grupoNovo: grupo,
        });
        await executar('acesso.trocarGrupoUsuario', { login, grupo });
      });
    }
    for (const x of plano.papeisRetirar)
      await passo('retirar-papel', `${x.papel} ${x.nome}`, async () => {
        await exigirGestorRestante(this.fonte, rede, hospital, {
          tipo: 'retirar-papel',
          login,
          papel: x.papel,
        });
        await executar('acesso.revogarPapelUsuario', { login, papel: x.papel });
      });
    for (const x of plano.papeisReativar)
      await passo('reativar-papel', `${x.papel} ${x.nome}`, () =>
        executar('acesso.reativarPapelUsuario', { login, papel: x.papel }),
      );
    for (const x of plano.papeisConceder)
      await passo('conceder-papel', `${x.papel} ${x.nome}`, () =>
        executar('acesso.concederPapelUsuario', { login, papel: x.papel }),
      );
    for (const x of plano.perfisRetirar)
      await passo('retirar-perfil', x.perfil, async () => {
        await exigirGestorRestante(this.fonte, rede, hospital, { tipo: 'retirar-perfil', concessao: x.id });
        const r = await this.fonte.revogarPerfil(
          rede,
          hospital,
          x.id,
          operador,
          trilha(EVENTOS_AUDITAVEIS.perfilRevogado.codigo, 'acesso.revogarPerfil'),
          motivo,
        );
        if (!r) throw new ErroProblema('recusa-de-negocio', 409, 'Concessão já revogada');
      });
    for (const x of plano.perfisConceder)
      await passo('conceder-perfil', x.perfil, () =>
        this.fonte.concederPerfil(
          rede,
          hospital,
          {
            idUsuario: alvo.id,
            login,
            perfil: x.perfil,
            concedidoPor: operador,
            areaAprovou: req.sghComo?.modo === 'acesso-total' ? 'plataforma' : 'gestor-acessos',
            inicio: null,
            fim: x.fim ? new Date(x.fim) : null,
            motivo,
          },
          trilha(EVENTOS_AUDITAVEIS.perfilConcedido.codigo, 'acesso.concederPerfil'),
        ),
      );

    await this.servico?.servicoAutorizacao?.invalidar(rede, hospital, login);
    const feitos = passos.filter((x) => x.feito).length;
    return {
      alvo: login,
      modelo: p.modelo,
      passos,
      feitos,
      falhas: passos.length - feitos,
      destino: this.fonte.destino,
    };
  }
}

/** A recusa do passo para a pessoa: o detalhe do problema (nunca tabela nem valor). */
function mensagemDoErro(e: unknown): string {
  if (e instanceof ErroProblema) return e.detalhe ?? e.titulo;
  if (e instanceof ErroOperacao) return e.problema.detail ?? e.problema.title;
  return 'Não foi possível gravar este passo; tente de novo.';
}
