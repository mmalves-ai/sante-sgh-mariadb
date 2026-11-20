import { describe, expect, it } from 'vitest';
import {
  esquemaMatrizPentest,
  esquemaRegistroConferencia,
  ondaDaOperacao,
  RE_TEXTO_SEM_DADO_PESSOAL,
} from './homologacao.js';
import { esquemaConferencia } from '../assinatura/catalogo.js';

const registro = {
  formato: 1,
  operacao: 'agenda.agendarConsulta',
  estabelecimento: 'pc',
  data: '2026-11-03',
  conferentes: [{ papel: 'chave-usuario', area: 'agendamento' }],
  versao_roteiro: '2026-10-23.1',
  impressao_schema: 'a1b2c3d4e5f60718',
  cenarios: [{ cenario: 'basico', resultado: 'conforme' }],
  resultado: 'conferida',
  revisao: { pr: '#12', data: '2026-11-03' },
};

describe('registro de conferência (M36, regra 4)', () => {
  it('aceita o registro mínimo', () => {
    expect(esquemaRegistroConferencia.parse(registro).operacao).toBe('agenda.agendarConsulta');
  });
  it('recusa nome de pessoa no lugar do papel e observação com número de documento ou e-mail', () => {
    expect(() =>
      esquemaRegistroConferencia.parse({ ...registro, conferentes: [{ papel: 'Maria', area: 'x' }] }),
    ).toThrow();
    expect(() =>
      esquemaRegistroConferencia.parse({ ...registro, observacoes: 'paciente 12345678901 conferido' }),
    ).toThrow();
    expect(() => esquemaRegistroConferencia.parse({ ...registro, observacoes: 'avisar a@b.com' })).toThrow();
    expect(RE_TEXTO_SEM_DADO_PESSOAL.test('tela do outro sistema mostrou o horário ocupado')).toBe(true);
  });
  it('recusa campo desconhecido (ex.: nome do paciente)', () => {
    expect(() => esquemaRegistroConferencia.parse({ ...registro, paciente: 'X' })).toThrow();
  });
  it('a conferência do catálogo aceita o caminho do registro', () => {
    expect(
      esquemaConferencia.parse({
        estabelecimento: 'pc',
        data: '2026-11-03',
        papel: 'chave-usuario',
        evidencia: 'docs/operacoes/conferencias/pc/agenda.agendarConsulta.yaml',
      }).evidencia,
    ).toContain('conferencias');
    expect(() =>
      esquemaConferencia.parse({
        estabelecimento: 'pc',
        data: '2026-11-03',
        papel: 'chave-usuario',
        evidencia: 'docs/operacoes/conferencias/pc/../x.yaml',
      }),
    ).toThrow();
  });
});

describe('ondas das rodadas (cap-15 §15.3.3)', () => {
  it('eventos de acesso na onda 0, agenda na 1, PEP na 2, suprimentos na 3, faturamento na 4', () => {
    expect(ondaDaOperacao('acesso.trocarSenha')).toBe(0);
    expect(ondaDaOperacao('auditoria.registrarEventoLegado')).toBe(0);
    expect(ondaDaOperacao('agenda.agendarConsulta')).toBe(1);
    // a ficha (campo 5) põe o agendamento e o cancelamento de exame na onda 1, embora o SADT (onda 2) os use
    expect(ondaDaOperacao('agenda.agendarExame')).toBe(1);
    expect(ondaDaOperacao('agenda.cancelarExame')).toBe(1);
    expect(ondaDaOperacao('pep.prescrever')).toBe(2);
    expect(ondaDaOperacao('suprimentos.registrarSaida')).toBe(3);
    expect(ondaDaOperacao('faturamento.fecharConta')).toBe(4);
  });
});

describe('matriz de achados do pentest (regra 8)', () => {
  const base = {
    formato: 1,
    situacao: 'concluido',
    versao_candidata: 'v1.0.0-rc1',
    ambiente: 'homologação',
    lista: 'OWASP ASVS 4.0.3 nível 2',
    data_relatorio: '2026-11-10',
    data_reteste: null,
    achados: [],
  };
  it('retestado exige o reteste; exceção exige a decisão; corrigido exige o commit', () => {
    const achado = {
      id: 'PT-001',
      titulo: 'Cabeçalho ausente',
      asvs: 'V14.4.1',
      componente: 'web',
      severidade: 'media',
    };
    expect(() =>
      esquemaMatrizPentest.parse({
        ...base,
        achados: [{ ...achado, situacao: 'retestado', correcao: 'abc1234' }],
      }),
    ).toThrow(/reteste/);
    expect(() =>
      esquemaMatrizPentest.parse({ ...base, achados: [{ ...achado, situacao: 'excecao-aprovada' }] }),
    ).toThrow(/exceção/);
    expect(() =>
      esquemaMatrizPentest.parse({ ...base, achados: [{ ...achado, situacao: 'corrigido' }] }),
    ).toThrow(/commit/);
    expect(() => esquemaMatrizPentest.parse({ ...base, data_relatorio: null })).toThrow(/relatório/);
  });
});
