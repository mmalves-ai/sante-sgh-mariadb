// F3.8, 07-FIN linha 111: contrato de efeito da EFD-REINF por evento contra o MariaDB real (massa SINTÉTICA "L0207";
// nenhuma pessoa real). O processo com suspensão grava o tributo e o beneficiário (migração 14_FIN/98); a geração da
// R-4000 sai com um evento por beneficiário (R-4010 da pessoa física, R-4020 da jurídica), o valor do tributo com
// processo como suspenso e o item do processo; repetir não gera outro; a transmissão ao simulador abre o lote com
// protocolo; o retorno grava o recibo (aceito) ou as ocorrências (rejeitado) e fecha o lote; o aceito que mudou volta
// como retificador ligado ao original (XML com o recibo dele); o rejeitado sem correção é apontado; o beneficiário que
// saiu da competência: o rejeitado fica cancelado e o aceito ganha o R-9000 ligado a ele. Nada é apagado. O outro
// estabelecimento não vê nada.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERACOES_REINF, painelReinf, xmlDoEventoReinf } from '../reinf-eventos-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-reinf-${randomUUID()}` });
const PERIODO = '2026-10';
const ids = (v: unknown): number[] =>
  String(v ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);
const CPF = '92070000017';
const CNPJ_PJ = '92070000000107';

describe.skipIf(SEM_BANCO)(
  'EFD-REINF por evento: processo, geração, envio, retorno, retificação e exclusão (MariaDB)',
  () => {
    let m: MassaFinanceiro;
    let ir = 0;
    let csll = 0;
    let pf = 0;
    let tituloPj = 0;
    let tituloPf = 0;
    const consultar = (sql: string, p: unknown[]) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'reinf-111' }, (l) => l.consultar(sql, p));
    const executar = (nome: keyof typeof OPERACOES_REINF, entrada: unknown, est?: number) =>
      m.nucleo
        .criarExecutor()
        .executar(OPERACOES_REINF[nome] as never, CLIENTE, entrada, op(m.ctx(m.lanca, est)))
        .then((r) => r.resultado as Record<string, unknown>);
    const painel = (est: number) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'reinf-111' }, (l) => painelReinf(l, est, PERIODO));
    const limparProprio = () =>
      m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-reinf-111' }, async (e) => {
        const q = '?, ?';
        const ests = [m.est, m.outroEst];
        await e.executar(
          `DELETE r FROM retorno_reinf r JOIN evento_reinf v ON v.id = r.evento_reinf_id WHERE v.estabelecimento_id IN (${q})`,
          ests,
        );
        await e.executar(
          `DELETE i FROM evento_reinf_item i JOIN evento_reinf v ON v.id = i.evento_reinf_id WHERE v.estabelecimento_id IN (${q})`,
          ests,
        );
        await e.executar(
          `UPDATE evento_reinf SET retificado_evento_reinf_id = NULL, lote_reinf_id = NULL WHERE estabelecimento_id IN (${q})`,
          ests,
        );
        await e.executar(`DELETE FROM evento_reinf WHERE estabelecimento_id IN (${q})`, ests);
        await e.executar(`DELETE FROM lote_reinf WHERE estabelecimento_id IN (${q})`, ests);
        await e.executar(
          `DELETE s FROM suspensao_processo_tributario s JOIN processo_tributario p ON p.id = s.processo_tributario_id WHERE p.estabelecimento_id IN (${q})`,
          ests,
        );
        await e.executar(`DELETE FROM processo_tributario WHERE estabelecimento_id IN (${q})`, ests);
        await e.executar(
          `DELETE FROM sequencia_negocio WHERE tipo = 'lote_reinf' AND estabelecimento_id IN (${q})`,
          ests,
        );
      });

    /** Título com uma parcela e as retenções da competência (tributo, valor). */
    const titulo = (credor: number, doc: string, bruto: number, retencoes: [number, number][]) =>
      m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-reinf-111' }, async (e) => {
        const agora = new Date();
        const n = Number(
          (await e.uma<{ id: number }>("SELECT id FROM natureza_financeira WHERE codigo = '9207.1.1'", []))
            ?.id,
        );
        const tc = Number(
          (await e.uma<{ id: number }>("SELECT id FROM tipo_credor WHERE codigo = 'fornecedor'", []))?.id,
        );
        const td = Number(
          (await e.uma<{ id: number }>('SELECT id FROM tipo_documento_financeiro ORDER BY id LIMIT 1', []))
            ?.id,
        );
        const retido = retencoes.reduce((s, [, v]) => s + v, 0);
        const t = await e.inserir(
          `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id, tipo_documento_financeiro_id,
           numero_documento, data_emissao, data_lancamento, valor_bruto, valor_retencoes, valor_liquido, natureza_financeira_id,
           referente, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, '2026-10-05', '2026-10-05', ?, ?, ?, ?, 'SERVICO SINTETICO', 'aberto', ?)`,
          [m.est, `L0207-${doc}`, tc, credor, td, doc, bruto, retido, bruto - retido, n, agora],
        );
        const p = await e.inserir(
          `INSERT INTO parcela_pagar (titulo_pagar_id, sequencia, vencimento, vencimento_original, valor, saldo, valor_pago,
           situacao, criado_em) VALUES (?, 1, '2026-10-30', '2026-10-30', ?, ?, 0, 'aberta', ?)`,
          [t, bruto - retido, bruto - retido, agora],
        );
        let seq = 0;
        for (const [tributo, v] of retencoes)
          await e.inserir(
            `INSERT INTO retencao_titulo (parcela_pagar_id, sequencia, tributo_id, competencia, data_fato_gerador, base_calculo,
             aliquota, valor_retido, criado_em) VALUES (?, ?, ?, '2026-10-01', '2026-10-05', ?, 1.5, ?, ?)`,
            [p, ++seq, tributo, bruto, v, agora],
          );
        return t;
      });
    const cancelarTitulo = (t: number) =>
      m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-reinf-111' }, (e) =>
        e.executar(
          "UPDATE titulo_pagar SET situacao = 'cancelado', cancelado_em = NOW(3), motivo_cancelamento = 'CANCELAMENTO SINTETICO' WHERE id = ?",
          [t],
        ),
      );

    beforeAll(async () => {
      m = await montarMassa();
      await limparProprio();
      ({ ir, csll, pf } = await m.nucleo.escrever(
        { cliente: CLIENTE, correlacao: 'preparo-reinf-111' },
        async (e) => {
          const agora = new Date();
          const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) =>
            Number((await e.uma<{ id: number }>(sel, p))?.id ?? 0) || e.inserir(ins, pi);
          const tributo = (codigo: string) =>
            g(
              'SELECT id FROM tributo WHERE codigo = ?',
              [codigo],
              "INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em) VALUES (?, ?, 'federal', 'por_pagamento', 'retido', ?)",
              [codigo, `${codigo} SINTETICO`, agora],
            );
          // CNPJ sintético do estabelecimento (a REINF exige a inscrição).
          await e.executar(
            "UPDATE estabelecimento SET cnpj = '92070000000191' WHERE id = ? AND cnpj IS NULL",
            [m.est],
          );
          return {
            ir: await tributo('IRRF-L0207R'),
            csll: await tributo('CSLL-L0207R'),
            pf: await g(
              'SELECT id FROM empresa_fornecedora WHERE cpf = ?',
              [CPF],
              "INSERT INTO empresa_fornecedora (tipo_pessoa, cpf, razao_social, criado_em) VALUES ('fisica', ?, 'PRESTADOR SINTETICO L0207', ?)",
              [CPF, agora],
            ),
          };
        },
      ));
      tituloPj = await titulo(m.fornecedor, 'L0207RF1', 1000, [
        [ir, 15],
        [csll, 10],
      ]);
      tituloPf = await titulo(pf, 'L0207RF2', 500, [[ir, 7.5]]);
    });

    afterAll(async () => {
      if (!m) return;
      await limparProprio();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    });

    it('processo com suspensão: grava tributo e beneficiário; a mesma suspensão repetida é recusada', async () => {
      const proc = {
        tipo: 'judicial',
        numero: '0001234-56.2026.4.01.3400',
        vara: '0001',
        indicativo: '01',
        tributo: 'csrf',
        beneficiario: CNPJ_PJ,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        dataDecisao: '2026-01-10',
      };
      const r = await executar('financeiro.reinfManterProcesso', proc);
      expect(r['processo']).toBeGreaterThan(0);
      expect(await codigoDaGravacao(executar('financeiro.reinfManterProcesso', proc))).toBe(
        'suspensao-repetida',
      );
      expect(
        await codigoDaGravacao(
          executar('financeiro.reinfManterProcesso', { ...proc, numero: '123', tributo: 'ir' }),
        ),
      ).toBe('numero-processo');
      const [s] = await consultar(
        'SELECT s.tributo, s.beneficiario_documento, p.numero_processo FROM suspensao_processo_tributario s JOIN processo_tributario p ON p.id = s.processo_tributario_id WHERE p.estabelecimento_id = ?',
        [m.est],
      );
      expect(s).toMatchObject({
        tributo: 'csrf',
        beneficiario_documento: CNPJ_PJ,
        numero_processo: '00012345620264013400',
      });
    });

    it('gera, transmite, registra o retorno, retifica o aceito e exclui o que saiu da competência', async () => {
      const g1 = await executar('financeiro.reinfGerarEventos', { serie: 'R-4000', periodo: PERIODO });
      expect(ids(g1['gerados']).length).toBe(2);
      let p = await painel(m.est);
      const pj = p.eventos.find((e) => e.beneficiario === CNPJ_PJ)!;
      const pfe = p.eventos.find((e) => e.beneficiario === CPF)!;
      expect(pj).toMatchObject({
        evento: 'R-4020',
        situacao: 'gerado',
        valorBruto: 1000,
        valorRetido: 15,
        valorSuspenso: 10,
        processos: 1,
      });
      expect(pfe).toMatchObject({
        evento: 'R-4010',
        situacao: 'gerado',
        valorBruto: 500,
        valorRetido: 7.5,
        valorSuspenso: 0,
      });
      const [item] = await consultar(
        "SELECT processo_tributario_id, valor_suspenso FROM evento_reinf_item WHERE evento_reinf_id = ? AND tipo_item = 'processo_judicial'",
        [pj.id],
      );
      expect(Number(item?.['processo_tributario_id'])).toBeGreaterThan(0);
      expect(Number(item?.['valor_suspenso'])).toBe(10);
      // Repetir com o mesmo conteúdo não gera outro.
      const g2 = await executar('financeiro.reinfGerarEventos', { serie: 'R-4000', periodo: PERIODO });
      expect(g2).toMatchObject({ gerados: '', iguais: 2 });

      // Transmissão ao simulador: lote com protocolo; o já enviado não vai de novo.
      const t = await executar('financeiro.reinfTransmitir', { periodo: PERIODO, eventos: [pj.id, pfe.id] });
      expect(String(t['protocolo'])).toMatch(/^SIM-/);
      expect(
        await codigoDaGravacao(
          executar('financeiro.reinfTransmitir', { periodo: PERIODO, eventos: [pj.id] }),
        ),
      ).toBe('evento-nao-transmissivel');
      const g3 = await executar('financeiro.reinfGerarEventos', { serie: 'R-4000', periodo: PERIODO });
      expect(g3['aguardando']).toBe([CNPJ_PJ, CPF].sort().join(','));

      // Retorno: aceito com recibo; rejeitado com ocorrências; sem recibo é recusado.
      expect(
        await codigoDaGravacao(
          executar('financeiro.reinfRegistrarRetorno', {
            evento: pj.id,
            aceito: true,
            recibo: null,
            ocorrencias: null,
          }),
        ),
      ).toBe('recibo-obrigatorio');
      await executar('financeiro.reinfRegistrarRetorno', {
        evento: pj.id,
        aceito: true,
        recibo: '1.2.0000000001',
        ocorrencias: null,
      });
      await executar('financeiro.reinfRegistrarRetorno', {
        evento: pfe.id,
        aceito: false,
        recibo: null,
        ocorrencias: 'MS1234 CAMPO INVALIDO',
      });
      const [lote] = await consultar(
        'SELECT situacao, quantidade_eventos, protocolo FROM lote_reinf WHERE estabelecimento_id = ?',
        [m.est],
      );
      expect(lote).toMatchObject({ situacao: 'processado_com_erro', quantidade_eventos: 2 });
      const ret = await consultar(
        'SELECT r.situacao, r.numero_recibo FROM retorno_reinf r JOIN evento_reinf e ON e.id = r.evento_reinf_id WHERE e.estabelecimento_id = ? ORDER BY r.id',
        [m.est],
      );
      expect(ret.map((r) => r['situacao'])).toEqual(['sucesso', 'erro']);

      // O PJ mudou (mais IR): retificador ligado ao aceito, com o recibo dele no XML; o PF rejeitado igual é apontado.
      await titulo(m.fornecedor, 'L0207RF3', 200, [[ir, 3]]);
      const g4 = await executar('financeiro.reinfGerarEventos', { serie: 'R-4000', periodo: PERIODO });
      expect(g4).toMatchObject({ retificadores: 1, rejeitadosSemCorrecao: String(pfe.id) });
      const retif = ids(g4['gerados'])[0]!;
      const [rv] = await consultar(
        'SELECT acao, retificado_evento_reinf_id, situacao FROM evento_reinf WHERE id = ?',
        [retif],
      );
      expect(rv).toMatchObject({ acao: 'retificacao', situacao: 'gerado' });
      expect(Number(rv?.['retificado_evento_reinf_id'])).toBe(pj.id);
      const xml = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'reinf-111' }, (l) =>
        xmlDoEventoReinf(l, m.est, retif),
      );
      expect(xml).toContain('<indRetif>2</indRetif><nrRecibo>1.2.0000000001</nrRecibo>');
      expect(xml).toContain('<vlrSusp>10.00</vlrSusp>');

      // Os dois saem da competência: o PF rejeitado fica cancelado; o PJ ganha o R-9000 do aceito e o retificador
      // gerado fica cancelado. Nada é apagado.
      await cancelarTitulo(tituloPf);
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-reinf-111' }, (e) =>
        e.executar(
          "UPDATE titulo_pagar SET situacao = 'cancelado', cancelado_em = NOW(3), motivo_cancelamento = 'CANCELAMENTO SINTETICO' WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ?",
          [m.est, m.fornecedor],
        ),
      );
      expect(tituloPj).toBeGreaterThan(0);
      const g5 = await executar('financeiro.reinfGerarEventos', { serie: 'R-4000', periodo: PERIODO });
      expect(ids(g5['exclusoes']).length).toBe(1);
      expect(g5['cancelados']).toBe(2);
      p = await painel(m.est);
      const porId = new Map(p.eventos.map((e) => [e.id, e]));
      expect(porId.get(pfe.id)?.situacao).toBe('cancelado');
      expect(porId.get(retif)?.situacao).toBe('cancelado');
      expect(porId.get(pj.id)?.situacao).toBe('aceito');
      const exc = porId.get(ids(g5['exclusoes'])[0]!)!;
      expect(exc).toMatchObject({ evento: 'R-9000', retifica: pj.id, situacao: 'gerado' });
      const xmlExc = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'reinf-111' }, (l) =>
        xmlDoEventoReinf(l, m.est, exc.id),
      );
      expect(xmlExc).toContain('<tpEvento>R-4020</tpEvento><nrRecEvt>1.2.0000000001</nrRecEvt>');
      // Repetir não gera outro R-9000 (o gerado encerra a cadeia).
      const g6 = await executar('financeiro.reinfGerarEventos', { serie: 'R-4000', periodo: PERIODO });
      expect(g6).toMatchObject({ gerados: '', exclusoes: '', cancelados: 0 });
      expect(p.eventos.length).toBe(4);

      // O outro estabelecimento não vê nada; o evento dele não é transmitido daqui.
      expect((await painel(m.outroEst)).eventos).toEqual([]);
      expect(
        await codigoDaGravacao(
          executar('financeiro.reinfTransmitir', { periodo: PERIODO, eventos: [exc.id] }, m.outroEst),
        ),
      ).toBe('evento-inexistente');
    });
  },
);
