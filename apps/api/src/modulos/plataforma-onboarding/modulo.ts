// Módulo do painel de onboarding de clientes (F4 L3; API_MODULOS=plataforma-onboarding). Com o núcleo (banco
// plataforma) monta o repositório e a ponte com os comandos do repositório (criar_cliente.py e conector.sh); sem o
// núcleo, as rotas respondem 503 (falha fechada).
import { type DynamicModule, Module } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chaveMestra } from '@sgh/dominio-acesso';
import { nucleoPlataforma } from '../../sessao/fonte-plataforma.js';
import { cofreDoAmbiente } from '../assinatura/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { CargaController } from './carga.controller.js';
import { OnboardingController } from './onboarding.controller.js';
import { PonteConectorScript } from './ponte-script.js';
import { SERVICO_ONBOARDING } from './porta.js';
import { RepositorioCargaPlataforma, RepositorioOnboardingPlataforma } from './repositorio-plataforma.js';
import { SERVICO_CARGA, ServicoCarga } from './servico-carga.js';
import { ServicoOnboarding } from './servico.js';

export interface OpcoesModuloOnboarding {
  readonly servico?: ServicoOnboarding | null;
  readonly servicoCarga?: ServicoCarga | null;
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
  return new ServicoOnboarding(new RepositorioOnboardingPlataforma(np), ponteDoAmbiente(ctx));
}

function ponteDoAmbiente(ctx: ContextoModulo): PonteConectorScript {
  // A raiz vem da variável ou da busca pelo conector/conector.sh subindo a partir deste arquivo: no build
  // empacotado (dist/) o caminho relativo fixo apontava para fora do repositório.
  const raiz = ctx.env['SGH_RAIZ_REPOSITORIO'] || raizDoRepositorio(import.meta.dirname);
  // Só repassa a pasta autorizada quando definida: um valor ausente viraria o texto "undefined" no ambiente do
  // processo filho e o conector recusaria a pasta.
  const origens = ctx.env['CONECTOR_ORIGENS_DIR'];
  return new PonteConectorScript({
    raiz,
    plataforma: ctx.env['SGH_BANCO_PLATAFORMA'] || 'plataforma',
    env: origens ? { CONECTOR_ORIGENS_DIR: origens } : {},
  });
}

/** Tela "Carga e sincronismo" (obra carga-painel): o mesmo banco plataforma e a mesma ponte; a senha da origem de
 * servidor vai ao cofre de arquivo (COFRE_DIR fora do repositório + PLATAFORMA_CHAVE_MESTRA); o log é lido de
 * CONECTOR_LOG_DIR. Sem o núcleo, as rotas respondem 503. */
export function servicoDaCarga(ctx: ContextoModulo): ServicoCarga | null {
  const np = nucleoPlataforma(ctx.nucleo);
  if (!np) return null;
  const raiz = ctx.env['SGH_RAIZ_REPOSITORIO'] || raizDoRepositorio(import.meta.dirname);
  return new ServicoCarga(
    new RepositorioCargaPlataforma(np),
    ponteDoAmbiente(ctx),
    cofreDoAmbiente(ctx.env, chaveMestra(ctx.env['PLATAFORMA_CHAVE_MESTRA']), raiz),
    ctx.env['CONECTOR_LOG_DIR']?.trim() || null,
  );
}

@Module({})
class ModuloOnboarding {}

export function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloOnboarding = {}): DynamicModule {
  const servico = opcoes.servico !== undefined ? opcoes.servico : servicoDoOnboarding(ctx);
  const servicoCarga = opcoes.servicoCarga !== undefined ? opcoes.servicoCarga : servicoDaCarga(ctx);
  return {
    module: ModuloOnboarding,
    controllers: [OnboardingController, CargaController],
    providers: [
      { provide: SERVICO_ONBOARDING, useValue: servico },
      { provide: SERVICO_CARGA, useValue: servicoCarga },
    ],
  };
}
