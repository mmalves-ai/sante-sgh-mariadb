// Módulo do acesso (F2.2, onda 2): o saneamento dos perfis de acesso amplo e, com a fonte da gestão, o provisionamento
// pelo RH e o "aplicar acessos de um usuário-modelo". Com o núcleo, a porta e o executor próprios (MariaDB pelo
// @sgh/nucleo); sem núcleo, a porta sintética só em dev/ci; fora disso, nada do saneamento é montado e a rota responde
// 503 pelo próprio controlador (falha fechada) — a mesma regra do F2-L.
// A fonte da gestão (FONTE_GESTAO) é a do lote da gestão do acesso (gestao-fonte-propria.ts com o núcleo; a de memória
// em dev/ci sem núcleo): sem nenhuma das duas, os controladores do RH e do usuário-modelo não são montados.
// Integração da onda 2 (ondas finais): com a fonte da gestão, também a gestão, a recertificação, os pedidos de acesso,
// a consulta do acesso, a comunicação (mensagens, comunicados, avisos), as contas dormentes e o conselho; a identidade
// (segundo fator) pela porta própria; as contas do banco pela porta própria. Fica fora a emergência ("quebra de
// vidro"), que depende do alerta ao auditor e do vínculo assistencial ainda sem dono registrado.
import { chaveMestra } from '@sgh/dominio-acesso';
import { randomBytes } from 'node:crypto';
import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/configuracao-fonte.js';
import type { ContextoModulo } from '../registro.js';
import { parteComunicacaoDoAcesso } from './comunicacao-modulo.js';
import { ConsultaAcessoController } from './consulta.controller.js';
import { ContasBancoController } from './contas-banco/contas-banco.controller.js';
import type { PortaContasBanco } from './contas-banco/porta.js';
import { PORTA_CONTAS_BANCO } from './contas-banco/porta.js';
import { PortaContasBancoMemoria } from './contas-banco/porta-memoria.js';
import {
  contasSghDoAmbiente,
  PortaContasBancoPropria,
  portaContasBancoIndisponivel,
} from './contas-banco/porta-propria.js';
import { GestaoAcessoController } from './gestao.controller.js';
import { FONTE_GESTAO, type FonteGestao, fonteGestaoMemoria } from './gestao-fonte.js';
import { IdentidadeController, SERVICO_IDENTIDADE } from './identidade/identidade.controller.js';
import { PortaIdentidadePropria } from './identidade/porta-identidade-propria.js';
import { portaIdentidadeSintetica } from './identidade/porta-identidade-sintetica.js';
import { type PortaIdentidade, ServicoIdentidade } from './identidade/servico-identidade.js';
import { NUCLEO_ACESSO } from './legado-acesso.js';
import { PedidosAcessoController, PedidosAcessoGestaoController } from './pedido-acesso.controller.js';
import { RecertificacaoController } from './recertificacao.controller.js';
import { fonteGestaoPropria } from './gestao-fonte-propria.js';
import { RhAcessoController } from './rh.controller.js';
import { administradoresMaximoPelaConfiguracao } from './saneamento/parametro.js';
import type { PortaSaneamento } from './saneamento/porta.js';
import { ExecutorSaneamentoProprio, PortaSaneamentoPropria } from './saneamento/porta-propria.js';
import { PortaSaneamentoSintetica } from './saneamento/porta-sintetica.js';
import { SaneamentoController, SERVICO_SANEAMENTO } from './saneamento/saneamento.controller.js';
import { type ExecutorSaneamento, ServicoSaneamento } from './saneamento/servico.js';
import { UsuarioModeloController } from './usuario-modelo.controller.js';

export interface OpcoesModuloAcesso {
  /** Testes: a porta do saneamento já montada. */
  readonly saneamento?: PortaSaneamento;
  /** Testes: o executor da aplicação do saneamento (null: sem gravação). */
  readonly executorSaneamento?: ExecutorSaneamento | null;
  /** A fonte da gestão do acesso (montagem do integrador ou testes). */
  readonly fonteGestao?: FonteGestao;
}

/** A porta e o executor do saneamento pela regra do módulo. */
export async function saneamentoDoModulo(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloAcesso = {},
): Promise<{ porta: PortaSaneamento | null; executor: ExecutorSaneamento | null }> {
  const cliente = ctx.configuracao.clientePadrao;
  if (opcoes.saneamento) return { porta: opcoes.saneamento, executor: opcoes.executorSaneamento ?? null };
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return {
      porta: new PortaSaneamentoPropria(ctx.nucleo, cliente),
      executor: opcoes.executorSaneamento ?? new ExecutorSaneamentoProprio(ctx.nucleo, cliente),
    };
  }
  // Dev/ci sem núcleo: o plano em memória sobre o estado sintético; a aplicação fica indisponível (503 com o motivo).
  if (!ctx.nucleo && fontesSinteticas(ctx.env))
    return { porta: new PortaSaneamentoSintetica(), executor: opcoes.executorSaneamento ?? null };
  return { porta: null, executor: null };
}

export async function moduloAcesso(ctx: ContextoModulo, opcoes: OpcoesModuloAcesso = {}): Promise<DynamicModule> {
  const { porta, executor } = await saneamentoDoModulo(ctx, opcoes);
  const servico: Provider = {
    provide: SERVICO_SANEAMENTO,
    inject: [{ token: FONTE_CONFIGURACAO, optional: true }],
    useFactory: (configuracao: FonteConfiguracao | null | undefined) =>
      porta
        ? new ServicoSaneamento({
            porta,
            executor,
            administradoresMaximo: administradoresMaximoPelaConfiguracao(() => configuracao ?? null),
            invalidar: async (rede, hospital, login) => {
              const a = ctx.servico?.servicoAutorizacao;
              if (!a) return;
              await (login ? a.invalidar(rede, hospital, login) : a.invalidarEstabelecimento(rede, hospital));
            },
          })
        : null,
  };
  const cliente = ctx.configuracao.clientePadrao;
  const gestao =
    opcoes.fonteGestao ??
    (ctx.nucleo && cliente
      ? fonteGestaoPropria(ctx.nucleo, cliente)
      : !ctx.nucleo && fontesSinteticas(ctx.env)
        ? fonteGestaoMemoria(ctx.trilha)
        : null);
  const comunicacao = parteComunicacaoDoAcesso(ctx, gestao);
  const controllers: Type[] = [SaneamentoController, ...comunicacao.controllers, ContasBancoController];
  if (gestao)
    controllers.push(
      RhAcessoController,
      UsuarioModeloController,
      GestaoAcessoController,
      RecertificacaoController,
      PedidosAcessoController,
      PedidosAcessoGestaoController,
      ConsultaAcessoController,
    );
  const identidade = identidadeDoModulo(ctx);
  if (identidade) controllers.push(IdentidadeController);
  const nucleo = ctx.nucleo;
  return {
    module: class ModuloAcesso {},
    // Global: a comunicação (PORTA_COMUNICACAO, AVISOS_INICIO) e a fonte da gestão servem aos módulos que avisam no sino.
    global: true,
    controllers,
    providers: [
      servico,
      ...comunicacao.providers,
      { provide: PORTA_CONTAS_BANCO, useValue: contasBancoDoModulo(ctx) },
      ...(identidade ? [{ provide: SERVICO_IDENTIDADE, useValue: identidade }] : []),
      ...(gestao
        ? [
            { provide: FONTE_GESTAO, useValue: gestao },
            {
              provide: NUCLEO_ACESSO,
              useValue:
                nucleo && cliente
                  ? { cliente, lerSomente: nucleo.lerSomente.bind(nucleo) as typeof nucleo.lerSomente }
                  : null,
            },
          ]
        : []),
    ],
    exports: [SERVICO_SANEAMENTO, PORTA_CONTAS_BANCO, ...comunicacao.exports, ...(gestao ? [FONTE_GESTAO] : [])],
  };
}

/** A porta das contas do banco pela regra do F2-L: própria com o núcleo, memória só em dev/ci sintético. */
function contasBancoDoModulo(ctx: ContextoModulo): PortaContasBanco {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) return new PortaContasBancoPropria(ctx.nucleo, cliente, contasSghDoAmbiente(ctx.env));
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaContasBancoMemoria();
  return portaContasBancoIndisponivel();
}

/** O serviço da identidade (segundo fator): porta própria com o núcleo; sintética só em dev/ci sem núcleo. */
function identidadeDoModulo(ctx: ContextoModulo): ServicoIdentidade | null {
  const cliente = ctx.configuracao.clientePadrao;
  const sintetica = !ctx.nucleo && fontesSinteticas(ctx.env);
  const porta: PortaIdentidade | null =
    ctx.nucleo && cliente ? new PortaIdentidadePropria(ctx.nucleo, cliente) : sintetica ? portaIdentidadeSintetica() : null;
  if (!porta) return null;
  return new ServicoIdentidade({
    porta,
    // Sem a chave mestra do ambiente, o cadastro do segundo fator fica indisponível (falha fechada), exceto no dev
    // sintético, que usa uma chave descartável do processo.
    chave:
      chaveMestra(ctx.env['ACESSO_CHAVE_MESTRA'] ?? ctx.env['PLATAFORMA_CHAVE_MESTRA']) ??
      (sintetica ? randomBytes(32) : null),
    emissor: ctx.configuracao.produtoNome,
  });
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloAcesso(ctx);
}
