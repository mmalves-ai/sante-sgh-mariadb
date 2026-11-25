import { describe, expect, it } from 'vitest';
import {
  acessoAoPainel,
  competenciasDoPeriodo,
  conferirAtivacaoPainel,
  conferirItensPainel,
  conferirPermissoesPainel,
  type ItemPainelEntrada,
  MAXIMO_ITENS_PAINEL,
  variacaoDaSerie,
} from './painel-gerencial.js';

const ind = (indicadorId: number | null, extra: Partial<ItemPainelEntrada> = {}): ItemPainelEntrada => ({
  tipo: 'indicador',
  indicadorId,
  titulo: null,
  texto: null,
  forma: 'linha',
  largura: 1,
  casasDecimais: null,
  exibirMeta: true,
  ...extra,
});
const codigos = (e: { codigo: string }[]) => e.map((x) => x.codigo);

describe('painel gerencial: quadros', () => {
  it('aceita indicador e texto bem formados', () => {
    expect(
      conferirItensPainel([
        ind(1),
        ind(1, { forma: 'numero' }),
        { ...ind(null), tipo: 'texto', texto: 'Leitura do mês', forma: 'texto', largura: 3 },
      ]),
    ).toEqual([]);
  });

  it('recusa indicador ausente, repetido na mesma forma, como texto, largura e casas fora da faixa', () => {
    const e = conferirItensPainel([
      ind(null),
      ind(2),
      ind(2),
      ind(3, { forma: 'texto' }),
      ind(4, { largura: 4, casasDecimais: 7 }),
    ]);
    expect(codigos(e)).toEqual([
      'indicador-ausente',
      'indicador-repetido',
      'forma-invalida',
      'largura-invalida',
      'casas-invalidas',
    ]);
    expect(e.find((x) => x.codigo === 'indicador-repetido')?.campo).toBe('itens[2]');
  });

  it('recusa texto vazio ou exibido fora da forma texto, e quadros demais', () => {
    expect(
      codigos(conferirItensPainel([{ ...ind(null), tipo: 'texto', texto: '  ', forma: 'barra' }])),
    ).toEqual(['texto-ausente', 'forma-invalida']);
    const muitos = Array.from({ length: MAXIMO_ITENS_PAINEL + 1 }, (_, i) => ind(i + 1));
    expect(codigos(conferirItensPainel(muitos))).toEqual(['itens-demais']);
  });
});

describe('painel gerencial: permissões e entrada em uso', () => {
  const p = (
    perfilId: number | null,
    usuarioId: number | null,
    vi: string | null = null,
    vf: string | null = null,
  ) => ({
    perfilId,
    usuarioId,
    podeExportar: false,
    vigenciaInicio: vi,
    vigenciaFim: vf,
  });

  it('perfil ou pessoa, um dos dois, sem repetir, com a vigência em ordem', () => {
    expect(
      conferirPermissoesPainel([p(1, null), p(null, 1), p(2, null, '2026-01-01', '2026-12-31')]),
    ).toEqual([]);
    expect(
      codigos(
        conferirPermissoesPainel([
          p(null, null),
          p(1, 1),
          p(3, null),
          p(3, null),
          p(4, null, '2026-12-01', '2026-01-01'),
          p(5, null, '01/01/2026'),
        ]),
      ),
    ).toEqual([
      'alvo-invalido',
      'alvo-invalido',
      'permissao-repetida',
      'vigencia-invertida',
      'vigencia-invalida',
    ]);
  });

  it('só entra em uso com quadro e permissão', () => {
    expect(codigos(conferirAtivacaoPainel(0, 0))).toEqual(['sem-itens', 'sem-permissoes']);
    expect(conferirAtivacaoPainel(2, 1)).toEqual([]);
  });

  it('quem abre: editor geral e dono sempre; os demais pela permissão vigente e com o painel em uso', () => {
    const perms = [
      { ...p(10, null, '2026-01-01', '2026-06-30'), podeExportar: true },
      p(11, null),
      { ...p(null, 7), podeExportar: true },
    ];
    const pessoa = (usuarioId: number, perfis: number[], editorGeral = false) => ({
      usuarioId,
      perfis: new Set(perfis),
      editorGeral,
    });
    const ativo = { ativo: true, donoId: 1 };
    expect(acessoAoPainel(ativo, perms, pessoa(2, [10]), '2026-11-25')).toEqual({
      ver: false,
      exportar: false,
    });
    expect(acessoAoPainel(ativo, perms, pessoa(2, [10]), '2026-03-01')).toEqual({
      ver: true,
      exportar: true,
    });
    expect(acessoAoPainel(ativo, perms, pessoa(2, [11]), '2026-11-25')).toEqual({
      ver: true,
      exportar: false,
    });
    expect(acessoAoPainel(ativo, perms, pessoa(7, []), '2026-11-25')).toEqual({ ver: true, exportar: true });
    expect(acessoAoPainel({ ativo: false, donoId: 1 }, perms, pessoa(7, [11]), '2026-11-25').ver).toBe(false);
    expect(acessoAoPainel({ ativo: false, donoId: 1 }, perms, pessoa(1, []), '2026-11-25').ver).toBe(true);
    expect(acessoAoPainel({ ativo: false, donoId: null }, [], pessoa(9, [], true), '2026-11-25').ver).toBe(
      true,
    );
  });
});

describe('painel gerencial: período e variação', () => {
  it('converte o período padrão em competências, virando o ano', () => {
    expect(competenciasDoPeriodo('mes_atual', '2026-11-25')).toEqual({ de: '2026-11-01', ate: '2026-11-01' });
    expect(competenciasDoPeriodo('mes_anterior', '2026-01-10')).toEqual({
      de: '2025-12-01',
      ate: '2025-12-01',
    });
    expect(competenciasDoPeriodo('ultimos_3_meses', '2026-02-10')).toEqual({
      de: '2025-11-01',
      ate: '2026-01-01',
    });
    expect(competenciasDoPeriodo('ultimos_12_meses', '2026-11-25')).toEqual({
      de: '2025-11-01',
      ate: '2026-10-01',
    });
    expect(competenciasDoPeriodo('ano_atual', '2026-11-25')).toEqual({ de: '2026-01-01', ate: '2026-11-01' });
  });

  it('variação da última competência sobre a anterior', () => {
    expect(variacaoDaSerie([70, null, 85.5])).toBe(22.1);
    expect(variacaoDaSerie([0, 10])).toBeNull();
    expect(variacaoDaSerie([10])).toBeNull();
  });
});
