// M59-F1: o catálogo das contas técnicas (cap-08 §8.10) é coerente e não nomeia pessoa.
import { describe, expect, it } from 'vitest';
import {
  CLASSES_CONTA_BANCO,
  CONTAS_TECNICAS_LEGADO,
  DESTINOS_CONTA_BANCO,
  esquemaUsoContaBanco,
} from './contas-banco.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { PERMISSOES_M59 } from '../permissoes/endurecimento.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';

describe('contas técnicas do banco (M59-F1)', () => {
  it('nomes e prefixos únicos, em maiúsculas, com classe e destino do vocabulário', () => {
    const chaves = CONTAS_TECNICAS_LEGADO.map((x) => x.nome ?? `${x.prefixo}*`);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const x of CONTAS_TECNICAS_LEGADO) {
      expect(Boolean(x.nome) !== Boolean(x.prefixo)).toBe(true);
      expect(x.nome ?? x.prefixo).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(CLASSES_CONTA_BANCO).toContain(x.classe);
      expect(DESTINOS_CONTA_BANCO).toContain(x.destino);
      expect(x.exigeMedicao).toBe(true);
      expect(x.classe).not.toBe('nao-catalogada');
    }
  });

  it('cobre as contas do cap-08 §8.10 (28 nomes e 1 prefixo para as 4 de relatório), PUBLIC e os 3 papéis', () => {
    expect(CONTAS_TECNICAS_LEGADO.filter((x) => x.nome)).toHaveLength(32);
    expect(CONTAS_TECNICAS_LEGADO.filter((x) => x.prefixo).map((x) => x.prefixo)).toEqual(['RELATORIO_']);
    // Parceiros dependem da DP-16 e a conta da Hal-AI da regra 12.
    const hal = CONTAS_TECNICAS_LEGADO.find((x) => x.nome === 'HAL_AI');
    expect(hal?.dependeDe).toEqual(['regra-12']);
    for (const x of CONTAS_TECNICAS_LEGADO.filter((y) => y.classe === 'parceiro-terceiro')) {
      expect(x.dependeDe).toContain('DP-16');
    }
  });

  it('uso medido: conta em maiúsculas, janela em dias ISO, sem campos a mais', () => {
    const ok = {
      conta: 'EXCEL_FIN',
      inicio: '2026-07-01',
      fim: '2026-09-30',
      sessoes: 0,
      consultas: null,
      ultimoUso: null,
      fonte: 'trace',
    };
    expect(esquemaUsoContaBanco.parse(ok)).toEqual(ok);
    expect(esquemaUsoContaBanco.safeParse({ ...ok, conta: 'excel' }).success).toBe(false);
    expect(esquemaUsoContaBanco.safeParse({ ...ok, sessoes: -1 }).success).toBe(false);
    expect(esquemaUsoContaBanco.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it('permissão do inventário no catálogo declarado, formato de três partes, só consulta', () => {
    for (const p of PERMISSOES_M59) {
      expect(CATALOGO_DECLARADO).toContain(p);
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(p.concessaoPorPerfil).toBe('por-perfil');
      // M59-F3: as senhas secundárias dos usuários são administrativas (gestor de acessos); as demais, técnicas.
      expect(p.categoria).toBe(p.codigo.startsWith('acesso.senhaSecundaria.') ? 'administrativa' : 'tecnica');
    }
  });
});
