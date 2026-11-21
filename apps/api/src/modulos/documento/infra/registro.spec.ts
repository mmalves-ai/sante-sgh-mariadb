// Registro das emissões: reserva, confirmação única e unicidade (original, via) como no banco; tamanhos das colunas
// de emissao_documento (db/migracoes, ou o DDL proposto do lote 02-06 enquanto não entra) iguais aos segmentos da chave
// do objeto (LIMITES_CHAVE).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type EmissaoDocumento, ErroViaOcupada, LIMITES_CHAVE } from '@sgh/dominio-documento';
import { RegistroEmissoesMemoria } from './registro.js';
import { DDL_EMISSAO_DOCUMENTO } from './registro-propria.js';

/** O CREATE TABLE de emissao_documento nas migrações; enquanto o pedido não entra, o DDL proposto. */
function ddlEmissao(): string {
  const raiz = resolve(import.meta.dirname, '../../../../../../db/migracoes');
  const arquivos = (pasta: string): string[] =>
    readdirSync(pasta, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? arquivos(join(pasta, d.name)) : d.name.endsWith('.sql') ? [join(pasta, d.name)] : [],
    );
  for (const f of arquivos(raiz)) {
    const m = /CREATE TABLE emissao_documento \([\s\S]*?\n\)[^;]*;/.exec(readFileSync(f, 'utf8'));
    if (m) return m[0];
  }
  return DDL_EMISSAO_DOCUMENTO;
}

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

  it('colunas de emissao_documento do tamanho dos segmentos da chave; sem DEFAULT de hora local', () => {
    const sql = ddlEmissao();
    const tamanho = (coluna: string) =>
      Number(new RegExp(`\\n\\s*${coluna}\\s+VARCHAR\\((\\d+)\\)`).exec(sql)?.[1]);
    expect(tamanho('rede')).toBe(LIMITES_CHAVE.rede);
    expect(tamanho('estabelecimento_codigo')).toBe(LIMITES_CHAVE.estabelecimento);
    expect(tamanho('modelo')).toBe(LIMITES_CHAVE.modelo);
    expect(tamanho('versao_objeto')).toBe(100);
    expect(sql).not.toMatch(/DEFAULT\s+CURRENT_TIMESTAMP/i);
  });
});
