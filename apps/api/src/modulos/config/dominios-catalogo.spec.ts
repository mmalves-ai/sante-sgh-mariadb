// Unidade da declaração derivada dos metadados (dominios-catalogo.ts): puro, sem banco.
import { describe, expect, it } from 'vitest';
import {
  camelo,
  type ColunaMeta,
  declararDominio,
  ErroValorCampo,
  tabelasDeDominio,
  valoresParaBanco,
  valorParaTela,
} from './dominios-catalogo.js';

const col = (coluna: string, tipo: string, o: Partial<ColunaMeta> = {}): ColunaMeta => ({
  coluna,
  tipo,
  tipoColuna: tipo,
  nulo: false,
  temPadrao: false,
  tamanho: null,
  escala: null,
  comentario: '',
  gerada: false,
  referencia: null,
  ...o,
});

const COLUNAS = [
  col('id', 'bigint'),
  col('codigo', 'varchar', { tamanho: 10 }),
  col('descricao', 'varchar', { tamanho: 20 }),
  col('ativo', 'tinyint', { tipoColuna: 'tinyint(1)', temPadrao: true }),
  col('exige_horario', 'tinyint', { tipoColuna: 'tinyint(1)', temPadrao: true }),
  col('valor', 'decimal', { escala: 2, tipoColuna: 'decimal(10,2) unsigned', nulo: true, temPadrao: true }),
  col('inicio', 'date', { nulo: true, temPadrao: true }),
  col('hora', 'time', { nulo: true, temPadrao: true }),
  col('tipo_id', 'bigint', { tipoColuna: 'bigint(20) unsigned', referencia: 'tipo_exemplo' }),
  col('chave_escopo', 'varchar', { gerada: true }),
  col('criado_em', 'datetime'),
  col('versao', 'int', { temPadrao: true }),
];

describe('declaração do domínio pelos metadados', () => {
  const d = declararDominio('exemplo_dominio', 'CAD', 'Exemplos de domínio', COLUNAS)!;

  it('módulo pela área, recurso em camelCase, subitem e ações; colunas do núcleo e geradas fora', () => {
    expect(d).toMatchObject({ modulo: 'cadastro', recurso: 'exemploDominio', subitem: 'demograficos', natureza: 'editavel' });
    expect(d.acoes).toEqual(['ler', 'criar', 'editar', 'inativar', 'exportar']);
    expect(d.campos.map((c) => c.campo)).toEqual([
      'codigo',
      'descricao',
      'exigeHorario',
      'valor',
      'inicio',
      'hora',
      'tipoId',
    ]);
    expect(d.rotulo.plural).toBe('Exemplos de domínio');
  });

  it('tipos: booleano como Sim/Não, decimal com casas, data, hora e referência pela FK', () => {
    const c = Object.fromEntries(d.campos.map((x) => [x.campo, x]));
    expect(c['exigeHorario']).toMatchObject({ tipo: 'letra', booleano: true, obrigatorio: false });
    expect(c['valor']).toMatchObject({ tipo: 'decimal', casas: 2, minimo: 0 });
    expect(c['inicio']?.tipo).toBe('data');
    expect(c['hora']?.tipo).toBe('hora');
    expect(c['tipoId']).toMatchObject({ tipo: 'referencia', referencia: 'tipoExemplo', obrigatorio: true });
    expect(c['codigo']).toMatchObject({ obrigatorio: true, editavel: false, maxBytes: 10, codigo: 'manual' });
  });

  it('tabela sem a forma de domínio, ou de área sem módulo, não é declarada', () => {
    expect(declararDominio('x', 'CAD', '', COLUNAS.filter((c) => c.coluna !== 'ativo'))).toBeNull();
    expect(declararDominio('x', 'ZZZ', '', COLUNAS)).toBeNull();
  });

  it('catálogo do sistema é só consulta', () => {
    expect(declararDominio('acao_sistema', 'ADM', '', COLUNAS)).toMatchObject({
      natureza: 'sistema',
      acoes: ['ler', 'exportar'],
    });
  });

  it('valores da tela → banco: converte, confere e recusa com a lista de campos', () => {
    expect(
      valoresParaBanco(
        d,
        { codigo: 'A1', descricao: ' Um ', exigeHorario: 'sim', valor: '10,5', inicio: '2026-01-31', tipoId: 3 },
        'incluir',
      ),
    ).toEqual({ codigo: 'A1', descricao: 'Um', exige_horario: true, valor: 10.5, inicio: '2026-01-31', tipo_id: 3 });
    const erro = (() => {
      try {
        valoresParaBanco(d, { codigo: 'A1', descricao: 'x'.repeat(21), valor: '1.234', hora: '25:00', outro: 1 }, 'incluir');
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(erro).toBeInstanceOf(ErroValorCampo);
    expect([...(erro as ErroValorCampo).campos].sort()).toEqual(['descricao', 'hora', 'outro', 'tipoId', 'valor']);
    // Na alteração, o código não muda e só o enviado vai ao banco.
    expect(() => valoresParaBanco(d, { codigo: 'B2' }, 'alterar')).toThrow(ErroValorCampo);
    expect(valoresParaBanco(d, { descricao: 'Dois', inicio: '' }, 'alterar')).toEqual({ descricao: 'Dois', inicio: null });
  });

  it('valor do banco → tela', () => {
    const c = Object.fromEntries(d.campos.map((x) => [x.campo, x]));
    expect(valorParaTela(c['exigeHorario']!, 1)).toBe('sim');
    expect(valorParaTela(c['exigeHorario']!, 0)).toBe('nao');
    expect(valorParaTela(c['hora']!, '08:30:00')).toBe('08:30');
    expect(valorParaTela(c['inicio']!, new Date(2026, 0, 31))).toBe('2026-01-31');
    expect(valorParaTela(c['valor']!, '10.50')).toBe(10.5);
    expect(valorParaTela(c['descricao']!, null)).toBeNull();
  });

  it('a lista gerada das tabelas de domínio tem centenas de tabelas, todas em snake_case', () => {
    const t = tabelasDeDominio();
    expect(t.size).toBeGreaterThan(600);
    for (const nome of t.keys()) expect(nome).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(camelo('grau_priorizacao_gut')).toBe('grauPriorizacaoGut');
  });
});
