// A fila do médico (M27) sobre portas falsas: o recorte "meus" pelos CBOs do profissional (regra 2), as pendências
// (crítico não visto e resultado novo até a visualização ou a ciência; sem evolução em 24 h; prescrição a vencer;
// parecer atrasado e pendente; assinatura) e a ordem por prioridade e prazo (regra 1). Pacientes sintéticos.
import { describe, expect, it } from 'vitest';
import type { PortaDocumentos } from '../documentos-porta.js';
import { ServicoDocumentos } from '../documentos-servico.js';
import type { PortaPrescricao } from '../prescricao-porta.js';
import type { PortaWorklist } from '../worklist-porta.js';
import { ServicoWorklistMedico } from './worklist-medico.js';

const c = {
  cliente: 'teste',
  estabelecimento: null,
  usuario: null,
  correlacao: 'teste',
  rede: 'rede-teste',
  hospital: 'aa',
};
const AGORA = '2026-10-22T12:00:00.000';

const linha = (paciente: number, tipo: 'internacao' | 'externo', entrada: string, leito: string) => ({
  paciente,
  nome: `PACIENTE SINTETICO ${paciente}`,
  nomeSocial: null,
  nascimento: '1960-01-01',
  sexo: 'F',
  prontuario: paciente * 7,
  atendimento: paciente * 10,
  registro: paciente * 100,
  tipo,
  entrada,
  unidade: 'UNIDADE SINTETICA',
  idUnidade: 1,
  leito,
  convenio: null,
  medico: null,
  alergiasAtivas: paciente === 2 ? 1 : 0,
});

function portas(
  o: {
    profissional?: boolean;
    alergiasInformadas?: { paciente: number; em: string }[];
    negas?: { paciente: number; em: string }[];
  } = {},
) {
  const pedidos: unknown[] = [];
  const docs = {
    destino: 'memoria',
    agora: async () => AGORA,
    profissional: async () =>
      o.profissional === false
        ? null
        : {
            idUsuario: 1,
            idProfissional: 1,
            nome: 'MEDICO',
            cbo: 77,
            cbos: [77],
            especialidades: [1],
            permiteRetroativo: true,
            ocupacoes: [{ cbo: 77, codigo: '225125', conselhoAtivo: true }],
          },
    painel: async (_c: unknown, f: unknown) => {
      pedidos.push(f);
      return {
        linhas: [
          linha(1, 'internacao', '2026-10-19T08:00:00.000', '201A'),
          linha(2, 'internacao', '2026-10-21T20:00:00.000', '101A'),
          linha(3, 'externo', '2026-10-22T09:00:00.000', null as unknown as string),
        ],
        limitado: false,
      };
    },
    pendencias: async () => [{ paciente: 3 }, { paciente: 3 }],
    completudePainel: async () => ({
      evolucoesMedicas: [{ atendimento: 20, em: '2026-10-22T07:00:00.000' }],
      alergiasInformadas: o.alergiasInformadas ?? [],
      negas: o.negas ?? [],
      valores: [
        {
          paciente: 1,
          exame: 501,
          elemento: 'POTASSIO',
          numerico: 7.1,
          minAbe: 3.5,
          maxAbe: 5.1,
          liberadoEm: '2026-10-22',
        },
        {
          paciente: 1,
          exame: 502,
          elemento: 'SODIO',
          numerico: 140,
          minAbe: 135,
          maxAbe: 145,
          liberadoEm: '2026-10-22',
        },
        {
          paciente: 2,
          exame: 503,
          elemento: 'POTASSIO',
          numerico: 7.2,
          minAbe: 3.5,
          maxAbe: 5.1,
          liberadoEm: '2026-10-22',
        },
      ],
      ciencias: [{ paciente: 2, exame: 503 }],
      pareceres: [
        { paciente: 2, situacao: 'solicitado', prazo: '2026-10-21T10:00:00.000' },
        { paciente: 2, situacao: 'aceito', prazo: null },
      ],
    }),
  } as unknown as PortaDocumentos;
  const worklist: PortaWorklist = {
    destino: 'memoria',
    leituras: async () => ({
      previsoesAlta: [{ internacao: 100, previsao: '2026-10-25' }],
      resultados: [
        {
          paciente: 1,
          exame: 501,
          liberadoEm: '2026-10-22',
          vistoPeloMedico: false,
        },
        {
          paciente: 1,
          exame: 502,
          liberadoEm: '2026-10-22',
          vistoPeloMedico: false,
        },
        {
          paciente: 1,
          exame: 504,
          liberadoEm: '2026-10-21',
          vistoPeloMedico: true,
        },
        {
          paciente: 2,
          exame: 503,
          liberadoEm: '2026-10-22',
          vistoPeloMedico: false,
        },
      ],
    }),
  };
  const prescricao = {
    vencemAte: async () => [{ prescricao: 9, atendimento: 20, fim: '2026-10-22T14:00:00.000', paciente: 2 }],
  } as unknown as PortaPrescricao;
  return { docs, worklist, prescricao, pedidos };
}

describe('fila do médico', () => {
  it('pede o painel pelos CBOs do médico (vínculo); sem ocupação no cadastro, a fila fica vazia', async () => {
    const p = portas();
    await new ServicoWorklistMedico(new ServicoDocumentos(p.docs), p.prescricao, p.worklist).fila(
      c,
      'SINT.MEDICO',
    );
    expect(p.pedidos[0]).toMatchObject({ meus: { cbos: [77], login: 'SINT.MEDICO', hospital: 'aa' } });
    const sem = portas({ profissional: false });
    const f = await new ServicoWorklistMedico(new ServicoDocumentos(sem.docs), null, sem.worklist).fila(
      c,
      'X',
    );
    expect(f).toMatchObject({ pacientes: [], semVinculo: true });
  });

  it('as pendências de cada paciente e a ordem por prioridade e prazo', async () => {
    const p = portas();
    const f = await new ServicoWorklistMedico(new ServicoDocumentos(p.docs), p.prescricao, p.worklist).fila(
      c,
      'SINT.MEDICO',
    );
    const [primeiro, segundo, terceiro] = f.pacientes;
    // Paciente 1: crítico não visto (potássio 7,1), um resultado novo (o sódio) e sem evolução há mais de 24 h; o exame
    // o já visto pelo médico não conta; previsão de alta da internação.
    expect(primeiro?.paciente).toBe(1);
    expect(primeiro?.pendencias.map((x) => x.tipo)).toEqual([
      'critico-nao-visto',
      'sem-evolucao-24h',
      'resultado-novo',
    ]);
    expect(primeiro?.previsaoAlta).toBe('2026-10-25');
    expect(primeiro?.dias).toBe(3);
    // Paciente 2: o crítico com ciência não conta; prescrição a vencer, parecer atrasado e um em aberto.
    expect(segundo?.paciente).toBe(2);
    expect(segundo?.pendencias.map((x) => x.tipo)).toEqual([
      'prescricao-a-renovar',
      'parecer-atrasado',
      'parecer-pendente',
    ]);
    expect(segundo?.prazo).toBe('2026-10-21T10:00');
    expect(segundo?.alergias).toBe('lista');
    // Paciente 3 (externo): só as assinaturas.
    expect(terceiro?.pendencias).toEqual([
      expect.objectContaining({ tipo: 'assinatura-pendente', quantidade: 2 }),
    ]);
    expect(terceiro?.previsaoAlta).toBeNull();
    expect(f.pacientes.map((x) => x.prioridade)).toEqual([180, 105, 10]);
  });

  it('alergias pela regra do painel: o "nega" registrado sai; a nega anterior à última alergia informada não vale', async () => {
    const p = portas({
      // Paciente 1: nega depois da alergia retirada; paciente 3: nega mais antiga que a alergia retirada.
      alergiasInformadas: [
        { paciente: 1, em: '2026-10-10T08:00:00.000' },
        { paciente: 3, em: '2026-10-20T08:00:00.000' },
      ],
      negas: [
        { paciente: 1, em: '2026-10-12T08:00:00.000' },
        { paciente: 3, em: '2026-10-15T08:00:00.000' },
      ],
    });
    const f = await new ServicoWorklistMedico(new ServicoDocumentos(p.docs), p.prescricao, p.worklist).fila(
      c,
      'SINT.MEDICO',
    );
    const por = new Map(f.pacientes.map((x) => [x.paciente, x.alergias]));
    expect(por.get(1)).toBe('nega');
    expect(por.get(2)).toBe('lista');
    expect(por.get(3)).toBe('nao-avaliadas');
  });

  it('alergias: só a nega, sem alergia informada, também é "nega"; sem nada, "não avaliadas"', async () => {
    const p = portas({ negas: [{ paciente: 3, em: '2026-10-01T08:00:00.000' }] });
    const f = await new ServicoWorklistMedico(new ServicoDocumentos(p.docs), p.prescricao, p.worklist).fila(
      c,
      'SINT.MEDICO',
    );
    const por = new Map(f.pacientes.map((x) => [x.paciente, x.alergias]));
    expect(por.get(3)).toBe('nega');
    expect(por.get(1)).toBe('nao-avaliadas');
  });
});
