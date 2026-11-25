// Valores habituais da abertura pela porta em MEMÓRIA e pelo serviço (o caminho do E2E sintético): gravação por
// escopo, controle otimista, recusas e a ficha do paciente com e sem atendimento anterior. Massa SINTÉTICA.
import { describe, expect, it } from 'vitest';
import { PortaAtendimentoMemoria } from './porta-memoria.js';
import { ServicoAtendimento } from './servico.js';

const c = {
  cliente: 'teste',
  estabelecimento: 1,
  usuario: null,
  correlacao: 'padrao',
  rede: 'r',
  hospital: 'h',
};
let n = 0;
const g = () => ({ ...c, chaveIdempotencia: `padrao-${++n}`, login: 'SINT.ATENDIMENTO', estacao: 'TESTE' });

describe('valores habituais da abertura na porta em memória', () => {
  it('grava por escopo, aplica na ficha e recusa versão velha, nada a alterar e item fora de uso', async () => {
    const porta = new PortaAtendimentoMemoria({ estado: () => 'verde' });
    const servico = new ServicoAtendimento(porta);
    const exec = (op: string, valores: object, versao: number) =>
      porta.executar(c as never, `atendimento.${op}`, { valores, versao }, g() as never);

    expect((await servico.configuracaoPadraoAbertura(c as never)).versaoEstabelecimento).toBe(0);
    await exec('definirPadraoAbertura', { unidade: 1, convenio: 320 }, 0);
    await exec('definirMeuPadraoAbertura', { centroCusto: 300600 }, 0);
    const cfg = await servico.configuracaoPadraoAbertura(c as never);
    expect(cfg).toMatchObject({ versaoEstabelecimento: 1, versaoPessoal: 1 });
    expect(cfg.campos.find((x) => x.campo === 'unidade')?.emVigor).toMatchObject({
      id: 1,
      origem: 'estabelecimento',
    });
    expect(cfg.campos.find((x) => x.campo === 'centroCusto')?.emVigor).toMatchObject({
      id: 300600,
      origem: 'usuario',
    });

    // Paciente 1006: sem atendimento anterior, recebe todos os valores em vigor.
    const novo = await servico.historico(c as never, 1006);
    expect(novo.anterior).toBeNull();
    expect(novo.padrao?.valores).toEqual({ unidade: 1, centroCusto: 300600, convenio: 320 });
    // Paciente 1002: o convênio vem do atendimento anterior; o hábito só completa unidade e centro de custo.
    const antigo = await servico.historico(c as never, 1002);
    expect(antigo.anterior?.herdados).toHaveProperty('convenio');
    expect(antigo.padrao?.valores).toEqual({ unidade: 1, centroCusto: 300600 });

    await expect(exec('definirPadraoAbertura', { unidade: 2 }, 0)).rejects.toMatchObject({
      problema: { codigo: 'conflito-versao' },
    });
    await expect(exec('definirPadraoAbertura', { unidade: 1 }, 1)).rejects.toMatchObject({
      problema: { codigo: 'nada-a-alterar' },
    });
    await expect(exec('definirPadraoAbertura', { unidade: 99 }, 1)).rejects.toMatchObject({
      problema: { codigo: 'padrao-invalido' },
    });
    // Limpar: o campo fica sem valor habitual e a versão avança.
    await exec('definirPadraoAbertura', { unidade: null, convenio: null }, 1);
    expect((await servico.historico(c as never, 1006)).padrao?.valores).toEqual({ centroCusto: 300600 });
  });
});
