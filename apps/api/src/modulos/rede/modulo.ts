// Módulo da Rede (F2.2/F2.3, lote 02-13): o MPI da Rede (fila de prováveis duplicados entre os estabelecimentos,
// decisão, vínculos, pareamento, divergência e o aviso no cabeçalho do paciente) e o registro de serviços compartilhados.
// A porta é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci;
// fora disso, a indisponível (503, falha fechada) — a mesma regra do F2-L. A liberação (chaves `rede.mpi` e `rede.bi`)
// vem da FONTE_CONFIGURACAO; sem ela, as telas recusam (falha fechada). Na memória, a fonte sintética da configuração.
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { lerEstabelecimentosSinteticos } from '../acesso/estabelecimentos-sinteticos.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { portaRedeIndisponivel, portaServicosRedeIndisponivel } from './indisponivel.js';
import { PORTA_REDE, type PortaRede } from './porta.js';
import { estabelecimentosSinteticosRede, PortaRedeMemoria } from './porta-memoria.js';
import { PortaRedePropria } from './porta-propria.js';
import { RedeMpiController } from './rede.controller.js';
import { PORTA_SERVICOS_REDE, type PortaServicosRede } from './servicos/porta.js';
import { PortaServicosRedeMemoria } from './servicos/porta-memoria.js';
import { PortaServicosRedePropria } from './servicos/porta-propria.js';
import { ServicosRedeController } from './servicos/servicos.controller.js';

export interface OpcoesModuloRede {
  /** Testes: as portas já montadas. */
  readonly porta?: PortaRede;
  readonly servicos?: PortaServicosRede;
  /** Testes: a fonte da liberação. */
  readonly configuracao?: unknown;
}

/** As portas da Rede pela regra do módulo (sem as opções de teste). */
export async function portasDaRede(
  ctx: ContextoModulo,
): Promise<{ mpi: PortaRede; servicos: PortaServicosRede }> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    const mpi = new PortaRedePropria(ctx.nucleo, cliente, ctx.configuracao.rede);
    // Falha na leitura dos estabelecimentos não derruba a partida: a porta relê na primeira chamada.
    await mpi.carregar().catch(() => undefined);
    return { mpi, servicos: new PortaServicosRedePropria() };
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) {
    return {
      mpi: new PortaRedeMemoria({
        rede: ctx.configuracao.rede ?? 'rede-sintetica',
        estabelecimentos: estabelecimentosSinteticosRede(
          lerEstabelecimentosSinteticos(ctx.env).map((e) => ({ codigo: e.codigo, nome: e.nome })),
          ctx.env['REDE_SINTETICA_SEGUNDO'],
        ),
      }),
      servicos: new PortaServicosRedeMemoria(),
    };
  }
  return { mpi: portaRedeIndisponivel(), servicos: portaServicosRedeIndisponivel() };
}

export async function moduloRede(ctx: ContextoModulo, opcoes: OpcoesModuloRede = {}): Promise<DynamicModule> {
  const padrao = opcoes.porta && opcoes.servicos ? null : await portasDaRede(ctx);
  const mpi = opcoes.porta ?? (padrao as { mpi: PortaRede }).mpi;
  const servicos = opcoes.servicos ?? (padrao as { servicos: PortaServicosRede }).servicos;
  const configuracao =
    opcoes.configuracao ??
    (mpi.destino === 'memoria'
      ? fonteConfiguracaoMemoria(ctx.trilha, {
          chavesIniciais: chavesIniciaisSinteticas,
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : null);
  return {
    module: class ModuloRede {},
    controllers: [RedeMpiController, ServicosRedeController],
    providers: [
      { provide: PORTA_REDE, useValue: mpi },
      { provide: PORTA_SERVICOS_REDE, useValue: servicos },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
    exports: [PORTA_REDE, PORTA_SERVICOS_REDE],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloRede(ctx);
}
