// Módulo da administração na API migrada (F2.2 onda 2, lotes 02-05 e 02-06): as telas do M10 (usuários, perfis e
// permissões, estrutura, trilha e CPF da rede, pela fonte da administração) e a certificação SBIS (ciclos de
// avaliação, termo das concessões e backup verificado, M59-F5).
// - Com núcleo e cliente: a fonte própria (fonte-propria.ts) e a porta própria (sbis/porta-propria.ts).
// - Sem núcleo, só em dev/ci (fontesSinteticas): a fonte e a porta em memória.
// - Fora disso: indisponíveis (503, falha fechada).
// A situação do estabelecimento é a do produto sem sistema anterior (ADR 0003): desligado e sem contingência. As
// medidas das concessões, as políticas do segundo fator e a assinatura configurada vêm dos módulos donos delas pelas
// opções (sem a fonte, a medida fica "indisponível" e o item do pacote, pendente: nunca um "atendido" inventado).
// Os serviços de outros módulos que as telas usam (saneamento, gestores, recepção) são opcionais nos controladores.
import { type DynamicModule, Module, type Provider, type Type } from '@nestjs/common';
import type { Politica2fa } from '@sgh/contratos';
import type { SituacaoEstabelecimento } from '@sgh/dominio-acesso';
import { fontesSinteticas } from '../../sessao/montar.js';
import { AuditoriaController } from './auditoria.controller.js';
import { EstruturaController } from './estrutura.controller.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao, fonteAdministracaoIndisponivel } from './fonte.js';
import { fonteAdministracaoMemoria } from './fonte-memoria.js';
import { PermissoesController } from './permissoes.controller.js';
import { RedeCpfController } from './rede-cpf.controller.js';
import { UsuariosController } from './usuarios.controller.js';
import { VersaoService } from '../../versao.service.js';
import type { ContextoModulo } from '../registro.js';
import type { FontesMedidas } from './sbis/medidas.js';
import { PORTA_SBIS, type PortaSbis, portaSbisIndisponivel } from './sbis/porta.js';
import { PortaSbisMemoria } from './sbis/porta-memoria.js';
import { PortaSbisPropria } from './sbis/porta-propria.js';
import { SbisController } from './sbis/sbis.controller.js';
import { ImpressaoController } from './impressao.controller.js';
import { PreferenciasController } from './preferencias.controller.js';
import { SERVICO_SBIS, ServicoSbis } from './sbis/servico.js';

/** O produto não convive com sistema anterior (ADR 0003). */
export const SEM_SISTEMA_ANTERIOR: SituacaoEstabelecimento = Object.freeze({
  desligado: true,
  contingenciaAtiva: false,
});

export interface OpcoesModuloAdministracao {
  /** Fonte pronta das telas do M10 (testes). */
  readonly fonte?: FonteAdministracao;
  /** Porta pronta da certificação (testes). */
  readonly sbis?: PortaSbis;
  readonly medidas?: (c: { rede: string; hospital: string }) => FontesMedidas;
  readonly politicas2fa?: (hospital: string) => Promise<Politica2fa[]>;
  readonly assinaturaConfigurada?: (hospital: string) => Promise<boolean>;
  readonly agora?: () => Date;
  /** Controladores e provedores a mais (testes). */
  readonly controladores?: readonly Type<unknown>[];
  readonly provedores?: readonly Provider[];
}

/**
 * A fonte das telas do M10 pela regra do módulo (sem as opções de teste). A própria só é carregada com o núcleo
 * (import dinâmico): o dev/ci em memória não carrega o que fala com o banco.
 */
export async function fonteDaAdministracao(ctx: ContextoModulo): Promise<FonteAdministracao> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    const { FonteAdministracaoPropria } = await import('./fonte-propria.js');
    return new FonteAdministracaoPropria(ctx.nucleo, cliente, { rede: ctx.configuracao.rede });
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return fonteAdministracaoMemoria(ctx.trilha);
  return fonteAdministracaoIndisponivel();
}

/** A porta da certificação pela regra do módulo (sem as opções de teste). */
export function portaDaCertificacao(ctx: ContextoModulo): PortaSbis {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) return new PortaSbisPropria(ctx.nucleo, cliente);
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaSbisMemoria();
  return portaSbisIndisponivel();
}

@Module({})
export class ModuloAdministracao {}

export async function modulo(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloAdministracao = {},
): Promise<DynamicModule> {
  const fonte = opcoes.fonte ?? (await fonteDaAdministracao(ctx));
  const porta = opcoes.sbis ?? portaDaCertificacao(ctx);
  const servico = new ServicoSbis({
    porta,
    situacao: async () => SEM_SISTEMA_ANTERIOR,
    ...(opcoes.medidas ? { medidas: opcoes.medidas } : {}),
    ...(opcoes.politicas2fa ? { politicas2fa: opcoes.politicas2fa } : {}),
    ...(opcoes.assinaturaConfigurada ? { assinaturaConfigurada: opcoes.assinaturaConfigurada } : {}),
    ...(opcoes.agora ? { agora: opcoes.agora } : {}),
    ambiente: ctx.configuracao.ambiente,
    versao: () => new VersaoService().atual(ctx.configuracao.produtoNome),
  });
  return {
    module: ModuloAdministracao,
    controllers: [
      UsuariosController,
      RedeCpfController,
      PermissoesController,
      EstruturaController,
      AuditoriaController,
      SbisController,
      ImpressaoController,
      PreferenciasController,
      ...(opcoes.controladores ?? []),
    ],
    providers: [
      { provide: FONTE_ADMINISTRACAO, useValue: fonte },
      { provide: PORTA_SBIS, useValue: porta },
      { provide: SERVICO_SBIS, useValue: servico },
      ...(opcoes.provedores ?? []),
    ],
    // Global: os pedidos de acesso (módulo acesso) leem a fonte da administração.
    global: true,
    exports: [FONTE_ADMINISTRACAO, PORTA_SBIS, SERVICO_SBIS],
  };
}
