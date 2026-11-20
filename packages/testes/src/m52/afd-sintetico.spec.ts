// Regra 12 do M52 sobre os arquivos sintéticos do relógio: o válido entra e cada um dos cinco com defeito vai INTEIRO
// para a quarentena (nenhuma marcação), com o motivo esperado; nenhum CPF no relatório das falhas.
import { validarAfd } from '@sgh/dominio-pessoas';
import { describe, expect, it } from 'vitest';
import { ARQUIVOS_AFD_SINTETICOS, CPFS_AFD_SINTETICOS } from './afd-sintetico.js';

describe('AFD sintéticos (M52.4)', () => {
  it('um válido e cinco com defeito', () => {
    expect(ARQUIVOS_AFD_SINTETICOS.filter((a) => a.esperado === 'quarentena')).toHaveLength(5);
    for (const a of ARQUIVOS_AFD_SINTETICOS) {
      const r = validarAfd(a.conteudo);
      expect(r.situacao, a.nome).toBe(a.esperado);
      if (a.falha) {
        expect(r.marcacoes, a.nome).toEqual([]);
        expect(
          r.falhas.map((f) => f.codigo),
          a.nome,
        ).toContain(a.falha);
      } else expect(r.marcacoes).toHaveLength(4);
      for (const c of CPFS_AFD_SINTETICOS) expect(JSON.stringify(r.falhas)).not.toContain(c);
    }
  });
});
