// Contratos da CCIH (M48, etapa 3): vocabulário, entradas e permissões. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { recursoDesligado } from '../liberacao/recursos.js';
import { CATALOGO_DECLARADO, PERFIS_COMPLEMENTARES } from '../permissoes/catalogo.js';
import { PERFIL_CCIH, PERMISSOES_CCIH, PERMISSOES_QUALIDADE_CCIH_M48 } from '../permissoes/qualidade-ccih.js';
import {
  esquemaAtualizarSurto,
  esquemaConfigurarAntimicrobiano,
  esquemaDefinirPrecaucao,
  esquemaLiberarAntimicrobiano,
  esquemaRegistrarDispositivo,
  esquemaRegistrarIras,
  esquemaRegistrarObservacaoMaos,
  esquemaRetirarDispositivo,
  MOTIVOS_PRECAUCAO,
  motivoMultirresistente,
  rotuloDispositivoInvasivo,
  rotuloMotivoVigilancia,
  tipoSugeridoDaPrecaucao,
} from './ccih.js';
import { opcoesDoMapa } from '../permissoes/mapa-origem-teste.js';

const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) => s.safeParse(v).success;

describe('vocabulário da CCIH', () => {
  it('tipo sugerido e multirresistente pelo motivo; rótulos', () => {
    expect(tipoSugeridoDaPrecaucao('tuberculose')).toBe('aerossois');
    expect(tipoSugeridoDaPrecaucao('influenza')).toBe('goticulas');
    expect(motivoMultirresistente('kpc')).toBe(true);
    expect(motivoMultirresistente('clostridioides')).toBe(false);
    expect(MOTIVOS_PRECAUCAO.filter((m) => m.mr).map((m) => m.codigo)).toEqual([
      'kpc',
      'mrsa',
      'vre',
      'acinetobacter',
      'outroMultirresistente',
    ]);
    expect(rotuloDispositivoInvasivo('cvc')).toBe('Cateter venoso central');
    expect(rotuloMotivoVigilancia('febre')).toBe('Febre nas últimas 48 horas');
  });
});

describe('entradas', () => {
  it('dispositivo: inserção e retirada', () => {
    const d = {
      internacao: 55,
      tipo: 'cvc',
      sitio: 'Subclávia direita',
      inseridoEm: '2026-10-25T08:00',
      itemPrescricao: null,
      observacao: null,
    };
    expect(ok(esquemaRegistrarDispositivo, d)).toBe(true);
    expect(ok(esquemaRegistrarDispositivo, { ...d, inseridoEm: '2026-02-30T08:00' })).toBe(false);
    expect(ok(esquemaRegistrarDispositivo, { ...d, tipo: 'dreno' })).toBe(false);
    expect(
      ok(esquemaRetirarDispositivo, {
        dispositivo: 1,
        versao: 1,
        retiradoEm: '2026-10-26T08:00',
        motivo: 'acidental',
        observacao: null,
      }),
    ).toBe(true);
  });
  it('IRAS: ISC com cirurgia e profundidade; os campos da ISC só nela; multirresistente com microrganismo', () => {
    const base = {
      internacao: 55,
      sitio: 'ipcs',
      dataInfeccao: '2026-10-20',
      criterios: ['hemoculturaPatogeno'],
      nivelIsc: null,
      cirurgia: null,
      implante: false,
      exame: 123456789012,
      microrganismo: null,
      multirresistente: false,
      descricao: null,
    };
    expect(ok(esquemaRegistrarIras, base)).toBe(true);
    expect(ok(esquemaRegistrarIras, { ...base, sitio: 'isc', criterios: ['drenagemPurulenta'] })).toBe(false);
    expect(
      ok(esquemaRegistrarIras, {
        ...base,
        sitio: 'isc',
        criterios: ['drenagemPurulenta'],
        cirurgia: 9,
        nivelIsc: 'profunda',
      }),
    ).toBe(true);
    expect(ok(esquemaRegistrarIras, { ...base, implante: true })).toBe(false);
    expect(ok(esquemaRegistrarIras, { ...base, sitio: 'outra', criterios: ['diagnosticoMedico'] })).toBe(
      false,
    );
    expect(ok(esquemaRegistrarIras, { ...base, multirresistente: true })).toBe(false);
    expect(ok(esquemaRegistrarIras, { ...base, criterios: [] })).toBe(false);
  });
  it('antimicrobiano: DDD e gramas juntas; dias e orientação conforme a decisão', () => {
    const c = { item: 10, restrito: true, atc: 'J01DH02', dddGramas: 3, gramasPorUnidade: 1 };
    expect(ok(esquemaConfigurarAntimicrobiano, c)).toBe(true);
    expect(ok(esquemaConfigurarAntimicrobiano, { ...c, gramasPorUnidade: null })).toBe(false);
    expect(
      ok(esquemaConfigurarAntimicrobiano, { ...c, dddGramas: null, gramasPorUnidade: null, atc: null }),
    ).toBe(true);
    expect(ok(esquemaConfigurarAntimicrobiano, { ...c, atc: 'xx' })).toBe(false);
    const l = { itemPrescricao: 7, decisao: 'liberado', diasAutorizados: 7, justificativa: null };
    expect(ok(esquemaLiberarAntimicrobiano, l)).toBe(true);
    expect(ok(esquemaLiberarAntimicrobiano, { ...l, diasAutorizados: null })).toBe(false);
    expect(ok(esquemaLiberarAntimicrobiano, { ...l, decisao: 'liberadoComAjuste' })).toBe(false);
    expect(
      ok(esquemaLiberarAntimicrobiano, {
        ...l,
        decisao: 'naoLiberado',
        diasAutorizados: null,
        justificativa: 'Sem indicação: trocar por cefazolina.',
      }),
    ).toBe(true);
    expect(
      ok(esquemaLiberarAntimicrobiano, {
        ...l,
        decisao: 'naoLiberado',
        justificativa: 'Sem indicação: trocar por cefazolina.',
      }),
    ).toBe(false);
  });
  it('precaução: motivo "outro" descrito; microbiologia com a cultura', () => {
    const p = {
      internacao: 55,
      motivo: 'kpc',
      motivoOutro: null,
      tipo: 'contato',
      origem: 'manual',
      exame: null,
      bloquearVizinhos: false,
      observacao: null,
    };
    expect(ok(esquemaDefinirPrecaucao, p)).toBe(true);
    expect(ok(esquemaDefinirPrecaucao, { ...p, motivo: 'outro' })).toBe(false);
    expect(ok(esquemaDefinirPrecaucao, { ...p, origem: 'microbiologia' })).toBe(false);
    expect(ok(esquemaDefinirPrecaucao, { ...p, origem: 'microbiologia', exame: 99 })).toBe(true);
  });
  it('higiene das mãos e surto', () => {
    const o = {
      unidade: 1,
      setor: 'UTI',
      observadoEm: '2026-10-26T09:00',
      categoria: 'enfermeiro',
      oportunidades: [{ momento: 'antesContato', acao: 'friccao', luvas: false }],
      observacao: null,
    };
    expect(ok(esquemaRegistrarObservacaoMaos, o)).toBe(true);
    expect(ok(esquemaRegistrarObservacaoMaos, { ...o, oportunidades: [] })).toBe(false);
    const s = { surto: 1, versao: 1, situacao: 'encerrado', casos: 3, medidas: null, encerradoEm: null };
    expect(ok(esquemaAtualizarSurto, s)).toBe(false);
    expect(ok(esquemaAtualizarSurto, { ...s, encerradoEm: '2026-10-25' })).toBe(true);
    expect(ok(esquemaAtualizarSurto, { ...s, situacao: 'controle', encerradoEm: '2026-10-25' })).toBe(false);
  });
});

describe('permissões, liberação e auditoria', () => {
  it('perfil complementar da CCIH; todas no catálogo; as opções de antimicrobiano mapeadas', () => {
    expect((PERFIS_COMPLEMENTARES as readonly string[]).includes(PERFIL_CCIH)).toBe(true);
    const codigos = new Set(CATALOGO_DECLARADO.map((p) => p.codigo));
    for (const p of PERMISSOES_QUALIDADE_CCIH_M48) {
      expect(codigos.has(p.codigo)).toBe(true);
      expect(p.perfis).toEqual([PERFIL_CCIH]);
      expect(p.categoria).toBe('clinica');
    }
    const por = (c: string) => PERMISSOES_QUALIDADE_CCIH_M48.find((p) => p.codigo === c);
    expect(opcoesDoMapa(por(PERMISSOES_CCIH.antimicrobianoLiberar)?.codigo)).toEqual([1935, 5228]);
    expect(opcoesDoMapa(por(PERMISSOES_CCIH.ccihLer)?.codigo)).toEqual([2299]);
  });
  it('a chave qualidade.ccih e os eventos da regra 11', () => {
    expect(recursoDesligado('qualidade.ccih')?.marco).toBe('M48');
    expect(EVENTOS_AUDITAVEIS.qualidadeAntimicrobianoLiberado.codigo).toBe(
      'qualidade.antimicrobiano.liberado',
    );
    expect(EVENTOS_AUDITAVEIS.qualidadePrecaucaoDefinida.codigo).toBe('qualidade.precaucao.definida');
  });
});
