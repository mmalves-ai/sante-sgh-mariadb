// O resumo do ensaio do UTF-8 (M58-F3) sem HTTP: relatório ausente, de outro estabelecimento, fora do esquema ou
// ilegível (falha fechada), a reavaliação pelos números e o registro do ensaio da F2 e da F3.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { relatorioEnsaioUtf8Vazio } from '@sgh/dominio-config';
import { describe, expect, it } from 'vitest';
import { lerRegistroDesligamento } from './aplicacao/desligamento.js';
import { lerRegistroEnsaioUtf8, lerRelatorioEnsaioUtf8, resumirEnsaioUtf8 } from './aplicacao/ensaio-utf8.js';

const vazio = (h = 'pc') =>
  relatorioEnsaioUtf8Vazio(
    h,
    '2026-10-27',
    { versaoMotor: '5.0.3', charset: 'NONE' },
    {
      versaoMotor: '5.0.3',
      charset: 'UTF8',
    },
  );
const registro = lerRegistroDesligamento(mkdtempSync(join(tmpdir(), 'm58-regu-')), 'pc').registro;
const EM = new Date('2026-10-27T12:00:00Z');

describe('relatório do ensaio do UTF-8 (falha fechada)', () => {
  it('ausente, de outro estabelecimento, fora do esquema ou ilegível: nada aprovável, com o aviso', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'm58-utf8-'));
    expect(lerRelatorioEnsaioUtf8(raiz, 'pc').invalido).toBe('ensaio ainda não executado');
    mkdirSync(join(raiz, 'pc'));
    writeFileSync(join(raiz, 'pc', 'utf8.json'), JSON.stringify(vazio('hs')));
    expect(lerRelatorioEnsaioUtf8(raiz, 'pc').invalido).toBe('relatório de outro estabelecimento');
    writeFileSync(join(raiz, 'pc', 'utf8.json'), JSON.stringify({ ...vazio(), formato: 2 }));
    expect(lerRelatorioEnsaioUtf8(raiz, 'pc').invalido).toContain('fora do esquema');
    writeFileSync(join(raiz, 'pc', 'utf8.json'), '{');
    const l = lerRelatorioEnsaioUtf8(raiz, 'pc');
    expect(l.invalido).toBe('relatório ilegível');
    const s = resumirEnsaioUtf8('pc', EM, l, registro);
    expect(s).toMatchObject({ aprovavel: false, ensaiadoEm: null, janelaMinutos: null, paginaAlvo: null });
    expect(s.etapas.every((x) => x.situacao === 'nao-executada')).toBe(true);
    expect(lerRegistroEnsaioUtf8(null, 'pc', EM, registro).relatorioInvalido).toBe(
      'pasta dos ensaios não configurada',
    );
  });

  it('"aprovada" sem número que a sustente vira reprovada; o vazio não tem janela', () => {
    const r = vazio();
    r.etapas.codec = { ...r.etapas.codec, situacao: 'aprovada', corpusBytes: 256, idaEVoltaOk: true };
    const s = resumirEnsaioUtf8('pc', EM, { relatorio: r, invalido: null }, registro);
    expect(s.etapas.find((x) => x.etapa === 'codec')).toEqual({
      etapa: 'codec',
      situacao: 'reprovada',
      bloqueio: null,
      achados: ['charset-nao-conferido'],
    });
    expect(s.janelaMinutos).toBeNull();
    expect(s.firebird5Aprovado).toBe(false);
  });
});
