import type { ContextoPaciente } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { montar } from '../testes/montar.js';
import SanteCabecalhoPaciente from './SanteCabecalhoPaciente.vue';

// Paciente FICTÍCIO (dados sintéticos; nenhum dado real).
const base: ContextoPaciente = {
  identificacao: {
    nomeSocial: null,
    nomeCivil: 'Paciente Fictício Um',
    nascimento: '1980-05-17',
    idade: '46 anos',
    sexo: 'F',
    prontuario: '000123',
  },
  localizacao: {
    estabelecimento: 'Estabelecimento de teste',
    unidade: 'Unidade A',
    leito: '101-B',
    diasInternacao: 3,
    altaProvavel: null,
  },
  atendimento: { tipo: 'Internação', numero: '0001', convenio: 'Convênio de teste', medicoResponsavel: null },
  alergias: { situacao: 'nao-avaliadas' },
  alertas: [],
  homonimoNaUnidade: false,
  medidas: { peso: null, altura: null },
};

describe('SanteCabecalhoPaciente (regra 11)', () => {
  it('seis blocos e dois identificadores sempre visíveis (nome + nascimento, e prontuário)', () => {
    const w = montar(SanteCabecalhoPaciente, { props: { paciente: base } });
    const blocos = w.findAll('[data-bloco]').map((b) => b.attributes('data-bloco'));
    expect(blocos).toEqual(['identificacao', 'localizacao', 'atendimento', 'alergias', 'alertas', 'medidas']);
    expect(w.find('h2').text()).toBe('Paciente Fictício Um');
    expect(w.find('[data-testid="nascimento"]').text()).toBe('Nascimento: 17/05/1980');
    expect(w.find('[data-testid="prontuario"]').text()).toBe('Prontuário 000123');
    w.unmount();
  });

  it('nome social vem antes do civil', () => {
    const w = montar(SanteCabecalhoPaciente, {
      props: {
        paciente: { ...base, identificacao: { ...base.identificacao, nomeSocial: 'Nome Social Fictício' } },
      },
    });
    expect(w.find('h2').text()).toBe('Nome Social Fictício');
    expect(w.text()).toContain('Nome civil: Paciente Fictício Um');
    w.unmount();
  });

  it('"Alergias não avaliadas" é alerta, nunca exibido como "sem alergia"', () => {
    const w = montar(SanteCabecalhoPaciente, { props: { paciente: base } });
    const a = w.find('[data-testid="alergias-nao-avaliadas"]');
    expect(a.attributes('data-variante')).toBe('alerta');
    expect(a.text()).toBe('Alergias não avaliadas');
    expect(w.text()).not.toContain('Nega alergias');
    w.unmount();
  });

  it('lista de alergias em destaque e "Nega alergias" registrado', () => {
    const l = montar(SanteCabecalhoPaciente, {
      props: { paciente: { ...base, alergias: { situacao: 'lista', itens: ['dipirona', 'látex'] } } },
    });
    expect(l.find('[data-testid="alergias-lista"]').text()).toBe('ALERGIA: dipirona, látex');
    l.unmount();
    const n = montar(SanteCabecalhoPaciente, {
      props: { paciente: { ...base, alergias: { situacao: 'nega' } } },
    });
    expect(n.find('[data-testid="nega-alergias"]').text()).toBe('Nega alergias');
    n.unmount();
  });

  it('aviso de homônimo, alertas e medidas', () => {
    const w = montar(SanteCabecalhoPaciente, {
      props: {
        paciente: {
          ...base,
          homonimoNaUnidade: true,
          alertas: [{ id: 'iso', texto: 'Isolamento de contato' }],
          medidas: {
            peso: { valor: '70 kg', data: '2026-10-18' },
            altura: { valor: '1,70 m', data: '2026-10-18' },
          },
        },
      },
    });
    expect(w.find('[data-testid="homonimo"]').text()).toContain('Homônimo na unidade');
    expect(w.text()).toContain('Isolamento de contato');
    expect(w.text()).toContain('Peso 70 kg (18/10/2026)');
    w.unmount();
  });

  it('o CPF ou outro campo mascarado pelo servidor é exibido como veio (nunca desmascara)', () => {
    const w = montar(SanteCabecalhoPaciente, {
      props: { paciente: { ...base, identificacao: { ...base.identificacao, prontuario: '***123' } } },
    });
    expect(w.find('[data-testid="prontuario"]').text()).toBe('Prontuário ***123');
    w.unmount();
  });
});

describe('SanteCabecalhoPaciente: campos completos do contrato e nascimento inválido', () => {
  it('mostra dias de internação, alta provável e médico responsável', () => {
    const p: ContextoPaciente = {
      ...base,
      localizacao: { ...base.localizacao, diasInternacao: 3, altaProvavel: '2026-10-25' },
      atendimento: { ...base.atendimento, medicoResponsavel: 'Médico Fictício' },
    };
    const w = montar(SanteCabecalhoPaciente, { props: { paciente: p } });
    expect(w.find('[data-testid="localizacao"]').text()).toContain('D3 de internação');
    expect(w.find('[data-testid="localizacao"]').text()).toContain('Alta provável 25/10/2026');
    expect(w.find('[data-testid="atendimento"]').text()).toContain('Médico responsável: Médico Fictício');
    expect(w.find('[data-testid="nascimento-invalido"]').exists()).toBe(false);
    w.unmount();
  });

  it('nascimento fora da faixa aparece com alerta, sem ser corrigido', () => {
    const p: ContextoPaciente = {
      ...base,
      identificacao: { ...base.identificacao, nascimento: '5202-03-01' },
    };
    const w = montar(SanteCabecalhoPaciente, { props: { paciente: p } });
    expect(w.find('[data-testid="nascimento-invalido"]').text()).toContain('01/03/5202');
    w.unmount();
  });
});
