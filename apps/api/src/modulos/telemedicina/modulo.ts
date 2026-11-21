// Módulo da telemedicina na API migrada (F2.2/F2.3): a tela do médico e a sala de espera do portal sobre a porta
// própria (MariaDB pelo @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora
// disso, a porta indisponível (503 em tudo, falha fechada). O atendimento e o cadastro usam as portas dos seus módulos,
// pela mesma regra. O portal do paciente, a agenda do portal e os documentos do PEP são ligados quando montados
// (injeção opcional): sem eles, as rotas do portal respondem 503 e os documentos saem sem a marca.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { portaDoAtendimento } from '../atendimento/modulo.js';
import type { PortaAtendimento } from '../atendimento/porta.js';
import { PortaAtendimentoMemoria } from '../atendimento/porta-memoria.js';
import { portaDoCadastro } from '../cadastro/modulo.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import type { PortaCadastro } from '../cadastro/porta.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import { SERVICO_DOCUMENTOS } from '../pep/documentos.controller.js';
import type { ServicoPortalPaciente } from '../portal-paciente/aplicacao/servico.js';
import { SERVICO_AGENDA_PORTAL } from '../portal-paciente/agenda/portal-agenda.controller.js';
import { SERVICO_PORTAL_PACIENTE } from '../portal-paciente/portal-paciente.controller.js';
import type { ContextoModulo } from '../registro.js';
import { PORTA_TELEMEDICINA, type ContextoTelemedicina, type PortaTelemedicina } from './porta.js';
import { PortaTelemedicinaMemoria } from './porta-memoria.js';
import { portaTelemedicinaIndisponivel, PortaTelemedicinaPropria } from './porta-propria.js';
import { PortalTeleconsultaController } from './portal-teleconsulta.controller.js';
import { provedorDoAmbiente, type ProvedorTeleconsulta } from './provedor.js';
import {
  type GanchoTeleconsultaPortal,
  OPERACOES_TELEMEDICINA,
  PortaGravacaoTelemedicina,
  ServicoTelemedicina,
} from './servico.js';
import { SERVICO_TELEMEDICINA, TelemedicinaController } from './telemedicina.controller.js';

export interface OpcoesModuloTelemedicina {
  /** Testes: as portas já montadas e o provedor da sala. */
  readonly porta?: PortaTelemedicina;
  readonly atendimento?: PortaAtendimento;
  readonly cadastro?: PortaCadastro;
  readonly provedor?: ProvedorTeleconsulta;
}

/** A porta da telemedicina pela regra do módulo (sem as opções de teste). */
export async function portaDaTelemedicina(
  ctx: ContextoModulo,
  atendimento: PortaAtendimento | null = null,
): Promise<PortaTelemedicina> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaTelemedicinaPropria(ctx.nucleo, cliente);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env))
    return new PortaTelemedicinaMemoria(undefined, {
      semente: true,
      aoSemear: (h, m) => {
        if (atendimento instanceof PortaAtendimentoMemoria) atendimento.incluirMarcacaoSintetica(h, m);
      },
    });
  return portaTelemedicinaIndisponivel();
}

interface AgendaDoPortal {
  ligarTeleconsulta(g: GanchoTeleconsultaPortal): void;
}
interface DocumentosDoPep {
  ligarTelemedicina(
    fn: (c: ContextoTelemedicina & { cliente: string }, atendimento: number) => Promise<boolean>,
  ): void;
}

@Module({})
export class ModuloTelemedicina {}

export async function moduloTelemedicina(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloTelemedicina = {},
): Promise<DynamicModule> {
  const atendimento = opcoes.atendimento ?? (await portaDoAtendimento(ctx));
  const cadastro = opcoes.cadastro ?? (await portaDoCadastro(ctx));
  const porta = opcoes.porta ?? (await portaDaTelemedicina(ctx, atendimento));
  const provedor = opcoes.provedor ?? provedorDoAmbiente(ctx.env, ctx.configuracao.ambiente);
  const configMemoria =
    porta.destino === 'memoria'
      ? fonteConfiguracaoMemoria(ctx.trilha, {
          chavesIniciais: chavesIniciaisSinteticas,
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : null;
  return {
    module: ModuloTelemedicina,
    controllers: [TelemedicinaController, PortalTeleconsultaController],
    providers: [
      { provide: PORTA_TELEMEDICINA, useValue: porta },
      {
        provide: SERVICO_TELEMEDICINA,
        useFactory: (
          fonte: FonteConfiguracao | null,
          portal: ServicoPortalPaciente | null,
          agendaPortal: AgendaDoPortal | null,
          documentos: DocumentosDoPep | null,
        ) => {
          const configuracao = fonte ?? (configMemoria as FonteConfiguracao | null);
          const apoio = new ApoioGravacao(
            { chave: 'telemedicina', nome: 'a telemedicina', operacoes: OPERACOES_TELEMEDICINA },
            new PortaGravacaoTelemedicina(porta, atendimento),
            ctx.trilha,
            configuracao,
            null,
          );
          const s = new ServicoTelemedicina(
            porta,
            atendimento,
            cadastro,
            apoio,
            provedor,
            configuracao,
            portal ?? null,
          );
          agendaPortal?.ligarTeleconsulta(s);
          documentos?.ligarTelemedicina((c, a) => s.atendimentoEmTeleconsulta(c, a));
          return s;
        },
        inject: [
          { token: FONTE_CONFIGURACAO, optional: true },
          { token: SERVICO_PORTAL_PACIENTE, optional: true },
          { token: SERVICO_AGENDA_PORTAL, optional: true },
          { token: SERVICO_DOCUMENTOS, optional: true },
        ],
      },
    ],
    exports: [PORTA_TELEMEDICINA, SERVICO_TELEMEDICINA],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloTelemedicina(ctx);
}
