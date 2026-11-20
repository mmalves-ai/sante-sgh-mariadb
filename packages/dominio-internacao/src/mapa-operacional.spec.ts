// Regras 4 e 8 (ficha do M21): o mapa operacional tem os MESMOS números do painel do M16 (ocupação pela marca do
// leito conferida com as internações abertas; nunca o contador da acomodação) e sobrepõe os estados só do novo: o
// bloqueio e a higienização impedem a admissão no novo; o leito bloqueado ocupado pelo outro sistema vira conflito.
import { describe, expect, it } from 'vitest';
import { compativelComPaciente, idadeEmAnos, montarMapaOperacional, vencimentoDaGuia } from './adt.js';
import { em } from './massa.spec-util.js';
import { montarPainel } from './painel.js';
import { leituras } from './painel.spec-util.js';

const painel = montarPainel(leituras(), {
  intensivas: [3],
  agora: em('2026-10-21'),
  lidoEm: '2026-10-21T10:00:00Z',
  dadosAte: '2026-10-21T10:00:00Z',
  destino: 'memoria',
});

describe('mapa de leitos operacional', () => {
  it('sem estados do novo: os leitos e os totais são os do painel', () => {
    const m = montarMapaOperacional(painel, [], []);
    const leitosPainel = painel.blocos.flatMap((b) => b.acomodacoes.flatMap((a) => a.leitos));
    expect(m.leitos).toHaveLength(leitosPainel.length);
    expect(m.leitos.filter((l) => l.situacao === 'ocupado')).toHaveLength(painel.totais.ocupados);
    expect(m.leitos.filter((l) => l.situacao === 'livre')).toHaveLength(painel.totais.livres);
    expect(m.leitos.filter((l) => l.situacao === 'inativo')).toHaveLength(painel.totais.inativos);
    expect(m.resumo.admissiveis).toBe(painel.totais.livres);
    expect(m.painel).toBe(painel);
  });

  it('bloqueio e higienização impedem a admissão no novo; o ocupado bloqueado é conflito', () => {
    const m = montarMapaOperacional(
      painel,
      [
        {
          chave: '1|ENF|02',
          estado: 'bloqueio',
          motivo: 'manutencao',
          precaucao: null,
          previsaoFim: '2026-10-25',
          desde: '2026-10-20T08:00:00',
          solicitacao: null,
          conflitoReg: null,
          conflitoEm: null,
        },
        {
          chave: '1|ENF|01',
          estado: 'higienizacao',
          motivo: null,
          precaucao: 'contato',
          previsaoFim: null,
          desde: '2026-10-21T09:00:00',
          solicitacao: 77,
          conflitoReg: 501,
          conflitoEm: '2026-10-21T09:30:00',
        },
      ],
      [
        {
          chave: '1|ENF|01',
          solicitacao: 77,
          etapa: 'solicitado',
          prazo: '2026-10-21T11:00:00',
          atrasada: false,
        },
      ],
      [{ chave: '1|ENF|02', sexo: 'F', idadeMinima: 18, idadeMaxima: null, criticidade: 2 }],
    );
    const l2 = m.leitos.find((l) => l.chave === '1|ENF|02');
    const l1 = m.leitos.find((l) => l.chave === '1|ENF|01');
    expect(l2?.situacao).toBe('bloqueado');
    expect(l2?.admissivel).toBe(false);
    expect(l2?.atributos?.sexo).toBe('F');
    expect(l1?.situacao).toBe('conflito');
    // Já registrado (CONFLITO_EM gravado): a releitura do mapa não registra de novo.
    expect(l1?.conflito).toEqual({ internacao: 501, desde: '2026-10-21T09:30:00', registrado: true });
    expect(l1?.limpeza?.solicitacao).toBe(77);
    expect(m.resumo).toEqual({
      bloqueados: 1,
      emHigienizacao: 0,
      conflitos: 1,
      admissiveis: painel.totais.livres - 1,
      reservados: 0,
    });
  });

  it('M44: o leito reservado pelo NIR só admite o paciente da solicitação; ocupado por fora, conflito com a reserva', () => {
    const reservas = [
      {
        chave: '1|ENF|02',
        id: 31,
        solicitacao: 7,
        validaAte: '2026-10-21T12:00:00',
        confirmada: false,
        conflitoEm: null,
      },
      {
        chave: '1|ENF|01',
        id: 32,
        solicitacao: 8,
        validaAte: '2026-10-21T12:00:00',
        confirmada: true,
        conflitoEm: null,
      },
    ];
    const m = montarMapaOperacional(painel, [], [], [], reservas);
    const r = m.leitos.find((l) => l.chave === '1|ENF|02');
    expect(r).toMatchObject({
      situacao: 'reservado',
      admissivel: false,
      reserva: { id: 31, solicitacao: 7, confirmada: false },
    });
    expect(r?.motivo).toMatch(/NIR/);
    const c = m.leitos.find((l) => l.chave === '1|ENF|01');
    expect(c?.situacao).toBe('conflito');
    expect(c?.conflito).toMatchObject({ internacao: 501, registrado: false, reserva: 32 });
    expect(m.resumo).toMatchObject({ reservados: 1, conflitos: 1, admissiveis: painel.totais.livres - 1 });
    // A admissão que atende a solicitação 7 pode usar o leito reservado para ela.
    const p = montarMapaOperacional(painel, [], [], [], reservas, 7);
    expect(p.leitos.find((l) => l.chave === '1|ENF|02')?.admissivel).toBe(true);
    const ja = montarMapaOperacional(
      painel,
      [],
      [],
      [],
      [{ ...reservas[1]!, conflitoEm: '2026-10-21T09:00:00' }],
    );
    expect(ja.leitos.find((l) => l.chave === '1|ENF|01')?.conflito).toMatchObject({
      registrado: true,
      desde: '2026-10-21T09:00:00',
    });
  });

  it('o conflito visto pela primeira vez sai como não registrado (o mapa registra e a trilha recebe uma vez)', () => {
    const m = montarMapaOperacional(
      painel,
      [
        {
          chave: '1|ENF|01',
          estado: 'bloqueio',
          motivo: 'manutencao',
          precaucao: null,
          previsaoFim: null,
          desde: '2026-10-21T09:00:00',
          solicitacao: null,
          conflitoReg: null,
          conflitoEm: null,
        },
      ],
      [],
    );
    const l = m.leitos.find((x) => x.chave === '1|ENF|01');
    expect(l?.situacao).toBe('conflito');
    expect(l?.conflito?.registrado).toBe(false);
  });

  it('leito em higienização livre e inativo', () => {
    const m = montarMapaOperacional(
      painel,
      [
        {
          chave: '1|ENF|02',
          estado: 'higienizacao',
          motivo: null,
          precaucao: null,
          previsaoFim: null,
          desde: '2026-10-21T09:00:00',
          solicitacao: 5,
          conflitoReg: null,
          conflitoEm: null,
        },
      ],
      [],
    );
    expect(m.leitos.find((l) => l.chave === '1|ENF|02')?.situacao).toBe('higienizacao');
    expect(m.leitos.find((l) => l.chave === '1|ENF|03')?.situacao).toBe('inativo');
    expect(m.resumo.emHigienizacao).toBe(1);
  });

  it('compatibilidade pelos atributos e o vencimento da guia', () => {
    expect(compativelComPaciente(null, { sexo: 'M', idade: 40 })).toBeNull();
    expect(
      compativelComPaciente({ sexo: 'F', idadeMinima: null, idadeMaxima: null }, { sexo: 'M', idade: 1 }),
    ).toMatch(/feminino/);
    expect(
      compativelComPaciente({ sexo: 'M', idadeMinima: null, idadeMaxima: null }, { sexo: 'F', idade: 1 }),
    ).toMatch(/masculino/);
    expect(
      compativelComPaciente({ sexo: 'A', idadeMinima: 18, idadeMaxima: 60 }, { sexo: 'F', idade: 10 }),
    ).toMatch(/18/);
    expect(
      compativelComPaciente({ sexo: null, idadeMinima: 0, idadeMaxima: 12 }, { sexo: 'F', idade: 30 }),
    ).toMatch(/12/);
    expect(
      compativelComPaciente({ sexo: 'F', idadeMinima: 0, idadeMaxima: 12 }, { sexo: 'F', idade: null }),
    ).toBeNull();
    expect(idadeEmAnos('2001-09-09', '2026-10-22')).toBe(25);
    expect(idadeEmAnos('2001-10-23', '2026-10-22')).toBe(24);
    expect(idadeEmAnos('2001-10-22', '2026-10-22')).toBe(25);
    expect(idadeEmAnos(null, '2026-10-22')).toBeNull();
    expect(idadeEmAnos('2030-01-01', '2026-10-22')).toBeNull();
    expect(idadeEmAnos('x', '2026-10-22')).toBeNull();
    expect(vencimentoDaGuia(null, '2026-10-21')).toBe('vigente');
    expect(vencimentoDaGuia('2026-10-20', '2026-10-21')).toBe('vencida');
    expect(vencimentoDaGuia('2026-10-22', '2026-10-21')).toBe('vence-hoje');
    expect(vencimentoDaGuia('2026-10-30', '2026-10-21')).toBe('vigente');
  });
});
