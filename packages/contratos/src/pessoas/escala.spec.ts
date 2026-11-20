// Contratos da escala, fatia F2 (M52.2): esquemas, permissões (a publicação só pelo perfil de gestor de escala), a chave
// de liberação e os eventos auditáveis.
import { describe, expect, it } from 'vitest';
import { EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { recursoDesligado } from '../liberacao/recursos.js';
import { PERFIS_COMPLEMENTARES } from '../permissoes/catalogo.js';
import { PERMISSOES_PESSOAS_M52_F2 } from '../permissoes/pessoas.js';
import {
  esquemaAlterarRegime,
  esquemaCriarEscala,
  esquemaIncluirPlantao,
  esquemaIncluirRegime,
  esquemaPublicarEscala,
} from './escala-entradas.js';
import { CONSELHO_DA_ESCALA, LIMITES_TEMPO_PARCIAL, TURNOS_ESCALA } from './escala-vocabulario.js';

const regime = {
  codigo: '12x36',
  nome: 'Plantão 12 por 36',
  jornada: 2,
  minutosPlantao: 720,
  descansoMinimoMin: 2160,
  limiteSemanalHoras: 48,
};

describe('contratos da escala (M52.2)', () => {
  it('regime: padrões, sigla e versão na alteração', () => {
    expect(esquemaIncluirRegime.parse(regime)).toMatchObject({
      contratoParcial: 0,
      folgaPadrao: null,
      acordo: null,
      ativo: true,
    });
    expect(esquemaIncluirRegime.safeParse({ ...regime, codigo: '#1' }).success).toBe(false);
    expect(esquemaIncluirRegime.safeParse({ ...regime, minutosPlantao: 30 }).success).toBe(false);
    expect(esquemaAlterarRegime.safeParse({ ...regime, id: 1 }).success).toBe(false);
    expect(esquemaAlterarRegime.safeParse({ ...regime, id: 1, versao: 0 }).success).toBe(true);
  });

  it('escala e plantão: competência, instante local, sobreaviso com chegada', () => {
    expect(
      esquemaCriarEscala.parse({
        unidade: 1,
        competencia: '2026-11',
        tipo: 'enfermagem',
        cobertura: { manha: 2, tarde: 2, noite: 1 },
      }),
    ).toMatchObject({ setor: '' });
    expect(
      esquemaCriarEscala.safeParse({
        unidade: 1,
        competencia: '2026-13',
        tipo: 'enfermagem',
        cobertura: { manha: 0, tarde: 0, noite: 0 },
      }).success,
    ).toBe(false);
    const p = {
      escala: 1,
      vinculo: 2,
      tipo: 'presencial',
      inicio: '2026-11-02T07:00',
      fim: '2026-11-02T19:00',
    };
    expect(esquemaIncluirPlantao.parse(p)).toMatchObject({ chegadaMin: null, motivo: null });
    expect(esquemaIncluirPlantao.safeParse({ ...p, inicio: '2026-11-02 07:00' }).success).toBe(false);
    expect(esquemaIncluirPlantao.safeParse({ ...p, tipo: 'sobreaviso' }).success).toBe(false);
    expect(esquemaIncluirPlantao.safeParse({ ...p, tipo: 'sobreaviso', chegadaMin: 30 }).success).toBe(true);
    expect(esquemaPublicarEscala.parse({ escala: 1, versao: 3 })).toEqual({
      escala: 1,
      versao: 3,
      justificativaFuro: null,
    });
  });

  it('vocabulário: conselho por tipo de escala, tempo parcial da ref 02 e os turnos', () => {
    expect(CONSELHO_DA_ESCALA).toEqual({
      medica: 'CRM',
      enfermagem: 'COREN',
      multiprofissional: 'qualquer',
      apoio: null,
    });
    expect(LIMITES_TEMPO_PARCIAL).toEqual({ 0: null, 1: 25, 2: 30, 3: 26 });
    expect(Object.keys(TURNOS_ESCALA)).toEqual(['manha', 'tarde', 'noite']);
  });

  it('permissões: as cinco da ficha; publicar só pelo perfil (sem opção do outro sistema)', () => {
    const por = new Map(PERMISSOES_PESSOAS_M52_F2.map((p) => [p.codigo, p]));
    expect([...por.keys()]).toEqual([
      'pessoas.escala.ler',
      'pessoas.escala.montar',
      'pessoas.escala.publicar',
      'pessoas.regime.ler',
      'pessoas.regime.editar',
    ]);
    expect(por.get('pessoas.escala.publicar')).toMatchObject({
      opcoesLegado: [],
      concessaoPorPerfil: 'por-perfil',
      perfis: ['gestor-escala'],
    });
    expect(por.get('pessoas.escala.montar')?.opcoesLegado).toEqual([5073]);
    expect(PERFIS_COMPLEMENTARES).toContain('gestor-escala');
  });

  it('chave de liberação com o pré-requisito e os eventos auditáveis', () => {
    expect(recursoDesligado('pessoas.escala')?.prerequisitos).toHaveLength(1);
    for (const k of [
      'pessoasRegimeGravado',
      'pessoasRegimeAtribuido',
      'pessoasEscalaCriada',
      'pessoasPlantaoGravado',
      'pessoasEscalaPublicada',
    ] as const)
      expect(EVENTOS_AUDITAVEIS[k].codigo).toMatch(/^pessoas\./);
  });
});
