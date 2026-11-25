// Módulo da operadora própria na API migrada (F2.2, lotes 02-09 e 02-10): situação das chaves e catálogos da ANS,
// beneficiários, rede credenciada, cobrança, autorização, contas médicas, obrigações com a ANS, atendimento ao
// beneficiário e o portal do prestador. As portas são as próprias sobre o banco do cliente quando o núcleo existe; sem
// núcleo, as de memória só em dev/ci (fonte sintética); fora disso, as indisponíveis (503, falha fechada). Os testes
// passam as portas prontas pelas opções.
// - A configuração (FONTE_CONFIGURACAO e CACHE_CONFIG) vem do módulo config (global) quando registrado; na memória sem
//   ele, a fonte sintética local, como na agenda.
// - O portal do prestador usa a chave mestra do portal para cifrar o segundo fator (na sintética, uma chave do processo).
import { randomBytes } from 'node:crypto';
import { type DynamicModule, Module } from '@nestjs/common';
import { chaveMestra } from '@sgh/dominio-acesso';
import { ambienteDe, criarArmazemLocal, ErroOperacao, lerRaizArquivos } from '@sgh/nucleo';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { AnsOperadoraController } from './ans.controller.js';
import { METODOS_PORTA_ANS, PORTA_ANS_OPERADORA, type PortaAnsOperadora } from './ans-porta.js';
import { PortaAnsOperadoraMemoria } from './ans-porta-memoria.js';
import { PortaAnsOperadoraPropria } from './ans-porta-propria.js';
import { ServicoSituacaoOperadora } from './aplicacao/situacao.js';
import { AtendimentoOperadoraController } from './atendimento.controller.js';
import {
  METODOS_PORTA_ATENDIMENTO,
  PORTA_ATENDIMENTO_OPERADORA,
  type PortaAtendimentoOperadora,
} from './atendimento-porta.js';
import { PortaAtendimentoOperadoraMemoria } from './atendimento-porta-memoria.js';
import { PortaAtendimentoOperadoraPropria } from './atendimento-porta-propria.js';
import { AutorizacaoOperadoraController } from './autorizacao.controller.js';
import {
  METODOS_PORTA_AUTORIZACAO,
  PORTA_AUTORIZACAO_OPERADORA,
  type PortaAutorizacaoOperadora,
} from './autorizacao-porta.js';
import { PortaAutorizacaoOperadoraMemoria } from './autorizacao-porta-memoria.js';
import { PortaAutorizacaoOperadoraPropria } from './autorizacao-porta-propria.js';
import { BeneficiariosOperadoraController } from './beneficiarios.controller.js';
import { DeclaracoesAnsController } from './ans-declaracoes.controller.js';
import { ComercialOperadoraController } from './comercial.controller.js';
import { METODOS_COMERCIAL, PORTA_COMERCIAL, PortaComercialPropria } from './comercial-propria.js';
import { ReajusteColetivoOperadoraController } from './reajuste-coletivo.controller.js';
import {
  METODOS_REAJUSTE_COLETIVO,
  PORTA_REAJUSTE_COLETIVO,
  PortaReajusteColetivoPropria,
} from './reajuste-coletivo-propria.js';
import {
  METODOS_DECLARACOES_ANS,
  PORTA_DECLARACOES_ANS,
  PortaDeclaracoesAnsPropria,
} from './ans-declaracoes-propria.js';
import { CadastroComplementarOperadoraController } from './cadastro-complementar.controller.js';
import {
  METODOS_CADASTRO_COMPLEMENTAR,
  PORTA_CADASTRO_COMPLEMENTAR,
  PortaCadastroComplementarPropria,
} from './cadastro-complementar-porta-propria.js';
import { CobrancaOperadoraController } from './cobranca.controller.js';
import {
  METODOS_PORTA_COBRANCA,
  PORTA_COBRANCA_OPERADORA,
  type PortaCobrancaOperadora,
} from './cobranca-porta.js';
import { PortaCobrancaOperadoraMemoria } from './cobranca-porta-memoria.js';
import { PortaCobrancaOperadoraPropria } from './cobranca-porta-propria.js';
import { ContaConferenciaOperadoraController } from './conta-conferencia.controller.js';
import { METODOS_REEMBOLSO, PORTA_REEMBOLSO, PortaReembolsoPropria } from './reembolso-propria.js';
import { ReembolsoOperadoraController } from './reembolso.controller.js';
import {
  METODOS_CONFERENCIA_CONTA,
  PORTA_CONFERENCIA_CONTA,
  PortaConferenciaContaPropria,
} from './conta-conferencia-propria.js';
import { ContasOperadoraController } from './contas.controller.js';
import { METODOS_TROCA_TISS, PORTA_TROCA_TISS, PortaTrocaTissPropria } from './troca-tiss-propria.js';
import { TrocaTissOperadoraController } from './troca-tiss.controller.js';
import { PortalPrestadorPedidosController } from './portal-prestador-pedidos.controller.js';
import {
  METODOS_PORTAL_PRESTADOR_PEDIDOS,
  PORTA_PORTAL_PRESTADOR_PEDIDOS,
  PortaPortalPrestadorPedidosPropria,
} from './portal-prestador-pedidos-propria.js';
import { METODOS_PORTA_CONTAS, PORTA_CONTAS_OPERADORA, type PortaContasOperadora } from './contas-porta.js';
import { PortaContasOperadoraMemoria } from './contas-porta-memoria.js';
import { PortaContasOperadoraPropria } from './contas-porta-propria.js';
import { OperadoraController } from './operadora.controller.js';
import { PORTA_OPERADORA, type PortaOperadora, portaOperadoraIndisponivel } from './porta.js';
import { PortaOperadoraMemoria } from './porta-memoria.js';
import { PortaOperadoraPropria } from './porta-propria.js';
import { PortalPrestadorController } from './portal-prestador.controller.js';
import { SERVICO_PORTAL_PRESTADOR, ServicoPortalPrestador } from './portal-prestador-servico.js';
import { RedeOperadoraController } from './rede.controller.js';
import {
  PORTA_REDE_OPERADORA,
  type PortaRedeOperadora,
  portaRedeOperadoraIndisponivel,
} from './rede-porta.js';
import { PortaRedeOperadoraMemoria } from './rede-porta-memoria.js';
import { PortaRedeOperadoraPropria } from './rede-porta-propria.js';
import { portaIndisponivel } from '../exames/public-api.js';

/** As portas da operadora (cada uma pode vir pronta nas opções: testes). */
export interface PortasOperadora {
  readonly operadora: PortaOperadora;
  readonly rede: PortaRedeOperadora;
  readonly cobranca: PortaCobrancaOperadora;
  readonly autorizacao: PortaAutorizacaoOperadora;
  readonly contas: PortaContasOperadora;
  readonly ans: PortaAnsOperadora;
  readonly atendimento: PortaAtendimentoOperadora;
}

export interface OpcoesModuloOperadora extends Partial<PortasOperadora> {
  /** Fonte de configuração pronta (testes); null: sem fonte (as telas ficam em consulta). */
  readonly configuracao?: FonteConfiguracao | null;
  /** Chave mestra do portal do prestador (testes). */
  readonly chavePortal?: Buffer | null;
}

type BuscaPorSenha = Pick<PortaContasOperadora, 'autorizacoesPorSenha'>;
const temBuscaPorSenha = (x: object): x is BuscaPorSenha =>
  typeof (x as Partial<BuscaPorSenha>).autorizacoesPorSenha === 'function';

/** A porta da autorização montada sem a busca pela senha (configuração do módulo): 503, nada lido. */
const semBuscaPorSenha = (): ErroOperacao =>
  new ErroOperacao(
    503,
    'porta-indisponivel',
    'Busca indisponível',
    'A busca da autorização pela senha não está ligada nesta instalação. Nada foi lido.',
  );

/** A busca das autorizações pela senha (as contas conferem a guia): a da porta da autorização, ou 503 sem ela. */
function buscaPorSenha(
  a: PortaAutorizacaoOperadora,
): BuscaPorSenha & Pick<PortaAutorizacaoOperadora, 'designacoes'> {
  return {
    designacoes: (c, login) => a.designacoes(c, login),
    autorizacoesPorSenha: temBuscaPorSenha(a)
      ? (c, senhas) => a.autorizacoesPorSenha(c, senhas)
      : () => Promise.reject(semBuscaPorSenha()),
  };
}

/** As portas pela regra do módulo: próprias com o núcleo; memória só em dev/ci sem núcleo; senão indisponíveis. */
export async function portasDaOperadora(
  ctx: ContextoModulo,
  o: OpcoesModuloOperadora = {},
): Promise<PortasOperadora> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    const n = ctx.nucleo;
    await ligarMapaEstabelecimentos(cliente, n);
    const operadora = o.operadora ?? new PortaOperadoraPropria(n, cliente);
    const rede = o.rede ?? new PortaRedeOperadoraPropria(n, cliente);
    const autorizacao = o.autorizacao ?? new PortaAutorizacaoOperadoraPropria(n, cliente, operadora, rede);
    const cobranca = o.cobranca ?? new PortaCobrancaOperadoraPropria(n, cliente);
    const contas =
      o.contas ?? new PortaContasOperadoraPropria(n, cliente, operadora, rede, buscaPorSenha(autorizacao));
    return {
      operadora,
      rede,
      autorizacao,
      cobranca,
      contas,
      ans:
        o.ans ??
        new PortaAnsOperadoraPropria(
          n,
          cliente,
          operadora,
          ambienteDe(ctx.env) === 'producao' ? 'ans' : 'simulador',
          { operadora, cobranca, contas },
          // O arquivo do envio no disco da instalação (ADR 0004); sem ARQUIVOS_RAIZ, abrir o arquivo responde 501.
          lerRaizArquivos(ctx.env) ? criarArmazemLocal(n, { env: ctx.env }) : null,
        ),
      atendimento: o.atendimento ?? new PortaAtendimentoOperadoraPropria(n, cliente, operadora, rede),
    };
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) {
    const operadora = o.operadora ?? new PortaOperadoraMemoria(ctx.trilha);
    const rede = o.rede ?? new PortaRedeOperadoraMemoria();
    const cobranca =
      o.cobranca ??
      (operadora instanceof PortaOperadoraMemoria
        ? new PortaCobrancaOperadoraMemoria(operadora)
        : portaIndisponivel<PortaCobrancaOperadora>(METODOS_PORTA_COBRANCA));
    const autorizacao = o.autorizacao ?? new PortaAutorizacaoOperadoraMemoria(operadora, rede);
    const contas =
      o.contas ??
      (autorizacao instanceof PortaAutorizacaoOperadoraMemoria
        ? new PortaContasOperadoraMemoria(operadora, rede, autorizacao)
        : portaIndisponivel<PortaContasOperadora>(METODOS_PORTA_CONTAS));
    return {
      operadora,
      rede,
      cobranca,
      autorizacao,
      contas,
      ans:
        o.ans ??
        new PortaAnsOperadoraMemoria(
          operadora,
          cobranca instanceof PortaCobrancaOperadoraMemoria ? cobranca : null,
          contas instanceof PortaContasOperadoraMemoria ? contas : null,
        ),
      atendimento: o.atendimento ?? new PortaAtendimentoOperadoraMemoria(operadora, rede, autorizacao),
    };
  }
  return {
    operadora: o.operadora ?? portaOperadoraIndisponivel(),
    rede: o.rede ?? portaRedeOperadoraIndisponivel(),
    cobranca: o.cobranca ?? portaIndisponivel<PortaCobrancaOperadora>(METODOS_PORTA_COBRANCA),
    autorizacao: o.autorizacao ?? portaIndisponivel<PortaAutorizacaoOperadora>(METODOS_PORTA_AUTORIZACAO),
    contas: o.contas ?? portaIndisponivel<PortaContasOperadora>(METODOS_PORTA_CONTAS),
    ans: o.ans ?? portaIndisponivel<PortaAnsOperadora>(METODOS_PORTA_ANS),
    atendimento: o.atendimento ?? portaIndisponivel<PortaAtendimentoOperadora>(METODOS_PORTA_ATENDIMENTO),
  };
}

@Module({})
export class ModuloOperadora {}

export async function moduloOperadora(
  ctx: ContextoModulo,
  o: OpcoesModuloOperadora = {},
): Promise<DynamicModule> {
  const p = await portasDaOperadora(ctx, o);
  // Na memória sem o módulo config, a fonte sintética local (as chaves da operadora como a sessão de dev/ci tem); com
  // ele (API_MODULOS com config, ou todos), a fonte global dele, a mesma que a administração da liberação grava.
  const pedidos = (ctx.env['API_MODULOS'] ?? '').split(',').map((x) => x.trim());
  const comConfig = pedidos.includes('config') || pedidos.includes('todos');
  const configuracao =
    o.configuracao !== undefined
      ? o.configuracao
      : p.operadora.destino === 'memoria' && !comConfig
        ? fonteConfiguracaoMemoria(ctx.trilha, {
            chavesIniciais: chavesIniciaisSinteticas,
            prerequisitosIniciais: prerequisitosIniciaisSinteticos,
            parametrosIniciais: parametrosIniciaisSinteticos,
          })
        : null;
  const chavePortal =
    o.chavePortal !== undefined
      ? o.chavePortal
      : (chaveMestra(ctx.env['PORTAL_CHAVE_MESTRA'] ?? ctx.env['PLATAFORMA_CHAVE_MESTRA']) ??
        (fontesSinteticas(ctx.env) ? randomBytes(32) : null));
  const rede = ctx.configuracao.rede ?? '';
  return {
    module: ModuloOperadora,
    controllers: [
      OperadoraController,
      BeneficiariosOperadoraController,
      RedeOperadoraController,
      CobrancaOperadoraController,
      AutorizacaoOperadoraController,
      ContasOperadoraController,
      AnsOperadoraController,
      AtendimentoOperadoraController,
      PortalPrestadorController,
      CadastroComplementarOperadoraController,
      DeclaracoesAnsController,
      ReajusteColetivoOperadoraController,
      ComercialOperadoraController,
      ContaConferenciaOperadoraController,
      ReembolsoOperadoraController,
      TrocaTissOperadoraController,
      PortalPrestadorPedidosController,
    ],
    providers: [
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
      { provide: PORTA_OPERADORA, useValue: p.operadora },
      { provide: PORTA_REDE_OPERADORA, useValue: p.rede },
      { provide: PORTA_COBRANCA_OPERADORA, useValue: p.cobranca },
      { provide: PORTA_AUTORIZACAO_OPERADORA, useValue: p.autorizacao },
      { provide: PORTA_CONTAS_OPERADORA, useValue: p.contas },
      { provide: PORTA_ANS_OPERADORA, useValue: p.ans },
      { provide: PORTA_ATENDIMENTO_OPERADORA, useValue: p.atendimento },
      // F78.08-1: o cadastro complementar só existe no banco do cliente (sem núcleo, 503: nada só em memória).
      {
        provide: PORTA_CADASTRO_COMPLEMENTAR,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaCadastroComplementarPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : portaIndisponivel<PortaCadastroComplementarPropria>(METODOS_CADASTRO_COMPLEMENTAR),
      },
      // 08-SGO L105 (C1-100): regras de crítica, críticas gravadas, auditoria e demonstrativos só no banco (sem núcleo, 503).
      {
        provide: PORTA_CONFERENCIA_CONTA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaConferenciaContaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : portaIndisponivel<PortaConferenciaContaPropria>(METODOS_CONFERENCIA_CONTA),
      },
      // 08-SGO L107 (C2-061): troca TISS recebida e demonstrativos enviados só no banco (sem núcleo, 503).
      {
        provide: PORTA_TROCA_TISS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaTrocaTissPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : portaIndisponivel<PortaTrocaTissPropria>(METODOS_TROCA_TISS),
      },
      // 08-SGO L113 (C2-074): pedidos do prestador, avisos e regras de arquivo do portal só no banco (sem núcleo, 503).
      {
        provide: PORTA_PORTAL_PRESTADOR_PEDIDOS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaPortalPrestadorPedidosPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : portaIndisponivel<PortaPortalPrestadorPedidosPropria>(METODOS_PORTAL_PRESTADOR_PEDIDOS),
      },
      // 08-SGO L106 (C2-047): reembolso ao beneficiário só no banco (sem núcleo, 503); comprovantes pela porta de arquivos.
      {
        provide: PORTA_REEMBOLSO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaReembolsoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : portaIndisponivel<PortaReembolsoPropria>(METODOS_REEMBOLSO),
      },
      // 08-SGO L100 (C2-095): comercial (proposta, força de venda, metas, campanhas, comissão) só no banco (sem núcleo, 503).
      {
        provide: PORTA_COMERCIAL,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaComercialPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : portaIndisponivel<PortaComercialPropria>(METODOS_COMERCIAL),
      },
      // 08-SGO L96 (C1-086): índice, regra por sinistralidade e agrupamento do coletivo pequeno só no banco (sem núcleo, 503).
      {
        provide: PORTA_REAJUSTE_COLETIVO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaReajusteColetivoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : portaIndisponivel<PortaReajusteColetivoPropria>(METODOS_REAJUSTE_COLETIVO),
      },
      // 08-SGO L110: TPS apurada, conferência cadastral e DMED só no banco do cliente (sem núcleo, 503).
      {
        provide: PORTA_DECLARACOES_ANS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaDeclaracoesAnsPropria(
                ctx.nucleo,
                ctx.configuracao.clientePadrao,
                p.ans,
                lerRaizArquivos(ctx.env) ? criarArmazemLocal(ctx.nucleo, { env: ctx.env }) : null,
              )
            : portaIndisponivel<PortaDeclaracoesAnsPropria>(METODOS_DECLARACOES_ANS),
      },
      {
        provide: SERVICO_PORTAL_PRESTADOR,
        // A situação das chaves pela configuração do estabelecimento (a local na memória, senão a do módulo config).
        useFactory: (fonte: FonteConfiguracao | null, cache: CacheConfig | null) =>
          new ServicoPortalPrestador(
            p.atendimento,
            p.autorizacao,
            new ServicoSituacaoOperadora(fonte ?? null, cache ?? null),
            rede,
            chavePortal,
            ctx.configuracao.produtoNome,
          ),
        inject: [
          { token: FONTE_CONFIGURACAO, optional: true },
          { token: CACHE_CONFIG, optional: true },
        ],
      },
    ],
    exports: [PORTA_OPERADORA, PORTA_REDE_OPERADORA],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloOperadora(ctx);
}
