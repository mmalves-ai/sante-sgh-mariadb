// M44 (etapa 3), regra 8: protocolos gerenciados — inclusão pelo enfermeiro ou pelo médico, ou sugerida pelo
// discriminador; metas (dor torácica: ECG em até 10 min; sepse: antibiótico na primeira hora); meta perdida exige o
// motivo. Dados SINTÉTICOS.
import { esquemaConteudoGerenciado } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  adesaoDasMetas,
  comSegundos,
  decidirRegistroMeta,
  type EventoDoProtocolo,
  nomeDoTipo,
  origemDaInclusao,
  prazoDaMeta,
  problemaDoEncerramento,
  problemasDaDefinicao,
  PROTOCOLOS_GERENCIADOS_SINTETICOS,
  recusaDoGerenciado,
  relogioDoProtocolo,
  somarMinutos,
  sugestoesDaClassificacao,
} from './protocolo-gerenciado.js';
import { PROTOCOLO_SINTETICO } from './protocolo-sintetico.js';

const dor = PROTOCOLOS_GERENCIADOS_SINTETICOS.find((p) => p.tipo === 'dor-toracica')!;
const sepse = PROTOCOLOS_GERENCIADOS_SINTETICOS.find((p) => p.tipo === 'sepse')!;
const ev = (x: Partial<EventoDoProtocolo>): EventoDoProtocolo => ({
  tipo: 'meta',
  codigo: 'ecg',
  situacao: 'cumprida',
  quando: '2026-10-24T10:08',
  motivo: null,
  por: 'SINT.ENFERMEIRO.PA',
  em: '2026-10-24T10:09:00',
  ...x,
});

describe('protocolos gerenciados: definição', () => {
  it('as definições sintéticas (a de TEV do W0-03 inclusive) valem pelo esquema e não têm problema', () => {
    expect(PROTOCOLOS_GERENCIADOS_SINTETICOS.map((p) => p.tipo)).toEqual([
      'dor-toracica',
      'sepse',
      'avc',
      'trauma',
      'tev',
    ]);
    for (const p of PROTOCOLOS_GERENCIADOS_SINTETICOS) {
      expect(esquemaConteudoGerenciado.parse(p)).toEqual(p);
      expect(problemasDaDefinicao(p, { autor: 'A', aprovador: 'B' })).toEqual([]);
      expect(p.nome).toMatch(/sintético/);
    }
    // As metas da ficha: ECG em 10 min da chegada; antibiótico em 60 min da inclusão.
    expect(dor.metas.find((m) => m.codigo === 'ecg')).toMatchObject({ prazoMin: 10, desde: 'chegada' });
    expect(sepse.metas.find((m) => m.codigo === 'antibiotico')).toMatchObject({
      prazoMin: 60,
      desde: 'inclusao',
    });
    expect(nomeDoTipo('avc')).toBe('AVC');
    expect(nomeDoTipo('outro')).toBe('outro');
  });

  it('códigos repetidos, meta com o código de um item do checklist e autoaprovação são recusados', () => {
    const ruim = {
      ...dor,
      criterios: [dor.criterios[0]!, dor.criterios[0]!],
      checklist: [{ codigo: 'ecg', titulo: 'Repetido com a meta' }],
    };
    const p = problemasDaDefinicao(ruim, { autor: 'sint.a', aprovador: 'SINT.A' });
    expect(p.map((x) => x.codigo)).toEqual(['codigo-repetido', 'codigo-repetido', 'autoaprovacao']);
  });
});

describe('protocolos gerenciados: quem inclui (regra 8)', () => {
  it('enfermeiro e médico com conselho ativo incluem; técnico, recepção e conselho inativo não', () => {
    const a = (
      categoria: 'enfermeiro' | 'medico' | 'tecnico-enfermagem' | 'administrativo',
      c = true,
      v = true,
    ) => ({
      categoria,
      conselhoAtivo: c,
      vinculoAssistencial: v,
    });
    expect(recusaDoGerenciado(a('enfermeiro'))).toBeNull();
    expect(recusaDoGerenciado(a('medico'))).toBeNull();
    expect(recusaDoGerenciado(a('tecnico-enfermagem'))).toBe('categoria-nao-inclui');
    expect(recusaDoGerenciado(a('administrativo', false, false))).toBe('sem-vinculo-assistencial');
    expect(recusaDoGerenciado(a('enfermeiro', false))).toBe('conselho-inativo');
    expect(origemDaInclusao('medico', null)).toBe('medico');
    expect(origemDaInclusao('enfermeiro', null)).toBe('enfermeiro');
    expect(origemDaInclusao('enfermeiro', 'dor-precordial')).toBe('sugerido');
  });

  it('a classificação sugere pelo discriminador presente, sem repetir o tipo já incluído nem o sem definição', () => {
    const d = PROTOCOLO_SINTETICO.discriminadores;
    expect(
      sugestoesDaClassificacao(['dor-precordial', 'dor-intensa'], d, new Set(), new Set(['dor-toracica'])),
    ).toEqual([{ tipo: 'dor-toracica', discriminador: 'dor-precordial', titulo: 'Dor precordial típica' }]);
    expect(
      sugestoesDaClassificacao(['dor-precordial'], d, new Set(['dor-toracica']), new Set(['dor-toracica'])),
    ).toEqual([]);
    expect(sugestoesDaClassificacao(['dor-precordial'], d, new Set(), new Set())).toEqual([]);
    expect(
      sugestoesDaClassificacao(['febre-alta', 'inexistente'], d, new Set(), new Set(['dor-toracica'])),
    ).toEqual([]);
    const estranho = [{ codigo: 'x', titulo: 'X', sugereProtocolo: 'nao-existe' }];
    expect(sugestoesDaClassificacao(['x'], estranho, new Set(), new Set(['nao-existe']))).toEqual([]);
  });
});

describe('protocolos gerenciados: relógio', () => {
  const base = { conteudo: dor, chegadaEm: '2026-10-24T10:00:00', incluidoEm: '2026-10-24T10:03' };

  it('prazo da chegada e da inclusão; no prazo, vencendo e vencida; a próxima é a mais apertada', () => {
    expect(prazoDaMeta(dor.metas[0]!, base.chegadaEm, base.incluidoEm)).toBe('2026-10-24T10:10:00');
    expect(prazoDaMeta(dor.metas[2]!, base.chegadaEm, base.incluidoEm)).toBe('2026-10-24T11:03:00');
    const r1 = relogioDoProtocolo({ ...base, eventos: [], agora: '2026-10-24T10:04:00' });
    expect(r1.metas.map((m) => m.situacao)).toEqual(['no_prazo', 'no_prazo', 'no_prazo', 'pendente']);
    expect(r1.proxima).toEqual({ titulo: 'ECG de 12 derivações', minutosRestantes: 6, situacao: 'no_prazo' });
    expect(r1.minutosDesdeInclusao).toBe(1);
    const r2 = relogioDoProtocolo({ ...base, eventos: [], agora: '2026-10-24T10:06' });
    expect(r2.metas[0]!.situacao).toBe('vencendo');
    const r3 = relogioDoProtocolo({ ...base, eventos: [], agora: '2026-10-24T10:12' });
    expect(r3.metas[0]).toMatchObject({ situacao: 'vencida', minutosRestantes: -2 });
    expect(r3.atrasadas).toBe(1);
  });

  it('meta registrada sai da contagem; checklist feito; encerrado para o relógio e não tem próxima', () => {
    const eventos = [
      ev({}),
      ev({ codigo: 'avaliacao-medica', situacao: 'perdida', quando: null, motivo: 'Médico em reanimação' }),
      ev({ tipo: 'checklist', codigo: 'aas', situacao: 'cumprida' }),
    ];
    const r = relogioDoProtocolo({ ...base, eventos, agora: '2026-10-24T10:30' });
    expect(r.metas.map((m) => m.situacao)).toEqual(['cumprida', 'perdida', 'no_prazo', 'feito']);
    expect(r.atrasadas).toBe(1);
    expect(r.proxima?.titulo).toBe('Coleta da troponina');
    const fim = ev({
      tipo: 'encerramento',
      codigo: 'encerramento',
      situacao: 'concluido',
      em: '2026-10-24T10:40:00',
    });
    const e = relogioDoProtocolo({ ...base, eventos: [...eventos, fim], agora: '2026-10-24T12:00' });
    expect(e.encerrado).toBe(fim);
    expect(e.proxima).toBeNull();
    expect(e.minutosDesdeInclusao).toBe(37);
    const perdidoChk = relogioDoProtocolo({
      ...base,
      eventos: [ev({ tipo: 'checklist', codigo: 'aas', situacao: 'perdida', motivo: 'Contraindicado' })],
      agora: '2026-10-24T10:04',
    });
    expect(perdidoChk.metas[3]!.situacao).toBe('perdida');
  });
});

describe('protocolos gerenciados: registro da meta (regra 8)', () => {
  const p = {
    chegadaEm: '2026-10-24T10:00:00',
    incluidoEm: '2026-10-24T10:03:00',
    agora: '2026-10-24T10:20:00',
  };
  const ecg = dor.metas[0]!;

  it('feita no prazo: cumprida; depois do prazo ou não feita: perdida e exige o motivo', () => {
    expect(
      decidirRegistroMeta({ ...p, meta: ecg, feita: true, quando: '2026-10-24T10:09', motivo: null }),
    ).toEqual({
      ok: true,
      situacao: 'cumprida',
      prazoEm: '2026-10-24T10:10:00',
    });
    expect(
      decidirRegistroMeta({ ...p, meta: ecg, feita: true, quando: '2026-10-24T10:15', motivo: null }),
    ).toMatchObject({ ok: false, codigo: 'motivo-obrigatorio', campo: 'motivo' });
    expect(
      decidirRegistroMeta({
        ...p,
        meta: ecg,
        feita: true,
        quando: '2026-10-24T10:15',
        motivo: 'Eletro em uso',
      }),
    ).toMatchObject({ ok: true, situacao: 'perdida' });
    expect(decidirRegistroMeta({ ...p, meta: ecg, feita: false, quando: null, motivo: '  ' })).toMatchObject({
      ok: false,
      codigo: 'motivo-obrigatorio',
    });
    expect(
      decidirRegistroMeta({ ...p, meta: ecg, feita: false, quando: null, motivo: 'Recusa do paciente' }),
    ).toMatchObject({
      ok: true,
      situacao: 'perdida',
    });
  });

  it('hora no futuro e antes da chegada são recusadas; o checklist não tem prazo', () => {
    expect(
      decidirRegistroMeta({ ...p, meta: ecg, feita: true, quando: '2026-10-24T10:30', motivo: null }),
    ).toMatchObject({
      ok: false,
      codigo: 'hora-no-futuro',
    });
    expect(
      decidirRegistroMeta({ ...p, meta: ecg, feita: true, quando: '2026-10-24T09:50', motivo: null }),
    ).toMatchObject({
      ok: false,
      codigo: 'hora-antes-da-chegada',
    });
    expect(
      decidirRegistroMeta({ ...p, meta: null, feita: true, quando: '2026-10-24T10:19', motivo: null }),
    ).toEqual({
      ok: true,
      situacao: 'cumprida',
      prazoEm: null,
    });
  });

  it('encerramento: o descarte e as metas sem registro pedem o motivo', () => {
    expect(problemaDoEncerramento('descartado', null, 0)).toMatch(/critério/);
    expect(problemaDoEncerramento('concluido', null, 2)).toMatch(/2 meta/);
    expect(problemaDoEncerramento('concluido', null, 0)).toBeNull();
    expect(problemaDoEncerramento('transferido', 'Transferido à hemodinâmica', 1)).toBeNull();
  });
});

describe('protocolos gerenciados: adesão e horas', () => {
  it('cumpridas sobre registradas por meta (numerador e denominador)', () => {
    const a = adesaoDasMetas([
      { tipo: 'dor-toracica', conteudo: dor, eventos: [ev({})] },
      { tipo: 'dor-toracica', conteudo: dor, eventos: [ev({ situacao: 'perdida', motivo: 'Atraso' })] },
      { tipo: 'dor-toracica', conteudo: dor, eventos: [] },
    ]);
    expect(a.find((x) => x.meta === 'ecg')).toEqual({
      tipo: 'dor-toracica',
      meta: 'ecg',
      titulo: 'ECG de 12 derivações',
      cumpridas: 1,
      registradas: 2,
      percentual: 50,
    });
    expect(a.find((x) => x.meta === 'troponina')?.percentual).toBeNull();
  });

  it('somar minutos e completar os segundos', () => {
    expect(somarMinutos('2026-10-24T23:55', 10)).toBe('2026-10-25T00:05:00');
    expect(comSegundos('2026-10-24T10:00')).toBe('2026-10-24T10:00:00');
    expect(comSegundos('2026-10-24T10:00:12.345')).toBe('2026-10-24T10:00:12');
  });
});
