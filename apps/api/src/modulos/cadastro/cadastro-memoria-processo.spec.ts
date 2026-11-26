// X-01 (C1-045): a ficha do usuário em memória lê o profissional do login da porta do cadastro que o módulo cadastro
// usa. Outros módulos que pedem a porta (carga, telemedicina, PEP, portal) não podem trocar essa instância.
import { describe, expect, it } from 'vitest';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste } from '../../sessao/teste.spec-util.js';
import type { ContextoModulo } from '../registro.js';
import { modulo, portaDoCadastro } from './modulo.js';
import { cadastroMemoriaAtual, PortaCadastroMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'cadastro' };
const ctx = { configuracao: lerConfiguracao(env), nucleo: null, env } as unknown as ContextoModulo;

describe('porta do cadastro em memória do processo (X-01)', () => {
  it('só o módulo cadastro registra a instância; outro pedido da porta não a sobrescreve', async () => {
    const doModulo = new PortaCadastroMemoria();
    await modulo(ctx, { porta: doModulo });
    expect(cadastroMemoriaAtual()).toBe(doModulo);

    const deOutroModulo = await portaDoCadastro(ctx);
    expect(deOutroModulo).toBeInstanceOf(PortaCadastroMemoria);
    expect(deOutroModulo).not.toBe(doModulo);
    expect(cadastroMemoriaAtual()).toBe(doModulo);
  });

  it('sem porta dada, o módulo cadastro registra a que ele mesmo criou', async () => {
    await modulo(ctx);
    const atual = cadastroMemoriaAtual();
    expect(atual).toBeInstanceOf(PortaCadastroMemoria);
    await portaDoCadastro(ctx);
    expect(cadastroMemoriaAtual()).toBe(atual);
  });
});
