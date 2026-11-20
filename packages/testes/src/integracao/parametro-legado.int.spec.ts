// Regra 7 do M08: parâmetro do legado lido com o tipo declarado por coluna e mostrado "como o legado o vê"
// (letra traduzida, hora HH:MM); coluna sem declaração aparece "não interpretada" e SEM valor; credencial e
// dado pessoal, ocultos. Valem sempre os parâmetros do banco do estabelecimento da sessão: a cópia do pc ao
// vivo (READ ONLY) e um segundo banco SINTÉTICO (dublê de leitor; a cópia do Serrano aguarda HS-1) com
// valores diferentes devolvem cada um os seus. Saída só com contagens.
import { type Leitor, painelParametrosLegado, PARAMETROS_LEGADO } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigos, criarNucleo } from './escrita.spec-util.js';

/** Segundo banco sintético: todas as letras no "falso" e horas 23:59 (o oposto do que o pc tem). */
const bancoSintetico: Leitor = {
  hospital: 'zz',
  async consultar<T>(sql: string): Promise<T[]> {
    const t = PARAMETROS_LEGADO.find((x) => sql.includes(` FROM ${x.tabela}`));
    if (!t) return [];
    const linha: Record<string, unknown> = {};
    for (const [c, tipo] of Object.entries(t.declaradas))
      linha[c] = tipo.tipo === 'letra' ? tipo.falso : tipo.tipo === 'hora' ? '2359' : 7;
    return [linha as T];
  },
  async lerBlob() {
    return Buffer.alloc(0);
  },
} as unknown as Leitor;

describe.skipIf(codigos.length === 0)('parâmetros do legado (regra 7)', () => {
  const nucleo = codigos.length > 0 ? criarNucleo() : null;
  const cod = codigos[0] ?? 'pc';
  beforeAll(async () => {
    await nucleo?.verificarSchema(cod);
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('pc ao vivo: declaradas interpretadas, não declaradas sem valor, credenciais ocultas', async () => {
    const p = await nucleo!.lerSomente({ rede: nucleo!.rede, hospital: cod, traceId: 'int-m08' }, (l) =>
      painelParametrosLegado(l, 'SGH.SEM.LINHA'),
    );
    const por = (s: string) => p.filter((x) => x.situacao === s);
    // REPARAM e PRPARAM (linha única) interpretados; GEPARAM sem a linha do login sintético: não interpretado.
    expect(por('interpretada').length + por('fora-do-declarado').length).toBe(24);
    expect(por('nao-interpretada').every((x) => x.valor === null && x.bruto === null)).toBe(true);
    expect(por('oculta').every((x) => x.valor === null && x.bruto === null)).toBe(true);
    expect(p.find((x) => x.campo === 'SENHAALTPLAN')?.situacao).toBe('oculta');
    expect(p.find((x) => x.campo === 'CPF_RESP')?.situacao).toBe('oculta');
    expect(p.find((x) => x.campo === 'HORA1')?.valor).toMatch(/^\d{2}:\d{2}$/);
    expect(p.filter((x) => x.grupo === 'estoque' && x.situacao === 'interpretada')).toEqual([]);
    console.log(
      `[${cod}] parâmetros do legado: ${p.length} colunas; interpretadas ${por('interpretada').length}, fora do declarado ${por('fora-do-declarado').length}, não interpretadas ${por('nao-interpretada').length}, ocultas ${por('oculta').length}`,
    );
  });

  it('cada banco devolve os seus valores (o do estabelecimento da sessão)', async () => {
    const real = await nucleo!.lerSomente({ rede: nucleo!.rede, hospital: cod, traceId: 'int-m08' }, (l) =>
      painelParametrosLegado(l, 'SGH.SEM.LINHA'),
    );
    const outro = await painelParametrosLegado(bancoSintetico, 'SGH.SEM.LINHA');
    const valor = (lista: typeof real, campo: string) => lista.find((x) => x.campo === campo)?.valor;
    expect(valor(outro, 'CHECKENF')).toBe('Não');
    expect(valor(outro, 'HORA1')).toBe('23:59');
    expect(valor(outro, 'RASTREAR')).toBe('Não');
    // Pelo menos uma letra declarada difere entre os bancos (o pc tem CHECKENF = T).
    expect(valor(real, 'CHECKENF')).not.toBe(valor(outro, 'CHECKENF'));
  });
});
