import { describe, expect, it } from 'vitest';
import { diasDaJanelaFim, inicioDaJanelaFim, medirUsuariosFim } from './montagem.js';

describe('montagem da entrada do fim (campo 4)', () => {
  it('ativos com trilha e acesso: fora painéis e contas combinadas; acesso pela pessoa, grupo, setor ou estabelecimento', () => {
    const pessoas = [
      { login: 'ANA', grupo: 'ATENDIMENTO', unidades: [], locais: [] },
      { login: 'BIA', grupo: 'ATENDIMENTO', unidades: [], locais: [] },
      { login: 'CAIO', grupo: 'GUICHE', unidades: [], locais: [] },
      { login: 'TV01', grupo: 'PAINEIS', unidades: [], locais: [] },
      { login: 'TEC', grupo: 'MASTER', unidades: [], locais: [] },
    ];
    const conclusoes = [
      { login: 'ana', papel: 'recepcao', resultado: 'aprovado', concluidoEm: '2027-01-03' },
      { login: 'BIA', papel: 'recepcao', resultado: 'refazer', concluidoEm: '2027-01-03' },
      { login: 'CAIO', papel: 'recepcao', resultado: 'aprovado', concluidoEm: '2027-01-04' },
    ];
    const chaves = [
      { escopo: 'grupo', valor: 'ATENDIMENTO', ligada: true, alteradoEm: '2027-01-05 10:00:00' },
      { escopo: 'pessoa', valor: 'CAIO', ligada: false, alteradoEm: '2027-01-05 10:00:00' },
    ];
    const r = medirUsuariosFim(pessoas, conclusoes, chaves, [], new Set(['TEC']));
    expect(r.u.ativos).toBe(3);
    expect(r.u.comTrilhaEAcesso).toBe(1);
    expect(r.u.semTrilha).toBeGreaterThanOrEqual(1);
    expect(r.verdeDesde).toBe('2027-01-05');
    const todos = medirUsuariosFim(
      pessoas.slice(0, 1),
      conclusoes,
      [{ escopo: 'hospital', valor: 'pc', ligada: true, alteradoEm: '2027-01-01 08:00:00' }],
      [],
      new Set(),
    );
    expect(todos).toEqual({
      u: { ativos: 1, comTrilhaEAcesso: 1, semTrilha: 0, semAcesso: 0 },
      porPapel: [{ papel: 'recepcao', ativos: 1, semTrilha: 0, semAcesso: 0 }],
      verdeDesde: '2027-01-03',
    });
  });

  it('campo 4: o agregado por papel soma o total (ativos, sem trilha e sem acesso), na ordem dos papéis', () => {
    const r = medirUsuariosFim(
      [
        { login: 'ANA', grupo: 'ATENDIMENTO', unidades: [], locais: [] },
        { login: 'BIA', grupo: 'ATENDIMENTO', unidades: [], locais: [] },
        { login: 'ZE', grupo: 'GRUPO SEM PAPEL SINTETICO', unidades: [], locais: [] },
      ],
      [{ login: 'ANA', papel: 'recepcao', resultado: 'aprovado', concluidoEm: '2027-01-03' }],
      [{ escopo: 'pessoa', valor: 'ANA', ligada: true, alteradoEm: '2027-01-05 10:00:00' }],
      [],
      new Set(),
    );
    expect(r.porPapel).toEqual([
      { papel: 'recepcao', ativos: 2, semTrilha: 1, semAcesso: 1 },
      { papel: 'outros', ativos: 1, semTrilha: 1, semAcesso: 1 },
    ]);
    const soma = (k: 'ativos' | 'semTrilha' | 'semAcesso') => r.porPapel.reduce((n, x) => n + x[k], 0);
    expect([soma('ativos'), soma('semTrilha'), soma('semAcesso')]).toEqual([
      r.u.ativos,
      r.u.semTrilha,
      r.u.semAcesso,
    ]);
  });

  it('os dias da janela: sem retrato ou sem coleta é null (falha fechada)', () => {
    const d = diasDaJanelaFim(
      '2027-01-10',
      [
        { dia: '2027-01-09', login: 'ANA', mudou: true },
        { dia: '2027-01-09', login: 'BIA', mudou: false },
        { dia: '2027-01-10', login: 'ANA', mudou: false },
      ],
      [{ dia: '2027-01-10', conexoes: 0 }],
      3,
    );
    expect(inicioDaJanelaFim('2027-01-10', 3)).toBe('2027-01-08');
    expect(d).toEqual([
      { dia: '2027-01-08', loginsComConexao: null, conexoesProgramaAnterior: null },
      { dia: '2027-01-09', loginsComConexao: ['ANA'], conexoesProgramaAnterior: null },
      { dia: '2027-01-10', loginsComConexao: [], conexoesProgramaAnterior: 0 },
    ]);
  });
});
