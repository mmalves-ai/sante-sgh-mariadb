// Regra 20 (ficha do M52; RDC63-05, NR32-04): treinamento com conteúdo, carga, instrutor, participantes e validade.
import { describe, expect, it } from 'vitest';
import {
  conclusaoQueVale,
  conferirCurso,
  conferirEncerramentoTurma,
  conferirParticipacao,
  conferirTurma,
  cursoAlcanca,
  type CursoLido,
  funcaoDoColaborador,
  participacaoConclui,
  pendenciasTreinamento,
  situacaoCurso,
  validadeAte,
} from './validade.js';

const HOJE = '2026-10-26';
const colab = {
  unidade: 12,
  funcao: 'Técnico de Enfermagem',
  cargo: 'Técnico',
  admissao: '2025-01-10',
  desligamento: null,
};
const curso = (x: Partial<CursoLido> = {}): CursoLido => ({
  id: 1,
  obrigatorio: true,
  validadeMeses: 12,
  cargaMinimaMin: 240,
  ativo: true,
  alvos: [],
  ...x,
});

describe('validade e situação do curso (regra 20)', () => {
  it('validade = conclusão + meses (31/01 + 1 mês = 28/02); 0 meses = sem vencimento', () => {
    expect(validadeAte('2026-01-31', 1)).toBe('2026-02-28');
    expect(validadeAte('2026-03-10', 12)).toBe('2027-03-10');
    expect(validadeAte('2026-03-10', 0)).toBeNull();
  });

  it('a conclusão que vale: a de validade mais longa; a sem validade vence; empate pela mais recente', () => {
    expect(conclusaoQueVale([])).toBeNull();
    const a = { curso: 1, conclusao: '2025-01-01', validoAte: '2026-01-01' };
    const b = { curso: 1, conclusao: '2025-06-01', validoAte: '2026-06-01' };
    const c = { curso: 1, conclusao: '2024-01-01', validoAte: null };
    expect(conclusaoQueVale([a, b])).toBe(b);
    expect(conclusaoQueVale([b, a])).toBe(b);
    expect(conclusaoQueVale([a, c])).toBe(c);
    const d = { curso: 1, conclusao: '2025-07-01', validoAte: '2026-06-01' };
    expect(conclusaoQueVale([b, d])).toBe(d);
  });

  it('situação: pendente sem conclusão; válido; a vencer dentro do alerta (30 dias); vencido', () => {
    expect(situacaoCurso([], HOJE).situacao).toBe('pendente');
    expect(situacaoCurso([{ curso: 1, conclusao: '2020-01-01', validoAte: null }], HOJE)).toEqual({
      situacao: 'valido',
      ultimaConclusao: '2020-01-01',
      validoAte: null,
      dias: null,
    });
    // 26/10 → 25/11 = 30 dias: ainda "a vencer"; 26/11 = 31 dias: válido.
    expect(
      situacaoCurso([{ curso: 1, conclusao: '2025-11-25', validoAte: '2026-11-25' }], HOJE),
    ).toMatchObject({
      situacao: 'aVencer',
      dias: 30,
    });
    expect(
      situacaoCurso([{ curso: 1, conclusao: '2025-11-26', validoAte: '2026-11-26' }], HOJE),
    ).toMatchObject({
      situacao: 'valido',
      dias: 31,
    });
    expect(
      situacaoCurso([{ curso: 1, conclusao: '2025-10-25', validoAte: '2026-10-25' }], HOJE),
    ).toMatchObject({
      situacao: 'vencido',
      dias: -1,
    });
    expect(
      situacaoCurso([{ curso: 1, conclusao: '2025-11-25', validoAte: '2026-11-25' }], HOJE, 10).situacao,
    ).toBe('valido');
  });
});

describe('público obrigatório e pendências (NR32-04)', () => {
  it('função pela função do vínculo, senão o cargo (sem acento, maiúsculas)', () => {
    expect(funcaoDoColaborador(colab)).toBe('TECNICO DE ENFERMAGEM');
    expect(funcaoDoColaborador({ funcao: '  ', cargo: 'Enfermeiro' })).toBe('ENFERMEIRO');
    expect(funcaoDoColaborador({ funcao: null, cargo: 'Médico' })).toBe('MEDICO');
  });

  it('alcance: sem alvo, todos; pela unidade; pela função; nenhum casa', () => {
    expect(cursoAlcanca(curso(), colab)).toBe(true);
    expect(cursoAlcanca(curso({ alvos: [{ tipo: 'unidade', valor: '12' }] }), colab)).toBe(true);
    expect(
      cursoAlcanca(curso({ alvos: [{ tipo: 'unidade', valor: '12' }] }), { ...colab, unidade: null }),
    ).toBe(false);
    expect(cursoAlcanca(curso({ alvos: [{ tipo: 'funcao', valor: 'TECNICO DE ENFERMAGEM' }] }), colab)).toBe(
      true,
    );
    expect(
      cursoAlcanca(
        curso({
          alvos: [
            { tipo: 'unidade', valor: '7' },
            { tipo: 'funcao', valor: 'MEDICO' },
          ],
        }),
        colab,
      ),
    ).toBe(false);
  });

  it('pendências só dos obrigatórios ativos que alcançam; o válido não é pendência', () => {
    const cursos = [
      curso({ id: 1 }),
      curso({ id: 2, obrigatorio: false }),
      curso({ id: 3, ativo: false }),
      curso({ id: 4, alvos: [{ tipo: 'unidade', valor: '99' }] }),
      curso({ id: 5 }),
      curso({ id: 6 }),
    ];
    const conclusoes = [
      { curso: 5, conclusao: '2026-06-01', validoAte: '2027-06-01' },
      { curso: 6, conclusao: '2025-10-01', validoAte: '2026-10-01' },
    ];
    expect(pendenciasTreinamento(cursos, conclusoes, colab, HOJE)).toEqual([
      { curso: 1, situacao: 'pendente', validoAte: null, dias: null },
      { curso: 6, situacao: 'vencido', validoAte: '2026-10-01', dias: -25 },
    ]);
  });
});

describe('curso, turma e participação', () => {
  it('curso: carga mínima, validade de 0 a 120 meses, alvo sem repetição', () => {
    const ok = { cargaMinimaMin: 60, validadeMeses: 12, obrigatorio: true, alvos: [] };
    expect(conferirCurso(ok)).toBeNull();
    expect(conferirCurso({ ...ok, cargaMinimaMin: 0 })?.codigo).toBe('carga-invalida');
    expect(conferirCurso({ ...ok, validadeMeses: 121 })?.codigo).toBe('validade-invalida');
    expect(conferirCurso({ ...ok, validadeMeses: -1 })?.codigo).toBe('validade-invalida');
    expect(
      conferirCurso({
        ...ok,
        alvos: [
          { tipo: 'unidade', valor: '1' },
          { tipo: 'unidade', valor: '1' },
        ],
      })?.codigo,
    ).toBe('alvo-repetido');
  });

  it('turma: curso ativo, período, início até 1 ano, carga ≥ mínima, instrutor', () => {
    const t = { inicio: '2026-11-03', fim: '2026-11-04', cargaMin: 240, instrutor: 'Instrutora Sintética' };
    const k = { cargaMinimaMin: 240, ativo: true };
    expect(conferirTurma(t, k, HOJE)).toBeNull();
    expect(conferirTurma(t, { ...k, ativo: false }, HOJE)?.codigo).toBe('curso-inativo');
    expect(conferirTurma({ ...t, fim: '2026-11-01' }, k, HOJE)?.codigo).toBe('periodo-invalido');
    expect(conferirTurma({ ...t, inicio: '2027-11-01', fim: '2027-11-02' }, k, HOJE)?.codigo).toBe(
      'inicio-distante',
    );
    expect(conferirTurma({ ...t, cargaMin: 239 }, k, HOJE)?.codigo).toBe('carga-insuficiente');
    expect(conferirTurma({ ...t, instrutor: ' a ' }, k, HOJE)?.codigo).toBe('instrutor-obrigatorio');
  });

  it('participação: turma aberta, ativo no início, ausente não conclui, conclusão dentro da turma', () => {
    const t = { inicio: '2026-10-20', fim: '2026-10-21', situacao: 'aberta' as const };
    const ok = {
      presenca: 'presente' as const,
      aproveitamento: 'aprovado' as const,
      conclusao: '2026-10-21',
    };
    expect(conferirParticipacao(ok, t, colab, HOJE)).toBeNull();
    expect(
      conferirParticipacao({ presenca: 'inscrito', aproveitamento: null, conclusao: null }, t, colab, HOJE),
    ).toBeNull();
    expect(conferirParticipacao(ok, { ...t, situacao: 'encerrada' }, colab, HOJE)?.codigo).toBe(
      'turma-encerrada',
    );
    expect(conferirParticipacao(ok, { ...t, situacao: 'cancelada' }, colab, HOJE)?.codigo).toBe(
      'turma-cancelada',
    );
    expect(conferirParticipacao(ok, t, { ...colab, desligamento: '2026-10-01' }, HOJE)?.codigo).toBe(
      'colaborador-desligado',
    );
    expect(
      conferirParticipacao(
        { presenca: 'ausente', aproveitamento: 'aprovado', conclusao: '2026-10-21' },
        t,
        colab,
        HOJE,
      )?.codigo,
    ).toBe('ausente-nao-conclui');
    expect(
      conferirParticipacao(
        { presenca: 'ausente', aproveitamento: 'reprovado', conclusao: null },
        t,
        colab,
        HOJE,
      ),
    ).toBeNull();
    expect(
      conferirParticipacao(
        { presenca: 'inscrito', aproveitamento: 'sem-avaliacao', conclusao: '2026-10-21' },
        t,
        colab,
        HOJE,
      )?.codigo,
    ).toBe('presenca-obrigatoria');
    expect(conferirParticipacao({ ...ok, conclusao: null }, t, colab, HOJE)?.codigo).toBe(
      'conclusao-obrigatoria',
    );
    expect(conferirParticipacao({ ...ok, conclusao: '2026-10-19' }, t, colab, HOJE)?.codigo).toBe(
      'conclusao-fora',
    );
    expect(conferirParticipacao({ ...ok, conclusao: '2026-10-27' }, t, colab, HOJE)?.codigo).toBe(
      'conclusao-futura',
    );
    expect(
      conferirParticipacao(
        { ...ok, conclusao: '2026-10-25' },
        { inicio: '2026-07-01', fim: '2026-07-02', situacao: 'aberta' },
        colab,
        HOJE,
      )?.codigo,
    ).toBe('conclusao-fora');
  });

  it('conclui: presente, com data e aprovado ou sem avaliação', () => {
    expect(participacaoConclui({ presenca: 'presente', aproveitamento: 'aprovado', conclusao: HOJE })).toBe(
      true,
    );
    expect(
      participacaoConclui({ presenca: 'presente', aproveitamento: 'sem-avaliacao', conclusao: HOJE }),
    ).toBe(true);
    expect(participacaoConclui({ presenca: 'presente', aproveitamento: 'reprovado', conclusao: HOJE })).toBe(
      false,
    );
    expect(participacaoConclui({ presenca: 'presente', aproveitamento: 'aprovado', conclusao: null })).toBe(
      false,
    );
    expect(participacaoConclui({ presenca: 'ausente', aproveitamento: null, conclusao: null })).toBe(false);
  });

  it('encerrar: só aberta, com participante e sem presença pendente', () => {
    expect(conferirEncerramentoTurma({ situacao: 'aberta' }, [{ presenca: 'presente' }])).toBeNull();
    expect(conferirEncerramentoTurma({ situacao: 'encerrada' }, [{ presenca: 'presente' }])?.codigo).toBe(
      'turma-encerrada',
    );
    expect(conferirEncerramentoTurma({ situacao: 'aberta' }, [])?.codigo).toBe('turma-vazia');
    expect(
      conferirEncerramentoTurma({ situacao: 'aberta' }, [{ presenca: 'presente' }, { presenca: 'inscrito' }])
        ?.codigo,
    ).toBe('presenca-pendente');
  });
});
