// M55 (etapa 3): o pedido e o título ligados a contrato pedem a permissão de ligar ao contrato
// (suprimentos.contrato.editar, a mesma da tela de contratos) antes da liberação e da gravação; a negação vai à
// trilha e responde 403. Sem o campo `contrato`, nada muda. Sessões sintéticas.
import { PERMISSOES_CONTRATO_CODIGOS } from '@sgh/contratos';
import { describe, expect, it, vi } from 'vitest';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { exigir, type SessaoCadastro } from '../cadastro/comum.js';
import { ServicoFinanceiro } from '../financeiro/servico.js';
import { ServicoSuprimentos } from './servico.js';

function sessao(permissoes: readonly string[]): SessaoCadastro {
  return {
    req: { headers: {} } as unknown as SessaoCadastro['req'],
    hospital: 'pc',
    rede: 'sante',
    login: 'SINT.TESTE',
    porta: { rede: 'sante', hospital: 'pc' } as unknown as SessaoCadastro['porta'],
    pode: (c) => permissoes.includes(c),
  };
}

function montar<T extends object>(proto: T) {
  const trilha = { registrar: vi.fn(async () => ({}) as never) } as unknown as RegistradorTrilha;
  const liberacao = vi.fn(async () => undefined);
  const executar = vi.fn(async () => ({ mensagem: 'ok', repetida: false, resultado: {} }));
  const contratos = {
    exigirPermissao: (s: SessaoCadastro, c: string) => exigir(s, c, trilha),
    exigirLiberacao: liberacao,
  };
  const servico = Object.create(proto) as Record<string, unknown>;
  servico['apoios'] = {
    apoios: { contratos },
    daOperacao: () => ({ executar }),
  };
  return { servico, trilha, liberacao, executar };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (x) {
    return (x as { getStatus?: () => number }).getStatus?.() ?? (x as { status?: number }).status ?? 500;
  }
};

const contrato = { contrato: 1, excecao: null, pedidoDeOrigem: null };

describe('o vínculo com o contrato na criação do pedido e do título', () => {
  it('o pedido com contrato sem a permissão de ligar: 403, a negação na trilha, sem liberação nem gravação', async () => {
    const m = montar(ServicoSuprimentos.prototype);
    const criar = (m.servico as unknown as ServicoSuprimentos).criarPedido.bind(m.servico);
    const e = { contrato } as unknown as Parameters<ServicoSuprimentos['criarPedido']>[1];
    expect(await status(criar(sessao(['suprimentos.pedido.criar']), e))).toBe(403);
    expect(m.trilha.registrar).toHaveBeenCalledTimes(1);
    expect(m.liberacao).not.toHaveBeenCalled();
    expect(m.executar).not.toHaveBeenCalled();
    // Com a permissão: segue para a liberação e a gravação.
    expect(await status(criar(sessao([PERMISSOES_CONTRATO_CODIGOS.editar]), e))).toBe(200);
    expect(m.liberacao).toHaveBeenCalledTimes(1);
    // Sem contrato: nada a mais é exigido.
    const sem = {} as Parameters<ServicoSuprimentos['criarPedido']>[1];
    expect(await status(criar(sessao([]), sem))).toBe(200);
    expect(m.liberacao).toHaveBeenCalledTimes(1);
  });

  it('o título com contrato sem a permissão de ligar: 403 antes da liberação e da gravação', async () => {
    const m = montar(ServicoFinanceiro.prototype);
    const criar = (m.servico as unknown as ServicoFinanceiro).criarTituloPagar.bind(m.servico);
    const e = { acao: 'incluir', contrato } as unknown as Parameters<
      ServicoFinanceiro['criarTituloPagar']
    >[1];
    expect(await status(criar(sessao(['financeiro.titulo.pagar.incluir']), e))).toBe(403);
    expect(m.liberacao).not.toHaveBeenCalled();
    expect(m.executar).not.toHaveBeenCalled();
    expect(await status(criar(sessao([PERMISSOES_CONTRATO_CODIGOS.editar]), e))).toBe(200);
    expect(m.liberacao).toHaveBeenCalledTimes(1);
  });
});
