// Regra 8 do M08 (gravação): versão nova fecha a anterior; nível não permitido → 422; conflito de perfis.
import { type DefinicaoParametro, definicaoParametro, type ValorParametro } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { conferirValor, ehRecusa, planejarDefinicao } from './vigencia.js';

const def: DefinicaoParametro = {
  chave: 'cadastro.itensPorPagina',
  modulo: 'cadastro',
  descricao: 'x',
  tipo: 'inteiro',
  padrao: '25',
  niveis: ['usuario', 'perfil', 'estabelecimento'],
  critico: false,
  minimo: 10,
  maximo: 100,
  dono: 'x',
  origem: 'x',
};
const agora = new Date('2026-10-20T12:00:00Z');
const existente = (
  id: string,
  nivel: ValorParametro['nivel'],
  alvo: string,
  valor: string,
  vigenteAte: string | null = null,
): ValorParametro => ({
  id,
  chave: def.chave,
  nivel,
  alvo,
  valor,
  vigenteDesde: '2026-10-01T00:00:00Z',
  vigenteAte,
  justificativa: 'j',
  autor: 'a',
});
const pedido = {
  nivel: 'estabelecimento' as const,
  alvo: 'pc',
  valor: '40',
  justificativa: 'ajuste da recepção',
};

describe('vigência (regra 8)', () => {
  it('cria versão nova e fecha a vigente do mesmo nível e alvo', () => {
    const p = planejarDefinicao(
      def,
      pedido,
      [
        existente('1', 'estabelecimento', 'pc', '30'),
        existente('2', 'estabelecimento', 'pc', '20', '2026-10-02T00:00:00Z'),
        existente('3', 'usuario', 'X', '15'),
      ],
      'SINT.GESTOR',
      agora,
    );
    if (ehRecusa(p)) throw new Error('recusou');
    expect(p.fechar).toEqual(['1']);
    expect(p.nova).toMatchObject({
      valor: '40',
      vigenteDesde: agora.toISOString(),
      vigenteAte: null,
      autor: 'SINT.GESTOR',
    });
  });
  it('recusas: inexistente, nível não permitido, valor inválido, alvo inválido; perfis diferentes só avisam', () => {
    expect(planejarDefinicao(undefined, pedido, [], 'a', agora)).toMatchObject({
      codigo: 'parametro-inexistente',
      status: 404,
    });
    expect(planejarDefinicao(def, { ...pedido, nivel: 'rede' }, [], 'a', agora)).toMatchObject({
      codigo: 'nivel-nao-permitido',
      status: 422,
    });
    expect(planejarDefinicao(def, { ...pedido, valor: '5' }, [], 'a', agora)).toMatchObject({
      codigo: 'valor-invalido',
      status: 422,
    });
    const c = planejarDefinicao(
      def,
      { ...pedido, nivel: 'perfil', alvo: 'recepcao' },
      [existente('9', 'perfil', 'faturamento', '30')],
      'a',
      agora,
    );
    expect(ehRecusa(c)).toBe(false);
    expect(ehRecusa(c) ? [] : c.avisos).toHaveLength(1);
    expect(
      planejarDefinicao(
        { ...def, niveis: ['unidade'] },
        { ...pedido, nivel: 'unidade', alvo: 'x' },
        [],
        'a',
        agora,
      ),
    ).toMatchObject({ codigo: 'alvo-invalido', status: 422 });
    const igual = planejarDefinicao(
      def,
      { ...pedido, nivel: 'perfil', alvo: 'recepcao', valor: '30' },
      [existente('9', 'perfil', 'faturamento', '30')],
      'a',
      agora,
    );
    expect(ehRecusa(igual)).toBe(false);
  });
  it('conferência de valor por tipo', () => {
    expect(conferirValor(def, 'abc')).toMatch(/inteiro/);
    expect(conferirValor(def, '101')).toMatch(/máximo/);
    expect(conferirValor(def, '50')).toBeNull();
    expect(conferirValor({ ...def, tipo: 'booleano' }, 'talvez')).toMatch(/sim ou não/);
    expect(conferirValor({ ...def, tipo: 'booleano' }, 'nao')).toBeNull();
    expect(conferirValor({ ...def, tipo: 'lista', opcoes: ['csv'] }, 'xls')).toMatch(/csv/);
    expect(conferirValor({ ...def, tipo: 'lista' }, 'xls')).toMatch(/opções/);
    expect(conferirValor({ ...def, tipo: 'texto' }, ' ')).toMatch(/Informe/);
    expect(conferirValor({ ...def, tipo: 'texto' }, 'x')).toBeNull();
  });
  it('meta de indicador (texto com formato): "sem meta" ou número com vírgula ou ponto; o resto recusado', () => {
    const meta = definicaoParametro('relatorio.meta.taxaOcupacao')!;
    // O rótulo mostra o nome da ficha, não o código interno.
    expect(meta.descricao).toMatch(/^Meta do indicador Taxa de ocupação hospitalar/);
    expect(meta.descricao).not.toMatch(/taxaOcupacao/);
    for (const ok of ['sem meta', 'Sem meta', '85', '85,5', '85.5', ' 90 ', '-1'])
      expect(conferirValor(meta, ok), ok).toBeNull();
    for (const ruim of ['85%', '85,5 %', 'oitenta', '85,', ',5', '1.000,5'])
      expect(conferirValor(meta, ruim), ruim).toMatch(/sem o símbolo %/);
    expect(
      conferirValor({ ...def, minimo: undefined, maximo: undefined } as unknown as DefinicaoParametro, '-5'),
    ).toBeNull();
  });
});
