import { describe, expect, it } from 'vitest';
import {
  categoriaTnm,
  comportamentoDoCid,
  conferirAprovacaoPlano,
  conferirEncerramentoPlano,
  conferirEstadiamento,
  conferirPlanoRadioterapia,
  conferirSessaoRadioterapia,
  conferirTumor,
  estadioDecorrente,
  normalizarMorfologia,
  rotuloTnm,
  type EstadiamentoEntrada,
  type PlanoRtAtual,
  type TumorEntrada,
} from './registro-oncologico.js';

const HOJE = '2026-11-25';
const campos = (e: readonly { campo: string }[]) => e.map((x) => x.campo);
const tumor = (x: Partial<TumorEntrada> = {}): TumorEntrada => ({
  cid: 'C50.4',
  morfologia: 'M8500/3',
  diagnosticadoEm: '2026-10-01',
  baseDiagnostica: 'histologia_primario',
  lateralidade: 'esquerda',
  ecog: 1,
  ...x,
});
const est = (x: Partial<EstadiamentoEntrada> = {}): EstadiamentoEntrada => ({
  tipo: 'clinico',
  data: '2026-10-05',
  t: 'cT2',
  n: 'N1',
  m: 'M0',
  estadio: 'IIB',
  metastases: [],
  ...x,
});
const DIAG = { diagnosticadoEm: '2026-10-01', base: 'histologia_primario' as const };

describe('registro do tumor (CID-10 × CID-O-3)', () => {
  it('normaliza a morfologia e o comportamento pelo CID', () => {
    expect(normalizarMorfologia('8140/3')).toBe('M8140/3');
    expect(normalizarMorfologia('m81403')).toBe('M8140/3');
    expect(normalizarMorfologia('8140/5')).toBeNull();
    expect(comportamentoDoCid('C50.4')).toEqual(['3', '9']);
    expect(comportamentoDoCid('D05.1')).toEqual(['2']);
    expect(comportamentoDoCid('C79.5')).toEqual(['3', '6', '9']);
    expect(comportamentoDoCid('I10')).toBeNull();
  });
  it('aceita o tumor coerente', () => expect(conferirTumor(tumor(), HOJE)).toEqual([]));
  it('recusa CID fora das neoplasias, data futura e ECOG fora da escala', () => {
    expect(
      campos(conferirTumor(tumor({ cid: 'I10', morfologia: null, lateralidade: 'nao_se_aplica' }), HOJE)),
    ).toEqual(['cid']);
    expect(campos(conferirTumor(tumor({ diagnosticadoEm: '2026-12-01' }), HOJE))).toEqual([
      'diagnosticadoEm',
    ]);
    expect(campos(conferirTumor(tumor({ ecog: 6 }), HOJE))).toEqual(['ecog']);
  });
  it('recusa comportamento incompatível com o CID (in situ com morfologia maligna)', () => {
    expect(campos(conferirTumor(tumor({ cid: 'D05.1' }), HOJE))).toEqual(['morfologia']);
    expect(conferirTumor(tumor({ cid: 'D05.1', morfologia: '8500/2' }), HOJE)).toEqual([]);
  });
  it('morfologia específica exige base histológica; sem ela só M8000/3', () => {
    expect(campos(conferirTumor(tumor({ baseDiagnostica: 'exame_imagem' }), HOJE))).toEqual([
      'baseDiagnostica',
    ]);
    expect(conferirTumor(tumor({ baseDiagnostica: 'exame_imagem', morfologia: '8000/3' }), HOJE)).toEqual([]);
  });
  it('lateralidade só em órgão par', () => {
    expect(
      campos(conferirTumor(tumor({ cid: 'C16.0', morfologia: '8140/3', lateralidade: 'direita' }), HOJE)),
    ).toEqual(['lateralidade']);
  });
});

describe('estadiamento TNM (UICC 8ª edição)', () => {
  it('padroniza as categorias e tira o prefixo', () => {
    expect(categoriaTnm('T', 'pT2a')).toBe('T2a');
    expect(categoriaTnm('T', 'tis')).toBe('Tis');
    expect(categoriaTnm('N', 'ypN1mi')).toBe('N1mi');
    expect(categoriaTnm('M', 'cM1b')).toBe('M1b');
    expect(categoriaTnm('M', 'MX')).toBeNull();
    expect(categoriaTnm('T', 'T5')).toBeNull();
    expect(rotuloTnm('patologico', 'T2', 'N1', 'M0')).toBe('pT2N1M0');
  });
  it('estádio que decorre só do TNM', () => {
    expect(estadioDecorrente('T1', 'N0', 'M1a')).toBe('IV');
    expect(estadioDecorrente('Tis', 'N0', 'M0')).toBe('0');
    expect(estadioDecorrente('T2', 'N1', 'M0')).toBeNull();
  });
  it('aceita o estadiamento coerente', () => expect(conferirEstadiamento(est(), DIAG, HOJE)).toEqual([]));
  it('M1 exige sítio e estádio IV; M0 não tem sítio', () => {
    expect(campos(conferirEstadiamento(est({ m: 'M1', estadio: 'IIIA' }), DIAG, HOJE))).toEqual([
      'metastases',
      'estadio',
    ]);
    expect(conferirEstadiamento(est({ m: 'M1b', estadio: 'IV', metastases: ['C34.1'] }), DIAG, HOJE)).toEqual(
      [],
    );
    expect(campos(conferirEstadiamento(est({ metastases: ['C22.0'] }), DIAG, HOJE))).toEqual(['metastases']);
  });
  it('estádio 0 só in situ, e in situ sem N/M é estádio 0', () => {
    expect(campos(conferirEstadiamento(est({ estadio: '0' }), DIAG, HOJE))).toEqual(['estadio']);
    expect(campos(conferirEstadiamento(est({ t: 'Tis', n: 'N0', estadio: 'I' }), DIAG, HOJE))).toEqual([
      'estadio',
    ]);
  });
  it('data entre o diagnóstico e hoje; patológico só com histologia; categorias inválidas', () => {
    expect(campos(conferirEstadiamento(est({ data: '2026-09-01' }), DIAG, HOJE))).toEqual(['data']);
    expect(campos(conferirEstadiamento(est({ data: '2026-12-01' }), DIAG, HOJE))).toEqual(['data']);
    expect(
      campos(conferirEstadiamento(est({ tipo: 'patologico' }), { ...DIAG, base: 'exame_imagem' }, HOJE)),
    ).toEqual(['tipo']);
    expect(
      campos(conferirEstadiamento(est({ t: 'T9', n: 'N7', m: 'MX', estadio: null }), DIAG, HOJE)),
    ).toEqual(['t', 'n', 'm']);
  });
});

describe('radioterapia: plano e sessões', () => {
  const plano = {
    tecnica: 'imrt' as const,
    doseTotalCgy: 5000,
    doseFracaoCgy: 200,
    fracoesPrevistas: 25,
    fracoesPorSemana: 5,
    inicioPrevisto: '2026-11-30',
  };
  it('aceita o plano coerente e recusa a conta da dose', () => {
    expect(conferirPlanoRadioterapia(plano, HOJE)).toEqual([]);
    expect(campos(conferirPlanoRadioterapia({ ...plano, fracoesPrevistas: 20 }, HOJE))).toEqual([
      'doseTotalCgy',
    ]);
  });
  it('hipofracionamento extremo só em radiocirurgia, SBRT ou braquiterapia', () => {
    const sbrt = { ...plano, doseTotalCgy: 5400, doseFracaoCgy: 1800, fracoesPrevistas: 3 };
    expect(campos(conferirPlanoRadioterapia(sbrt, HOJE))).toEqual(['doseFracaoCgy']);
    expect(conferirPlanoRadioterapia({ ...sbrt, tecnica: 'sbrt' }, HOJE)).toEqual([]);
  });
  it('frações por semana e início previsto', () => {
    expect(
      campos(
        conferirPlanoRadioterapia({ ...plano, fracoesPorSemana: 15, inicioPrevisto: '2026-11-01' }, HOJE),
      ),
    ).toEqual(['fracoesPorSemana', 'inicioPrevisto']);
  });
  it('aprovação exige físico e plano em planejamento; encerramento exige motivo', () => {
    expect(conferirAprovacaoPlano('em_planejamento', true)).toEqual([]);
    expect(campos(conferirAprovacaoPlano('em_planejamento', false))).toEqual(['fisico']);
    expect(campos(conferirAprovacaoPlano('aprovado', true))).toEqual(['situacao']);
    expect(campos(conferirEncerramentoPlano('em_andamento', ' '))).toEqual(['motivo']);
    expect(campos(conferirEncerramentoPlano('concluido', 'x'))).toEqual(['situacao']);
  });
  const atual = (x: Partial<PlanoRtAtual> = {}): PlanoRtAtual => ({
    situacao: 'aprovado',
    doseTotalCgy: 600,
    doseFracaoCgy: 200,
    fracoesPrevistas: 3,
    realizadas: 0,
    doseAcumuladaCgy: 0,
    ...x,
  });
  it('a 1ª sessão põe em andamento e a última conclui', () => {
    const r = conferirSessaoRadioterapia(atual(), {
      desfecho: 'realizada',
      doseAplicadaCgy: 200,
      motivo: null,
    });
    expect(r).toEqual({ erros: [], situacaoPlano: 'em_andamento', doseAcumuladaCgy: 200 });
    const f = conferirSessaoRadioterapia(
      atual({ situacao: 'em_andamento', realizadas: 2, doseAcumuladaCgy: 400 }),
      {
        desfecho: 'realizada',
        doseAplicadaCgy: 200,
        motivo: null,
      },
    );
    expect(f.situacaoPlano).toBe('concluido');
  });
  it('recusa dose acima da fração, além da total e sessão de plano em planejamento', () => {
    expect(
      campos(
        conferirSessaoRadioterapia(atual(), { desfecho: 'realizada', doseAplicadaCgy: 250, motivo: null })
          .erros,
      ),
    ).toEqual(['doseAplicadaCgy']);
    expect(
      campos(
        conferirSessaoRadioterapia(
          atual({ situacao: 'em_andamento', realizadas: 2, doseAcumuladaCgy: 600 }),
          {
            desfecho: 'realizada',
            doseAplicadaCgy: 200,
            motivo: null,
          },
        ).erros,
      ),
    ).toEqual(['doseAplicadaCgy']);
    expect(
      campos(
        conferirSessaoRadioterapia(atual({ situacao: 'em_planejamento' }), {
          desfecho: 'falta',
          doseAplicadaCgy: null,
          motivo: 'x',
        }).erros,
      ),
    ).toEqual(['plano']);
  });
  it('falta exige motivo e não tem dose; não muda a situação', () => {
    const r = conferirSessaoRadioterapia(atual({ situacao: 'em_andamento' }), {
      desfecho: 'falta',
      doseAplicadaCgy: 100,
      motivo: '',
    });
    expect(campos(r.erros)).toEqual(['motivo', 'doseAplicadaCgy']);
    expect(r.situacaoPlano).toBe('em_andamento');
  });
});
