// Contrato de efeito dos documentos controlados no banco próprio (fatia F3.9-Q1): publicar, substituir, ciência e
// retirada contra o MariaDB do cliente de teste (SGH_CLIENTE_TESTE). Só dados sintéticos no estabelecimento da massa
// 'DQ'. Prova o que fica no banco: a ficha do código apontando a revisão vigente, a revisão anterior obsoleta com o
// texto e o resumo SHA-256 da publicação (nunca apagada), a retirada com motivo, instante e conta, a ciência uma por
// pessoa, e que o outro estabelecimento não alcança nada.
import { createHash, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { GravadorGestao } from './porta-gestao.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import { PortaGestaoPropria } from './porta-gestao-propria.js';
import { LeiturasGestaoComplementoQ2 } from './porta-propria-complemento-q2.js';
import { gravacoesDocumentos, TABELAS_DOCUMENTOS } from './porta-propria-documentos.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'documento_qualidade',
  entidadeId: null,
  correlacao: 'teste-qualidade-documentos',
};
const NUM = randomInt(100_000_000, 999_999_999);
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ErroOperacao) return `${e.problema.status}:${e.problema.codigo}`;
    throw e;
  }
}

describe.skipIf(SEM_BANCO_QUA)(
  `documentos controlados da qualidade no banco próprio (${CLIENTE_QUA})`,
  () => {
    let m: MassaQualidade;
    let leituras: LeiturasGestaoComplementoQ2;
    let c: ReturnType<typeof ctxBanco>;
    let cOutro: ReturnType<typeof ctxBanco>;
    let setorNome = '';
    const tipo = `tdq${NUM}`;
    const codigo = `POP-DQ-${NUM}`;
    const ids = { tipo: 0, v1: 0, v2: 0 };

    const gravar = <R>(ctx: ReturnType<typeof ctxBanco>, fn: (g: GravadorGestao) => Promise<R>) =>
      gravacaoDireta(m.nucleo.criarExecutor(), ctx, {
        nome: 'qualidade.gestao',
        tabelas: TABELAS_DOCUMENTOS,
        trilha: T,
        gravador: (tx, est) => gravacoesDocumentos(tx, est) as unknown as GravadorGestao,
        fn,
      });
    const uma = (sql: string, p: unknown[]) =>
      m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'conferencia-documentos' }, (e) =>
        e.uma<Record<string, unknown>>(sql, p),
      );
    const nova = (revisao: number, conteudo: string, substitui: { id: number; versao: number } | null) => ({
      codigo,
      revisao,
      tipo,
      titulo: 'Higiene das mãos (sintético)',
      area: setorNome,
      conteudo,
      resumoAlteracao: revisao > 1 ? 'Ajuste do passo 3' : null,
      elaboradoPor: m.loginGestor,
      revisadoPor: null,
      vigenciaAte: '2027-11-10',
      exigeCiencia: true,
      hash: sha256(conteudo),
      substitui,
      agora: `2026-11-1${revisao}T08:00:00`,
      usuario: m.login,
    });

    beforeAll(async () => {
      m = await prepararMassaQualidade('DQ');
      leituras = new LeiturasGestaoComplementoQ2(m.nucleo);
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
      cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
      await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-documentos' }, async (e) => {
        setorNome = String(
          (await e.uma<{ nome: string }>('SELECT nome FROM setor_funcional WHERE id = ?', [m.setor]))?.nome,
        );
        ids.tipo = await e.inserir(
          "INSERT INTO tipo_documento_qualidade (codigo, descricao, categoria, criado_em) VALUES (?, 'TIPO SINT', 'procedimento_operacional', ?)",
          [tipo, new Date()],
        );
      });
    });

    afterAll(async () => {
      if (!m) return;
      await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-documentos' }, async (e) => {
        const ests = [m.est, m.outro];
        await e.executar(
          `DELETE c FROM documento_qualidade_ciencia c JOIN documento_qualidade_versao v ON v.id = c.documento_qualidade_versao_id
           JOIN documento_qualidade d ON d.id = v.documento_qualidade_id WHERE d.estabelecimento_id IN (?, ?)`,
          ests,
        );
        await e.executar(
          'UPDATE documento_qualidade SET documento_qualidade_versao_id = NULL WHERE estabelecimento_id IN (?, ?)',
          ests,
        );
        await e.executar(
          `DELETE v FROM documento_qualidade_versao v JOIN documento_qualidade d ON d.id = v.documento_qualidade_id
          WHERE d.estabelecimento_id IN (?, ?)`,
          ests,
        );
        await e.executar('DELETE FROM documento_qualidade WHERE estabelecimento_id IN (?, ?)', ests);
        await e.executar('DELETE FROM tipo_documento_qualidade WHERE id = ?', [ids.tipo]);
      });
      await encerrarMassaQualidade(m);
    });

    it('publica a primeira revisão: ficha do código apontando a revisão vigente, com o resumo fixado e os responsáveis', async () => {
      const texto1 = `Passo 1. Passo 2. Passo 3 (${NUM}).`;
      ids.v1 = (await gravar(c, (g) => g.publicarDocumento(nova(1, texto1, null)))).id;
      const f = await uma(
        `SELECT d.situacao, d.exige_ciencia, d.dono_usuario_id, d.documento_qualidade_versao_id, d.setor_funcional_id,
              DATE_FORMAT(d.proxima_revisao, '%Y-%m-%d') AS proxima, v.situacao AS sv, v.resumo_sha256, v.numero_versao,
              v.elaborador_usuario_id, v.aprovador_usuario_id, v.formato, v.publicado_em IS NOT NULL AS publicado
         FROM documento_qualidade d JOIN documento_qualidade_versao v ON v.documento_qualidade_id = d.id
        WHERE v.id = ?`,
        [ids.v1],
      );
      expect(f).toMatchObject({
        situacao: 'vigente',
        documento_qualidade_versao_id: ids.v1,
        setor_funcional_id: m.setor,
        dono_usuario_id: m.usuario,
        proxima: '2027-11-10',
        sv: 'vigente',
        resumo_sha256: sha256(texto1),
        numero_versao: '1',
        elaborador_usuario_id: m.gestor,
        aprovador_usuario_id: m.usuario,
        formato: 'texto',
      });
      expect(Number(f?.['exige_ciencia'])).toBe(1);
      const lido = await leituras.documento(c, ids.v1);
      expect(lido).toMatchObject({
        codigo,
        revisao: 1,
        situacao: 'vigente',
        hash: sha256(texto1),
        tipo,
        area: setorNome,
      });
      expect(await leituras.documento(cOutro, ids.v1)).toBeNull();
    });

    it('recusa a segunda vigente sem substituição, o número repetido e a referência solta, sem gravar nada', async () => {
      const antes = await uma(
        'SELECT COUNT(*) AS n FROM documento_qualidade_versao WHERE documento_qualidade_id = (SELECT documento_qualidade_id FROM documento_qualidade_versao WHERE id = ?)',
        [ids.v1],
      );
      expect(await codigoDe(gravar(c, (g) => g.publicarDocumento(nova(2, 'outro', null))))).toBe(
        '409:versao-desatualizada',
      );
      expect(
        await codigoDe(gravar(c, (g) => g.publicarDocumento(nova(1, 'outro', { id: ids.v1, versao: 1 })))),
      ).toBe('409:versao-desatualizada');
      expect(
        await codigoDe(
          gravar(c, (g) =>
            g.publicarDocumento({ ...nova(2, 'x', { id: ids.v1, versao: 1 }), area: `NADA ${NUM}` }),
          ),
        ),
      ).toMatch(/:area-inexistente$/);
      expect(
        await codigoDe(
          gravar(c, (g) =>
            g.publicarDocumento({ ...nova(2, 'x', { id: ids.v1, versao: 1 }), tipo: 'inexistente' }),
          ),
        ),
      ).toMatch(/:tipo-documento-inexistente$/);
      // O setor escolhido pelo id tem de ser deste estabelecimento: o da outra unidade recusa, mesmo com o nome certo.
      expect(
        await codigoDe(
          gravar(c, (g) =>
            g.publicarDocumento({ ...nova(2, 'x', { id: ids.v1, versao: 1 }), setorId: m.setorOutro }),
          ),
        ),
      ).toMatch(/:area-inexistente$/);
      const depois = await uma(
        'SELECT COUNT(*) AS n FROM documento_qualidade_versao WHERE documento_qualidade_id = (SELECT documento_qualidade_id FROM documento_qualidade_versao WHERE id = ?)',
        [ids.v1],
      );
      expect(Number(depois?.['n'])).toBe(Number(antes?.['n']));
    });

    it('a revisão nova substitui a vigente: a anterior fica obsoleta com o texto e o resumo dela (nunca apagada)', async () => {
      const texto2 = `Passo 1. Passo 2. Passo 3 revisado (${NUM}).`;
      ids.v2 = (await gravar(c, (g) => g.publicarDocumento(nova(2, texto2, { id: ids.v1, versao: 1 })))).id;
      const doCodigo = await leituras.documentosDoCodigo(c, codigo);
      expect(doCodigo.map((d) => [d.revisao, d.situacao])).toEqual(
        expect.arrayContaining([
          [1, 'obsoleto'],
          [2, 'vigente'],
        ]),
      );
      const v1 = await uma(
        'SELECT situacao, conteudo, resumo_sha256, vigencia_fim IS NOT NULL AS fim FROM documento_qualidade_versao WHERE id = ?',
        [ids.v1],
      );
      expect(v1).toMatchObject({
        situacao: 'obsoleta',
        resumo_sha256: sha256(`Passo 1. Passo 2. Passo 3 (${NUM}).`),
      });
      expect(String(v1?.['conteudo'])).toContain('Passo 3 (');
      const ficha = await uma(
        'SELECT documento_qualidade_versao_id AS v, situacao FROM documento_qualidade WHERE codigo = ? AND estabelecimento_id = ?',
        [codigo, m.est],
      );
      expect(ficha).toMatchObject({ v: ids.v2, situacao: 'vigente' });
      expect((await leituras.documento(c, ids.v2))?.resumoAlteracao).toBe('Ajuste do passo 3');
    });

    it('registra a ciência uma vez por pessoa, só na revisão vigente', async () => {
      const r = await gravar(c, (g) =>
        g.registrarCiencia({ documento: ids.v2, agora: '2026-11-12T09:00:00', usuario: m.login }),
      );
      const linha = await uma(
        'SELECT usuario_id, meio, ciencia_em IS NOT NULL AS em FROM documento_qualidade_ciencia WHERE id = ?',
        [r.id],
      );
      expect(linha).toMatchObject({ usuario_id: m.usuario, meio: 'sistema' });
      expect(
        await codigoDe(
          gravar(c, (g) =>
            g.registrarCiencia({ documento: ids.v2, agora: '2026-11-12T09:05:00', usuario: m.login }),
          ),
        ),
      ).toMatch(/:ciencia-ja-registrada$/);
      expect(
        await codigoDe(
          gravar(c, (g) =>
            g.registrarCiencia({ documento: ids.v1, agora: '2026-11-12T09:05:00', usuario: m.login }),
          ),
        ),
      ).toMatch(/:documento-nao-vigente$/);
      expect(
        await codigoDe(
          gravar(cOutro, (g) =>
            g.registrarCiencia({ documento: ids.v2, agora: '2026-11-12T09:05:00', usuario: m.loginGestor }),
          ),
        ),
      ).toMatch(/:documento-nao-vigente$/);
      expect((await leituras.cientes(c, ids.v2)).map((x) => x.usuario)).toEqual([m.login.toUpperCase()]);
      const mapa = await leituras.ciencias(c, [ids.v2], m.login);
      expect(mapa.get(ids.v2)).toMatchObject({ total: 1, sessao: true });
    });

    it('retira a revisão vigente com motivo, instante e conta; versão lida conferida; o outro estabelecimento não alcança', async () => {
      expect(
        await codigoDe(
          gravar(c, (g) =>
            g.retirarDocumento({
              id: ids.v2,
              versao: 9,
              motivo: 'x',
              agora: '2026-11-13T10:00:00',
              usuario: m.login,
            }),
          ),
        ),
      ).toBe('409:versao-desatualizada');
      expect(
        await codigoDe(
          gravar(cOutro, (g) =>
            g.retirarDocumento({
              id: ids.v2,
              versao: 1,
              motivo: 'x',
              agora: '2026-11-13T10:00:00',
              usuario: m.login,
            }),
          ),
        ),
      ).toBe('409:versao-desatualizada');
      const r = await gravar(c, (g) =>
        g.retirarDocumento({
          id: ids.v2,
          versao: 1,
          motivo: 'Substituído por protocolo da rede',
          agora: '2026-11-13T10:00:00',
          usuario: m.login,
        }),
      );
      expect(r.versao).toBe(2);
      const v2 = await uma(
        'SELECT situacao, motivo_retirada, retirada_por_usuario_id, retirada_em IS NOT NULL AS em, conteudo IS NOT NULL AS texto FROM documento_qualidade_versao WHERE id = ?',
        [ids.v2],
      );
      expect(v2).toMatchObject({
        situacao: 'cancelada',
        motivo_retirada: 'Substituído por protocolo da rede',
        retirada_por_usuario_id: m.usuario,
      });
      expect(Number(v2?.['texto'])).toBe(1);
      const ficha = await uma(
        'SELECT documento_qualidade_versao_id AS v, situacao FROM documento_qualidade WHERE codigo = ? AND estabelecimento_id = ?',
        [codigo, m.est],
      );
      expect(ficha).toMatchObject({ v: null, situacao: 'cancelado' });
      const lido = await leituras.documento(c, ids.v2);
      expect(lido).toMatchObject({
        situacao: 'retirado',
        motivoRetirada: 'Substituído por protocolo da rede',
      });
      expect(lido?.encerradoEm).toBeTruthy();
      expect(
        await codigoDe(
          gravar(c, (g) =>
            g.retirarDocumento({
              id: ids.v2,
              versao: 2,
              motivo: 'x',
              agora: '2026-11-13T10:00:00',
              usuario: m.login,
            }),
          ),
        ),
      ).toBe('409:versao-desatualizada');
    });

    it('a área escolhida pelo id do setor vence o texto: a ficha grava o setor do estabelecimento', async () => {
      const outroCodigo = `${codigo}S`.slice(0, 20);
      const r = await gravar(c, (g) =>
        g.publicarDocumento({
          ...nova(1, `Passo único (${NUM}).`, null),
          codigo: outroCodigo,
          area: 'Rótulo livre que não é nome de setor',
          setorId: m.setor,
        }),
      );
      expect(r.id).toBeGreaterThan(0);
      const ficha = await uma(
        'SELECT setor_funcional_id AS setor FROM documento_qualidade WHERE codigo = ? AND estabelecimento_id = ?',
        [outroCodigo, m.est],
      );
      expect(Number(ficha?.['setor'])).toBe(m.setor);
      const lista = await new PortaGestaoPropria(m.nucleo).setoresDaArea(c);
      expect(lista.some((x) => x.id === m.setor)).toBe(true);
      expect(lista.some((x) => x.id === m.setorOutro)).toBe(false);
    });
  },
);
