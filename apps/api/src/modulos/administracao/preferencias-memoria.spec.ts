// Preferências da conta na fonte sintética (01-ADM L84): as mesmas regras do domínio que a porta própria aplica.
import { ARVORE_MENU } from '@sgh/contratos';
import { ErroOperacao } from '@sgh/nucleo';
import { beforeEach, describe, expect, it } from 'vitest';
import { PreferenciasMemoria, telasDoMenuSintetico } from './preferencias-memoria.js';

const entrada = ARVORE_MENU.find((i) => i.rota && i.permissao)!;
const outra = ARVORE_MENU.find((i) => i.rota && i.permissao && i.permissao !== entrada.permissao)!;
const tela = telasDoMenuSintetico().find((t) => t.rota === entrada.rota)!;
const telaOutra = telasDoMenuSintetico().find((t) => t.rota === outra.rota)!;
const permissoes = [entrada.permissao!];

const codigo = (f: () => unknown): string => {
  try {
    f();
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : `outro: ${(e as Error).message}`;
  }
};

describe('preferências da conta em memória (fonte sintética)', () => {
  let p: PreferenciasMemoria;
  beforeEach(() => {
    p = new PreferenciasMemoria();
  });

  it('sem nada guardado: as de fábrica; telas do menu só as do cargo', () => {
    const l = p.ler('SINT.X', undefined, new Set(permissoes));
    expect(l.guardadas).toBe(false);
    expect(l.geral.tema).toBe('sistema');
    expect(l.telasDoMenu.map((t) => t.codigo)).toContain(tela.codigo);
    expect(l.telasDoMenu.map((t) => t.codigo)).not.toContain(telaOutra.codigo);
  });

  it('grava tema e tela inicial do menu do cargo; recusa tela fora do cargo; por login', () => {
    p.gravarGeral('SINT.X', { tema: 'escuro', telaInicial: tela.codigo }, permissoes);
    expect(codigo(() => p.gravarGeral('SINT.X', { telaInicial: telaOutra.codigo }, permissoes))).toBe(
      'tela-sem-permissao',
    );
    expect(codigo(() => p.gravarGeral('SINT.X', { tema: 'rosa' }, permissoes))).toBe('tema-invalido');
    expect(codigo(() => p.gravarGeral(null, { tema: 'claro' }, permissoes))).toBe('sem-conta');
    const l = p.ler('SINT.X', undefined, new Set(permissoes));
    expect(l.guardadas).toBe(true);
    expect(l.geral.tema).toBe('escuro');
    expect(l.telaInicial).toEqual(tela);
    // O cargo perdeu o acesso: a inicial guardada não é devolvida.
    expect(p.ler('SINT.X', undefined, new Set()).telaInicial).toBeNull();
    // Outra conta não herda nada.
    expect(p.ler('SINT.Y', undefined, new Set(permissoes)).geral.tema).toBe('sistema');
  });

  it('visão de tela: nasce padrão, a nova padrão tira a marca da anterior, regravar mantém a marca', () => {
    p.gravarVisaoTela('SINT.X', { tela: tela.codigo, colunas: ['a', 'b'] });
    p.gravarVisaoTela('SINT.X', {
      tela: tela.codigo,
      nome: 'Noite',
      colunas: ['b'],
      ordenacao: [{ coluna: 'b', direcao: 'desc' }],
      padrao: true,
    });
    p.gravarVisaoTela('SINT.X', { tela: tela.codigo, nome: 'Noite', colunas: ['b', 'a'] });
    expect(
      codigo(() =>
        p.gravarVisaoTela('SINT.X', {
          tela: tela.codigo,
          colunas: ['a'],
          ordenacao: [{ coluna: 'b', direcao: 'asc' }],
        }),
      ),
    ).toBe('ordenacao-fora-das-colunas');
    expect(codigo(() => p.gravarVisaoTela('SINT.X', { tela: 'nao.existe', colunas: ['a'] }))).toBe(
      'tela-inexistente',
    );
    const l = p.ler('SINT.X', tela.codigo, new Set(permissoes));
    expect(l.visoes.map((v) => [v.nome, v.padrao])).toEqual([
      ['padrao', false],
      ['Noite', true],
    ]);
    expect(l.visaoInicialPorTela[tela.codigo]).toBe('Noite');
  });
});
