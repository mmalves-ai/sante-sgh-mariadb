// Unidade da família de gravação da prescrição no banco próprio: conversões, nomes de operação, decisões, recusas
// de tipo de item ainda sem adaptador e as leituras sobre um Leitor dublê (sem banco).
import { ErroOperacao, type Executor, type Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  conferirItensSuportados,
  decisaoGravada,
  GravacaoPrescricaoPropria,
  instanteLocal,
  nomeOperacao,
} from './prescricao-propria-gravacao.js';
import type { ItemGravacao } from './tipos-pep.js';

const ctx = {
  cliente: 'teste',
  estabelecimento: null,
  usuario: null,
  correlacao: 'spec',
  rede: 'r',
  hospital: 'H1',
};

/** Leitor dublê: responde pela primeira regra cujo trecho aparece no SQL. */
function dubleNucleo(regras: [string, Record<string, unknown>[]][]) {
  const sqls: string[] = [];
  const responder = (sql: string) => {
    sqls.push(sql);
    if (sql.includes('FROM estabelecimento WHERE codigo')) return [{ id: 7, fuso_horario: 'America/Sao_Paulo' }];
    return regras.find(([t]) => sql.includes(t))?.[1] ?? [];
  };
  const l = {
    consultar: async (sql: string) => responder(sql),
    uma: async (sql: string) => responder(sql)[0] ?? null,
  } as unknown as Leitor;
  const nucleo = {
    lerSomente: async <T>(_c: unknown, fn: (l: Leitor) => Promise<T>) => fn(l),
    criarExecutor: () => {
      throw new Error('sem executor no teste de unidade');
    },
  };
  return { porta: new GravacaoPrescricaoPropria(nucleo as never, 'teste'), sqls };
}

const item = (detalhe: Record<string, unknown>): ItemGravacao =>
  ({
    chave: 'k1',
    plano: 1,
    numDose: 1,
    frequencia: null,
    via: null,
    observacao: null,
    integracaoEstoque: false,
    detalhe,
    horarios: [],
  }) as unknown as ItemGravacao;

const med = {
  tipo: 'medicamento',
  produto: 1,
  dose: 500,
  unidade: 'mg',
  agora: false,
  naoAjustar: false,
  tempoInfusaoMinutos: null,
  naoPadronizado: null,
  justificativaAlergia: null,
  seNecessario: [],
  kit: [],
};

describe('apoio da gravação da prescrição própria', () => {
  it('converte a hora civil do estabelecimento em instante UTC (com e sem segundos)', () => {
    expect(instanteLocal('2026-11-23T10:30', 'America/Sao_Paulo').toISOString()).toBe('2026-11-23T13:30:00.000Z');
    expect(instanteLocal('2026-01-05T23:59:59', 'America/Manaus').toISOString()).toBe('2026-01-06T03:59:59.000Z');
    expect(() => instanteLocal('23/11/2026', 'America/Sao_Paulo')).toThrow(ErroOperacao);
  });

  it('dá nome de operação no formato do executor (só minúsculas)', () => {
    expect(nomeOperacao('pep.copiarPrescricao')).toBe('pep.prescricao.copiar-prescricao');
    expect(nomeOperacao('pep.prescrever')).toBe('pep.prescricao.prescrever');
    expect(nomeOperacao('pep.prescrever')).toMatch(/^[a-z][a-z0-9_.-]{2,119}$/);
  });

  it('grava a decisão no vocabulário do banco (retirado → cancelou_item; com justificativa → justificou)', () => {
    expect(decisaoGravada('retirado', null)).toBe('cancelou_item');
    expect(decisaoGravada('mantido', 'Benefício maior')).toBe('justificou');
    expect(decisaoGravada('mantido', null)).toBe('aceitou');
    expect(decisaoGravada('exibido', null)).toBe('aceitou');
  });

  it('recusa com 501 o que ainda não tem adaptador e com 422 a dose zero', () => {
    const codigo = (f: () => void) => {
      try {
        f();
        return null;
      } catch (e) {
        return e instanceof ErroOperacao ? `${e.problema.status}:${e.problema.codigo}` : 'outro';
      }
    };
    expect(codigo(() => conferirItensSuportados([item(med)]))).toBeNull();
    expect(codigo(() => conferirItensSuportados([item({ tipo: 'dieta' })]))).toBe('501:pendente-modelo-proprio');
    expect(codigo(() => conferirItensSuportados([item({ ...med, kit: [{ produto: 1 }] })]))).toBe(
      '501:pendente-modelo-proprio',
    );
    expect(codigo(() => conferirItensSuportados([item({ ...med, dose: 0 })]))).toBe('422:dose-invalida');
  });
});

describe('leituras da família sobre o Leitor dublê', () => {
  it('futuras: hora local, prescrição só quando efetivada, filtro por estabelecimento e sem as da carga', async () => {
    const { porta, sqls } = dubleNucleo([
      [
        'FROM planejamento_prescricao f',
        [
          {
            id: 1,
            liberar_em: new Date('2026-11-24T10:00:00Z'),
            descricao: 'Dipirona',
            situacao: 'programada',
            prescricao_id: null,
            itens: '[]',
          },
          {
            id: 2,
            liberar_em: new Date('2026-11-25T10:00:00Z'),
            descricao: 'Outra',
            situacao: 'efetivada',
            prescricao_id: 99,
            itens: '[]',
          },
        ],
      ],
    ]);
    const r = await porta.futuras(ctx, 5);
    expect(r).toEqual([
      { id: 1, aPartirDe: '2026-11-24T07:00:00', descricao: 'Dipirona', situacao: 'programada', prescricao: null, itemJson: '[]' },
      { id: 2, aPartirDe: '2026-11-25T07:00:00', descricao: 'Outra', situacao: 'efetivada', prescricao: 99, itemJson: '[]' },
    ]);
    const sql = sqls.find((s) => s.includes('planejamento_prescricao')) ?? '';
    expect(sql).toContain('f.estabelecimento_id = ?');
    expect(sql).toContain("f.origem <> 'migracao'");
  });

  it('reconciliações: lote com as linhas dele, em ordem', async () => {
    const { porta } = dubleNucleo([
      ['FROM reconciliacao_medicamentosa r', [{ id: 3, momento: 'admissao', em: null, usuario: 'med1' }]],
      [
        'FROM reconciliacao_item',
        [
          {
            lote: 3,
            descricao: 'Losartana',
            item_prescritivel_id: null,
            dose: '50 mg',
            frequencia: '1x',
            fonte: 'paciente',
            conduta: 'manter',
            justificativa: null,
            prescricao_item_id: null,
          },
        ],
      ],
    ]);
    const [r] = await porta.reconciliacoes(ctx, 5);
    expect(r?.lote).toBe(3);
    expect(r?.usuario).toBe('med1');
    expect(r?.linhas).toHaveLength(1);
    expect(r?.linhas[0]?.conduta).toBe('manter');
  });

  it('grades: horários separados e autor pelo login', async () => {
    const { porta } = dubleNucleo([
      [
        'FROM grade_horario_classe g',
        [
          {
            id: 1,
            unidade_assistencial_id: 4,
            classe: '6/6h',
            doses_por_dia: 4,
            horarios: '06:00;12:00;18:00;24:00'.replace('24:00', '00:00'),
            vigente_desde: '2026-11-01',
            ativo: 1,
            login: 'adm',
          },
        ],
      ],
    ]);
    expect(await porta.grades(ctx)).toEqual([
      {
        id: 1,
        unidade: 4,
        classe: '6/6h',
        numDoses: 4,
        horarios: ['06:00', '12:00', '18:00', '00:00'],
        vigenteDesde: '2026-11-01',
        ativa: true,
        autor: 'adm',
      },
    ]);
  });

  it('podeGravar: sem profissional com conselho ativo, consulta com o motivo (falha fechada)', async () => {
    const { porta } = dubleNucleo([]);
    expect(await porta.podeGravar(ctx, 'pep.prescrever', 'ninguem')).toEqual({
      pode: false,
      codigo: 'profissional-sem-cbo',
      motivo: expect.any(String),
    });
  });

  it('gravação sem o profissional da sessão: 409 profissional-sem-cbo, nada gravado', async () => {
    const { porta } = dubleNucleo([]);
    await expect(
      porta.programarFutura(ctx, 'ninguem', {
        atendimento: 1,
        paciente: 1,
        aPartirDe: '2026-11-24T08:00',
        descricao: 'x',
        itemJson: '[]',
        motivo: null,
      }),
    ).rejects.toMatchObject({ problema: { status: 409, codigo: 'profissional-sem-cbo' } });
  });

  it('ficha e regra ainda sem adaptador: 501', async () => {
    const { porta } = dubleNucleo([]);
    await expect(porta.registrarFicha()).rejects.toMatchObject({ problema: { status: 501 } });
    await expect(porta.gravarRegra()).rejects.toMatchObject({ problema: { status: 501 } });
  });
});

// O tipo do executor fica referenciado para o dublê (o teste de unidade nunca grava).
export type _Executor = Executor;
