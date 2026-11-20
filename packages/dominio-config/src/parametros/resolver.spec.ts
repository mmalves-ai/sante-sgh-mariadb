// Regra 8 do M08: vale o nível mais específico vigente; "explicar valor" diz de onde veio.
import type { DefinicaoParametro, ValorParametro } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { resolverParametro, valorTipado, vigenteEm } from './resolver.js';

const def: DefinicaoParametro = {
  chave: 'cadastro.itensPorPagina',
  modulo: 'cadastro',
  descricao: 'x',
  tipo: 'inteiro',
  padrao: '25',
  niveis: ['usuario', 'perfil', 'estabelecimento', 'rede'],
  critico: false,
  dono: 'x',
  origem: 'x',
};
const agora = new Date('2026-10-20T12:00:00Z');
let n = 0;
const v = (
  nivel: ValorParametro['nivel'],
  alvo: string,
  valor: string,
  extra: Partial<ValorParametro> = {},
): ValorParametro => ({
  id: String(++n),
  chave: def.chave,
  nivel,
  alvo,
  valor,
  vigenteDesde: '2026-10-01T00:00:00Z',
  vigenteAte: null,
  justificativa: 'j',
  autor: 'SINT.GESTOR',
  ...extra,
});
const sujeito = {
  rede: 'sante',
  empresa: '1',
  estabelecimento: 'pc',
  unidade: '2',
  perfis: ['recepcao', 'faturamento'],
  usuario: 'SINT.RECEPCAO',
};

describe('resolvedor (regra 8)', () => {
  it('sem valor: o padrão do registro', () => {
    const e = resolverParametro(def, [], sujeito, agora);
    expect(e).toMatchObject({ valor: '25', origem: 'padrao', alvo: null, autor: null });
    expect(e.passos.at(-1)).toEqual({ nivel: 'padrao', alvo: null, valor: '25', situacao: 'vale' });
  });
  it('o mais específico vence; os mais amplos aparecem como sobrepostos', () => {
    const e = resolverParametro(
      def,
      [v('rede', 'sante', '50'), v('estabelecimento', 'pc', '40'), v('usuario', 'SINT.RECEPCAO', '10')],
      sujeito,
      agora,
    );
    expect(e).toMatchObject({ valor: '10', origem: 'usuario', alvo: 'SINT.RECEPCAO' });
    expect(e.passos.filter((p) => p.situacao === 'sobreposto').map((p) => p.nivel)).toEqual([
      'estabelecimento',
      'rede',
      'padrao',
    ]);
  });
  it('fora da vigência e de outro alvo não valem', () => {
    const e = resolverParametro(
      def,
      [
        v('usuario', 'SINT.RECEPCAO', '10', { vigenteAte: '2026-10-10T00:00:00Z' }),
        v('usuario', 'OUTRO', '11'),
        v('rede', 'sante', '50'),
      ],
      sujeito,
      agora,
    );
    expect(e).toMatchObject({ valor: '50', origem: 'rede' });
  });
  it('nível não permitido é ignorado (e explicado)', () => {
    const e = resolverParametro(def, [v('unidade', '2', '99'), v('rede', 'sante', '50')], sujeito, agora);
    expect(e.valor).toBe('50');
    expect(e.passos.find((p) => p.nivel === 'unidade')?.situacao).toBe('nao-permitido');
  });
  it('conflito entre perfis não escolhe: segue ao nível seguinte; perfis que concordam valem', () => {
    const c = resolverParametro(
      def,
      [v('perfil', 'recepcao', '30'), v('perfil', 'faturamento', '35'), v('estabelecimento', 'pc', '40')],
      sujeito,
      agora,
    );
    expect(c).toMatchObject({ valor: '40', origem: 'estabelecimento' });
    expect(c.passos.filter((p) => p.situacao === 'conflito')).toHaveLength(2);
    const ok = resolverParametro(
      def,
      [v('perfil', 'recepcao', '30'), v('perfil', 'faturamento', '30')],
      sujeito,
      agora,
    );
    expect(ok).toMatchObject({ valor: '30', origem: 'perfil' });
  });
  it('sem unidade nem empresa no sujeito', () => {
    const e = resolverParametro(
      def,
      [v('empresa', '1', '1')],
      { ...sujeito, unidade: null, empresa: null },
      agora,
    );
    expect(e.origem).toBe('padrao');
  });
  it('vigência e valor tipado', () => {
    expect(vigenteEm({ vigenteDesde: '2026-10-21T00:00:00Z', vigenteAte: null }, agora)).toBe(false);
    expect(valorTipado(def, '12')).toBe(12);
    expect(valorTipado({ ...def, tipo: 'booleano' }, 'sim')).toBe(true);
    expect(valorTipado({ ...def, tipo: 'texto' }, 'x')).toBe('x');
  });
});
