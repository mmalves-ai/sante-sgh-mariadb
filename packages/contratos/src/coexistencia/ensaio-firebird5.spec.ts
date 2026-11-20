import { describe, expect, it } from 'vitest';
import { FUNCOES_EXTERNAS_ESPERADAS } from './desligamento.js';
import {
  caminhoRelatorioEnsaioFirebird5,
  esquemaFuncaoEnsaio,
  esquemaParceiroEnsaio,
  ETAPAS_ENSAIO_FIREBIRD5,
  VERSAO_ENSAIO_FIREBIRD5,
  VERSAO_ORIGEM_FIREBIRD,
} from './ensaio-firebird5.js';

describe('ensaio do Firebird 5 (M58-F2): vocabulário', () => {
  it('as 13 etapas da ficha, sem repetição, começando pelo backup', () => {
    expect(new Set(ETAPAS_ENSAIO_FIREBIRD5).size).toBe(13);
    expect(ETAPAS_ENSAIO_FIREBIRD5[0]).toBe('backup');
    for (const e of ['assinaturas', 'carga', 'sante-api', 'parceiros', 'volta-atras', 'restauracao-isolada'])
      expect(ETAPAS_ENSAIO_FIREBIRD5, e).toContain(e);
  });

  it('versões e caminho do relatório', () => {
    expect(VERSAO_ORIGEM_FIREBIRD).toBe('3.0.14');
    expect(VERSAO_ENSAIO_FIREBIRD5.startsWith('5.')).toBe(true);
    expect(caminhoRelatorioEnsaioFirebird5('pc')).toBe('docs/marcos/M58/pc/firebird5.json');
  });

  it('as funções esperadas cabem no esquema da função do ensaio', () => {
    for (const f of FUNCOES_EXTERNAS_ESPERADAS) {
      const r = esquemaFuncaoEnsaio.safeParse({
        nome: f.nome,
        modulo: f.modulo,
        bibliotecaPresente: false,
        chamadaOk: null,
        dependentes: 0,
        dependentesValidos: 0,
        resolucaoProposta: 'pendente',
      });
      expect(r.success, f.nome).toBe(true);
    }
  });

  it('o alvo do parceiro é prefixo de visão ou o banco externo; nada de texto livre', () => {
    expect(esquemaParceiroEnsaio.safeParse({ alvo: 'V_EPIMED_', objetos: 1, lidosSemErro: 1 }).success).toBe(
      true,
    );
    expect(
      esquemaParceiroEnsaio.safeParse({ alvo: 'banco-externo', objetos: 4, lidosSemErro: 4 }).success,
    ).toBe(true);
    expect(
      esquemaParceiroEnsaio.safeParse({ alvo: 'fulano de tal', objetos: 1, lidosSemErro: 1 }).success,
    ).toBe(false);
  });
});
