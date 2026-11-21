// Módulo do painel de onboarding de clientes (F4 L3; API_MODULOS=plataforma-onboarding). Com o núcleo (banco
// plataforma) monta o repositório e a ponte com os comandos do repositório (criar_cliente.py e conector.sh); sem o
// núcleo, as rotas respondem 503 (falha fechada).
import { type DynamicModule, Module } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

/** Sobe a partir de `inicio` até achar `conector/conector.sh`; sem achar, usa o diretório de trabalho do processo. */
export function raizDoRepositorio(inicio: string): string {
  let d = resolve(inicio);
  for (;;) {
    if (existsSync(resolve(d, 'conector/conector.sh'))) return d;
    const pai = dirname(d);
    if (pai === d) return process.cwd();
    d = pai;
  }
}

export function servicoDoOnboarding(ctx: ContextoModulo): ServicoOnboarding | null {
  const np = nucleoPlataforma(ctx.nucleo);
  if (!np) return null;
  // A raiz vem da variável ou da busca pelo conector/conector.sh subindo a partir deste arquivo: no build
  // empacotado (dist/) o caminho relativo fixo apontava para fora do repositório.
  const raiz = ctx.env['SGH_RAIZ_REPOSITORIO'] || raizDoRepositorio(import.meta.dirname);
  // Só repassa a pasta autorizada quando definida: um valor ausente viraria o texto "undefined" no ambiente do
  // processo filho e o conector recusaria a pasta.
  const origens = ctx.env['CONECTOR_ORIGENS_DIR'];
  return new ServicoOnboarding(
    new RepositorioOnboardingPlataforma(np),
    new PonteConectorScript({
      raiz,
      plataforma: ctx.env['SGH_BANCO_PLATAFORMA'] || 'plataforma',
      env: origens ? { CONECTOR_ORIGENS_DIR: origens } : {},
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
