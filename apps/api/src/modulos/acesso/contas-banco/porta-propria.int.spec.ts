// Integração da porta PRÓPRIA do painel de contas do banco contra o MariaDB real (cliente f22_o2): só leitura do
// information_schema do banco do cliente. A conta do núcleo (a do ambiente; root no dev) aparece pelo nome, com
// privilégio em todas as tabelas-base; as contas fora da lista legível só no agregado; nenhuma linha de dado lida.
// SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { nomesLegiveis } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contasSghDoAmbiente, PortaContasBancoPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const C = { rede: 'teste', hospital: 'l0202e' };

describe.skipIf(SEM_BANCO)('porta própria das contas do banco (information_schema, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaContasBancoPropria;
  const sgh = contasSghDoAmbiente(process.env);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaContasBancoPropria(nucleo, CLIENTE, sgh);
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('conta as tabelas-base do banco do cliente', async () => {
    expect(await porta.contarTabelas(C)).toBeGreaterThan(1000);
  });

  it('o inventário traz a conta do núcleo pelo nome, com leitura e escrita em todas as tabelas', async () => {
    const tabelas = await porta.contarTabelas(C);
    const inv = await porta.lerInventario(C, nomesLegiveis(sgh));
    const minha = inv.contas.find((c) => c.nome?.toUpperCase() === sgh.aplicacao[0]?.toUpperCase());
    expect(minha).toBeDefined();
    expect(minha?.privilegios.S).toBe(tabelas);
    expect(minha?.objetosComEscrita).toBe(tabelas);
    // Fora da lista legível: só contado, nunca pelo nome.
    expect(inv.contas.filter((c) => c.nome === null).length).toBeLessThanOrEqual(1);
    expect(inv.loginsNaoLegiveis).toBeGreaterThanOrEqual(0);
  });

  it('privilégios da aplicação e quem pode apagar linha', async () => {
    const tabelas = await porta.contarTabelas(C);
    const reais = await porta.lerPrivilegiosSgh();
    expect(reais.some((r) => r.acao === 'DELETE')).toBe(true);
    const del = await porta.lerDeleteClinico(C, nomesLegiveis(sgh));
    expect(del.find((x) => x.titular?.toUpperCase() === sgh.aplicacao[0]?.toUpperCase())?.tabelas).toBe(tabelas);
  });
});
