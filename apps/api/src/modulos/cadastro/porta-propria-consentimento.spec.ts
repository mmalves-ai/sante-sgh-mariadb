// Complemento da porta própria do cadastro sem banco: opções com os códigos da tela e as recusas de entrada antes de
// qualquer leitura ou gravação (o comportamento sobre o banco está no porta-propria-consentimento.int.spec.ts).
import { describe, expect, it } from 'vitest';
import type { ContextoPorta } from './porta.js';
import { CadastroProprioConsentimento } from './porta-propria-consentimento.js';
import type { RegistroTrilhaTela } from './tipos.js';

const nucleo = {
  lerSomente: () => Promise.reject(new Error('não deveria ler')),
  criarExecutor: () =>
    ({
      executar: () => Promise.reject(new Error('não deveria gravar')),
    }) as never,
};
const c: ContextoPorta = {
  cliente: 'x',
  estabelecimento: 1,
  usuario: 1,
  correlacao: 'teste',
  rede: 'r',
  hospital: 'h',
};
const trilha: RegistroTrilhaTela = {
  estabelecimento: 1,
  usuario: 1,
  acao: 'operacao',
  entidade: 'consentimento_titular',
  entidadeId: null,
  correlacao: 'teste',
};

describe('consentimentos do cadastro no banco próprio (sem banco)', () => {
  const p = new CadastroProprioConsentimento(nucleo, 'x');
  const base = { idPaciente: 1, pront: 1, finalidade: 'F', versao: 'v1', usuario: 'U' };

  it('opções com os códigos da tela (os mesmos da porta em memória)', async () => {
    const o = await p.opcoesConsentimento();
    expect(o.situacoes.map((x) => x.codigo)).toEqual([3, 4]);
    expect(o.signatarios.map((x) => x.codigo)).toEqual([1, 2]);
    expect(o.revogacoes.map((x) => x.codigo)).toEqual([2]);
  });

  it('recusa situação, signatário e motivo desconhecidos sem ler nem gravar', async () => {
    await expect(
      p.registrarConsentimento(c, { ...base, situacao: 1, signatario: 1 }, trilha),
    ).rejects.toMatchObject({
      problema: { codigo: 'situacao-invalida' },
    });
    await expect(
      p.registrarConsentimento(c, { ...base, situacao: 3, signatario: 3 }, trilha),
    ).rejects.toMatchObject({
      problema: { codigo: 'signatario-invalido' },
    });
    await expect(
      p.revogarConsentimento(c, { idPaciente: 1, id: 1, motivo: 1, usuario: 'U' }, trilha),
    ).rejects.toMatchObject({ problema: { codigo: 'motivo-invalido' } });
  });

  it('id de paciente inválido: lista vazia sem ler', async () => {
    expect(await p.consentimentos(c, 0)).toEqual([]);
  });
});
