// Módulo do portal do paciente na API migrada (F2.2/F2.3): a conta do portal, os resultados e os documentos do titular,
// o responsável legal, os consentimentos e os pedidos do titular (etapa 1), e a agenda online, o pré-check-in, o
// pagamento e a pesquisa (etapa 2), com as telas internas da recepção e da privacidade.
//   - A porta é a própria (MariaDB pelo @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes
//     sintéticas; fora disso, a porta indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
//   - As portas de SADT, agenda, exames e cadastro vêm dos módulos delas, pela mesma regra.
//   - A liberação (portal.paciente, portal.agenda, portal.pagamento) vem da FONTE_CONFIGURACAO do módulo de
//     configuração; sem ele, na memória, a fonte sintética; no banco, sem fonte, o portal fica desligado (falha fechada).
//   - O job da vigência dos vínculos e das contas só liga quando a porta tem o modelo da conta (ver `vigiaPossivel`).
// Melhoria: os estabelecimentos do job são os ativos do cliente no banco (e não uma lista de ambiente), e o job não
// roda em silêncio sobre um modelo ausente.
import { randomBytes } from 'node:crypto';
import { type DynamicModule, Module } from '@nestjs/common';
import { chaveMestra } from '@sgh/dominio-acesso';
import { logger } from '../../logger.js';
import { fontesSinteticas } from '../../sessao/montar.js';
import { pacientesSinteticos, portaAgendaIndisponivel } from '../agenda/modulo.js';
import type { PortaAgenda } from '../agenda/porta.js';
import { PortaAgendaMemoria } from '../agenda/porta-memoria.js';
import { PortaAgendaPropria } from '../agenda/porta-propria.js';
import { portaDoCadastro } from '../cadastro/modulo.js';
import type { PortaCadastro } from '../cadastro/porta.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { portaDosExames } from '../exames/modulo.js';
import type { PortaExame } from '../exames/porta.js';
import type { ContextoModulo } from '../registro.js';
import { portasDoSadt } from '../sadt/modulo.js';
import type { PortaSadt } from '../sadt/porta.js';
import { gatewayDoAmbiente, type GatewayPagamento } from './agenda/gateway.js';
import { PortalAgendaInternoController } from './agenda/interno.controller.js';
import { PORTA_AGENDA_ONLINE, type PortaAgendaOnline } from './agenda/porta.js';
import { PortaAgendaOnlineMemoria, sementeAgendaOnline } from './agenda/porta-memoria.js';
import { portaAgendaOnlineIndisponivel, PortaAgendaOnlinePropria } from './agenda/porta-propria.js';
import { PortalAgendaController, SERVICO_AGENDA_PORTAL } from './agenda/portal-agenda.controller.js';
import { ServicoAgendaPortal } from './agenda/servico.js';
import { canalDoAmbiente } from './aplicacao/canal.js';
import { type ArmazemProvas, ArmazemProvasMemoria, criarArmazemProvas } from './aplicacao/provas.js';
import { ServicoPortalPaciente } from './aplicacao/servico.js';
import { PORTA_PORTAL_PACIENTE, type PortaPortalPaciente } from './porta.js';
import { PortaPortalMemoria } from './porta-memoria.js';
import { portaPortalIndisponivel, PortaPortalPropria } from './porta-propria.js';
import { PortalPacienteController, SERVICO_PORTAL_PACIENTE } from './portal-paciente.controller.js';
import { PortalPacienteInternoController } from './portal-paciente-interno.controller.js';

export interface OpcoesModuloPortalPaciente {
  /** Testes: as portas já montadas. */
  readonly porta?: PortaPortalPaciente;
  readonly agendaOnline?: PortaAgendaOnline;
  readonly sadt?: PortaSadt | null;
  readonly agenda?: PortaAgenda;
  readonly exame?: PortaExame;
  readonly cadastro?: PortaCadastro;
  readonly gateway?: GatewayPagamento;
  readonly armazem?: ArmazemProvas;
  /** Testes: a fonte da liberação e dos parâmetros (null: sem fonte). */
  readonly configuracao?: FonteConfiguracao | null;
  /** Liga o job da vigência (padrão: só no banco com o modelo da conta). */
  readonly vigia?: boolean;
}

/** As portas do portal pela regra do módulo (sem as opções de teste). */
export function portasDoPortal(ctx: ContextoModulo): {
  porta: PortaPortalPaciente;
  agendaOnline: PortaAgendaOnline;
} {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente)
    return { porta: new PortaPortalPropria(ctx.nucleo), agendaOnline: new PortaAgendaOnlinePropria(ctx.nucleo) };
  if (!ctx.nucleo && fontesSinteticas(ctx.env))
    return {
      porta: new PortaPortalMemoria(),
      agendaOnline: new PortaAgendaOnlineMemoria(undefined, sementeAgendaOnline),
    };
  return { porta: portaPortalIndisponivel(), agendaOnline: portaAgendaOnlineIndisponivel() };
}

function portaDaAgenda(ctx: ContextoModulo): PortaAgenda {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) return new PortaAgendaPropria(ctx.nucleo, cliente);
  if (!ctx.nucleo && fontesSinteticas(ctx.env))
    return new PortaAgendaMemoria(null, async (_c, ids) => pacientesSinteticos(ids), undefined, {
      arquivoPorFora: ctx.env['AGENDA_SINTETICA_POR_FORA'] ?? null,
    });
  return portaAgendaIndisponivel();
}

/** Os códigos dos estabelecimentos: no banco, os ativos do cliente; na memória, os da sessão sintética (ambiente). */
async function estabelecimentos(ctx: ContextoModulo): Promise<string[]> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    const linhas = await ctx.nucleo.lerSomente({ cliente, correlacao: 'portal-estabelecimentos' }, (l) =>
      l.consultar<{ codigo: string }>(
        'SELECT codigo FROM estabelecimento WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY id',
        [],
      ),
    );
    return linhas.map((x) => x.codigo);
  }
  return (ctx.env['ESTABELECIMENTOS'] ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * O job da vigência lê os vínculos ativos e as contas abertas: sem o modelo da conta e do vínculo no banco (DDL pedido
 * na F2.2), a porta própria recusa com `recurso-sem-modelo` e o job não é ligado (aviso único no log, sem dado pessoal).
 */
async function vigiaPossivel(
  porta: PortaPortalPaciente,
  rede: string,
  hospital: string | undefined,
): Promise<boolean> {
  if (!hospital) return false;
  try {
    await porta.contasAbertas({ rede, hospital });
    return true;
  } catch (e) {
    const codigo = (e as { problema?: { codigo?: string } }).problema?.codigo ?? 'erro';
    logger.warn(
      { modulo: 'portal-paciente', operacao: 'vigia-vigencia', codigo },
      'Job da vigência do portal desligado: a leitura das contas abertas foi recusada.',
    );
    return false;
  }
}

@Module({})
export class ModuloPortalPaciente {}

export async function moduloPortalPaciente(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloPortalPaciente = {},
): Promise<DynamicModule> {
  const portas = portasDoPortal(ctx);
  const porta = opcoes.porta ?? portas.porta;
  const agendaOnline = opcoes.agendaOnline ?? portas.agendaOnline;
  const sadt = opcoes.sadt !== undefined ? opcoes.sadt : (await portasDoSadt(ctx)).sadt;
  const agenda = opcoes.agenda ?? portaDaAgenda(ctx);
  const exame = opcoes.exame ?? (await portaDosExames(ctx));
  const cadastro = opcoes.cadastro ?? (await portaDoCadastro(ctx));
  const memoria = porta.destino === 'memoria';
  const codigos = await estabelecimentos(ctx);
  const rede = ctx.configuracao.rede ?? ctx.configuracao.clientePadrao ?? '';
  const chave =
    chaveMestra(ctx.env['PORTAL_CHAVE_MESTRA'] ?? ctx.env['PLATAFORMA_CHAVE_MESTRA']) ??
    (fontesSinteticas(ctx.env) ? randomBytes(32) : null);
  // Com o núcleo, o disco local (ADR 0004); sem ele, a memória (a sessão sintética).
  const armazem =
    opcoes.armazem ??
    (memoria
      ? new ArmazemProvasMemoria()
      : criarArmazemProvas(ctx.nucleo, ctx.configuracao.clientePadrao, ctx.env));
  const gateway = opcoes.gateway ?? gatewayDoAmbiente(ctx.env, ctx.configuracao.ambiente);
  const configMemoria =
    opcoes.configuracao !== undefined
      ? opcoes.configuracao
      : memoria
        ? (fonteConfiguracaoMemoria(ctx.trilha, {
            chavesIniciais: chavesIniciaisSinteticas,
            prerequisitosIniciais: prerequisitosIniciaisSinteticos,
            parametrosIniciais: parametrosIniciaisSinteticos,
          }) as unknown as FonteConfiguracao)
        : null;
  const ligarVigia = opcoes.vigia ?? (!memoria && (await vigiaPossivel(porta, rede, codigos[0])));
  return {
    module: ModuloPortalPaciente,
    controllers: [
      PortalPacienteController,
      PortalPacienteInternoController,
      PortalAgendaController,
      PortalAgendaInternoController,
    ],
    providers: [
      { provide: PORTA_PORTAL_PACIENTE, useValue: porta },
      { provide: PORTA_AGENDA_ONLINE, useValue: agendaOnline },
      {
        provide: SERVICO_PORTAL_PACIENTE,
        useFactory: (fonte: FonteConfiguracao | null) => {
          const configuracao =
            opcoes.configuracao !== undefined ? opcoes.configuracao : (fonte ?? configMemoria);
          const servico = new ServicoPortalPaciente(porta, sadt, configuracao, armazem, {
            rede,
            produto: ctx.configuracao.produtoNome,
            chaveMestra: chave,
            estabelecimentoPadrao: codigos[0] ?? null,
            estabelecimentos: codigos,
          });
          servico.canal = canalDoAmbiente(ctx.configuracao.ambiente, configuracao, rede);
          if (ligarVigia) servico.iniciarVigia();
          return servico;
        },
        inject: [{ token: FONTE_CONFIGURACAO, optional: true }],
      },
      {
        provide: SERVICO_AGENDA_PORTAL,
        useFactory: (portal: ServicoPortalPaciente, fonte: FonteConfiguracao | null) =>
          new ServicoAgendaPortal(
            portal,
            agendaOnline,
            agenda,
            exame,
            cadastro,
            opcoes.configuracao !== undefined ? opcoes.configuracao : (fonte ?? configMemoria),
            armazem,
            gateway,
          ),
        inject: [SERVICO_PORTAL_PACIENTE, { token: FONTE_CONFIGURACAO, optional: true }],
      },
    ],
    exports: [SERVICO_PORTAL_PACIENTE, SERVICO_AGENDA_PORTAL, PORTA_PORTAL_PACIENTE],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloPortalPaciente(ctx);
}
