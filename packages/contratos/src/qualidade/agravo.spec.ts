// Contratos da notificação compulsória (M48, etapa 4): vocabulário, entradas e permissões. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { recursoDesligado } from '../liberacao/recursos.js';
import { CATALOGO_DECLARADO, PERFIS_COMPLEMENTARES } from '../permissoes/catalogo.js';
import {
  PERFIL_VIGILANCIA_EPIDEMIOLOGICA,
  PERMISSOES_AGRAVO,
  PERMISSOES_QUALIDADE_AGRAVO_M48,
} from '../permissoes/qualidade-agravo.js';
import {
  canalExigeNumero,
  esquemaAbrirCasoAgravo,
  esquemaCidAgravo,
  esquemaConfigurarGatilhoExame,
  esquemaDescartarCasoAgravo,
  esquemaFiltroCasosAgravo,
  esquemaFiltroGatilhosAgravo,
  esquemaRegistrarNotificacaoAgravo,
  horasDaPeriodicidade,
  periodicidadeDoCadastro,
  rotuloCanalNotificacaoAgravo,
  rotuloPeriodicidadeAgravo,
} from './agravo.js';
import { opcoesDoMapa } from '../permissoes/mapa-origem-teste.js';

const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) => s.safeParse(v).success;

describe('vocabulário da notificação compulsória', () => {
  it('periodicidade pelo valor do cadastro de CID (0 não notificável, 1 semanal, 2 imediata)', () => {
    expect(periodicidadeDoCadastro(2)).toBe('imediata');
    expect(periodicidadeDoCadastro(1)).toBe('semanal');
    expect(periodicidadeDoCadastro(0)).toBeNull();
    expect(periodicidadeDoCadastro(null)).toBeNull();
    expect(periodicidadeDoCadastro(9)).toBeNull();
    expect(horasDaPeriodicidade('imediata')).toBe(24);
    expect(horasDaPeriodicidade('semanal')).toBe(168);
    expect(rotuloPeriodicidadeAgravo('imediata')).toBe('Imediata (até 24 horas)');
  });

  it('canais: só os digitados no Sinan exigem o número', () => {
    expect(canalExigeNumero('sinanOnline')).toBe(true);
    expect(canalExigeNumero('esusSinan')).toBe(true);
    expect(canalExigeNumero('fichaImpressa')).toBe(false);
    expect(canalExigeNumero('telefone')).toBe(false);
    expect(rotuloCanalNotificacaoAgravo('fichaImpressa')).toContain('Ficha impressa');
  });

  it('CID no formato do cadastro (sem ponto, maiúsculo)', () => {
    expect(esquemaCidAgravo.parse('a90')).toBe('A90');
    expect(esquemaCidAgravo.parse('B16.9')).toBe('B169');
    expect(esquemaCidAgravo.parse('U07X')).toBe('U07X');
    expect(ok(esquemaCidAgravo, 'A9')).toBe(false);
    expect(ok(esquemaCidAgravo, 'AA90')).toBe(false);
  });
});

describe('entradas', () => {
  const base = {
    origem: 'cid',
    exame: null,
    atendimento: 209001,
    paciente: 77,
    cid: 'A90',
    gatilhoEm: '2026-10-27T08:30',
    observacao: null,
  };
  it('abrir caso: o gatilho traz o atendimento; o exame só no resultado reagente; o manual descreve a suspeita', () => {
    expect(ok(esquemaAbrirCasoAgravo, base)).toBe(true);
    expect(ok(esquemaAbrirCasoAgravo, { ...base, atendimento: null })).toBe(false);
    expect(ok(esquemaAbrirCasoAgravo, { ...base, exame: 5 })).toBe(false);
    expect(ok(esquemaAbrirCasoAgravo, { ...base, origem: 'exame' })).toBe(false);
    expect(ok(esquemaAbrirCasoAgravo, { ...base, origem: 'exame', exame: 9_000_001 })).toBe(true);
    expect(ok(esquemaAbrirCasoAgravo, { ...base, origem: 'manual', atendimento: null })).toBe(false);
    expect(
      ok(esquemaAbrirCasoAgravo, {
        ...base,
        origem: 'manual',
        atendimento: null,
        observacao: 'Suspeita clínica de sarampo (sintético).',
      }),
    ).toBe(true);
    expect(ok(esquemaAbrirCasoAgravo, { ...base, gatilhoEm: '2026-02-30T08:00' })).toBe(false);
  });

  it('registrar notificação: número pelo canal; quem recebeu no telefone e no e-mail', () => {
    const n = {
      caso: 1,
      versao: 1,
      autoridade: 'SMS',
      canal: 'fichaImpressa',
      numero: null,
      notificadoEm: '2026-10-27T10:00',
      recebidoPor: null,
      observacao: null,
    };
    expect(ok(esquemaRegistrarNotificacaoAgravo, n)).toBe(true);
    expect(ok(esquemaRegistrarNotificacaoAgravo, { ...n, canal: 'sinanOnline' })).toBe(false);
    expect(ok(esquemaRegistrarNotificacaoAgravo, { ...n, canal: 'sinanOnline', numero: '1234567' })).toBe(
      true,
    );
    expect(ok(esquemaRegistrarNotificacaoAgravo, { ...n, canal: 'sinanOnline', numero: '12-34' })).toBe(
      false,
    );
    expect(ok(esquemaRegistrarNotificacaoAgravo, { ...n, canal: 'telefone' })).toBe(false);
    expect(
      ok(esquemaRegistrarNotificacaoAgravo, { ...n, canal: 'telefone', recebidoPor: 'Plantão VE' }),
    ).toBe(true);
    expect(ok(esquemaRegistrarNotificacaoAgravo, { ...n, autoridade: 'OMS' })).toBe(false);
  });

  it('descartar exige a justificativa; gatilho de exame com padrão mínimo', () => {
    expect(
      ok(esquemaDescartarCasoAgravo, { caso: 1, versao: 2, motivo: 'jaNotificado', justificativa: 'curta' }),
    ).toBe(false);
    expect(
      ok(esquemaDescartarCasoAgravo, {
        caso: 1,
        versao: 2,
        motivo: 'jaNotificado',
        justificativa: 'Notificado pela UPA de origem (sintético).',
      }),
    ).toBe(true);
    const g = { gatilho: null, versao: null, padrao: 'DENGUE', exceto: 'IGG', cid: 'A90', ativo: true };
    expect(ok(esquemaConfigurarGatilhoExame, g)).toBe(true);
    expect(ok(esquemaConfigurarGatilhoExame, { ...g, padrao: 'HI' })).toBe(false);
  });

  it('filtros: janela da fila até 30 dias; paginação', () => {
    expect(esquemaFiltroGatilhosAgravo.parse({})).toEqual({ dias: 7 });
    expect(ok(esquemaFiltroGatilhosAgravo, { dias: '31' })).toBe(false);
    expect(esquemaFiltroCasosAgravo.parse({ situacao: 'aberto' })).toMatchObject({
      pagina: 1,
      porPagina: 50,
    });
    expect(ok(esquemaFiltroCasosAgravo, { situacao: 'arquivado' })).toBe(false);
  });
});

describe('permissões, eventos e liberação', () => {
  it('as opções de notificação compulsória do prontuário concedem; perfis da vigilância e da CCIH', () => {
    expect(PERMISSOES_QUALIDADE_AGRAVO_M48.map((p) => p.codigo)).toEqual([
      PERMISSOES_AGRAVO.ler,
      PERMISSOES_AGRAVO.notificar,
    ]);
    const todas = PERMISSOES_QUALIDADE_AGRAVO_M48.flatMap((p) => opcoesDoMapa(p.codigo));
    expect(new Set(todas).size).toBe(todas.length);
    expect(todas).toContain(5273);
    expect(todas).toContain(6856);
    for (const p of PERMISSOES_QUALIDADE_AGRAVO_M48) {
      expect(p.perfis).toContain(PERFIL_VIGILANCIA_EPIDEMIOLOGICA);
      expect(p.criticidade).toBe('sensivel');
      expect(CATALOGO_DECLARADO.some((c) => c.codigo === p.codigo)).toBe(true);
    }
    expect(PERFIS_COMPLEMENTARES).toContain(PERFIL_VIGILANCIA_EPIDEMIOLOGICA);
  });

  it('eventos da trilha (AGRAVO_NOTIFICADO) e a chave de liberação desligada', () => {
    const codigos = Object.values(EVENTOS_AUDITAVEIS).map((e) => e.codigo);
    for (const c of [
      'qualidade.agravo.casoAberto',
      'qualidade.agravo.notificado',
      'qualidade.agravo.descartado',
      'qualidade.agravo.gatilhoConfigurado',
      'qualidade.agravo.lido',
    ])
      expect(codigos).toContain(c);
    expect(recursoDesligado('qualidade.agravos')?.marco).toBe('M48');
  });
});
