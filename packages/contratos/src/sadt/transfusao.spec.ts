// Contratos da agência transfusional, etapa 1 (M47): vocabulário com os códigos do perfil e as entradas das operações.
import { describe, expect, it } from 'vitest';
import {
  classeDoHemocomponente,
  esquemaConcluirTransfusao,
  esquemaIniciarTransfusao,
  esquemaNumeroBolsa,
  esquemaRegistrarAmostraTransfusional,
  esquemaRegistrarReacaoTransfusional,
  esquemaRequisitarTransfusao,
  fatorRhPorId,
  grupoAboDoTexto,
  grupoAboPorId,
  ID_FATOR_RH,
  ID_GRUPO_ABO,
  rotuloTipagem,
  rotuloTipoReacao,
  rotuloUrgencia,
  TIPOS_REACAO_TRANSFUSIONAL,
  URGENCIAS_TRANSFUSAO,
  urgenciaPorId,
} from './transfusao.js';

const SINAIS = { pas: 120, pad: 80, fc: 80, temperatura: 36.5 };

describe('vocabulário', () => {
  it('hemocomponentes vistos no perfil e o resto como outro', () => {
    expect(classeDoHemocomponente('CH')).toBe('hemacias');
    expect(classeDoHemocomponente(' cp ')).toBe('plaquetas');
    expect(classeDoHemocomponente('PLC')).toBe('plasma');
    expect(classeDoHemocomponente('CR')).toBe('crioprecipitado');
    expect(classeDoHemocomponente('XYZ')).toBe('outro');
  });

  it('tipos de transfusão com os mesmos códigos 1 a 4 do cadastro', () => {
    expect(URGENCIAS_TRANSFUSAO.map((u) => u.id)).toEqual([1, 2, 3, 4]);
    expect(urgenciaPorId(3)).toBe('urgente');
    expect(urgenciaPorId(9)).toBeNull();
    expect(rotuloUrgencia('extremaUrgencia')).toMatch(/Extrema urgência/);
  });

  it('tipo sanguíneo e fator Rh pelos IDs do cadastro e pelo texto do paciente', () => {
    expect(ID_GRUPO_ABO).toEqual({ A: 1, B: 2, AB: 3, O: 4 });
    expect(ID_FATOR_RH).toEqual({ positivo: 1, negativo: 2 });
    expect(grupoAboPorId(3)).toBe('AB');
    expect(grupoAboPorId(null)).toBeNull();
    expect(fatorRhPorId(2)).toBe('negativo');
    expect(fatorRhPorId(7)).toBeNull();
    expect(grupoAboDoTexto(' ab ')).toBe('AB');
    expect(grupoAboDoTexto('')).toBeNull();
    expect(grupoAboDoTexto(null)).toBeNull();
    expect(rotuloTipagem({ abo: 'O', rh: 'negativo' })).toBe('O Rh negativo');
    expect(rotuloTipagem({ abo: 'A', rh: 'positivo' })).toBe('A Rh positivo');
    expect(rotuloTipagem({ abo: null, rh: 'positivo' })).toBe('Tipagem não informada');
  });

  it('reações com tempo imediata ou tardia e rótulo de produto', () => {
    expect(new Set(TIPOS_REACAO_TRANSFUSIONAL.map((t) => t.codigo)).size).toBe(
      TIPOS_REACAO_TRANSFUSIONAL.length,
    );
    expect(rotuloTipoReacao('trali')).toMatch(/TRALI/);
    for (const t of TIPOS_REACAO_TRANSFUSIONAL) expect(t.rotulo).not.toMatch(/SPDATA|legado/i);
  });
});

describe('entradas', () => {
  const req = {
    itemHemoterapia: 10,
    atendimento: 20,
    quantidadeBolsas: 2,
    volumeMl: null,
    urgencia: 'rotina' as const,
    programadaPara: null,
    indicacao: 'Anemia sintomática, hemoglobina 6,8',
    examesDeApoio: null,
    termo: 5,
    justificativaUrgencia: null,
    transfusaoAnterior: 'nao' as const,
    reacaoAnterior: 'naoSabe' as const,
    gestacaoAnterior: 'naoSeAplica' as const,
  };

  it('requisição: termo, programada com data e extrema urgência com justificativa', () => {
    expect(esquemaRequisitarTransfusao.safeParse(req).success).toBe(true);
    expect(esquemaRequisitarTransfusao.safeParse({ ...req, termo: null }).success).toBe(false);
    expect(esquemaRequisitarTransfusao.safeParse({ ...req, urgencia: 'programada' }).success).toBe(false);
    expect(
      esquemaRequisitarTransfusao.safeParse({
        ...req,
        urgencia: 'programada',
        programadaPara: '2026-10-25T08:00',
      }).success,
    ).toBe(true);
    expect(
      esquemaRequisitarTransfusao.safeParse({ ...req, urgencia: 'extremaUrgencia', termo: null }).success,
    ).toBe(false);
    expect(
      esquemaRequisitarTransfusao.safeParse({
        ...req,
        urgencia: 'extremaUrgencia',
        termo: null,
        justificativaUrgencia: 'Choque hemorrágico em curso',
      }).success,
    ).toBe(true);
    expect(esquemaRequisitarTransfusao.safeParse({ ...req, indicacao: 'curta' }).success).toBe(false);
  });

  it('amostra exige identificadores e rótulo no leito', () => {
    const a = {
      requisicao: 1,
      pulseira: { lida: true, codigo: 'P1|A2' },
      identificadoresConferidos: true,
      rotuladaNoLeito: true,
      coletadaEm: '2026-10-24T10:00',
    };
    expect(esquemaRegistrarAmostraTransfusional.safeParse(a).success).toBe(true);
    expect(esquemaRegistrarAmostraTransfusional.safeParse({ ...a, rotuladaNoLeito: false }).success).toBe(
      false,
    );
    expect(
      esquemaRegistrarAmostraTransfusional.safeParse({
        ...a,
        pulseira: { lida: false, motivo: 'motivo-que-nao-existe' },
      }).success,
    ).toBe(false);
  });

  it('início: bolsa conferida, segundo profissional e sinais de antes', () => {
    const i = {
      requisicao: 1,
      horario: null,
      pulseira: { lida: true, codigo: 'P1|A2' },
      bolsa: {
        numero: 'b1234-56',
        hemocomponente: 'ch',
        tipagem: { abo: 'O', rh: 'negativo' },
        validade: '2026-11-01T00:00',
        volumeMl: 300,
        etiquetaDoReceptorConfere: true,
        inspecaoVisualOk: true,
      },
      segundoProfissional: { login: 'ENF2', senha: 'x' },
      sinaisAntes: SINAIS,
      justificativaRh: null,
    };
    const r = esquemaIniciarTransfusao.parse(i);
    expect(r.bolsa.numero).toBe('B1234-56');
    expect(r.bolsa.hemocomponente).toBe('CH');
    expect(
      esquemaIniciarTransfusao.safeParse({ ...i, bolsa: { ...i.bolsa, inspecaoVisualOk: false } }).success,
    ).toBe(false);
    expect(esquemaIniciarTransfusao.safeParse({ ...i, sinaisAntes: { ...SINAIS, fc: 5 } }).success).toBe(
      false,
    );
    expect(esquemaNumeroBolsa.safeParse('ab').success).toBe(false);
  });

  it('conclusão interrompida exige o motivo', () => {
    const c = {
      ato: 1,
      terminoEm: '2026-10-24T12:00',
      volumeTransfundidoMl: 100,
      interrompida: true,
      motivoInterrupcao: null,
    };
    expect(esquemaConcluirTransfusao.safeParse(c).success).toBe(false);
    expect(esquemaConcluirTransfusao.safeParse({ ...c, motivoInterrupcao: 'Reação febril' }).success).toBe(
      true,
    );
  });

  it('reação: conduta marcada e as descrições de outra', () => {
    const r = {
      ato: 1,
      tipo: 'febrilNaoHemolitica' as const,
      descricaoOutra: null,
      grau: 1 as const,
      correlacao: 'provavel' as const,
      inicioEm: '2026-10-24T11:20',
      sinaisESintomas: 'Febre de 38,6 com calafrios',
      condutas: ['interromperTransfusao' as const],
      condutaOutra: null,
      destinoBolsa: 'devolvida' as const,
      sinaisNaReacao: null,
    };
    expect(esquemaRegistrarReacaoTransfusional.safeParse(r).success).toBe(true);
    expect(esquemaRegistrarReacaoTransfusional.safeParse({ ...r, condutas: [] }).success).toBe(false);
    expect(esquemaRegistrarReacaoTransfusional.safeParse({ ...r, tipo: 'outra' }).success).toBe(false);
    expect(esquemaRegistrarReacaoTransfusional.safeParse({ ...r, condutas: ['outra'] }).success).toBe(false);
  });
});
