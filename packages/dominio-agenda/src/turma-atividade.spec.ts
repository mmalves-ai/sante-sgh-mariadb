// Regras da agenda de grupos e turmas (02-AGE linha 50).
import { describe, expect, it } from 'vitest';
import {
  type DadosTurma,
  decidirInscricao,
  decidirSaida,
  frequencia,
  gerarEncontros,
  idadeNaTurma,
  type PedidoInscricao,
  proximoDaEspera,
  validarCancelamentoEncontro,
  validarEscala,
  validarPresenca,
  validarTurma,
} from './turma-atividade.js';

const turma = (x: Partial<DadosTurma> = {}): DadosTurma => ({
  codigo: 'GR-1',
  descricao: 'Grupo de hipertensos',
  dataInicio: '2030-03-01',
  dataFim: '2030-06-30',
  vagas: 2,
  vagasEncaixe: 1,
  exigeAcompanhante: false,
  permiteAcompanhante: true,
  exigeIndicacaoMedica: false,
  idadeMinimaAnos: 18,
  idadeMaximaAnos: 80,
  profissionais: [{ profissional: 1, principal: true }],
  fontes: [{ fontePagadora: 10, plano: null, limite: 1 }],
  ...x,
});
const escala = {
  id: 7,
  diaSemana: 3,
  horaInicio: '14:00',
  horaFim: '15:30',
  inclusiveFeriado: false,
  vigenciaInicio: '2030-03-01',
  vigenciaFim: null,
  ativo: true,
};
const inscricao = (x: Partial<PedidoInscricao> = {}): PedidoInscricao => ({
  hoje: '2030-03-10',
  turma: {
    ativo: true,
    dataFim: '2030-06-30',
    vagas: 2,
    vagasEncaixe: 1,
    idadeMinimaAnos: 18,
    idadeMaximaAnos: 80,
    sexo: null,
    exigeIndicacaoMedica: true,
    exigeAcompanhante: false,
  },
  paciente: { nascimento: '1970-05-20', sexo: 2 },
  fontePagadora: 10,
  plano: null,
  indicacaoProfissional: 5,
  acompanhanteInformado: false,
  encaixe: false,
  fontes: [],
  ocupadas: 0,
  ultimaPosicaoEspera: 0,
  ...x,
});

describe('turma: cadastro e escala', () => {
  it('aceita a turma coerente e recusa cada incoerência', () => {
    expect(validarTurma(turma())).toBeNull();
    expect(validarTurma(turma({ vagas: 0 }))?.codigo).toBe('turma-sem-vagas');
    expect(validarTurma(turma({ dataFim: '2030-02-01' }))?.codigo).toBe('turma-periodo-invertido');
    expect(validarTurma(turma({ idadeMinimaAnos: 60, idadeMaximaAnos: 18 }))?.codigo).toBe(
      'turma-idade-invertida',
    );
    expect(validarTurma(turma({ exigeAcompanhante: true, permiteAcompanhante: false }))?.codigo).toBe(
      'turma-acompanhante-incoerente',
    );
    expect(validarTurma(turma({ profissionais: [] }))?.codigo).toBe('turma-sem-profissional');
    expect(
      validarTurma(
        turma({
          profissionais: [
            { profissional: 1, principal: true },
            { profissional: 2, principal: true },
          ],
        }),
      )?.codigo,
    ).toBe('turma-responsavel');
    expect(
      validarTurma(
        turma({
          fontes: [
            { fontePagadora: 10, plano: null, limite: null },
            { fontePagadora: 10, plano: null, limite: 3 },
          ],
        }),
      )?.codigo,
    ).toBe('turma-fonte-repetida');
    expect(validarTurma(turma({ fontes: [{ fontePagadora: 10, plano: null, limite: 0 }] }))?.codigo).toBe(
      'turma-limite-fonte',
    );
  });
  it('escala: dia, horário e vigência', () => {
    expect(validarEscala(escala)).toBeNull();
    expect(validarEscala({ ...escala, diaSemana: 8 })?.codigo).toBe('escala-dia-invalido');
    expect(validarEscala({ ...escala, horaFim: '13:00' })?.codigo).toBe('escala-horario-invertido');
    expect(validarEscala({ ...escala, horaInicio: '25:00' })?.codigo).toBe('escala-hora-invalida');
    expect(validarEscala({ ...escala, vigenciaFim: '2030-01-01' })?.codigo).toBe('escala-vigencia-invertida');
  });
});

describe('turma: geração dos encontros', () => {
  const base = {
    de: '2030-02-20',
    ate: '2030-03-31',
    turma: { dataInicio: '2030-03-01', dataFim: '2030-06-30', ativo: true },
    escalas: [escala],
    feriados: [],
    existentes: [],
  };
  it('gera as terças do período dentro da turma, sem feriado e sem repetir', () => {
    const g = gerarEncontros({
      ...base,
      feriados: [{ data: '2030-03-12' }],
      existentes: [{ data: '2030-03-05', horaInicio: '14:00' }],
    });
    expect(g.ok && g.encontros.map((e) => e.data)).toEqual(['2030-03-19', '2030-03-26']);
    expect(g.ok && [g.existentes, g.feriados]).toEqual([1, 1]);
    expect(g.ok && g.encontros[0]).toEqual({
      escala: 7,
      data: '2030-03-19',
      horaInicio: '14:00',
      horaFim: '15:30',
    });
  });
  it('feriado de meio período só pula o encontro que cruza a faixa; escala com feriado gera', () => {
    const manha = gerarEncontros({
      ...base,
      feriados: [{ data: '2030-03-12', horaInicio: '08:00', horaFim: '12:00' }],
    });
    expect(manha.ok && manha.encontros.length).toBe(4);
    const comFeriado = gerarEncontros({
      ...base,
      escalas: [{ ...escala, inclusiveFeriado: true }],
      feriados: [{ data: '2030-03-12' }],
    });
    expect(comFeriado.ok && comFeriado.encontros.length).toBe(4);
  });
  it('recusa período inválido, longo, turma inativa e sem escala', () => {
    expect(gerarEncontros({ ...base, ate: '2030-01-01' })).toMatchObject({
      ok: false,
      codigo: 'geracao-periodo-invalido',
    });
    expect(gerarEncontros({ ...base, ate: '2031-03-01' })).toMatchObject({
      ok: false,
      codigo: 'geracao-periodo-longo',
    });
    expect(gerarEncontros({ ...base, turma: { ...base.turma, ativo: false } })).toMatchObject({
      ok: false,
      codigo: 'turma-inativa',
    });
    expect(gerarEncontros({ ...base, escalas: [{ ...escala, ativo: false }] })).toMatchObject({
      ok: false,
      codigo: 'turma-sem-escala',
    });
  });
});

describe('turma: inscrição', () => {
  it('idade em anos completos', () => {
    expect(idadeNaTurma('1970-05-20', '2030-05-19')).toBe(59);
    expect(idadeNaTurma('1970-05-20', '2030-05-20')).toBe(60);
    expect(idadeNaTurma(null, '2030-05-20')).toBeNull();
  });
  it('inscreve com vaga, encaixa quando pedido e põe na espera sem vaga', () => {
    expect(decidirInscricao(inscricao())).toMatchObject({
      ok: true,
      situacao: 'inscrito',
      posicaoEspera: null,
    });
    expect(decidirInscricao(inscricao({ ocupadas: 2, encaixe: true }))).toMatchObject({
      ok: true,
      situacao: 'inscrito',
      encaixe: true,
    });
    expect(decidirInscricao(inscricao({ ocupadas: 3, encaixe: true, ultimaPosicaoEspera: 2 }))).toMatchObject(
      {
        ok: true,
        situacao: 'em_espera',
        posicaoEspera: 3,
      },
    );
  });
  it('recusa fora da idade, do sexo, sem indicação, sem acompanhante, fonte não aceita e limite da fonte', () => {
    expect(decidirInscricao(inscricao({ paciente: { nascimento: '2020-01-01', sexo: 2 } }))).toMatchObject({
      codigo: 'idade-fora-da-turma',
    });
    expect(decidirInscricao(inscricao({ paciente: { nascimento: null, sexo: 2 } }))).toMatchObject({
      codigo: 'paciente-sem-nascimento',
    });
    expect(decidirInscricao(inscricao({ turma: { ...inscricao().turma, sexo: 1 } }))).toMatchObject({
      codigo: 'sexo-fora-da-turma',
    });
    expect(decidirInscricao(inscricao({ indicacaoProfissional: null }))).toMatchObject({
      codigo: 'indicacao-obrigatoria',
    });
    expect(
      decidirInscricao(inscricao({ turma: { ...inscricao().turma, exigeAcompanhante: true } })),
    ).toMatchObject({
      codigo: 'acompanhante-obrigatorio',
    });
    expect(
      decidirInscricao(inscricao({ fontes: [{ fontePagadora: 11, plano: null, limite: null, usadas: 0 }] })),
    ).toMatchObject({ codigo: 'fonte-nao-aceita' });
    expect(
      decidirInscricao(inscricao({ fontes: [{ fontePagadora: 10, plano: null, limite: 1, usadas: 1 }] })),
    ).toMatchObject({ codigo: 'limite-da-fonte' });
    expect(
      decidirInscricao(
        inscricao({
          plano: 3,
          fontes: [
            { fontePagadora: 10, plano: null, limite: 1, usadas: 1 },
            { fontePagadora: 10, plano: 3, limite: null, usadas: 5 },
          ],
        }),
      ),
    ).toMatchObject({ ok: true, situacao: 'inscrito' });
    expect(decidirInscricao(inscricao({ turma: { ...inscricao().turma, ativo: false } }))).toMatchObject({
      codigo: 'turma-inativa',
    });
    expect(decidirInscricao(inscricao({ hoje: '2030-07-01' }))).toMatchObject({ codigo: 'turma-encerrada' });
  });
  it('saída com motivo e promoção da espera pela posição', () => {
    expect(decidirSaida('inscrito', 'desligado', null)?.codigo).toBe('saida-sem-motivo');
    expect(decidirSaida('ativo', 'concluido', null)).toBeNull();
    expect(decidirSaida('em_espera', 'concluido', null)?.codigo).toBe('espera-nao-conclui');
    expect(decidirSaida('desligado', 'desistente', 'x')?.codigo).toBe('participacao-encerrada');
    expect(
      proximoDaEspera([
        { id: 9, posicaoEspera: 2 },
        { id: 4, posicaoEspera: 1 },
      ])?.id,
    ).toBe(4);
    expect(proximoDaEspera([])).toBeNull();
  });
});

describe('turma: presença e encontro', () => {
  const agora = new Date('2030-03-12T18:00:00Z');
  const p = {
    encontro: { situacao: 'previsto' as const, inicio: new Date('2030-03-12T17:00:00Z') },
    agora,
    participante: { situacao: 'inscrito' as const },
    situacao: 'presente' as const,
    justificativa: null,
    acompanhantePresente: false,
    permiteAcompanhante: false,
  };
  it('aceita a presença e recusa cada impedimento', () => {
    expect(validarPresenca(p)).toBeNull();
    expect(validarPresenca({ ...p, encontro: { ...p.encontro, situacao: 'cancelado' } })?.codigo).toBe(
      'encontro-cancelado',
    );
    expect(validarPresenca({ ...p, agora: new Date('2030-03-12T16:00:00Z') })?.codigo).toBe(
      'encontro-futuro',
    );
    expect(validarPresenca({ ...p, participante: { situacao: 'em_espera' } })?.codigo).toBe(
      'participante-fora',
    );
    expect(validarPresenca({ ...p, situacao: 'falta_justificada' })?.codigo).toBe('falta-sem-justificativa');
    expect(validarPresenca({ ...p, acompanhantePresente: true })?.codigo).toBe('acompanhante-nao-permitido');
  });
  it('cancelamento do encontro e frequência', () => {
    expect(validarCancelamentoEncontro('previsto', 'chuva')).toBeNull();
    expect(validarCancelamentoEncontro('previsto', ' ')?.codigo).toBe('cancelamento-sem-motivo');
    expect(validarCancelamentoEncontro('realizado', 'x')?.codigo).toBe('encontro-realizado');
    expect(frequencia(['presente', 'falta', 'presente', 'falta_justificada'])).toBe(50);
    expect(frequencia([])).toBeNull();
  });
});
