// Integração do complemento D da porta própria da gestão da qualidade (modulos-proprios-2, qualidade-d) contra o
// MariaDB do cliente de teste do lote (SGH_CLIENTE_TESTE). Só dados sintéticos: as consultas rodam contra o DDL real
// (colunas, junções e filtros), a versão anterior entra pela trilha de uma gravação da própria gestão (como a correção
// grava) e o protocolo gerenciado sintético é do estabelecimento da massa.
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaGestaoPropriaCompleta } from './gestao-porta-propria-completa.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import { LeiturasGestaoComplementoD } from './porta-propria-complemento-d.js';

describe.skipIf(SEM_BANCO_QUA)(
  `complemento D da gestão da qualidade no banco próprio (${CLIENTE_QUA})`,
  () => {
    let m: MassaQualidade;
    let leituras: LeiturasGestaoComplementoD;
    let c: ReturnType<typeof ctxBanco>;
    let cOutro: ReturnType<typeof ctxBanco>;
    const codigoProtocolo = `SINT-QD-${randomInt(1_000_000, 9_999_999)}`;
    let protocolo = 0;
    let versaoProtocolo = 0;

    beforeAll(async () => {
      m = await prepararMassaQualidade('D');
      leituras = new LeiturasGestaoComplementoD(m.nucleo);
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
      cOutro = ctxBanco(m.outro, m.codigoOutro, m.usuario);
      await m.nucleo.escrever(
        { cliente: CLIENTE_QUA, correlacao: 'preparo-teste-qualidade-d' },
        async (e) => {
          const agora = new Date();
          protocolo = await e.inserir(
            `INSERT INTO protocolo_gerenciado (estabelecimento_id, codigo, nome, tipo, criado_em)
             VALUES (?, ?, 'Protocolo sintético QD', 'sepse', ?)`,
            [m.est, codigoProtocolo, agora],
          );
          versaoProtocolo = await e.inserir(
            `INSERT INTO protocolo_gerenciado_versao (protocolo_gerenciado_id, operacao, dados, ocorrido_em,
               numero_versao, vigencia_inicio, motivo, usuario_id, criado_em)
             VALUES (?, 'inclusao', ?, ?, 1, ?, 'Publicação sintética', ?, ?)`,
            [protocolo, JSON.stringify({ criterios: [] }), agora, agora, m.usuario, agora],
          );
        },
      );
    }, 60_000);

    afterAll(async () => {
      // A versão publicada é histórico (só de acréscimo no produto); a limpeza do teste tenta tirar o sintético e,
      // se o privilégio recusar, a linha fica no estabelecimento da massa (codigo SINT-QD-*), sem afetar outros testes.
      if (m && protocolo)
        await m.nucleo
          .escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-teste-qualidade-d' }, async (e) => {
            await e.executar('DELETE FROM protocolo_gerenciado_versao WHERE protocolo_gerenciado_id = ?', [
              protocolo,
            ]);
            await e.executar('DELETE FROM protocolo_gerenciado WHERE id = ?', [protocolo]);
          })
          .catch(() => undefined);
      await encerrarMassaQualidade(m);
    });

    it('pesquisas: a consulta roda no DDL real; período sem resposta devolve vazio sem corte, id inexistente é nulo', async () => {
      expect(await leituras.pesquisas(c, '2026-01-01', '2026-01-31')).toEqual({ itens: [], cortada: false });
      expect(await leituras.pesquisa(c, 999_999_999)).toBeNull();
    });

    it('versões: a versão anterior gravada na trilha da operação volta pela tabela e id, só no estabelecimento', async () => {
      const porta = new PortaGestaoPropriaCompleta(m.nucleo);
      const id = randomInt(900_000_000, 999_999_999);
      const va = {
        tabela: 'nao_conformidade_qualidade',
        id,
        versao: 1,
        acao: 'correcao',
        motivo: 'Correção sintética',
        dados: { titulo: 'Título sintético anterior' },
      };
      const t: TrilhaDaGravacao = {
        estabelecimento: null,
        usuario: null,
        acao: 'operacao',
        entidade: 'nao_conformidade_qualidade',
        entidadeId: id,
        correlacao: 'teste-qualidade-d-versoes',
        dadosDepois: { versaoAnterior: va },
      };
      await porta.gravarSgh(c, t, () => Promise.resolve(null));
      const vs = await leituras.versoes(c, 'nao_conformidade_qualidade', id);
      expect(vs).toHaveLength(1);
      expect(vs[0]).toMatchObject({
        versao: 1,
        acao: 'correcao',
        motivo: 'Correção sintética',
        alteradoPor: m.login,
        dados: { titulo: 'Título sintético anterior' },
      });
      expect(vs[0]?.alteradoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      expect(await leituras.versoes(cOutro, 'nao_conformidade_qualidade', id)).toEqual([]);
      expect(await leituras.versoes(c, 'auditoria_interna', id)).toEqual([]);
    });

    it('protocolos gerenciados: a versão publicada do estabelecimento aparece com a impressão; a do outro não', async () => {
      const r = await leituras.protocolosGerenciados(c, '2026-01-01T00:00:00', '2026-02-01T00:00:00');
      const v = r.versoes.find((x) => x.id === versaoProtocolo);
      expect(v).toMatchObject({
        versao: 1,
        nome: 'Protocolo sintético QD',
        notas: 'Publicação sintética',
        autor: m.login,
      });
      expect(v?.impressao).toMatch(/^[0-9a-f]{64}$/);
      expect(r.protocolos).toEqual([]);
      const outro = await leituras.protocolosGerenciados(
        cOutro,
        '2026-01-01T00:00:00',
        '2026-02-01T00:00:00',
      );
      expect(outro.versoes.some((x) => x.id === versaoProtocolo)).toBe(false);
    });
  },
);
