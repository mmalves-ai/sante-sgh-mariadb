// Módulo da agenda de consultas (F2.2): os controladores da agenda sobre a porta própria (MariaDB pelo @sgh/nucleo)
// quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a porta indisponível
// (503 em tudo, falha fechada) — a mesma regra do F2-L.
// A liberação da funcionalidade (chave agenda.consulta) e os parâmetros vêm da FONTE_CONFIGURACAO do módulo de
// configuração; sem ela, a agenda fica só em consulta (falha fechada). Na memória, a fonte sintética da configuração.
import type { DynamicModule } from '@nestjs/common';
import { ErroProblema } from '../../problema.filter.js';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { AgendasController } from './agendas.controller.js';
import { ApoioAgendaController } from './apoio.controller.js';
import { MarcacoesController } from './marcacoes.controller.js';
import { CONTATO_ATIVO, ContatoAtivoController } from './contato-ativo.controller.js';
import { ContatoAtivoPropria } from './contato-ativo.js';
import { COTAS_PRAZOS, CotasPrazosController } from './cota-prazo.controller.js';
import { CotasPrazosPropria } from './cota-prazo.js';
import { PEDIDOS_VAGA, PedidosVagaController } from './pedido-vaga.controller.js';
import { PedidosVagaPropria } from './pedido-vaga.js';
import { PERFIS_MARCACAO, PerfisMarcacaoController } from './perfil-marcacao.controller.js';
import { PerfisMarcacaoPropria } from './perfil-marcacao.js';
import { PORTA_AGENDA, type PortaAgenda } from './porta.js';
import { PortaAgendaMemoria, type PacienteSintetico } from './porta-memoria.js';
import { PortaAgendaPropria } from './porta-propria.js';
import { USUARIOS_AGENDA, UsuariosAgendaController } from './usuarios-agenda.controller.js';
import { UsuariosAgendaPropria } from './usuarios-agenda.js';

/** Porta sem banco configurado: 503 em toda leitura e gravação; a liberação diz por quê. */
export function portaAgendaIndisponivel(): PortaAgenda {
  const recusar = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return new Proxy({} as PortaAgenda, {
    get: (_t, chave) => {
      if (chave === 'destino') return 'propria';
      if (chave === 'podeGravar')
        return async () => ({
          pode: false,
          codigo: 'indisponivel',
          motivo: 'O banco do estabelecimento não está configurado: nada é gravado.',
        });
      // Nunca responde a `then` nem aos ganchos do Nest (onModuleInit…): só os métodos da porta.
      if (typeof chave !== 'string' || chave === 'then' || chave.startsWith('on')) return undefined;
      return recusar;
    },
  });
}

/** Pacientes SINTÉTICOS da memória (dev/ci): nenhum nome é de pessoa real. */
export function pacientesSinteticos(ids: readonly number[]): PacienteSintetico[] {
  return ids
    .filter((id) => id >= 1001 && id <= 1010)
    .map((id) => ({
      id,
      nome: `PACIENTE SINTETICO ${id - 1000} TESTE`,
      prontuario: 9000 + (id - 1000),
      telefone: null,
      celular: null,
      ativo: true,
    }));
}

export interface OpcoesModuloAgenda {
  /** Testes: a porta já montada. */
  readonly porta?: PortaAgenda;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: unknown;
}

export function moduloAgenda(ctx: ContextoModulo, opcoes: OpcoesModuloAgenda = {}): DynamicModule {
  const cliente = ctx.configuracao.clientePadrao;
  const memoria = !ctx.nucleo && fontesSinteticas(ctx.env);
  const porta: PortaAgenda =
    opcoes.porta ??
    (ctx.nucleo && cliente
      ? new PortaAgendaPropria(ctx.nucleo, cliente)
      : memoria
        ? new PortaAgendaMemoria(null, async (_c, ids) => pacientesSinteticos(ids))
        : portaAgendaIndisponivel());
  const configuracao =
    opcoes.configuracao ??
    (porta.destino === 'memoria'
      ? fonteConfiguracaoMemoria(ctx.trilha, {
          chavesIniciais: chavesIniciaisSinteticas,
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : null);
  return {
    module: class ModuloAgenda {},
    controllers: [
      AgendasController,
      ApoioAgendaController,
      MarcacoesController,
      UsuariosAgendaController,
      PerfisMarcacaoController,
      PedidosVagaController,
      CotasPrazosController,
      ContatoAtivoController,
    ],
    providers: [
      { provide: PORTA_AGENDA, useValue: porta },
      {
        provide: USUARIOS_AGENDA,
        useValue:
          porta.destino === 'propria' && ctx.nucleo && cliente
            ? new UsuariosAgendaPropria(ctx.nucleo, cliente)
            : null,
      },
      {
        provide: PERFIS_MARCACAO,
        useValue:
          porta.destino === 'propria' && ctx.nucleo && cliente
            ? new PerfisMarcacaoPropria(ctx.nucleo, cliente)
            : null,
      },
      {
        provide: COTAS_PRAZOS,
        useValue:
          porta.destino === 'propria' && ctx.nucleo && cliente
            ? new CotasPrazosPropria(ctx.nucleo, cliente)
            : null,
      },
      {
        provide: CONTATO_ATIVO,
        useValue:
          porta.destino === 'propria' && ctx.nucleo && cliente
            ? new ContatoAtivoPropria(ctx.nucleo, cliente)
            : null,
      },
      {
        provide: PEDIDOS_VAGA,
        useValue:
          porta.destino === 'propria' && ctx.nucleo && cliente
            ? new PedidosVagaPropria(ctx.nucleo, cliente)
            : null,
      },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloAgenda(ctx);
}
