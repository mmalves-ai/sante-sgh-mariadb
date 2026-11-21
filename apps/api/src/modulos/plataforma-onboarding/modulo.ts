// Módulo do painel de onboarding de clientes (F4 L3; API_MODULOS=plataforma-onboarding). Com o núcleo (banco
// plataforma) monta o repositório e a ponte com os comandos do repositório (criar_cliente.py e conector.sh); sem o
// núcleo, as rotas respondem 503 (falha fechada).
import { type DynamicModule, Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { nucleoPlataforma } from '../../sessao/fonte-plataforma.js';
import type { ContextoModulo } from '../registro.js';
import { OnboardingController } from './onboarding.controller.js';
import { PonteConectorScript } from './ponte-script.js';
import { SERVICO_ONBOARDING } from './porta.js';
import { RepositorioOnboardingPlataforma } from './repositorio-plataforma.js';
import { ServicoOnboarding } from './servico.js';

export interface OpcoesModuloOnboarding {
  readonly servico?: ServicoOnboarding | null;
}

export function servicoDoOnboarding(ctx: ContextoModulo): ServicoOnboarding | null {
  const np = nucleoPlataforma(ctx.nucleo);
  if (!np) return null;
  const raiz = ctx.env['SGH_RAIZ_REPOSITORIO'] || resolve(import.meta.dirname, '../../../../..');
  return new ServicoOnboarding(
    new RepositorioOnboardingPlataforma(np),
    new PonteConectorScript({
      raiz,
      plataforma: ctx.env['SGH_BANCO_PLATAFORMA'] || 'plataforma',
      env: { CONECTOR_ORIGENS_DIR: ctx.env['CONECTOR_ORIGENS_DIR'] },
    }),
  );
}

@Module({})
class ModuloOnboarding {}

export function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloOnboarding = {}): DynamicModule {
  const servico = opcoes.servico !== undefined ? opcoes.servico : servicoDoOnboarding(ctx);
  return {
    module: ModuloOnboarding,
    controllers: [OnboardingController],
    providers: [{ provide: SERVICO_ONBOARDING, useValue: servico }],
  };
}
