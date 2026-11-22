import { describe, expect, it } from 'vitest';
import {
  ehMedico,
  prioridadeDaSenha,
  recusaCancelamento,
  recusaConducao,
  recusaMarcacaoNaAbertura,
  recusaSaidaObservacao,
  recusaSenhaNaAbertura,
  senhaVoltaAFila,
  situacaoNoConsultorio,
} from './fluxo-atendimento.js';

describe('abertura do atendimento', () => {
  const senha = { existe: true, doDia: true, situacao: 'aguardando', outroAtendimentoAtivo: false };
  it('senha do dia na fila abre; as demais recusam com o código', () => {
    expect(recusaSenhaNaAbertura(senha)).toBeNull();
    expect(recusaSenhaNaAbertura({ ...senha, situacao: 'chamada' })).toBeNull();
    expect(recusaSenhaNaAbertura({ ...senha, existe: false })?.codigo).toBe('senha-inexistente');
    expect(recusaSenhaNaAbertura({ ...senha, outroAtendimentoAtivo: true })?.codigo).toBe(
      'senha-ja-atendida',
    );
    expect(recusaSenhaNaAbertura({ ...senha, doDia: false })?.codigo).toBe('senha-de-outro-dia');
    for (const s of ['em_atendimento', 'encaminhada', 'atendida', 'cancelada'])
      expect(recusaSenhaNaAbertura({ ...senha, situacao: s })?.codigo).toBe('senha-concluida');
  });
  it('marcação: existe, do dia, sem atendimento e do mesmo paciente', () => {
    const m = { existe: true, doDia: true, jaAtendida: false, mesmoPaciente: true };
    expect(recusaMarcacaoNaAbertura(m)).toBeNull();
    expect(recusaMarcacaoNaAbertura({ ...m, existe: false })?.codigo).toBe('marcacao-inexistente');
    expect(recusaMarcacaoNaAbertura({ ...m, doDia: false })?.codigo).toBe('marcacao-de-outro-dia');
    expect(recusaMarcacaoNaAbertura({ ...m, jaAtendida: true })?.codigo).toBe('marcacao-ja-atendida');
    expect(recusaMarcacaoNaAbertura({ ...m, mesmoPaciente: false })?.codigo).toBe(
      'marcacao-de-outro-paciente',
    );
  });
});

describe('consultório', () => {
  it('situação pela situação do atendimento e pela chamada', () => {
    expect(situacaoNoConsultorio({ situacao: 'aberto', chamado: false })).toBe('aguardando');
    expect(situacaoNoConsultorio({ situacao: 'aberto', chamado: true })).toBe('chamado');
    expect(situacaoNoConsultorio({ situacao: 'em_observacao', chamado: true })).toBe('emAtendimento');
    expect(situacaoNoConsultorio({ situacao: 'cancelado', chamado: false })).toBe('liberado');
  });
  it('atender exige a chamada; chamar de novo vale; encerrado e em atendimento recusam', () => {
    expect(recusaConducao('chamar', 'aguardando')).toBeNull();
    expect(recusaConducao('chamar', 'chamado')).toBeNull();
    expect(recusaConducao('atender', 'chamado')).toBeNull();
    expect(recusaConducao('atender', 'aguardando')?.codigo).toBe('paciente-nao-chamado');
    expect(recusaConducao('atender', 'emAtendimento')?.codigo).toBe('situacao-mudou');
    expect(recusaConducao('chamar', 'liberado')?.codigo).toBe('atendimento-encerrado');
  });
  it('prioridade legal: acima de 80 anos, demais prioridades, normal', () => {
    expect(prioridadeDaSenha({ prioritaria: true, idadeMinimaDoGrupo: 80 })).toBe('0');
    expect(prioridadeDaSenha({ prioritaria: true, idadeMinimaDoGrupo: 60 })).toBe('1');
    expect(prioridadeDaSenha({ prioritaria: true, idadeMinimaDoGrupo: null })).toBe('1');
    expect(prioridadeDaSenha({ prioritaria: false, idadeMinimaDoGrupo: null })).toBe('2');
  });
});

describe('exclusão e observação', () => {
  it('exclui só o aberto por engano; a senha só volta se estava em atendimento e é do dia', () => {
    expect(recusaCancelamento({ situacao: 'aberto', temDesfecho: false })).toBeNull();
    expect(recusaCancelamento({ situacao: 'encerrado', temDesfecho: true })?.codigo).toBe(
      'exclusao-recusada',
    );
    expect(recusaCancelamento({ situacao: 'em_atendimento', temDesfecho: true })?.codigo).toBe(
      'exclusao-recusada',
    );
    expect(recusaCancelamento({ situacao: 'cancelado', temDesfecho: false })?.codigo).toBe(
      'exclusao-recusada',
    );
    expect(senhaVoltaAFila({ situacao: 'em_atendimento', doDia: true })).toBe(true);
    expect(senhaVoltaAFila({ situacao: 'atendida', doDia: true })).toBe(false);
    expect(senhaVoltaAFila({ situacao: 'em_atendimento', doDia: false })).toBe(false);
  });
  it('acima do limite pede justificativa de ao menos 10 caracteres; a transferência não', () => {
    const s = { horas: 25, limiteHoras: 24, justificativa: null, transferencia: false };
    expect(recusaSaidaObservacao(s)?.codigo).toBe('justificativa-obrigatoria');
    expect(recusaSaidaObservacao({ ...s, justificativa: 'curta' })?.codigo).toBe('justificativa-obrigatoria');
    expect(recusaSaidaObservacao({ ...s, justificativa: 'Aguardou vaga de leito' })).toBeNull();
    expect(recusaSaidaObservacao({ ...s, transferencia: true })).toBeNull();
    expect(recusaSaidaObservacao({ ...s, horas: 23.9 })).toBeNull();
  });
  it('ato médico: CBO 225 ou CRM ativo; enfermagem e farmácia não', () => {
    expect(ehMedico({ codigoCbo: '225125', siglaConselho: null, inscricaoAtiva: false })).toBe(true);
    expect(ehMedico({ codigoCbo: null, siglaConselho: 'CRM', inscricaoAtiva: true })).toBe(true);
    expect(ehMedico({ codigoCbo: null, siglaConselho: 'CRM', inscricaoAtiva: false })).toBe(false);
    expect(ehMedico({ codigoCbo: '223505', siglaConselho: 'COREN', inscricaoAtiva: true })).toBe(false);
    expect(ehMedico({ codigoCbo: null, siglaConselho: 'CRF', inscricaoAtiva: true })).toBe(false);
  });
});
