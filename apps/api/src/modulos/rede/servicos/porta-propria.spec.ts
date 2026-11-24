// Porta própria dos serviços compartilhados sem o núcleo (montagem antiga, até a ligação no módulo): recusa com 501
// `pendente-modelo-proprio` em tudo, sem ler nem gravar; a lista do serviço não confunde a recusa com banco fora do ar.
// O comportamento sobre o banco do cliente está no porta-propria.int.spec.ts.
import { esquemaConsultaServicosRede } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { PortaServicosRedePropria } from './porta-propria.js';
import { ServicoServicosRede } from './servico.js';

const pendente = { problema: { status: 501, codigo: 'pendente-modelo-proprio' } };
const c = { rede: 'rede-x', hospital: 'hxa' };
const trilha = {
  estabelecimento: 1,
  usuario: 1,
  acao: 'operacao' as const,
  entidade: 'x',
  entidadeId: null,
  correlacao: 'x',
};

describe('porta própria dos serviços compartilhados sem o núcleo', () => {
  it('recusa 501 nas quatro chamadas', async () => {
    const p = new PortaServicosRedePropria();
    await expect(p.listar(c, { ate: 10 })).rejects.toMatchObject(pendente);
    await expect(p.ler(c, 1)).rejects.toMatchObject(pendente);
    await expect(
      p.registrar(
        c,
        { area: 'outro', titulo: 'abc', descricao: null, estabelecimentos: ['hxa'] },
        'U',
        trilha,
      ),
    ).rejects.toMatchObject(pendente);
    await expect(p.alterar(c, 1, { situacao: 'adotada' }, 'U', trilha)).rejects.toMatchObject(pendente);
  });

  it('sem cliente também recusa; a lista do serviço propaga o 501', async () => {
    const nucleo = {
      lerSomente: () => Promise.reject(new Error('não deveria ler')),
      criarExecutor: () => {
        throw new Error('não deveria montar o executor');
      },
    };
    const p = new PortaServicosRedePropria(nucleo, '');
    await expect(p.listar(c, { ate: 10 })).rejects.toMatchObject(pendente);
    const servico = new ServicoServicosRede(p, {
      redeConfigurada: () => c.rede,
      estabelecimentos: () => [{ codigo: c.hospital, nome: 'H' }],
    });
    await expect(
      servico.listar(
        { ...c, login: 'U', como: false, liberados: new Set([c.hospital]), trilha: () => trilha },
        esquemaConsultaServicosRede.parse({}),
      ),
    ).rejects.toMatchObject(pendente);
  });
});
