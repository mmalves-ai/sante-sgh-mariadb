// Registro das emissões: reserva, confirmação única e unicidade (ID_ORIGINAL, VIA) como no SQL; tamanhos das
// colunas do script 0101 iguais aos segmentos da chave do S3 (LIMITES_CHAVE).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type EmissaoDocumento, ErroViaOcupada, LIMITES_CHAVE } from '@sgh/dominio-documento';
import { RegistroEmissoesMemoria } from './registro.js';

const base: EmissaoDocumento = {
  id: '00000000-0000-4000-8000-000000000001',
  rede: 'rede-teste',
  estabelecimento: 'zz',
  modelo: 'prova',
  versaoModelo: '1',
  origem: { tipo: 'sintetico', idLegado: 1 },
  via: 1,
  idOriginal: null,
  motivoReemissao: null,
  sha256: 'a'.repeat(64),
  chaveObjeto: 'k1',
  identificadorQr: 'q1',
  autor: 'USUARIO_TESTE',
  emitidoEm: '2026-10-20T00:00:00.000Z',
  versaoS3: null,
};

describe('registro das emissões', () => {
  it('reserva não aparece como emissão até a confirmação, que acontece uma vez só', async () => {
    const r = new RegistroEmissoesMemoria();
    await r.reservar(base);
    expect(await r.porId(base.id)).toBeNull();
    expect(await r.porQr('q1')).toBeNull();
    expect(await r.doOriginal(base.id)).toHaveLength(1);
    expect((await r.confirmar(base.id, 'v1')).versaoS3).toBe('v1');
    expect(await r.porQr('q1')).toMatchObject({ versaoS3: 'v1' });
    await expect(r.confirmar(base.id, 'v2')).rejects.toThrow(/já confirmada/);
    await expect(r.reservar({ ...base, versaoS3: 'v9', id: 'x' })).rejects.toThrow(/sem versão/);
  });

  it('(ID_ORIGINAL, VIA) única: a segunda reserva da mesma via é ErroViaOcupada', async () => {
    const r = new RegistroEmissoesMemoria();
    const via2 = { ...base, via: 2, idOriginal: base.id, motivoReemissao: 'Extravio' };
    await r.reservar({ ...via2, id: 'a', chaveObjeto: 'ka', identificadorQr: 'qa' });
    await expect(
      r.reservar({ ...via2, id: 'b', chaveObjeto: 'kb', identificadorQr: 'qb' }),
    ).rejects.toBeInstanceOf(ErroViaOcupada);
    await r.reservar({ ...via2, via: 3, id: 'c', chaveObjeto: 'kc', identificadorQr: 'qc' });
  });

  it('colunas do script 0101 do tamanho dos segmentos da chave; sem DEFAULT de hora local', () => {
    const sql = readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../../../packages/legado/src/documento/sgh/0101_documento_emissao.sql',
      ),
      'utf8',
    );
    const tamanho = (coluna: string) =>
      Number(new RegExp(`\\n\\s*${coluna}\\s+VARCHAR\\((\\d+)\\)`).exec(sql)?.[1]);
    expect(tamanho('REDE')).toBe(LIMITES_CHAVE.rede);
    expect(tamanho('ESTABELECIMENTO')).toBe(LIMITES_CHAVE.estabelecimento);
    expect(tamanho('MODELO')).toBe(LIMITES_CHAVE.modelo);
    expect(tamanho('VERSAO_S3')).toBe(100);
    expect(sql).not.toMatch(/DEFAULT\s+CURRENT_TIMESTAMP/i);
  });
});
