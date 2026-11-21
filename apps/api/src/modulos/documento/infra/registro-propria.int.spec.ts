// Integração do registro das emissões contra o MariaDB real (cliente f22_o2). Massa SINTÉTICA com o código "L0206"
// (nenhuma pessoa real). Contrato de efeito: a reserva grava a linha 'reservada' (sem versão do objeto), a trilha e a
// idempotência; a confirmação passa a 'emitida' uma vez, com a versão do objeto e a versao da linha; a via repetida do
// mesmo original vira ErroViaOcupada; a validação pública (QR) só vê a confirmada. A mesma bateria roda na memória.
// Enquanto o pedido de DDL do lote 02-06 (emissao_documento) não entra em db/migracoes, a parte do banco é pulada
// (nada de criar nem derrubar tabela no banco compartilhado); a memória roda sempre. O registro do banco é montado por
// requisição, com o contexto da sessão (estabelecimento e usuário), e a leitura de outro estabelecimento não vê nada.
// SGH_NUCLEO_SEM_BANCO=1 pula a parte do banco.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type EmissaoDocumento, ErroEmissao, ErroViaOcupada } from '@sgh/dominio-documento';
import { type ContextoNucleo, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RegistroEmissoes, RegistroEmissoesMemoria } from './registro.js';
import { RegistroEmissoesPropria, registroEmissoesDaRequisicao } from './registro-propria.js';

const CLIENTE = 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l0206';

/** A tabela emissao_documento já está nas migrações (o pedido de DDL do lote 02-06 entrou)? */
function tabelaNaMigracao(): boolean {
  const raiz = resolve(import.meta.dirname, '../../../../../../db/migracoes');
  const arquivos = (pasta: string): string[] =>
    readdirSync(pasta, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? arquivos(join(pasta, d.name)) : d.name.endsWith('.sql') ? [join(pasta, d.name)] : [],
    );
  return arquivos(raiz).some((f) => /CREATE TABLE emissao_documento \(/.test(readFileSync(f, 'utf8')));
}
const SEM_TABELA = !tabelaNaMigracao();
/** Usuário sintético só deste arquivo (removido no fim, com os dois estabelecimentos). */
const LOGIN = 'l0206d.teste';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

const emissao = (x: Partial<EmissaoDocumento> = {}): EmissaoDocumento => {
  const id = randomUUID();
  return {
    id,
    rede: 'rede-teste',
    estabelecimento: P,
    modelo: 'prova',
    versaoModelo: '1',
    origem: { tipo: 'sintetico', idLegado: 4242 },
    via: 1,
    idOriginal: null,
    motivoReemissao: null,
    sha256: 'a'.repeat(64),
    chaveObjeto: `k-${id}`,
    identificadorQr: `q-${id.slice(0, 8)}`,
    autor: 'l0206.teste',
    emitidoEm: '2026-11-21T10:00:00.000Z',
    versaoS3: null,
    ...x,
  };
};

/** A bateria comum: reserva invisível até a confirmação única; via repetida recusada. */
async function bateria(r: RegistroEmissoes): Promise<void> {
  const o = emissao();
  await r.reservar(o);
  expect(await r.porId(o.id)).toBeNull();
  expect(await r.porQr(o.identificadorQr)).toBeNull();
  expect(await r.doOriginal(o.id)).toHaveLength(1);
  expect((await r.confirmar(o.id, 'v1')).versaoS3).toBe('v1');
  expect(await r.porQr(o.identificadorQr)).toMatchObject({ id: o.id, versaoS3: 'v1', via: 1, autor: 'l0206.teste' });
  await expect(r.confirmar(o.id, 'v2')).rejects.toBeInstanceOf(ErroEmissao);
  await expect(r.reservar({ ...o, versaoS3: 'v9' })).rejects.toThrow(/sem versão/);
  const via2 = emissao({ via: 2, idOriginal: o.id, motivoReemissao: 'Extravio' });
  await r.reservar(via2);
  await expect(r.reservar(emissao({ via: 2, idOriginal: o.id, motivoReemissao: 'Extravio' }))).rejects.toBeInstanceOf(
    ErroViaOcupada,
  );
  await r.reservar(emissao({ via: 3, idOriginal: o.id, motivoReemissao: 'Extravio' }));
  expect((await r.doOriginal(o.id)).map((x) => x.via).sort()).toEqual([1, 2, 3]);
  await r.confirmar(via2.id, 'v2');
  expect((await r.daOrigem('sintetico', 4242)).some((x) => x.id === via2.id)).toBe(true);
  // A mesma chave do objeto não entra duas vezes (o registro é só de inclusão).
  await expect(r.reservar(emissao({ chaveObjeto: o.chaveObjeto }))).rejects.toThrow(/repetida/i);
}

describe('registro das emissões em memória', () => {
  it('memória: reserva invisível até a confirmação única; via repetida recusada', () => bateria(new RegistroEmissoesMemoria()));
});

describe.skipIf(SEM_BANCO || SEM_TABELA)('registro das emissões no banco (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  const ids = { est: 0, outroEst: 0, usuario: 0 };
  let ctx: ContextoNucleo;

  const limpar = async (e: Escritor) => {
    for (const est of [ids.est, ids.outroEst]) {
      if (!est) continue;
      // As reemissões (via > 1) antes do original (FK auto-referente e ck_emissao_documento_via).
      await e.executar('DELETE FROM emissao_documento WHERE estabelecimento_id = ? AND via > 1', [est]);
      await e.executar('DELETE FROM emissao_documento WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM idempotencia_operacao WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM integracao_mensagem WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM trilha_auditoria WHERE estabelecimento_id = ?', [est]);
    }
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o2');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-06' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P.toUpperCase());
      ids.outroEst = await est(`${P.toUpperCase()}D`);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        [LOGIN, 'USUARIO SINTETICO L0206D', agora],
      );
      await limpar(e);
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'teste-02-06-doc' };
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-06' }, async (e) => {
      await limpar(e);
      await e.executar('DELETE FROM estabelecimento WHERE id IN (?, ?)', [ids.est, ids.outroEst]);
      await e.executar('DELETE FROM usuario WHERE id = ?', [ids.usuario]);
    });
    await nucleo.encerrar();
  });

  it('banco: reserva invisível até a confirmação única; via repetida recusada', () =>
    bateria(registroEmissoesDaRequisicao(nucleo)(ctx)));

  it('banco: contrato de efeito (linha, versao, trilha com o usuário), outro estabelecimento e original inexistente', async () => {
    const r = new RegistroEmissoesPropria(nucleo, ctx);
    const o = emissao();
    const inicio = new Date(Date.now() - 1000);
    await r.reservar(o);
    const ler = (sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-06' }, (l) => l.uma(sql, p));
    const antes = await ler('SELECT id, situacao, versao, versao_objeto, estabelecimento_id, autor_usuario_id FROM emissao_documento WHERE codigo = ?', [o.id]);
    expect(antes).toMatchObject({ situacao: 'reservada', versao: 1, versao_objeto: null });
    expect(Number(antes!['estabelecimento_id'])).toBe(ids.est);
    expect(Number(antes!['autor_usuario_id'])).toBe(ids.usuario);
    await r.confirmar(o.id, 'v-objeto-1');
    const depois = await ler('SELECT situacao, versao, versao_objeto FROM emissao_documento WHERE codigo = ?', [o.id]);
    expect(depois).toMatchObject({ situacao: 'emitida', versao: 2, versao_objeto: 'v-objeto-1' });
    const trilha = await ler(
      `SELECT COUNT(*) AS n, MIN(usuario_id) AS u FROM trilha_auditoria
        WHERE entidade = 'emissao_documento' AND entidade_id = ? AND estabelecimento_id = ? AND ocorrido_em >= ?`,
      [antes!['id'], ids.est, inicio],
    );
    expect(Number(trilha!['n'])).toBe(2);
    expect(Number(trilha!['u'])).toBe(ids.usuario);
    // Outro estabelecimento: as leituras internas não veem a emissão; a validação pública pelo QR vê.
    const outro = new RegistroEmissoesPropria(nucleo, { ...ctx, estabelecimento: ids.outroEst });
    expect(await outro.porId(o.id)).toBeNull();
    expect(await outro.doOriginal(o.id)).toEqual([]);
    expect(await outro.daOrigem('sintetico', 4242)).toEqual([]);
    expect(await outro.porQr(o.identificadorQr)).toMatchObject({ id: o.id });
    await expect(outro.reservar(emissao({ via: 2, idOriginal: o.id, motivoReemissao: 'Extravio' }))).rejects.toThrow(
      /original/i,
    );
    await expect(r.reservar(emissao({ via: 2, idOriginal: randomUUID(), motivoReemissao: 'Extravio' }))).rejects.toThrow(
      /original/i,
    );
    // Sem estabelecimento na sessão, a emissão é recusada.
    await expect(new RegistroEmissoesPropria(nucleo, { ...ctx, estabelecimento: null }).reservar(emissao())).rejects.toThrow(
      /estabelecimento/i,
    );
  });
});
