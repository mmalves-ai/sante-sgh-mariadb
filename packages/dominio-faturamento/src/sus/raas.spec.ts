// RAAS (06-SUS linha 64): regras puras do registro de ações ambulatoriais da atenção psicossocial e domiciliar. Massa
// sintética.
import { describe, expect, it } from 'vitest';
import { conferirEstrutura } from './leiaute.js';
import {
  type AcaoRaas,
  chaveCriticaRaas,
  conferirAcaoRaas,
  conferirCabecalhoRaas,
  continuacaoRaas,
  criticarRegistroRaas,
  gerarArquivoRaas,
  LEIAUTE_RAAS,
  recusaGerarRemessaRaas,
  type RegistroRaasParaCritica,
  tiposRaasDoProcedimento,
} from './raas.js';

const CNS = '700000000000005';
const acao = (x: Partial<AcaoRaas> = {}): AcaoRaas => ({
  sequencia: 1,
  procedimento: '0301080208',
  registros: ['raas-psicossocial'],
  cbo: '225133',
  cnsProfissional: '800000000000001',
  dataInicio: '2026-01-10',
  dataFim: null,
  quantidade: 1,
  local: 'unidade',
  cid: null,
  ...x,
});
const registro = (x: Partial<RegistroRaasParaCritica> = {}): RegistroRaasParaCritica => ({
  id: 7,
  tipo: 'atencao_psicossocial',
  competencia: '202601',
  dataAdmissao: '2025-12-15',
  dataConclusao: null,
  destino: null,
  estrategiaSaudeFamilia: false,
  cnesSaudeFamilia: null,
  cidPrincipal: 'F20.0',
  cnsPaciente: CNS,
  cpfPaciente: null,
  acoes: [acao()],
  ...x,
});

describe('RAAS: tipo pelo instrumento de registro', () => {
  it('08 é psicossocial, 09 domiciliar, os dois quando o procedimento admite os dois', () => {
    expect(tiposRaasDoProcedimento(['raas-psicossocial'])).toEqual(['atencao_psicossocial']);
    expect(tiposRaasDoProcedimento(['raas-domiciliar', 'bpa-i'])).toEqual(['atencao_domiciliar']);
    expect(tiposRaasDoProcedimento(['raas-psicossocial', 'raas-domiciliar'])).toHaveLength(2);
    expect(tiposRaasDoProcedimento(['bpa-c'])).toEqual([]);
  });
});

describe('RAAS: cabeçalho', () => {
  const base = registro();
  it('aceita admissão em competência anterior (acompanhamento contínuo)', () => {
    expect(conferirCabecalhoRaas(base)).toEqual([]);
  });
  it('recusa admissão depois da competência, conclusão fora dela ou sem destino', () => {
    expect(conferirCabecalhoRaas({ ...base, dataAdmissao: '2026-02-01' }).map((p) => p.campo)).toEqual([
      'dataAdmissao',
    ]);
    expect(
      conferirCabecalhoRaas({ ...base, dataConclusao: '2026-02-03', destino: 1 }).map((p) => p.campo),
    ).toEqual(['dataConclusao']);
    expect(
      conferirCabecalhoRaas({ ...base, dataConclusao: '2025-12-01', destino: 1 }).map((p) => p.mensagem),
    ).toEqual(['A conclusão não pode ser anterior à admissão.']);
    expect(conferirCabecalhoRaas({ ...base, dataConclusao: '2026-01-20' }).map((p) => p.campo)).toEqual([
      'destino',
    ]);
  });
  it('saúde da família exige o CNES de 7 dígitos, e o CNES sem a cobertura é recusado', () => {
    expect(conferirCabecalhoRaas({ ...base, estrategiaSaudeFamilia: true }).map((p) => p.campo)).toEqual([
      'cnesSaudeFamilia',
    ]);
    expect(
      conferirCabecalhoRaas({ ...base, estrategiaSaudeFamilia: true, cnesSaudeFamilia: '1234567' }),
    ).toEqual([]);
    expect(conferirCabecalhoRaas({ ...base, cnesSaudeFamilia: '1234567' })).toHaveLength(1);
  });
});

describe('RAAS: ação', () => {
  const conferir = (
    x: Partial<AcaoRaas>,
    tipo: 'atencao_psicossocial' | 'atencao_domiciliar' = 'atencao_psicossocial',
  ) => conferirAcaoRaas(tipo, '202601', '2026-01-05', acao(x)).map((p) => p.campo);
  it('aceita a ação válida', () => {
    expect(conferir({})).toEqual([]);
  });
  it('recusa procedimento de outro instrumento, quantidade, CBO e datas', () => {
    expect(conferir({}, 'atencao_domiciliar')).toEqual(['procedimento']);
    expect(conferir({ quantidade: 0 })).toEqual(['quantidade']);
    expect(conferir({ quantidade: 1.5 })).toEqual(['quantidade']);
    expect(conferir({ cbo: null })).toEqual(['cbo']);
    expect(conferir({ dataInicio: '2026-02-01' })).toEqual(['dataInicio']);
    expect(conferir({ dataInicio: '2026-01-02' })).toEqual(['dataInicio']);
    expect(conferir({ dataFim: '2026-01-09' })).toEqual(['dataFim']);
    expect(conferir({ dataFim: '2026-02-02' })).toEqual(['dataFim']);
  });
});

describe('RAAS: crítica da competência', () => {
  it('registro completo não tem crítica', () => {
    expect(criticarRegistroRaas(registro())).toEqual([]);
  });
  it('bloqueia CID, identificação, ausência de ação e profissional sem CNS', () => {
    const c = criticarRegistroRaas(registro({ cidPrincipal: null, cnsPaciente: '123', acoes: [] }));
    expect(c.map((x) => [x.regra, x.gravidade])).toEqual([
      ['raas.cid-principal', 'bloqueante'],
      ['raas.identificacao-paciente', 'bloqueante'],
      ['raas.sem-acao', 'bloqueante'],
    ]);
    expect(criticarRegistroRaas(registro({ cnsPaciente: null, cpfPaciente: '12345678901' }))).toEqual([]);
    const semCns = criticarRegistroRaas(registro({ acoes: [acao({ cnsProfissional: null })] }));
    expect(semCns.map((x) => [x.regra, x.sequencia])).toEqual([['raas.cns-profissional', 1]]);
  });
  it('ação inválida e cabeçalho inválido viram bloqueantes com o campo', () => {
    const c = criticarRegistroRaas(
      registro({ dataConclusao: '2026-01-20', acoes: [acao({ dataInicio: '2026-03-01' })] }),
    );
    expect(c.map((x) => [x.regra, x.campo])).toEqual([
      ['raas.cabecalho', 'destino'],
      ['raas.acao', 'dataInicio'],
    ]);
  });
  it('avisa a ação repetida e a domiciliar fora do domicílio', () => {
    const c = criticarRegistroRaas(
      registro({
        tipo: 'atencao_domiciliar',
        acoes: [
          acao({ registros: ['raas-domiciliar'], local: 'domicilio' }),
          acao({ sequencia: 2, registros: ['raas-domiciliar'], local: 'unidade' }),
        ],
      }),
    );
    expect(c.map((x) => [x.regra, x.gravidade, x.sequencia])).toEqual([
      ['raas.acao-repetida', 'aviso', 2],
      ['raas.domiciliar-fora-do-domicilio', 'aviso', 2],
    ]);
    expect(new Set(c.map(chaveCriticaRaas)).size).toBe(2);
  });
});

describe('RAAS: continuação e remessa', () => {
  it('o acompanhamento aberto continua na competência seguinte; concluído ou cancelado não', () => {
    expect(continuacaoRaas({ competencia: '202612', dataConclusao: null, situacao: 'exportado' })).toEqual({
      competencia: '202701',
    });
    expect(
      continuacaoRaas({ competencia: '202601', dataConclusao: '2026-01-20', situacao: 'aberto' }),
    ).toHaveProperty('campo', 'dataConclusao');
    expect(
      continuacaoRaas({ competencia: '202601', dataConclusao: null, situacao: 'cancelado' }),
    ).toHaveProperty('campo', 'situacao');
  });
  it('a remessa exige registro e nenhuma bloqueante aberta', () => {
    expect(recusaGerarRemessaRaas(0, 0)?.campo).toBe('registros');
    expect(recusaGerarRemessaRaas(3, 2)?.campo).toBe('criticas');
    expect(recusaGerarRemessaRaas(3, 0)).toBeNull();
  });
  it('o arquivo sai com cabeçalho, registro e ações, sem erro de estrutura e com o controle', () => {
    const r = gerarArquivoRaas(
      {
        competencia: '202601',
        tipo: 'atencao_psicossocial',
        cnes: '1234567',
        cnpj: null,
        orgaoOrigem: 'Hospital sintético',
        orgaoDestino: 'Secretaria sintética',
        indicadorDestino: 'M',
      },
      [
        {
          numero: 'RA-1',
          cnsPaciente: CNS,
          cpfPaciente: null,
          nomePaciente: 'Paciente Sintético Ação',
          nascimento: '1990-05-02',
          nomeMae: null,
          dataAdmissao: '2025-12-15',
          dataConclusao: null,
          destino: null,
          origem: null,
          cids: ['F20.0'],
          cidAssociado: null,
          estrategiaSaudeFamilia: false,
          cnesSaudeFamilia: null,
          continuacao: null,
          acoes: [
            { ...acao(), cbo: '225133', cnsProfissional: '800000000000001', quantidade: 2 },
            { ...acao({ sequencia: 2 }), cbo: '225133', cnsProfissional: '800000000000001', quantidade: 3 },
          ],
        },
      ],
    );
    expect(r.linhas).toBe(4);
    expect(r.procedimentos).toBe(5);
    expect(conferirEstrutura(LEIAUTE_RAAS, r.conteudo)).toEqual([]);
    expect(r.controle).toBe(Number(((2n * 301080208n + 5n) % 1111n) + 1111n));
    expect(r.conteudo).toContain('PACIENTE SINTETICO ACAO');
    expect(r.conteudo.split('\r\n')[1]?.slice(0, 2)).toBe('02');
  });
});
