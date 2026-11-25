// Preferências da conta na fonte sintética (01-ADM L84): as mesmas regras do domínio que a porta própria aplica.
import { ARVORE_MENU, ROTA_TRILHA_AUDITORIA } from '@sgh/contratos';
import { ErroOperacao } from '@sgh/nucleo';
import { beforeEach, describe, expect, it } from 'vitest';
import { PreferenciasMemoria, telasDoMenuSintetico } from './preferencias-memoria.js';

const entrada = ARVORE_MENU.find((i) => i.rota && i.permissao)!;
const outra = ARVORE_MENU.find((i) => i.rota && i.permissao && i.permissao !== entrada.permissao)!;
const tela = telasDoMenuSintetico().find((t) => t.rota === entrada.rota)!;
const telaOutra = telasDoMenuSintetico().find((t) => t.rota === outra.rota)!;
const permissoes = [entrada.permissao!];
// A lista que guarda visão por usuário (a trilha de auditoria) e uma tela do menu que não tem lista.
const lista = telasDoMenuSintetico().find((t) => t.rota === ROTA_TRILHA_AUDITORIA)!;
const semLista = telasDoMenuSintetico().find((t) => t.rota === '/administracao/parametros')!;

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
    p.gravarVisaoTela('SINT.X', { tela: lista.codigo, colunas: ['dataHora', 'usuario'] });
    p.gravarVisaoTela('SINT.X', {
      tela: lista.codigo,
      nome: 'Noite',
      colunas: ['usuario'],
      ordenacao: [{ coluna: 'usuario', direcao: 'desc' }],
      padrao: true,
    });
    p.gravarVisaoTela('SINT.X', { tela: lista.codigo, nome: 'Noite', colunas: ['usuario', 'dataHora'] });
    expect(
      codigo(() =>
        p.gravarVisaoTela('SINT.X', {
          tela: lista.codigo,
          colunas: ['dataHora'],
          ordenacao: [{ coluna: 'usuario', direcao: 'asc' }],
        }),
      ),
    ).toBe('ordenacao-fora-das-colunas');
    expect(codigo(() => p.gravarVisaoTela('SINT.X', { tela: 'nao.existe', colunas: ['dataHora'] }))).toBe(
      'tela-inexistente',
    );
    const l = p.ler('SINT.X', lista.codigo, new Set(permissoes));
    expect(l.visoes.map((v) => [v.nome, v.padrao])).toEqual([
      ['padrao', false],
      ['Noite', true],
    ]);
    expect(l.visaoInicialPorTela[lista.codigo]).toBe('Noite');
  });

  it('visão de tela: só as colunas que a lista oferece, e só em tela que tem lista', () => {
    expect(
      codigo(() => p.gravarVisaoTela('SINT.X', { tela: lista.codigo, colunas: ['dataHora', 'salario'] })),
    ).toBe('coluna-desconhecida');
    expect(codigo(() => p.gravarVisaoTela('SINT.X', { tela: semLista.codigo, colunas: ['dataHora'] }))).toBe(
      'tela-sem-visao',
    );
    expect(p.ler('SINT.X', undefined, new Set(permissoes)).visoes).toEqual([]);
  });

  it('cada tela do menu tem um código só dela', () => {
    const codigos = telasDoMenuSintetico().map((t) => t.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const c of codigos) expect(c).toMatch(/^[A-Za-z0-9._-]{1,30}$/);
  });
});
