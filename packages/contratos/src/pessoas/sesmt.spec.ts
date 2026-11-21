// Contratos do SESMT (M52.5): as permissões da ficha no catálogo com a origem no outro sistema, a chave de liberação, os
// eventos auditáveis e os esquemas (retificação com motivo, dose com lote, CA, a fonte nunca identificada).
import { describe, expect, it } from 'vitest';
import { EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { recursoDesligado } from '../liberacao/recursos.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { PERMISSOES_PESSOAS_M52_F5 } from '../permissoes/pessoas-sesmt.js';
import {
  esquemaAssinaturaEpi,
  esquemaEmitirCat,
  esquemaFiltroSesmt,
  esquemaLinhaRisco,
  esquemaRegistrarAcidente,
  esquemaRegistrarAso,
  esquemaRegistrarVacinaColaborador,
  esquemaRegistroEpi,
  esquemaSorologia,
} from './sesmt-entradas.js';
import { naturezaAso, VACINAS_SESMT } from './sesmt-vocabulario.js';
import { opcoesDoMapa } from '../permissoes/mapa-origem-teste.js';

describe('SESMT: permissões, liberação e eventos', () => {
  it('as permissões das telas do SESMT, todas com opção do outro sistema e no catálogo', () => {
    expect(PERMISSOES_PESSOAS_M52_F5.map((p) => p.codigo)).toEqual([
      'pessoas.ocupacional.ler',
      'pessoas.ocupacional.registrar',
      'pessoas.acidente.ler',
      'pessoas.acidente.registrar',
      'pessoas.risco.ler',
      'pessoas.risco.editar',
      'pessoas.epi.entregar',
      'pessoas.vacinacao.ler',
      'pessoas.vacinacao.registrar',
    ]);
    for (const p of PERMISSOES_PESSOAS_M52_F5) {
      expect(opcoesDoMapa(p.codigo).length).toBeGreaterThan(0);
      expect(CATALOGO_DECLARADO).toContain(p);
      // Regra 16: nenhuma opção do SESMT fora do módulo de segurança do trabalho (554 a 582).
      for (const o of opcoesDoMapa(p.codigo)) expect(o >= 554 && o <= 582).toBe(true);
    }
  });
  it('a chave pessoas.sesmt nasce desligada com a conferência do SESMT; os eventos existem', () => {
    const r = recursoDesligado('pessoas.sesmt');
    expect(r?.prerequisitos.map((p) => p.responsavel)).toEqual(['SESMT']);
    expect(EVENTOS_AUDITAVEIS.pessoasOcupacionalLido.codigo).toBe('pessoas.ocupacional.lido');
    expect(EVENTOS_AUDITAVEIS.pessoasEpiRegistrado.legado).toBeNull();
  });
  it('a natureza do ASO e o código das vacinas do domínio', () => {
    expect(naturezaAso(8)).toBe('demissional');
    // D-VAC-525: nenhum código fixo do domínio de vacinas; só os termos que casam com a descrição lida.
    expect(VACINAS_SESMT['dupla-adulto'].termos).toContain('DUPLA');
    expect(Object.values(VACINAS_SESMT).every((v) => !('codigoLegado' in v) && v.termos.length > 0)).toBe(
      true,
    );
  });
});

describe('SESMT: esquemas', () => {
  const aso = {
    vinculo: 1,
    tipo: 1,
    data: '2026-10-20',
    conclusao: 1,
    medico: 'MEDICA SINTETICA',
    exames: [{ exame: 'Hemograma', data: '2026-10-10', resultado: 'normal' }],
  };
  it('ASO: padrões; a retificação pede o motivo', () => {
    const r = esquemaRegistrarAso.parse(aso);
    expect([r.proximo, r.retifica, r.restricoes]).toEqual([null, null, null]);
    expect(esquemaRegistrarAso.safeParse({ ...aso, retifica: 3 }).success).toBe(false);
    expect(
      esquemaRegistrarAso.safeParse({ ...aso, retifica: 3, motivoRetificacao: 'Data digitada errada.' })
        .success,
    ).toBe(true);
  });
  it('vacina: a dose pede o lote e a validade; o anti-HBs pede o valor', () => {
    const d = { vinculo: 1, registro: 'dose', vacina: 'hepatite-b', dose: '1', data: '2026-10-20' };
    expect(esquemaRegistrarVacinaColaborador.safeParse(d).success).toBe(false);
    expect(
      esquemaRegistrarVacinaColaborador.safeParse({ ...d, lote: 'L1', validadeLote: '2027-01-01' }).success,
    ).toBe(true);
    expect(
      esquemaRegistrarVacinaColaborador.safeParse({ ...d, registro: 'anti-hbs', dose: null }).success,
    ).toBe(false);
  });
  it('acidente: instante com hora; nenhum campo do paciente aceito', () => {
    const a = {
      vinculo: 1,
      ocorridoEm: '2026-10-21T14:05',
      tipo: 'tipico',
      local: 'Posto 2',
      descricao: 'Picada de agulha no descarte.',
      biologico: true,
      perfurocortante: true,
    };
    expect(esquemaRegistrarAcidente.safeParse(a).success).toBe(true);
    expect(esquemaRegistrarAcidente.safeParse({ ...a, ocorridoEm: '2026-10-21' }).success).toBe(false);
    expect(esquemaRegistrarAcidente.safeParse({ ...a, paciente: 123 }).success).toBe(false);
  });
  it('sorologia, CAT, risco, EPI, assinatura e o painel', () => {
    expect(
      esquemaSorologia.safeParse({ acidente: 1, marco: 'd30', resultado: 'sem-alteracao' }).success,
    ).toBe(false);
    expect(
      esquemaSorologia.safeParse({ acidente: 1, marco: 'd30', resultado: 'nao-realizada' }).success,
    ).toBe(true);
    expect(
      esquemaEmitirCat.safeParse({ acidente: 1, versao: 0, tipoCat: 1, numero: '', emitidaEm: '2026-10-22' })
        .success,
    ).toBe(false);
    expect(
      esquemaLinhaRisco.safeParse({ funcao: 'Técnico', tipo: 'risco', inicio: '2026-01-01' }).success,
    ).toBe(false);
    expect(
      esquemaLinhaRisco.safeParse({ funcao: 'Técnico', tipo: 'epi', epi: 'Luva', inicio: '2026-01-01' })
        .success,
    ).toBe(true);
    const epi = {
      tipo: 'epi',
      vinculo: 1,
      data: '2026-10-26',
      epi: 'Luva',
      caNumero: '123',
      caValidade: '2027-01-01',
      quantidade: 1,
    };
    expect(esquemaRegistroEpi.safeParse(epi).success).toBe(true);
    expect(esquemaRegistroEpi.safeParse({ ...epi, tipo: 'quimio' }).success).toBe(false);
    expect(esquemaAssinaturaEpi.safeParse({ entrega: 1, conferida: false }).success).toBe(false);
    expect(esquemaFiltroSesmt.parse({ somentePendentes: 'false' }).somentePendentes).toBe(false);
    expect(esquemaFiltroSesmt.parse({}).somentePendentes).toBe(true);
  });
});
