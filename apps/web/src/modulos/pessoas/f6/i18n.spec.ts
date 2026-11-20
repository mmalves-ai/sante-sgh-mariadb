// Os textos da F6 não citam o sistema antigo nem tabela (ADR 0023); as rotas exigem permissões do catálogo da F6; o
// "Meu espaço" diz onde ver o holerite sem mandar a outro sistema.
import { PERMISSOES_PESSOAS_M52_F1, PERMISSOES_PESSOAS_M52_F6 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensF6 } from './i18n.js';
import { rotasF6 } from './rotas.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('textos e rotas da F6 (M52.6)', () => {
  it('nenhum texto cita o sistema antigo nem nome de tabela', () => {
    const achados = textos(mensagensF6).filter(([, t]) =>
      /spdata|legado|sistema atual|sistema antigo|\bTB[A-Z]{3,}|\bRP[A-Z]{3,}|\bFP[A-Z_]{3,}|SGH_/i.test(t),
    );
    expect(achados).toEqual([]);
  });

  it('rotas com as permissões da F6 (a fila das solicitações, W0-06, com a de aprovar)', () => {
    const codigos = new Set(
      [...PERMISSOES_PESSOAS_M52_F6, ...PERMISSOES_PESSOAS_M52_F1].map((p) => p.codigo),
    );
    expect(rotasF6.map((r) => r.path)).toEqual([
      '/pessoas/treinamentos',
      '/pessoas/meu',
      '/pessoas/escala/realizado',
      '/pessoas/solicitacoes',
    ]);
    for (const r of rotasF6) expect(codigos.has(String(r.meta?.['permissao']))).toBe(true);
  });

  it('o autosserviço e o lançamento desligado explicam o motivo sem citar outro sistema', () => {
    expect(mensagensF6.meu.semVinculo).toMatch(/cadastro de colaborador/);
    expect(mensagensF6.realizado.repasseDesligado).toMatch(/desligado/);
  });
});
