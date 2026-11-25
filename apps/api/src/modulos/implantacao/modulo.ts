// Módulo da implantação na API migrada (F2.2 onda 2): a conferência da instalação (M60.2) e a fumaça do servidor
// (M60.3), só leitura, com a permissão dos painéis de saúde e as rotas de sonda com o segredo do pipeline.
// - Com núcleo e cliente: a porta própria sobre o banco do cliente (conexão, migrações, relógio e estrutura).
// - Sem núcleo, só em dev/ci (fontesSinteticas): a instalação sintética em memória.
// - Fora disso: a porta indisponível (503, falha fechada).
// Os testes passam a porta, as migrações do pacote e as filas pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import type { ScriptDoPacote } from '@sgh/dominio-config';
import { fontesSinteticas } from '../../sessao/montar.js';
import { VersaoService } from '../../versao.service.js';
import type { ContextoModulo } from '../registro.js';
import {
  ConferenciaInstalacaoController,
  SCRIPTS_DO_PACOTE,
  scriptsDoPacoteDoDisco,
} from './conferencia.controller.js';
import { FILAS_IMPLANTACAO, filasDoAmbiente, type PortaFilasImplantacao } from './filas.js';
import { FumacaServidorController } from './fumaca.controller.js';
import { KitImplantacaoController } from './kit-implantacao.controller.js';
import { PORTA_KIT_IMPLANTACAO, PortaKitImplantacaoPropria } from './kit-implantacao-propria.js';
import { PORTA_IMPLANTACAO, type PortaImplantacao, portaImplantacaoIndisponivel } from './porta.js';
import { PortaImplantacaoMemoria } from './porta-memoria.js';
import { PortaImplantacaoPropria } from './porta-propria.js';

export interface OpcoesModuloImplantacao {
  /** Porta pronta (testes). */
  readonly porta?: PortaImplantacao;
  /** As migrações do pacote (testes); padrão: db/migracoes do disco. */
  readonly scriptsDoPacote?: () => readonly ScriptDoPacote[];
  /** As filas (testes); padrão: pelo VALKEY_URL do ambiente. */
  readonly filas?: PortaFilasImplantacao;
}

/** A porta da implantação pela regra do módulo (sem as opções de teste). */
export function portaDaImplantacao(
  ctx: ContextoModulo,
  scripts: () => readonly ScriptDoPacote[],
): PortaImplantacao {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) return new PortaImplantacaoPropria(ctx.nucleo, cliente);
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaImplantacaoMemoria(scripts);
  return portaImplantacaoIndisponivel();
}

@Module({})
export class ModuloImplantacao {}

export function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloImplantacao = {}): DynamicModule {
  const scripts = opcoes.scriptsDoPacote ?? scriptsDoPacoteDoDisco();
  const porta = opcoes.porta ?? portaDaImplantacao(ctx, scripts);
  return {
    module: ModuloImplantacao,
    controllers: [ConferenciaInstalacaoController, FumacaServidorController, KitImplantacaoController],
    providers: [
      { provide: PORTA_IMPLANTACAO, useValue: porta },
      { provide: SCRIPTS_DO_PACOTE, useValue: scripts },
      { provide: FILAS_IMPLANTACAO, useValue: opcoes.filas ?? filasDoAmbiente(ctx.env) },
      // C2-025 (01-ADM L98): kit de implantação do hospital novo; sem núcleo, 503.
      {
        provide: PORTA_KIT_IMPLANTACAO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaKitImplantacaoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      VersaoService,
    ],
    exports: [PORTA_IMPLANTACAO],
  };
}
