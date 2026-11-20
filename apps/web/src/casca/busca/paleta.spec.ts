import { describe, expect, it, vi } from 'vitest';
import { RegistroDeProvedores, type ResultadoBusca } from './paleta.js';

const r = (
  id: string,
  grupo: ResultadoBusca['grupo'],
  titulo: string,
  permissao: string | null,
  detalhe = '',
): ResultadoBusca => ({
  id,
  grupo,
  titulo,
  detalhe,
  permissao,
  executar: vi.fn(),
});

describe('paleta de comandos (Ctrl+K)', () => {
  const registro = new RegistroDeProvedores();
  registro.registrar({
    id: 'telas',
    grupo: 'telas',
    candidatos: () => [
      r(
        'pref',
        'telas',
        'Tema, densidade, atalhos',
        'acesso.preferencia.ler',
        'Início > Preferências do usuário',
      ),
      r('inicio', 'telas', 'Minha fila de trabalho', 'acesso.inicio.ler', 'Início'),
      r('restrita', 'telas', 'Tela restrita', 'outro.modulo.ler'),
    ],
  });
  registro.registrar({
    id: 'acoes',
    grupo: 'acoes',
    candidatos: () => [r('escuro', 'acoes', 'Usar o tema escuro', null)],
  });
  const permissoes = new Set(['acesso.preferencia.ler', 'acesso.inicio.ler']);

  it('só aparece o que o usuário pode abrir', () => {
    expect(registro.buscar('', permissoes).map((x) => x.id)).toEqual(['pref', 'inicio', 'escuro']);
    expect(registro.buscar('restrita', permissoes)).toEqual([]);
  });

  it('busca ignora acento e maiúsculas e procura também no caminho', () => {
    expect(registro.buscar('PREFERENCIAS', permissoes).map((x) => x.id)).toEqual(['pref']);
    expect(registro.buscar('tema', permissoes).map((x) => x.id)).toEqual(['pref', 'escuro']);
    expect(registro.buscar('fila trab', permissoes).map((x) => x.id)).toEqual(['inicio']);
  });

  it('telas antes de ações; dentro do grupo, título que começa pelo termo primeiro', () => {
    const reg = new RegistroDeProvedores();
    reg.registrar({
      id: 't',
      grupo: 'telas',
      candidatos: () => [r('b', 'telas', 'Sobre o tema', null), r('a', 'telas', 'Tema', null)],
    });
    reg.registrar({ id: 'x', grupo: 'acoes', candidatos: () => [r('c', 'acoes', 'Tema escuro', null)] });
    expect(reg.buscar('tema', new Set()).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('provedor solto deixa de responder', () => {
    const reg = new RegistroDeProvedores();
    const soltar = reg.registrar({ id: 't', grupo: 'telas', candidatos: () => [r('a', 'telas', 'A', null)] });
    soltar();
    expect(reg.buscar('', new Set())).toEqual([]);
  });
});

describe('provedor por termo (M11)', () => {
  it('devolve o atalho do termo só com a permissão do destino', () => {
    const r = new RegistroDeProvedores();
    r.registrar({
      id: 'pacientes',
      grupo: 'pacientes',
      candidatos: () => [],
      doTermo: (termo) => [
        {
          id: 'p',
          grupo: 'pacientes',
          titulo: `Buscar paciente: "${termo}"`,
          detalhe: '',
          permissao: 'cadastro.paciente.ler',
          executar: () => undefined,
        },
      ],
    });
    expect(r.buscar('jose silva', new Set(['cadastro.paciente.ler']))[0]?.titulo).toBe(
      'Buscar paciente: "jose silva"',
    );
    expect(r.buscar('jose silva', new Set())).toEqual([]);
  });
});
