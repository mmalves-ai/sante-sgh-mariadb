// F3.6 (05-SUP linha 3): a porta do cadastro do estoque EM MEMÓRIA (sessão sintética de dev/ci, a do E2E
// f36-local-escopo): o local guarda o que atende e o que guarda, a inativação com saldo é recusada, a versão lida
// vencida não grava, o escopo do usuário por local é gravado e retirado, e um estabelecimento não vê o do outro.
// O que fica no banco é provado no contrato de efeito da porta própria.
import { describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaCadastroEstoqueMemoria } from './cadastro-estoque-porta-memoria.js';

const c = { cliente: 'sintetico', estabelecimento: 1, usuario: 1 } as unknown as ContextoPortaM18;
const codigoDe = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'gravou';
  } catch (x) {
    const e = x as { codigo?: string; problema?: { codigo?: string } };
    return e.codigo ?? e.problema?.codigo ?? String(x);
  }
};

describe('cadastro do estoque em memória (local e escopo do usuário)', () => {
  it('local: grava o que atende e o que guarda; a ficha devolve o gravado e a versão sobe', async () => {
    const porta = new PortaCadastroEstoqueMemoria(() => '2026-03-15');
    expect(porta.destino).toBe('memoria');
    const { id, versao, ativo, ...dados } = (await porta.fichaLocal(c, 10))!;
    expect(ativo).toBe(true);
    const r = await porta.alterarLocal(c, id, versao, {
      ...dados,
      atendeSetor: true,
      apenasUrgente: true,
      classificacoes: [{ grupo: 1 }],
    } as typeof dados);
    expect(r.versao).toBe(versao + 1);
    expect(await porta.fichaLocal(c, 10)).toMatchObject({
      atendeSetor: true,
      apenasUrgente: true,
      classificacoes: [{ grupo: 1 }],
      versao: versao + 1,
    });
    // A versão lida vencida não grava por cima.
    expect(await codigoDe(porta.alterarLocal(c, id, versao, dados))).not.toBe('gravou');
    expect((await porta.fichaLocal(c, 10))?.apenasUrgente).toBe(true);
    // Grupo que não existe: recusado, nada muda.
    expect(
      await codigoDe(
        porta.alterarLocal(c, id, versao + 1, { ...dados, classificacoes: [{ grupo: 999 }] } as typeof dados),
      ),
    ).toBe('referencia-inexistente');
  });

  it('local com saldo não é inativado; o motivo é exigido', async () => {
    const porta = new PortaCadastroEstoqueMemoria(() => '2026-03-15');
    const ficha = (await porta.fichaLocal(c, 10))!;
    expect(
      await codigoDe(porta.situacaoLocal(c, 10, ficha.versao, false, 'Encerramento sintético do local')),
    ).not.toBe('gravou');
    expect((await porta.fichaLocal(c, 10))?.ativo).toBe(true);
    // O posto não tem saldo: inativa com motivo e sai da lista de apoio.
    const posto = (await porta.fichaLocal(c, 20))!;
    expect(await codigoDe(porta.situacaoLocal(c, 20, posto.versao, false, ''))).not.toBe('gravou');
    await porta.situacaoLocal(c, 20, posto.versao, false, 'Posto sintético desativado');
    expect((await porta.fichaLocal(c, 20))?.ativo).toBe(false);
    expect((await porta.apoio(c)).locais.map((l) => l.id)).not.toContain(20);
  });

  it('escopo: busca o usuário, grava ações por local, concede outro local e retira', async () => {
    const porta = new PortaCadastroEstoqueMemoria(() => '2026-03-15');
    expect((await porta.buscar(c, 'usuarios', 'almox')).map((u) => u.codigo)).toEqual(['SINT.ALMOXARIFE']);
    const antes = (await porta.escopoUsuario(c, 9001))!;
    expect(antes.locais).toMatchObject([{ local: 10, permissoes: ['requisitar', 'atender', 'receberNota'] }]);
    await porta.gravarEscopoLocal(c, 9001, 10, {
      permissoes: ['requisitar', 'atender', 'receberNota', 'inventariar'],
    });
    await porta.gravarEscopoLocal(c, 9001, 20, { permissoes: ['requisitar'] });
    const depois = (await porta.escopoUsuario(c, 9001))!;
    expect(depois.locais.map((l) => l.local).sort()).toEqual([10, 20]);
    expect(depois.locais.find((l) => l.local === 10)?.permissoes).toContain('inventariar');
    // Local marcado sem nenhuma ação é recusado (regra do domínio); retirar tira a linha.
    expect(await codigoDe(porta.gravarEscopoLocal(c, 9001, 20, { permissoes: [] }))).not.toBe('gravou');
    await porta.retirarEscopoLocal(c, 9001, 20);
    expect((await porta.escopoUsuario(c, 9001))!.locais.map((l) => l.local)).toEqual([10]);
    expect(await codigoDe(porta.retirarEscopoLocal(c, 9001, 20))).toBe('escopo-inexistente');
  });

  it('outro estabelecimento não vê os locais nem o escopo deste', async () => {
    const porta = new PortaCadastroEstoqueMemoria(() => '2026-03-15');
    await porta.locais(c);
    const outro = { ...c, estabelecimento: 2 } as ContextoPortaM18;
    expect(await porta.locais(outro)).toEqual([]);
    expect(await porta.fichaLocal(outro, 10)).toBeNull();
    expect((await porta.escopoUsuario(outro, 9001))?.locais).toEqual([]);
  });
});
