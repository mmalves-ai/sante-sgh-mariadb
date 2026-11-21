// Apoio dos testes HTTP do PEP sobre a app migrada (F2.2, lote 04-02): a base com a configuração sintética, o cadastro
// e o PEP, com as portas em memória passadas pelo teste (o resto pela regra do módulo, a memória de dev/ci).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { criarApp } from '../../app.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { moduloConfiguracaoDeTeste, registroDeTeste } from '../cadastro/teste.spec-util.js';
import { modulo as moduloConfig } from '../config/modulo.js';
import { moduloPep, type OpcoesModuloPep } from './modulo.js';

export interface OpcoesAppPep extends OpcoesModuloPep {
  readonly trilha: RegistradorTrilha;
  /** Monta o módulo de configuração de verdade (telas de liberação e parâmetros) no lugar da configuração sintética. */
  readonly comConfig?: boolean;
}

/** A app do teste (sem núcleo): base, configuração sintética, cadastro e PEP. Quem chama faz o init e o close. */
export function criarAppPep(env: Record<string, string>, o: OpcoesAppPep): Promise<NestFastifyApplication> {
  const configuracao = o.comConfig ? 'config' : 'configuracao_teste';
  const e = { ...env, API_MODULOS: `${configuracao},cadastro,pep` };
  const cadastro = o.cadastro ?? new PortaCadastroMemoria();
  return criarApp(lerConfiguracao(e), null, e, {
    trilha: o.trilha,
    registro: registroDeTeste(
      { cadastro },
      {
        configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx),
        config: (ctx) => moduloConfig(ctx),
        pep: (ctx) => moduloPep(ctx, { ...o, cadastro }),
      },
    ),
  });
}
