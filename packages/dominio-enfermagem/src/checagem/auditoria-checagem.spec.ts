import { describe, expect, it } from 'vitest';
import {
  AMOSTRA_MAXIMA,
  auditoresDaAbertura,
  concluirAuditoria,
  conferirAbertura,
  conferirAvaliacao,
  conferirCancelamentoAuditoria,
  podeAvaliar,
  sortearAmostra,
  totaisDaAuditoria,
} from './auditoria-checagem.js';

const agora = new Date('2026-11-20T12:00:00Z');
const abertura = {
  inicio: new Date('2026-11-01T00:00:00Z'),
  fim: new Date('2026-11-10T00:00:00Z'),
  tamanho: 5,
  candidatas: 30,
  responsavel: 1,
  auditores: [{ usuario: 2, papel: 'auditor' as const }],
  agora,
};

describe('auditoria das checagens: sorteio da amostra', () => {
  const lista = Array.from({ length: 50 }, (_, i) => 100 + i);

  it('é reprodutível pela semente e não depende da ordem das candidatas', () => {
    const a = sortearAmostra(lista, 10, 'semente-1');
    const b = sortearAmostra([...lista].reverse(), 10, 'semente-1');
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(10);
    expect(a.every((x) => lista.includes(x))).toBe(true);
  });

  it('outra semente dá outra amostra; a amostra não passa do que existe', () => {
    expect(sortearAmostra(lista, 10, 'semente-1')).not.toEqual(sortearAmostra(lista, 10, 'semente-2'));
    expect(sortearAmostra([1, 2, 3, 3], 10, 'x').sort()).toEqual([1, 2, 3]);
    expect(sortearAmostra(lista, 0, 'x')).toEqual([]);
  });
});

describe('auditoria das checagens: abertura', () => {
  it('aceita o pedido válido', () => expect(conferirAbertura(abertura)).toBeNull());

  it('recusa período invertido, futuro, longo e amostra fora dos limites', () => {
    expect(conferirAbertura({ ...abertura, fim: new Date('2026-10-01T00:00:00Z') })?.codigo).toBe(
      'periodo-invalido',
    );
    expect(
      conferirAbertura({
        ...abertura,
        inicio: new Date('2026-12-01T00:00:00Z'),
        fim: new Date('2026-12-02T00:00:00Z'),
      })?.codigo,
    ).toBe('periodo-futuro');
    expect(conferirAbertura({ ...abertura, inicio: new Date('2026-01-01T00:00:00Z') })?.codigo).toBe(
      'periodo-longo',
    );
    expect(conferirAbertura({ ...abertura, tamanho: 0 })?.codigo).toBe('amostra-invalida');
    expect(conferirAbertura({ ...abertura, tamanho: AMOSTRA_MAXIMA + 1 })?.codigo).toBe('amostra-invalida');
    expect(conferirAbertura({ ...abertura, candidatas: 0 })?.codigo).toBe('sem-checagens');
  });

  it('recusa auditor repetido e um segundo responsável', () => {
    expect(
      conferirAbertura({
        ...abertura,
        auditores: [
          { usuario: 2, papel: 'auditor' },
          { usuario: 2, papel: 'observador' },
        ],
      })?.codigo,
    ).toBe('auditor-repetido');
    expect(conferirAbertura({ ...abertura, auditores: [{ usuario: 3, papel: 'responsavel' }] })?.codigo).toBe(
      'responsavel-unico',
    );
  });

  it('grava o responsável primeiro e sem repetir; o observador não avalia', () => {
    const a = auditoresDaAbertura(1, [
      { usuario: 1, papel: 'auditor' },
      { usuario: 2, papel: 'auditor' },
      { usuario: 3, papel: 'observador' },
    ]);
    expect(a).toEqual([
      { usuario: 1, papel: 'responsavel' },
      { usuario: 2, papel: 'auditor' },
      { usuario: 3, papel: 'observador' },
    ]);
    expect(podeAvaliar(a, 1)).toBe(true);
    expect(podeAvaliar(a, 2)).toBe(true);
    expect(podeAvaliar(a, 3)).toBe(false);
    expect(podeAvaliar(a, 9)).toBe(false);
  });
});

describe('auditoria das checagens: avaliação de cada checagem', () => {
  const base = {
    situacao: 'aberta' as const,
    motivo: null,
    motivoExigeComplemento: false,
    justificativa: null,
  };

  it('conforme passa sem justificativa', () =>
    expect(conferirAvaliacao({ ...base, resultado: 'conforme' })).toBeNull());

  it('não conforme pede o motivo padronizado e a justificativa', () => {
    expect(conferirAvaliacao({ ...base, resultado: 'nao_conforme' })?.codigo).toBe('motivo-obrigatorio');
    expect(
      conferirAvaliacao({ ...base, resultado: 'nao_conforme', motivo: 7, justificativa: 'curta' })?.codigo,
    ).toBe('justificativa-obrigatoria');
    expect(
      conferirAvaliacao({
        ...base,
        resultado: 'nao_conforme',
        motivo: 7,
        justificativa: 'Sem leitura da pulseira registrada',
      }),
    ).toBeNull();
  });

  it('não aplicável pede a justificativa; motivo só na não conformidade; encerrada não muda', () => {
    expect(conferirAvaliacao({ ...base, resultado: 'nao_aplicavel' })?.codigo).toBe(
      'justificativa-obrigatoria',
    );
    expect(conferirAvaliacao({ ...base, resultado: 'conforme', motivo: 7 })?.codigo).toBe('motivo-indevido');
    expect(conferirAvaliacao({ ...base, resultado: 'pendente' })?.codigo).toBe('avaliacao-invalida');
    expect(conferirAvaliacao({ ...base, situacao: 'concluida', resultado: 'conforme' })?.codigo).toBe(
      'auditoria-encerrada',
    );
  });
});

describe('auditoria das checagens: conclusão e cancelamento', () => {
  it('soma os totais sem os não aplicáveis na taxa', () => {
    expect(totaisDaAuditoria(['conforme', 'conforme', 'nao_conforme', 'nao_aplicavel', 'pendente'])).toEqual({
      avaliados: 3,
      conformes: 2,
      naoConformes: 1,
      naoAplicaveis: 1,
      pendentes: 1,
      taxa: 2 / 3,
    });
  });

  it('não conclui com checagem pendente nem com tudo não aplicável', () => {
    const r = concluirAuditoria('em_andamento', ['conforme', 'pendente']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problema.codigo).toBe('amostra-incompleta');
    const s = concluirAuditoria('em_andamento', ['nao_aplicavel']);
    expect(!s.ok && s.problema.codigo).toBe('sem-avaliado');
    const t = concluirAuditoria('concluida', ['conforme']);
    expect(!t.ok && t.problema.codigo).toBe('auditoria-encerrada');
  });

  it('o resultado sai da taxa: tudo conforme, parcialmente a partir de 80%, abaixo não conforme', () => {
    const c = concluirAuditoria('em_andamento', ['conforme', 'conforme', 'nao_aplicavel']);
    expect(c.ok && c.resultado).toBe('conforme');
    expect(c.ok && c.totais.avaliados).toBe(2);
    const p = concluirAuditoria('em_andamento', [...Array(4).fill('conforme'), 'nao_conforme']);
    expect(p.ok && p.resultado).toBe('parcialmente_conforme');
    const n = concluirAuditoria('aberta', ['conforme', 'nao_conforme']);
    expect(n.ok && n.resultado).toBe('nao_conforme');
  });

  it('cancela só a não encerrada e com o motivo', () => {
    expect(conferirCancelamentoAuditoria('aberta', 'curto')?.codigo).toBe('motivo-obrigatorio');
    expect(conferirCancelamentoAuditoria('concluida', 'Amostra sorteada no período errado')?.codigo).toBe(
      'auditoria-encerrada',
    );
    expect(conferirCancelamentoAuditoria('em_andamento', 'Amostra sorteada no período errado')).toBeNull();
  });
});
