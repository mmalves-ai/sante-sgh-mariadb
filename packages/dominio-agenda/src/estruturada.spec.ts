// Teste de aceite do ADR 0009 (seção 6 da resposta da Hal-AI: convênio e subplano, preparo e documentos, restrições
// e vaga) sobre uma agenda estruturada SINTÉTICA. Cada resposta sai da regra estruturada e traz o texto original ao
// lado, com o trecho não interpretado marcado.
import type { AgendaEstruturada } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { agendaAtendeConvenio, agendaAtendePaciente, preparoDoExame } from './index.js';

const DIA = '2026-11-22';
const ASSIM = 20;
const A60 = 22;
const ASSIM_RAIZ = 21;
const BRADESCO = 30;
const FLEX = 31;
const EMPRESARIAL = 32;
const UNIMED = 40;
const SUS = 50;
const TEXTO = 'ATENDE ASSIM EXCETO A60. BRADESCO SOMENTE EMPRESARIAL. A PARTIR DE 12 ANOS. Ligar antes.';
const vig = { vigenciaInicio: '2026-01-01', vigenciaFim: null, versao: 1 } as const;

const agenda: AgendaEstruturada = {
  agendaId: 1,
  nome: 'Cardiologia Medico A',
  codigoOrigem: '9001',
  estabelecimentoId: 1,
  estabelecimentoNome: 'HOSPITAL SINTETICO',
  profissionalId: 101,
  profissionalNome: 'MEDICO SINTETICO',
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  padrao: {
    sexoAtendido: 'todos',
    idadeMinimaAnos: 14,
    idadeMaximaAnos: null,
    aceitaRetorno: true,
    diasRetorno: 30,
    permiteEncaixe: false,
    preparo: null,
  },
  convenios: [ASSIM, BRADESCO, SUS],
  conveniosAceitos: [ASSIM, BRADESCO, SUS].map((fontePagadoraId) => ({
    fontePagadoraId,
    nome: `CONVENIO ${fontePagadoraId}`,
  })),
  coberturas: [
    {
      ...vig,
      id: 1,
      fontePagadoraId: ASSIM,
      planoId: A60,
      planoSuperiorId: ASSIM_RAIZ,
      fontePagadoraNome: 'CONVENIO SINTETICO',
      planoNome: null,
      planoSuperiorNome: null,
      aceita: false,
      situacaoRevisao: 'estimada',
      textoOrigemId: 7,
    },
    {
      ...vig,
      id: 2,
      fontePagadoraId: BRADESCO,
      planoId: EMPRESARIAL,
      planoSuperiorId: null,
      fontePagadoraNome: 'CONVENIO SINTETICO',
      planoNome: null,
      planoSuperiorNome: null,
      aceita: true,
      situacaoRevisao: 'estimada',
      textoOrigemId: 7,
    },
    {
      ...vig,
      id: 3,
      fontePagadoraId: SUS,
      planoId: null,
      planoSuperiorId: null,
      fontePagadoraNome: 'CONVENIO SINTETICO',
      planoNome: null,
      planoSuperiorNome: null,
      aceita: false,
      situacaoRevisao: 'confirmada',
      textoOrigemId: null,
    },
  ],
  restricoes: [
    {
      ...vig,
      id: 1,
      fontePagadoraId: null,
      planoId: null,
      itemAgendavelId: null,
      fontePagadoraNome: null,
      planoNome: null,
      sexoAtendido: null,
      idadeMinimaAnos: 12,
      idadeMaximaAnos: null,
      aceitaRetorno: null,
      diasRetorno: null,
      permiteEncaixe: null,
      situacaoRevisao: 'estimada',
      textoOrigemId: 7,
    },
    {
      ...vig,
      id: 2,
      fontePagadoraId: null,
      planoId: null,
      itemAgendavelId: 600,
      fontePagadoraNome: null,
      planoNome: null,
      sexoAtendido: 'feminino',
      idadeMinimaAnos: null,
      idadeMaximaAnos: null,
      aceitaRetorno: null,
      diasRetorno: null,
      permiteEncaixe: true,
      situacaoRevisao: 'confirmada',
      textoOrigemId: null,
    },
  ],
  preparos: [
    {
      ...vig,
      id: 1,
      itemAgendavelId: null,
      tipo: 'documento',
      descricao: 'Levar o pedido médico original.',
      jejumHoras: null,
      situacaoRevisao: 'confirmada',
      textoOrigemId: null,
    },
    {
      ...vig,
      id: 2,
      itemAgendavelId: 700,
      tipo: 'preparo',
      descricao: 'Jejum de 8 horas; não mascar chiclete.',
      jejumHoras: 8,
      situacaoRevisao: 'estimada',
      textoOrigemId: 7,
    },
    {
      ...vig,
      id: 3,
      itemAgendavelId: 700,
      tipo: 'orientacao',
      descricao: 'Chegar 30 minutos antes.',
      jejumHoras: null,
      situacaoRevisao: 'confirmada',
      textoOrigemId: null,
    },
  ],
  precosParticulares: [],
  textos: [
    {
      id: 7,
      agendaId: 1,
      fontePagadoraId: null,
      campo: 'observacao',
      texto: TEXTO,
      hash: '0123456789abcdef0123456789abcdef',
      situacao: 'extraida',
      versaoExtrator: '1',
      trechos: [
        { inicio: 0, fim: 24, interpretado: true, tipoRegra: 'cobertura', motivo: null },
        {
          inicio: TEXTO.indexOf('Ligar'),
          fim: TEXTO.length,
          interpretado: false,
          tipoRegra: null,
          motivo: 'sem regra',
        },
      ],
    },
  ],
};

const conv = (
  fontePagadoraId: number,
  planoId: number | null = null,
  planoSuperiorId: number | null = null,
) => agendaAtendeConvenio(agenda, { fontePagadoraId, planoId, planoSuperiorId, data: DIA });

describe('Convênio e subplano (6.5 a 6.8)', () => {
  it('6.5/6.7 o médico atende o meu convênio: vínculo da agenda, com o texto original ao lado', () => {
    const r = conv(ASSIM, 23, ASSIM_RAIZ);
    expect(r.atende).toBe(true);
    expect(r.textos[0]?.texto).toBe(TEXTO);
    expect(r.trechoNaoInterpretado).toBe(true);
  });
  it('6.5 SUS ativo no hospital, mas a agenda exclui', () => {
    expect(conv(SUS).atende).toBe(false);
  });
  it('6.6 convênio fora da agenda (Unimed) não é atendido', () => {
    expect(conv(UNIMED).atende).toBe(false);
  });
  it('6.8 Assim A60: atende o Assim, exceto o subplano A60 (estimada do texto)', () => {
    const r = conv(ASSIM, A60, ASSIM_RAIZ);
    expect([r.atende, r.estimada]).toEqual([false, true]);
    expect(r.motivo).toContain('exceto');
    const semPlano = conv(ASSIM);
    expect([semPlano.atende, semPlano.dependeDoPlano]).toEqual([true, true]);
  });
  it('6.8 Bradesco: só o Empresarial; o Flex não; sem plano, pergunta o plano', () => {
    expect(conv(BRADESCO, EMPRESARIAL).atende).toBe(true);
    expect(conv(BRADESCO, FLEX).atende).toBe(false);
    expect(conv(BRADESCO).dependeDoPlano).toBe(true);
  });
  it('fora da vigência a cobertura não vale', () => {
    const r = agendaAtendeConvenio(agenda, {
      fontePagadoraId: SUS,
      planoId: null,
      planoSuperiorId: null,
      data: '2025-06-01',
    });
    expect(r.atende).toBe(true);
  });
});

describe('Preparo e documentos (6.10 e 6.11)', () => {
  it('6.10 precisa de preparo para o exame E: jejum, orientação e o texto ao lado', () => {
    const r = preparoDoExame(agenda, { data: DIA, itemAgendavelId: 700 });
    expect([r.precisaPreparo, r.jejumHoras, r.estimada]).toEqual([true, 8, true]);
    expect(r.preparos.map((p) => p.tipo)).toEqual(['preparo', 'orientacao']);
    expect(r.textos).toHaveLength(1);
  });
  it('6.11 precisa de pedido médico: o documento da agenda vale para todo exame', () => {
    expect(preparoDoExame(agenda, { data: DIA, itemAgendavelId: 700 }).documentos[0]?.descricao).toContain(
      'pedido',
    );
    const outro = preparoDoExame(agenda, { data: DIA, itemAgendavelId: 701 });
    expect([outro.precisaPreparo, outro.documentos.length]).toEqual([false, 1]);
  });
});

describe('Restrições e vaga (6.12 a 6.14)', () => {
  it('6.12 o médico atende criança de 5 anos? Não: a partir de 12 (regra do texto sobrepõe os 14 do cadastro)', () => {
    const r = agendaAtendePaciente(agenda, { data: DIA, idadeAnos: 5 });
    expect([r.permitido, r.regras.idadeMinimaAnos, r.estimada]).toEqual([false, 12, true]);
    expect(r.motivo).toContain('12 anos');
    expect(agendaAtendePaciente(agenda, { data: DIA, idadeAnos: 12 }).permitido).toBe(true);
  });
  it('6.13 encaixe: a agenda não aceita; o exame 600 aceita (restrição do item)', () => {
    expect(agendaAtendePaciente(agenda, { data: DIA, encaixe: true }).permitido).toBe(false);
    expect(
      agendaAtendePaciente(agenda, { data: DIA, encaixe: true, itemAgendavelId: 600, sexo: 'feminino' })
        .permitido,
    ).toBe(true);
  });
  it('restrição por sexo no exame 600', () => {
    const r = agendaAtendePaciente(agenda, { data: DIA, itemAgendavelId: 600, sexo: 'masculino' });
    expect([r.permitido, r.impedimentos.length]).toEqual([false, 1]);
  });
  it('6.14 tenho direito a retorno? Sim, em até 30 dias', () => {
    const r = agendaAtendePaciente(agenda, { data: DIA, retorno: true });
    expect(r.permitido).toBe(true);
    expect(r.motivo).toContain('30 dias');
  });
});
