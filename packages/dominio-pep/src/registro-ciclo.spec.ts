import { describe, expect, it } from 'vitest';
import {
  ligacaoDaCorrecao,
  pedidoDeParecer,
  RecusaCicloRegistro,
  respostaDeParecer,
  versaoNaSuspensao,
} from './registro-ciclo.js';

const FOTO = {
  situacao: 'finalizado',
  impressaoDigital: 'a'.repeat(64),
  textoConsolidado: 'Evolução sintética',
  dataHoraClinica: '2026-11-25T10:00:00.000Z',
  respostas: 3,
};
const codigo = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof RecusaCicloRegistro ? e.codigo : 'outro';
  }
  return 'sem-recusa';
};

describe('versaoNaSuspensao', () => {
  it('a primeira versão é 1 e a seguinte vem depois da maior guardada, com a fotografia e o motivo aparado', () => {
    expect(versaoNaSuspensao([], FOTO, '  Dado do paciente errado ')).toEqual({
      numeroVersao: 1,
      operacao: 'alteracao',
      motivo: 'Dado do paciente errado',
      dados: { ...FOTO, evento: 'suspensao' },
    });
    expect(versaoNaSuspensao([1, 3, 2], FOTO, 'Outro motivo').numeroVersao).toBe(4);
  });
  it('sem justificativa recusa', () => {
    expect(codigo(() => versaoNaSuspensao([], FOTO, '   '))).toBe('motivo-obrigatorio');
    expect(codigo(() => versaoNaSuspensao([], FOTO, null))).toBe('motivo-obrigatorio');
  });
});

describe('ligacaoDaCorrecao', () => {
  it('liga a última versão ainda não corrigida; sem nenhuma livre, cria a fotografia', () => {
    expect(
      ligacaoDaCorrecao([
        { numero: 1, corrigidoPor: 9 },
        { numero: 2, corrigidoPor: null },
      ]),
    ).toEqual({ ligar: 2 });
    expect(ligacaoDaCorrecao([{ numero: 1, corrigidoPor: 9 }])).toEqual({ criar: true });
    expect(ligacaoDaCorrecao([])).toEqual({ criar: true });
  });
});

describe('pedidoDeParecer', () => {
  const agora = new Date('2026-11-25T12:00:00Z');
  const base = {
    especialidade: 7,
    categoria: null,
    prioridade: 'urgente' as const,
    prazo: '2026-11-26T12:00:00Z',
    texto: ' Avaliar arritmia ',
    agora,
  };
  it('grava destino, prioridade, prazo e o texto do registro como motivo', () => {
    expect(pedidoDeParecer(base)).toEqual({
      especialidade: 7,
      categoria: null,
      prioridade: 'urgente',
      prazo: new Date('2026-11-26T12:00:00Z'),
      motivo: 'Avaliar arritmia',
    });
    expect(
      pedidoDeParecer({ ...base, especialidade: null, categoria: ' nutricao ', prazo: null }),
    ).toMatchObject({
      categoria: 'nutricao',
      prazo: null,
    });
  });
  it('recusa sem destino, sem texto e com prazo passado', () => {
    expect(codigo(() => pedidoDeParecer({ ...base, especialidade: null, categoria: ' ' }))).toBe(
      'parecer-sem-destino',
    );
    expect(codigo(() => pedidoDeParecer({ ...base, texto: '' }))).toBe('parecer-sem-motivo');
    expect(codigo(() => pedidoDeParecer({ ...base, prazo: '2026-11-25T11:00:00Z' }))).toBe(
      'parecer-prazo-invalido',
    );
  });
});

describe('respostaDeParecer', () => {
  const base = {
    situacao: 'solicitado',
    solicitante: 1,
    respondente: 2,
    pacienteDoParecer: 5,
    pacienteDoRegistro: 5,
    sequencias: [] as number[],
    texto: 'Sem contraindicação',
  };
  it('a primeira resposta aceita o parecer solicitado; a seguinte tem a sequência seguinte', () => {
    expect(respostaDeParecer(base)).toEqual({
      sequencia: 1,
      aceitaAgora: true,
      parecer: 'Sem contraindicação',
    });
    expect(respostaDeParecer({ ...base, situacao: 'respondido', sequencias: [1] })).toEqual({
      sequencia: 2,
      aceitaAgora: false,
      parecer: 'Sem contraindicação',
    });
  });
  it('recusa outro paciente, parecer cancelado, quem pediu e texto vazio', () => {
    expect(codigo(() => respostaDeParecer({ ...base, pacienteDoRegistro: 6 }))).toBe(
      'parecer-de-outro-paciente',
    );
    expect(codigo(() => respostaDeParecer({ ...base, situacao: 'cancelado' }))).toBe('parecer-encerrado');
    expect(codigo(() => respostaDeParecer({ ...base, respondente: 1 }))).toBe('parecer-proprio');
    expect(codigo(() => respostaDeParecer({ ...base, texto: ' ' }))).toBe('parecer-sem-motivo');
  });
});
