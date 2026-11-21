// M19: a senha "atual" do guichê (F7 chama de novo, F8 não localizado) é a da chamada mais recente, nunca a mais
// antiga que ficou no guichê (a senha de recepção só sai dele com a abertura do atendimento).
import { describe, expect, it } from 'vitest';
import { mostraNome, NOME_SIGILOSO } from '@sgh/dominio-recepcao';
import type { DispositivoRecepcao } from './tipos.js';
import type { CentralChamadas } from './chamadas.js';
import type { PortaRecepcao } from './porta.js';
import { ordenarNoGuiche, ServicoRecepcao } from './servico.js';

describe('senhas no guichê', () => {
  it('a chamada mais recente primeiro; sem medida (chamada no outro terminal), a emitida depois', () => {
    const xs = [
      { id: 10, emitidaEm: '2026-10-21T08:00:00', chamadaEm: '2026-10-21T08:20:00' },
      { id: 11, emitidaEm: '2026-10-21T08:05:00', chamadaEm: '2026-10-21T08:25:00' },
      { id: 12, emitidaEm: '2026-10-21T08:10:00', chamadaEm: null },
    ];
    expect(ordenarNoGuiche(xs).map((x) => x.id)).toEqual([11, 10, 12]);
    // Chamar de novo a mais antiga a torna a atual.
    const rechamada = [{ ...xs[0]!, chamadaEm: '2026-10-21T08:30:00' }, xs[1]!];
    expect(ordenarNoGuiche(rechamada).map((x) => x.id)).toEqual([10, 11]);
    // Mesmo instante: a de ID maior (a emitida depois).
    expect(
      ordenarNoGuiche([
        { id: 1, emitidaEm: '2026-10-21T08:00:00', chamadaEm: '2026-10-21T08:20:00' },
        { id: 2, emitidaEm: '2026-10-21T08:01:00', chamadaEm: '2026-10-21T08:20:00' },
      ]).map((x) => x.id),
    ).toEqual([2, 1]);
  });
});

describe('nome social e sigiloso no painel e na lista do guichê (W1-04)', () => {
  const pacientes = new Map([
    [1, { nome: 'JOAO CARLOS DA SILVA', nomeSocial: 'JOANA SILVA', prontuario: 501 }],
    [2, { nome: 'MARIA SOUZA', nomeSocial: null, prontuario: 502 }],
    [3, { nome: 'PEDRO ALVES', nomeSocial: 'PAULA ALVES', prontuario: 503 }],
  ]);
  const porta = {
    recepcoes: async () => [],
    pacientesDasSenhas: async () => pacientes,
    sigilosos: async (_c: unknown, ps: readonly number[]) => new Set(ps.filter((p) => p === 503)),
    fotos: async () =>
      new Map([
        [501, 'data:image/jpeg;base64,AAA'],
        [503, 'data:image/jpeg;base64,BBB'],
      ]),
    agendados: async () => ({
      cortada: false,
      itens: [...pacientes.values()].map((p, i) => ({
        tipo: 'consulta' as const,
        marcacao: 7000 + i,
        hora: '08:00',
        agenda: 'CONSULTA',
        paciente: p.nome,
        nomeSocial: p.nomeSocial,
        prontuario: p.prontuario,
        senha: null,
      })),
    }),
  } as unknown as PortaRecepcao;
  const central = {
    chamadas: async () => ({
      atualizadoEm: '2026-11-19T08:00:00',
      chamadas: [1, 2, 3].map((senha) => ({
        chave: `${senha}:1`,
        senha,
        texto: `MC 00${senha}`,
        recepcao: 2,
        guiche: 4,
        local: null,
        prioridade: '2',
        em: `2026-11-19T08:0${senha}:00`,
        origem: 'novo' as const,
      })),
    }),
  } as unknown as CentralChamadas;
  const s = new ServicoRecepcao(porta, central);
  const c = { rede: 'r', hospital: 'pc' };
  const d = { nome: 'TV', recepcao: 2, locais: [], voz: true } as unknown as DispositivoRecepcao;

  it('painel: iniciais do nome social; sigiloso sem iniciais; a fala nunca leva nome', async () => {
    const p = await s.painel(c, d, true);
    const por = new Map(p.ultimas.map((x) => [x.senha, x]));
    expect(por.get(1)?.iniciais).toBe('J. S.');
    expect(por.get(2)?.iniciais).toBe('M. S.');
    expect(por.get(3)?.iniciais).toBeNull();
    const json = JSON.stringify(p);
    expect(mostraNome(json, 'JOAO CARLOS')).toBe(false);
    expect(mostraNome(json, 'PAULA ALVES')).toBe(false);
    expect(mostraNome(json, 'PEDRO ALVES')).toBe(false);
    // Sem o parâmetro das iniciais, nada de paciente.
    expect((await s.painel(c, d, false)).ultimas.every((x) => x.iniciais === null)).toBe(true);
  });

  it('lista do guichê: nome social mascarado e marcado; sigiloso como "Paciente sigiloso"', async () => {
    const { itens } = await s.agendados(c, {});
    expect(itens.map((x) => [x.paciente, x.nomeSocial, x.sigiloso])).toEqual([
      ['J*** S***', true, false],
      ['M*** S***', false, false],
      [NOME_SIGILOSO, false, true],
    ]);
  });

  it('lista do guichê: foto do cadastro para conferir; sem foto é nulo; o sigiloso não mostra a foto', async () => {
    const { itens } = await s.agendados(c, {});
    expect(itens.map((x) => x.foto)).toEqual(['data:image/jpeg;base64,AAA', null, null]);
  });
});
