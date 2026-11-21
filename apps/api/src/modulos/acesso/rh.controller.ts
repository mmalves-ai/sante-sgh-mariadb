// W1-01 (parte 11a2): API do PROVISIONAMENTO PELO RH (gestor de acessos; mesma permissão das telas de acesso).
//   GET  /api/acesso/gestao/rh/tarefas            tarefas abertas (derivadas dos vínculos; D-W101-35) e as resolvidas
//   POST /api/acesso/gestao/rh/tarefas/resolver   {tipo, vinculo, ref, situacao, login|null, motivo, senha}
//   GET  /api/acesso/gestao/rh/perfis-cargo       mapa cargo -> perfil sugerido (vigente e histórico)
//   POST /api/acesso/gestao/rh/perfis-cargo       {cargo, perfil|null, motivo, senha} (linha nova; null retira)
// As tarefas são da regra do domínio (tarefas-rh.ts) sobre o que a fonte lê; a resolução grava pela fonte da gestão com a
// trilha na mesma transação, revalidando a regra sobre os dados relidos NESSA transação. "Suspender acesso" feita tem
// efeito na mesma requisição: bloqueio pelo executor (acesso.bloquearUsuario; as sessões do usuário caem), conferido
// antes de gravar (receita ligada, último gestor de acessos); se o efeito ainda falhar, a resposta diz que a resolução
// ficou registrada e o bloqueio não (código `efeito-pendente`). Os parâmetros acesso.provisionamentoRh.* vêm da
// configuração com a resolução por nível; sem ela, os padrões (PADRAO_RH).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Req } from '@nestjs/common';
import {
  definicaoParametro,
  EVENTOS_AUDITAVEIS,
  esquemaDefinirPerfilCargoRh,
  esquemaResolverTarefaRh,
  PERMISSOES_ACESSO,
  type PerfisCargoRhGestaoTela,
  type ResolucaoTarefaRhResultado,
  type TarefasRhGestaoTela,
} from '@sgh/contratos';
import {
  chaveCargoRh,
  PADRAO_RH,
  type ParametrosRh,
  type ResolucaoRhPedida,
  type TarefaRh,
  tarefasRh,
  validarResolucaoRh,
} from '@sgh/dominio-acesso';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { ErroOperacao } from '@sgh/nucleo';
import type { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema, tipoPorStatus } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/configuracao-fonte.js';
import { SERVICO_SESSAO } from './acesso.controller.js';
import { FONTE_GESTAO, type FonteGestao } from './gestao-fonte.js';
import { PERFIS_DA_TELA } from './gestao.controller.js';
import { perfilPorCargoVigente } from './perfil-cargo.js';
import type { DadosRhLidos } from './tipos-gestao-acesso.js';
import { exigirGestorRestante } from './ultimo-gestor.js';

export const OPERACAO_BLOQUEIO_RH = 'acesso.bloquearUsuario';
export const PARAMETROS_RH = {
  suspenderAfastamento: 'acesso.provisionamentoRh.suspenderAfastamento',
  diasMinimosAfastamento: 'acesso.provisionamentoRh.diasMinimosAfastamento',
} as const;
/** Resoluções mais novas devolvidas com a lista (as demais ficam consultáveis no banco). */
export const RESOLVIDAS_NA_LISTA = 100;

/** A linha de trilha que a fonte da gestão grava com a resolução (o formato é o da fonte). */
type TrilhaGestao = Parameters<FonteGestao['resolverTarefaRh']>[3];
/** O contexto das operações da conta pela fonte da gestão. */
type ContextoGestao = Parameters<FonteGestao['executar']>[3];
const FUSO = 'America/Sao_Paulo';

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** As tarefas abertas pela regra do domínio sobre os dados lidos. */
export function tarefasDosDados(dados: DadosRhLidos, hoje: string, parametros: ParametrosRh): TarefaRh[] {
  return tarefasRh({
    hoje,
    vinculos: dados.vinculos,
    mudancas: dados.mudancas,
    afastamentos: dados.afastamentos,
    resolucoes: dados.resolucoes,
    perfilPorCargo: perfilPorCargoVigente(dados.perfisCargo),
    parametros,
  });
}

/**
 * Revisão (achado 1): o login de 'criar-acesso' feita passa a SER o usuário do vínculo; um login já ligado a outro
 * vínculo ativo (pela gestão de pessoas ou por outra criação) é recusado, senão duas pessoas dividiriam a revisão e a
 * suspensão de um mesmo acesso.
 */
export function loginDeOutroVinculo(
  dados: DadosRhLidos,
  pedido: Pick<ResolucaoRhPedida, 'tipo' | 'situacao' | 'vinculo' | 'login'>,
): { codigo: string; mensagem: string; campos: string[] } | null {
  if (pedido.tipo !== 'criar-acesso' || pedido.situacao !== 'feita' || !pedido.login) return null;
  const alvo = pedido.login.trim().toUpperCase();
  const outro = dados.vinculos.find(
    (v) => v.id !== pedido.vinculo && (v.login ?? '').trim().toUpperCase() === alvo,
  );
  return outro
    ? {
        codigo: 'login-de-outro-vinculo',
        mensagem: `Este login já é o acesso de outro vínculo (${outro.nome}): informe o login criado para esta pessoa.`,
        campos: ['login'],
      }
    : null;
}

@Controller('acesso/gestao/rh')
export class RhAcessoController {
  /** O relógio (os testes simulam o tempo). */
  agora: () => number = () => Date.now();

  constructor(
    @Inject(FONTE_GESTAO) private readonly fonte: FonteGestao,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional()
    @Inject(FONTE_CONFIGURACAO)
    private readonly configuracao: Pick<FonteConfiguracao, 'valoresParametro'> | null = null,
  ) {}

  private hoje(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(this.agora()));
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
      throw new ErroProblema(tipo, p.status, p.title, p.detail, {
        ...(p.codigo ? { codigo: p.codigo } : {}),
        ...(p.campos?.length ? { campos: p.campos } : {}),
      });
    }
    throw e;
  }

  private recusa(codigo: string, mensagem: string, campos: readonly string[] = []): never {
    throw new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
      codigo,
      ...(campos.length ? { campos } : {}),
    });
  }

  private trilha(req: RequisicaoAutorizada, evento: string, operacao: string): TrilhaGestao {
    const { rede, hospital, login } = this.sessao(req);
    return {
      rede,
      hospital,
      usuario: login,
      evento,
      recurso: 'acesso.usuario',
      operacao,
      resultado: 'sucesso',
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(req, 'acesso-rh').slice(0, 64),
    };
  }

  /** Os dois parâmetros do estabelecimento, cada um caindo no padrão quando não resolve. */
  async parametros(rede: string, hospital: string): Promise<ParametrosRh> {
    const valores = this.configuracao
      ? await this.configuracao.valoresParametro(rede, hospital).catch(() => null)
      : null;
    const ler = (chave: string): unknown => {
      const def = definicaoParametro(chave);
      if (!def) return null;
      try {
        if (!valores) return valorTipado(def, def.padrao);
        return valorTipado(
          def,
          resolverParametro(
            def,
            valores,
            { rede, empresa: null, estabelecimento: hospital, unidade: null, perfis: [], usuario: '' },
            new Date(this.agora()),
          ).valor,
        );
      } catch {
        return null;
      }
    };
    const s = ler(PARAMETROS_RH.suspenderAfastamento);
    const d = ler(PARAMETROS_RH.diasMinimosAfastamento);
    return {
      suspenderAfastamento: typeof s === 'boolean' ? s : PADRAO_RH.suspenderAfastamento,
      diasMinimosAfastamento:
        typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 365
          ? d
          : PADRAO_RH.diasMinimosAfastamento,
    };
  }

  private async dados(rede: string, hospital: string): Promise<DadosRhLidos> {
    return this.fonte.dadosRh(rede, hospital).catch((e: unknown) => this.problema(e));
  }

  @Get('tarefas')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async tarefas(@Req() req: RequisicaoAutorizada): Promise<TarefasRhGestaoTela> {
    const { rede, hospital } = this.sessao(req);
    const hoje = this.hoje();
    const parametros = await this.parametros(rede, hospital);
    const dados = await this.dados(rede, hospital);
    const loginDe = new Map(dados.vinculos.map((v) => [v.id, v.login]));
    const b = this.fonte.receita(OPERACAO_BLOQUEIO_RH, hospital);
    return {
      hoje,
      tarefas: tarefasDosDados(dados, hoje, parametros).map((t) => ({
        tipo: t.tipo,
        vinculo: t.vinculo,
        ref: t.ref,
        nome: t.nome,
        cargo: t.cargo,
        setor: t.setor,
        desde: t.desde,
        login: loginDe.get(t.vinculo) ?? null,
        perfilSugerido: t.perfilSugerido,
        detalhe: [...t.detalhe],
      })),
      resolvidas: dados.resolucoes.slice(0, RESOLVIDAS_NA_LISTA).map((r) => ({
        id: r.id,
        tipo: r.tipo,
        vinculo: r.vinculo,
        ref: r.ref,
        situacao: r.situacao,
        login: r.login,
        motivo: r.motivo,
        resolvidoPor: r.resolvidoPor,
        resolvidoEm: iso(r.resolvidoEm),
      })),
      parametros: { ...parametros },
      bloqueio: { ligada: b.ligada, motivo: b.motivo ?? null },
    };
  }

  @Post('tarefas/resolver')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'a resolução e a trilha na mesma transação da fonte da gestão; suspender feita: bloqueio pelo executor do núcleo',
  )
  async resolver(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResolucaoTarefaRhResultado> {
    const p = this.analisar(esquemaResolverTarefaRh, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    const hoje = this.hoje();
    const parametros = await this.parametros(rede, hospital);
    let pedido: ResolucaoRhPedida = {
      tipo: p.tipo,
      vinculo: p.vinculo,
      ref: p.ref.trim(),
      situacao: p.situacao,
      motivo: p.motivo,
      login: p.login?.trim() || null,
    };
    // A regra responde antes da senha e antes de gravar: nada fica resolvido sem o efeito poder correr.
    const dados = await this.dados(rede, hospital);
    const v = validarResolucaoRh(tarefasDosDados(dados, hoje, parametros), pedido);
    if (!v.ok) this.recusa(v.recusa, v.mensagem, v.campos);
    if (pedido.tipo === 'criar-acesso' && pedido.situacao === 'feita' && pedido.login) {
      const u = await this.fonte
        .usuario(rede, hospital, pedido.login)
        .catch((e: unknown) => this.problema(e));
      if (!u)
        this.recusa(
          'login-inexistente',
          'Este usuário não existe: crie o acesso na ficha nova e informe o login criado.',
          ['login'],
        );
      // O login gravado na resolução é o do cadastro (a leitura dos vínculos o liga à conta por igualdade).
      pedido = { ...pedido, login: u.login.trim() };
      const outro = loginDeOutroVinculo(dados, pedido);
      if (outro) this.recusa(outro.codigo, outro.mensagem, outro.campos);
    }
    const suspender = pedido.tipo === 'suspender-acesso' && pedido.situacao === 'feita';
    const alvo = suspender ? (dados.vinculos.find((x) => x.id === pedido.vinculo)?.login ?? null) : null;
    let jaBloqueado = false;
    if (suspender) {
      if (!alvo) this.recusa('sem-usuario', 'O vínculo não tem usuário do sistema para suspender.');
      const b = this.fonte.receita(OPERACAO_BLOQUEIO_RH, hospital);
      if (!b.ligada)
        throw new ErroProblema('operacao-bloqueada', 409, 'Operação desligada', b.motivo ?? undefined, {
          codigo: 'operacao-desligada',
        });
      const u = await this.fonte.usuario(rede, hospital, alvo).catch((e: unknown) => this.problema(e));
      jaBloqueado = u?.bloqueado === true;
      if (!jaBloqueado)
        await exigirGestorRestante(this.fonte, rede, hospital, { tipo: 'bloquear', login: alvo });
    }
    const reautenticadoEm = await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    const g = await this.fonte
      .resolverTarefaRh(
        rede,
        hospital,
        { hospital, ...pedido, motivo: pedido.motivo.trim(), por: operador },
        this.trilha(req, EVENTOS_AUDITAVEIS.rhTarefaResolvida.codigo, 'acesso.resolverTarefaRh'),
        (relidos) => {
          const r = validarResolucaoRh(tarefasDosDados(relidos, hoje, parametros), pedido);
          if (!r.ok) return { codigo: r.recusa, mensagem: r.mensagem, campos: r.campos };
          return loginDeOutroVinculo(relidos, pedido);
        },
      )
      .catch((e: unknown) => this.problema(e));
    let bloqueado = false;
    if (suspender && alvo && !jaBloqueado) {
      try {
        const ctx: ContextoGestao = {
          rede,
          hospital,
          usuario: operador,
          correlacao: correlacaoDaRequisicao(req, 'acesso-rh').slice(0, 64),
          chaveIdempotencia: `rh-${pedido.vinculo}-${pedido.ref}`.slice(0, 80),
          estacao: estacaoDaRequisicao(req).slice(0, 80),
          reautenticadoEm,
        };
        await this.fonte.executar(OPERACAO_BLOQUEIO_RH, hospital, { login: alvo }, ctx);
        await this.sessoes?.revogarSessoesDoUsuario(rede, hospital, alvo);
        await this.sessoes?.servicoAutorizacao?.invalidar(rede, hospital, alvo).catch(() => undefined);
        bloqueado = true;
      } catch (e) {
        const detalhe =
          e instanceof ErroOperacao
            ? e.problema.detail
            : e instanceof ErroProblema
              ? e.message
              : 'falha interna';
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Efeito não aplicado',
          `A resolução ficou registrada, mas o bloqueio não foi aplicado: ${detalhe ?? ''} Bloqueie pela ficha do usuário.`,
          { codigo: 'efeito-pendente' },
        );
      }
    }
    return { id: g.id, bloqueado, destino: this.fonte.destino };
  }

  @Get('perfis-cargo')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async perfisCargo(@Req() req: RequisicaoAutorizada): Promise<PerfisCargoRhGestaoTela> {
    const { rede, hospital } = this.sessao(req);
    const dados = await this.dados(rede, hospital);
    const cargos = new Set<string>();
    for (const v of dados.vinculos) {
      if (v.cargo) cargos.add(chaveCargoRh(v.cargo));
      if (v.funcao) cargos.add(chaveCargoRh(v.funcao));
    }
    return {
      vigentes: perfilPorCargoVigente(dados.perfisCargo),
      historico: dados.perfisCargo.map((x) => ({
        id: x.id,
        cargo: x.cargo,
        perfil: x.perfil,
        situacao: x.situacao,
        motivo: x.motivo,
        criadoPor: x.criadoPor,
        criadoEm: iso(x.criadoEm),
      })),
      perfis: [...PERFIS_DA_TELA],
      cargos: [...cargos].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    };
  }

  @Post('perfis-cargo')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'o perfil do cargo e a trilha na mesma transação da fonte da gestão (memória: registrador da API)',
  )
  async definirPerfilCargo(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: string; anterior: string | null; perfil: string | null; destino: 'banco' | 'memoria' }> {
    const p = this.analisar(esquemaDefinirPerfilCargoRh, corpo);
    const { rede, hospital, login } = this.sessao(req);
    const cargo = chaveCargoRh(p.cargo);
    const perfil = p.perfil?.trim() || null;
    if (!cargo) this.recusa('cargo-invalido', 'Informe o cargo.', ['cargo']);
    if (perfil !== null && !PERFIS_DA_TELA.includes(perfil))
      this.recusa('perfil-desconhecido', 'Escolha um perfil da lista.', ['perfil']);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    const r = await this.fonte
      .definirPerfilCargoRh(
        rede,
        hospital,
        { hospital, cargo, perfil, motivo: p.motivo.trim(), por: login },
        this.trilha(req, EVENTOS_AUDITAVEIS.rhPerfilCargoDefinido.codigo, 'acesso.definirPerfilCargoRh'),
      )
      .catch((e: unknown) => this.problema(e));
    return { ...r, destino: this.fonte.destino };
  }
}
