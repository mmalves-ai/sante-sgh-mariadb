// W0-05: o ciclo de vida do protocolo e do ciclo de quimioterapia e a alteração da ordem do lactário.
import { describe, expect, it } from 'vitest';
import {
  conferirAjusteCiclo,
  ErroEspecialidade,
  exigirCicloEditavel,
  exigirLigacaoDesfazivel,
  exigirOfertavel,
  exigirOrdemAlteravel,
  exigirOrdemNaoCancelada,
  ofertaDoProtocolo,
  transicaoDoCiclo,
} from '../index.js';

const codigo = (fn: () => void) => {
  try {
    fn();
    return 'ok';
  } catch (x) {
    if (x instanceof ErroEspecialidade) return x.codigo;
    throw x;
  }
};

describe('oferta da versão do protocolo', () => {
  const v = { id: 10, codigo: 'FOLFOX', vigente: true };
  const e = (evento: string, em: string, protocolo: number | null = null, id = 1) => ({
    evento: evento as never,
    codigoProtocolo: 'FOLFOX',
    protocolo,
    em,
    id,
  });
  it('vigente sem eventos é ofertável; a versão antiga não', () => {
    expect(ofertaDoProtocolo(v, [])).toEqual({ revogada: false, inativo: false, ofertavel: true });
    expect(ofertaDoProtocolo({ ...v, vigente: false }, []).ofertavel).toBe(false);
  });
  it('a revogação da versão é final; a de outra versão não afeta', () => {
    expect(ofertaDoProtocolo(v, [e('versao-revogada', '2026-11-18T10:00', 10)])).toMatchObject({
      revogada: true,
      ofertavel: false,
    });
    expect(ofertaDoProtocolo(v, [e('versao-revogada', '2026-11-18T10:00', 9)]).ofertavel).toBe(true);
    expect(codigo(() => exigirOfertavel(ofertaDoProtocolo(v, [e('versao-revogada', 'x', 10)])))).toBe(
      'versao-revogada',
    );
  });
  it('inativar e reativar: o evento mais recente do código vale', () => {
    const inat = e('protocolo-inativado', '2026-11-17T10:00', null, 1);
    const reat = e('protocolo-reativado', '2026-11-18T10:00', null, 2);
    expect(ofertaDoProtocolo(v, [inat]).inativo).toBe(true);
    expect(codigo(() => exigirOfertavel(ofertaDoProtocolo(v, [inat])))).toBe('protocolo-inativo');
    expect(ofertaDoProtocolo(v, [reat, inat])).toMatchObject({ inativo: false, ofertavel: true });
  });
});

describe('ciclo', () => {
  it('o validado não se edita; o suspenso e o cancelado também não', () => {
    expect(codigo(() => exigirCicloEditavel({ situacao: 'prescrito', andamento: 'ativo' }))).toBe('ok');
    expect(codigo(() => exigirCicloEditavel({ situacao: 'validado', andamento: 'ativo' }))).toBe(
      'ciclo-ja-validado',
    );
    expect(codigo(() => exigirCicloEditavel({ situacao: 'prescrito', andamento: 'suspenso' }))).toBe(
      'ciclo-interrompido',
    );
  });
  it('suspender do ativo, retomar do suspenso, cancelar de ambos; o cancelado é final', () => {
    expect(transicaoDoCiclo('suspender', 'ativo')).toEqual({ de: ['ativo'], para: 'suspenso' });
    expect(transicaoDoCiclo('retomar', 'suspenso')).toEqual({ de: ['suspenso'], para: 'ativo' });
    expect(transicaoDoCiclo('cancelar', 'suspenso').para).toBe('cancelado');
    expect(codigo(() => transicaoDoCiclo('retomar', 'ativo'))).toBe('ciclo-interrompido');
    expect(codigo(() => transicaoDoCiclo('suspender', 'cancelado'))).toBe('ciclo-interrompido');
  });
  it('desfazer a ligação: só a prescrição ligada e só antes da validação', () => {
    expect(codigo(() => exigirLigacaoDesfazivel({ situacao: 'prescrito', prescricoes: [5] }, 5))).toBe('ok');
    expect(codigo(() => exigirLigacaoDesfazivel({ situacao: 'prescrito', prescricoes: [5] }, 6))).toBe(
      'prescricao-fora-do-ciclo',
    );
    expect(codigo(() => exigirLigacaoDesfazivel({ situacao: 'validado', prescricoes: [5] }, 5))).toBe(
      'ciclo-ja-validado',
    );
  });
});

describe('revisão: o ajuste do ciclo com as regras da inclusão', () => {
  const c = { numero: 2, dataPrevista: '2026-11-10', reducaoPct: 0, prescricoes: [] as number[] };
  const curso = [
    { numero: 1, dataPrevista: '2026-11-03' },
    { numero: 3, dataPrevista: '2026-11-17' },
  ];
  const novo = (dataPrevista: string, reducaoPct = 0, justificativaIntervalo: string | null = null) => ({
    dataPrevista,
    reducaoPct,
    justificativaIntervalo,
  });
  it('com prescrição ligada, mudar a data ou a redução recusa; sem mudar, passa', () => {
    const lig = { ...c, prescricoes: [990_201] };
    expect(codigo(() => conferirAjusteCiclo(lig, novo('2026-11-11'), curso, 7))).toBe('ciclo-com-prescricao');
    expect(codigo(() => conferirAjusteCiclo(lig, novo('2026-11-10', 20), curso, 7))).toBe(
      'ciclo-com-prescricao',
    );
    expect(codigo(() => conferirAjusteCiclo(lig, novo('2026-11-10'), curso, 7))).toBe('ok');
  });
  it('a data não passa do ciclo seguinte nem fica antes do anterior; no intervalo curto, a justificativa', () => {
    expect(codigo(() => conferirAjusteCiclo(c, novo('2026-11-18'), curso, 7))).toBe(
      'data-depois-do-seguinte',
    );
    expect(codigo(() => conferirAjusteCiclo(c, novo('2026-11-02'), curso, 7))).toBe('data-antes-do-anterior');
    expect(codigo(() => conferirAjusteCiclo(c, novo('2026-11-07'), curso, 7))).toBe('intervalo-curto');
    expect(conferirAjusteCiclo(c, novo('2026-11-07', 0, 'Viagem'), curso, 7)).toEqual({
      diasDesdeAnterior: 4,
    });
    expect(conferirAjusteCiclo({ ...c, numero: 1 }, novo('2026-11-01'), [], 7)).toEqual({
      diasDesdeAnterior: null,
    });
  });
});

describe('ordem do lactário', () => {
  it('altera antes da conferência; conferida ou cancelada recusa', () => {
    expect(codigo(() => exigirOrdemAlteravel({ situacao: 'preparada', canceladaEm: null }))).toBe('ok');
    expect(codigo(() => exigirOrdemAlteravel({ situacao: 'conferida', canceladaEm: null }))).toBe(
      'ordem-ja-conferida',
    );
    expect(
      codigo(() => exigirOrdemAlteravel({ situacao: 'preparada', canceladaEm: '2026-11-18T10:00' })),
    ).toBe('ordem-cancelada');
    expect(codigo(() => exigirOrdemNaoCancelada({ canceladaEm: '2026-11-18T10:00' }))).toBe(
      'ordem-cancelada',
    );
  });
});
