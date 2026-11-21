// Opções de teste do módulo "pessoas" pela HTTP, TIPADAS (sem cast): as portas sintéticas que os specs passam e a
// conferência, logo depois de subir a app, de que cada uma chegou ao módulo. Se o módulo ignorar uma opção (ex.: ainda
// não a lê do ContextoModulo), o teste falha com o nome dela, em vez de rodar sobre outra porta sem aviso.
// A app sobe com o módulo "pessoas" do registro montado com as opções (moduloPessoas), mais os módulos pedidos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OpcoesAppBase } from '../../app-base.module.js';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { REGISTRO_MODULOS } from '../registro.js';
import { moduloPessoas, type OpcoesModuloPessoas } from './modulo.js';
import type { CifraCpf } from './cifra-cpf.js';
import { PORTA_INDICADORES_PESSOAS, type PortaIndicadoresPessoas } from './indicadores/porta-indicadores.js';
import { CIFRA_CPF_PESSOAS } from './pessoas.controller.js';
import { PORTA_PESSOAS, type PortaPessoas } from './porta.js';

export const PESSOAS_REGISTRADO = 'pessoas' in REGISTRO_MODULOS;

/** As opções da app base mais as portas sintéticas que o módulo "pessoas" deve aceitar (pedido ao lote que o registrar). */
export interface OpcoesTestePessoas extends OpcoesAppBase, Omit<OpcoesModuloPessoas, 'configuracao'> {
  readonly pessoas?: PortaPessoas;
  readonly indicadoresPessoas?: PortaIndicadoresPessoas;
  readonly cifraCpf?: CifraCpf | null;
  readonly configuracao?: FonteConfiguracao;
}

const TOKENS = {
  pessoas: PORTA_PESSOAS,
  indicadoresPessoas: PORTA_INDICADORES_PESSOAS,
  cifraCpf: CIFRA_CPF_PESSOAS,
  configuracao: FONTE_CONFIGURACAO,
} as const;

/** Falha se alguma opção passada não for a instância que o módulo injetou. */
export function conferirOpcoesPessoas(app: NestFastifyApplication, o: OpcoesTestePessoas): void {
  for (const k of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
    if (!(k in o)) continue;
    let injetado: unknown;
    try {
      // Outro módulo montado junto pode prover o mesmo token (como a configuração): basta uma das instâncias ser a dada.
      const todas: unknown[] = app.get(TOKENS[k], { strict: false, each: true });
      injetado = todas.includes(o[k] ?? null) ? (o[k] ?? null) : todas[0];
    } catch {
      injetado = undefined;
    }
    if (injetado !== (o[k] ?? null))
      throw new Error(
        `A opção de teste "${k}" não chegou ao módulo pessoas: ligue-a pelo ContextoModulo do módulo.`,
      );
  }
}

/** Sobe a app com as opções tipadas e confere que cada porta sintética foi a injetada. */
export async function criarAppPessoas(
  env: Record<string, string>,
  o: OpcoesTestePessoas,
): Promise<NestFastifyApplication> {
  const registro = {
    ...(o.registro ?? REGISTRO_MODULOS),
    pessoas: async () => ({ modulo: (ctx: Parameters<typeof moduloPessoas>[0]) => moduloPessoas(ctx, o) }),
  };
  const pedidos = (env['API_MODULOS'] ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const modulos = pedidos.includes('todos') ? pedidos : [...new Set([...pedidos, 'pessoas'])];
  const comPessoas = { ...env, API_MODULOS: modulos.join(',') };
  const app = await criarApp(lerConfiguracao(comPessoas), null, comPessoas, { ...o, registro });
  conferirOpcoesPessoas(app, o);
  return app;
}
