// Os efeitos da aprovação ligados às portas próprias (sem banco): cada efeito monta o gravador da porta do módulo sobre a
// MESMA transação e com o contexto de quem decide, expõe só os métodos do contrato, declara as tabelas que grava, e as
// férias sem o cálculo ligado recusam com modelo-pendente.
import { ErroOperacao, type TxOperacao } from '@sgh/nucleo';
import { describe, expect, it, vi } from 'vitest';
import type { PortaPessoasPropria } from '../porta-propria.js';
import type { PortaPontoPropria } from '../ponto/porta-ponto-propria.js';
import {
  efeitosAutoatendimentoProprios,
  fonteCalculoDe,
  METODOS_EFEITO_PESSOAS,
  METODOS_EFEITO_PONTO,
} from './efeitos-proprios.js';
import type { ContextoAutoatendimento } from './porta-autoatendimento.js';

const ctx = { cliente: 't', estabelecimento: 3, usuario: 9, correlacao: 'x' } as ContextoAutoatendimento;
const tx = {
  uma: vi.fn(async () => ({ fuso_horario: 'America/Recife' })),
} as unknown as TxOperacao;

function portas() {
  const chamadasPonto: unknown[][] = [];
  const chamadasPessoas: unknown[][] = [];
  const gravadorPonto = Object.fromEntries(
    [...METODOS_EFEITO_PONTO, 'incluirMarcacao'].map((m) => [m, vi.fn(async (...a: unknown[]) => [m, ...a])]),
  );
  const gravadorPessoas = Object.fromEntries(
    [...METODOS_EFEITO_PESSOAS, 'desligarVinculo'].map((m) => [
      m,
      vi.fn(async (...a: unknown[]) => [m, ...a]),
    ]),
  );
  const ponto = {
    gravador: (...a: unknown[]) => {
      chamadasPonto.push(a);
      return gravadorPonto;
    },
  } as unknown as PortaPontoPropria;
  const pessoas = {
    gravador: (...a: unknown[]) => {
      chamadasPessoas.push(a);
      return gravadorPessoas;
    },
  } as unknown as PortaPessoasPropria;
  return { ponto, pessoas, chamadasPonto, chamadasPessoas, gravadorPonto };
}

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe('efeitos da aprovação do autoatendimento sobre as portas próprias', () => {
  it('declara as tabelas do ponto, do cadastro e da trilha (e as do cálculo, quando ligado)', () => {
    const p = portas();
    const sem = efeitosAutoatendimentoProprios(p);
    expect(sem.tabelas).toEqual(
      expect.arrayContaining([
        'ajuste_ponto',
        'vinculo_trabalho',
        'colaborador',
        'historico_cargo',
        'trilha_auditoria',
      ]),
    );
    expect(sem.tabelas).not.toContain('programacao_ferias');
    const com = efeitosAutoatendimentoProprios({
      ...p,
      calculo: { tabelas: ['programacao_ferias', 'ajuste_ponto'], gravadorNaTransacao: () => ({}) as never },
    });
    expect(com.tabelas).toContain('programacao_ferias');
    expect(com.tabelas.filter((t) => t === 'ajuste_ponto')).toHaveLength(1);
  });

  it('o ponto: o gravador da porta na mesma transação, com o contexto e o fuso, montado uma vez', async () => {
    const p = portas();
    const g = efeitosAutoatendimentoProprios(p).gravadores(tx, 3, ctx);
    expect(p.chamadasPonto).toHaveLength(0);
    expect(await g.ponto.travarPessoa(5)).toEqual(['travarPessoa', 5]);
    expect(await g.ponto.ajustes(1, '2026-10-01', '2026-10-31')).toEqual([
      'ajustes',
      1,
      '2026-10-01',
      '2026-10-31',
    ]);
    expect(p.chamadasPonto).toEqual([[tx, ctx, 3, 'America/Recife']]);
  });

  it('o ponto: o ajuste é pedido com a conta do solicitante (por) e decidido com a de quem decide', async () => {
    const p = portas();
    const t = {
      uma: vi.fn(async (sql: string, a: unknown[]) =>
        sql.includes('FROM usuario')
          ? a[0] === 'colab'
            ? { id: 41 }
            : null
          : { fuso_horario: 'America/Recife' },
      ),
    } as unknown as TxOperacao;
    const g = efeitosAutoatendimentoProprios(p).gravadores(t, 3, ctx);
    const pedido = { vinculo: 1, dia: '2026-10-20', tipo: 'justificativa', por: 'colab' } as never;
    await g.ponto.incluirAjuste(pedido);
    await g.ponto.decidirAjuste({ id: 7, versao: 1, situacao: 'aprovado', motivo: null, por: 'gestor' });
    expect(p.chamadasPonto).toEqual([
      [t, { ...ctx, usuario: 41 }, 3, 'America/Recife'],
      [t, ctx, 3, 'America/Recife'],
    ]);
    expect(p.gravadorPonto['incluirAjuste']).toHaveBeenCalledWith(pedido);
    // Solicitante sem conta no cliente: recusa (a operação inteira é desfeita), sem pedir o ajuste.
    expect(await codigo(g.ponto.incluirAjuste({ ...(pedido as object), por: 'ninguem' } as never))).toBe(
      'usuario-inexistente',
    );
    expect(p.gravadorPonto['incluirAjuste']).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(g.ponto)).toBe(true);
  });

  it('o cadastro: o gravador da porta na mesma transação e com o contexto de quem decide', async () => {
    const p = portas();
    const g = efeitosAutoatendimentoProprios(p).gravadores(tx, 3, ctx);
    expect(await g.pessoas.vinculo(7)).toEqual(['vinculo', 7]);
    await g.pessoas.registrarCorrecao({
      vinculo: 7,
      operacao: 'o',
      antes: {},
      depois: {},
      motivo: 'm',
      por: 'x',
    });
    expect(p.chamadasPessoas).toEqual([[tx, ctx, 3]]);
  });

  it('só os métodos do contrato ficam alcançáveis', () => {
    const g = efeitosAutoatendimentoProprios(portas()).gravadores(tx, 3, ctx);
    expect(Object.keys(g.ponto).sort()).toEqual([...METODOS_EFEITO_PONTO].sort());
    expect(Object.keys(g.pessoas).sort()).toEqual([...METODOS_EFEITO_PESSOAS].sort());
    expect((g.ponto as unknown as Record<string, unknown>)['incluirMarcacao']).toBeUndefined();
    expect((g.pessoas as unknown as Record<string, unknown>)['desligarVinculo']).toBeUndefined();
  });

  it('as férias sem o cálculo ligado recusam com modelo-pendente', async () => {
    const g = efeitosAutoatendimentoProprios(portas()).gravadores(tx, 3, ctx);
    expect(await codigo(g.folha.feriasDoVinculoComTrava(1))).toBe('modelo-pendente');
    expect(await codigo(g.folha.incluirFerias({} as never))).toBe('modelo-pendente');
  });

  it('as férias com o cálculo: o gravador do cálculo sobre a mesma transação', async () => {
    const feito: unknown[] = [];
    const porta = {
      gravadorNaTransacao(this: unknown, t: unknown, est: number) {
        feito.push(this === porta, t, est);
        return { feriasDoVinculoComTrava: async () => [], incluirFerias: async () => 42 };
      },
    };
    const calculo = fonteCalculoDe(porta, ['programacao_ferias']);
    expect(calculo?.tabelas).toEqual(['programacao_ferias']);
    const g = efeitosAutoatendimentoProprios({ ...portas(), calculo }).gravadores(tx, 3, ctx);
    expect(await g.folha.incluirFerias({} as never)).toBe(42);
    expect(feito).toEqual([true, tx, 3]);
    expect(fonteCalculoDe({})).toBeNull();
    expect(fonteCalculoDe(null)).toBeNull();
  });
});
