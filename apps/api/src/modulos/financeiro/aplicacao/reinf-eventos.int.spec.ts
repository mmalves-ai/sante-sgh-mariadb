// F3.8, 07-FIN linha 111: contrato de efeito da EFD-REINF por evento contra o MariaDB real (massa SINTÉTICA "L0207";
// nenhuma pessoa real). O processo com suspensão grava o tributo e o beneficiário (migração 14_FIN/98); a geração da
// R-4000 sai com um evento por beneficiário (R-4010 da pessoa física, R-4020 da jurídica), o valor do tributo com
// processo como suspenso e o item do processo; repetir não gera outro; a transmissão ao simulador abre o lote com
// protocolo; o retorno grava o recibo (aceito) ou as ocorrências (rejeitado) e fecha o lote; o aceito que mudou volta
// como retificador ligado ao original (XML com o recibo dele); o rejeitado sem correção é apontado; o beneficiário que
// saiu da competência: o rejeitado fica cancelado e o aceito ganha o R-9000 ligado a ele. Nada é apagado. O outro
// estabelecimento não vê nada.
// Correção da revisão (24/11): a série R-2000 fica no banco (R-2010 com o INSS retido ou suspenso e o item do
// processo, sem tocar os eventos da R-4000); o título com retenção cujo credor não tem CPF nem CNPJ é contado e
// avisado; a suspensão é encerrada (vale até o dia) ou anulada (nunca vale) sem apagar, e incluir outra suspensão não
// muda a vigência nem a vara do processo (isso é operação própria); e as rotas do controlador de verdade, com o banco
// e com os mesmos corpos que a tela manda, devolvem as mensagens e o painel campo a campo.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { partesDaPermissao } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { ErroProblema } from '../../../problema.filter.js';
import { desligarMapaEstabelecimentos, ligarMapaEstabelecimentos } from '../../cadastro/contexto-nucleo.js';
import { ReinfEventosController } from '../reinf-eventos.controller.js';
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
const CPF_MEDICO = '92070000025';
const PROCESSO = '0001234-56.2026.4.01.3400';

/** O que a rota respondeu: a mensagem, ou o status e o código do problema. */
async function resposta(p: () => unknown): Promise<string> {
  try {
    const r = (await p()) as { mensagem?: string };
    return r.mensagem ?? 'ok';
  } catch (e) {
    if (!(e instanceof ErroProblema)) throw e;
    return `${e.getStatus()}:${String(e.extras['codigo'] ?? e.tipo)}`;
  }
}

describe.skipIf(SEM_BANCO)(
  'EFD-REINF por evento: processo, geração, envio, retorno, retificação e exclusão (MariaDB)',
  () => {
    let m: MassaFinanceiro;
    let ir = 0;
    let csll = 0;
    let inss = 0;
    let pf = 0;
    let semDoc = 0;
    let medico = 0;
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
    const titulo = (
      credor: number | { profissional: number },
      doc: string,
      bruto: number,
      retencoes: [number, number][],
    ) =>
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
          `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id, profissional_id, tipo_documento_financeiro_id,
           numero_documento, data_emissao, data_lancamento, valor_bruto, valor_retencoes, valor_liquido, natureza_financeira_id,
           referente, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-05', '2026-10-05', ?, ?, ?, ?, 'SERVICO SINTETICO', 'aberto', ?)`,
          [
            m.est,
            `L0207-${doc}`,
            tc,
            typeof credor === 'number' ? credor : null,
            typeof credor === 'number' ? null : credor.profissional,
            td,
            doc,
            bruto,
            retido,
            bruto - retido,
            n,
            agora,
          ],
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
      ({ ir, csll, inss, pf, semDoc, medico } = await m.nucleo.escrever(
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
            inss: await tributo('INSS-L0207R'),
            // Profissional de saúde com CPF: o honorário com IR retido vai ao R-4010 pelo CPF dele.
            medico: await g(
              'SELECT pr.id FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE pf.cpf = ?',
              [CPF_MEDICO],
              "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
              [
                await g(
                  'SELECT id FROM pessoa_fisica WHERE cpf = ?',
                  [CPF_MEDICO],
                  "INSERT INTO pessoa_fisica (nome, cpf, criado_em) VALUES ('MEDICO SINTETICO L0207 REINF', ?, ?)",
                  [CPF_MEDICO, agora],
                ),
                agora,
              ],
            ),
            // Credor sem CPF no cadastro (o profissional de saúde da massa): a retenção dele não cabe em evento nenhum.
            semDoc: Number(
              (
                await e.uma<{ id: number }>(
                  "SELECT pr.id FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE pf.nome = 'MEDICO SINTETICO L0207' AND pf.cpf IS NULL",
                  [],
                )
              )?.id ?? 0,
            ),
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
      desligarMapaEstabelecimentos();
      if (!m) return;
      await limparProprio();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    });

    it('processo com suspensão: grava tributo e beneficiário; a mesma suspensão repetida é recusada', async () => {
      const proc = {
        tipo: 'judicial',
        numero: PROCESSO,
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

      // Outra suspensão do mesmo processo não muda a vigência nem a vara dele: com dado diferente é recusada (a
      // alteração é operação própria); com os mesmos dados entra, e a linha do processo fica como estava.
      const processo = () =>
        consultar(
          "SELECT versao, codigo_vara, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio, vigencia_fim FROM processo_tributario WHERE id = ?",
          [r['processo']],
        ).then((x) => x[0]);
      const antes = await processo();
      const outra = { ...proc, tributo: 'inss' };
      expect(
        await codigoDaGravacao(
          executar('financeiro.reinfManterProcesso', {
            ...outra,
            vigenciaInicio: '2026-03-01',
            vara: '0009',
          }),
        ),
      ).toBe('processo-dados-divergentes');
      const r2 = await executar('financeiro.reinfManterProcesso', outra);
      expect(r2['processo']).toBe(r['processo']);
      expect(await processo()).toEqual(antes);
      expect(antes).toMatchObject({ codigo_vara: '0001', inicio: '2026-01-01', vigencia_fim: null });
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

    it('R-2000: R-2010 com o INSS suspenso pelo processo, sem tocar a R-4000; sem documento avisado; suspensão encerrada e anulada sem apagar', async () => {
      const outros = () =>
        consultar(
          "SELECT id, situacao, versao FROM evento_reinf WHERE estabelecimento_id = ? AND codigo_evento <> 'R-2010' ORDER BY id",
          [m.est],
        );
      const antes = await outros();
      expect(antes.length).toBe(4);
      await titulo(m.fornecedor, 'L0207RF5', 800, [[inss, 88]]);
      expect(semDoc).toBeGreaterThan(0);
      const tSem = await titulo({ profissional: semDoc }, 'L0207RF6', 100, [[ir, 11]]);
      const r2010 = () =>
        consultar(
          `SELECT e.id, e.situacao, i.tipo_item, i.beneficiario_documento, i.valor_bruto, i.valor_inss, i.valor_irrf,
                  i.valor_suspenso
             FROM evento_reinf e JOIN evento_reinf_item i ON i.evento_reinf_id = e.id AND i.sequencia = 1
            WHERE e.estabelecimento_id = ? AND e.codigo_evento = 'R-2010' ORDER BY e.id`,
          [m.est],
        ).then((ls) =>
          ls.map((l) => ({
            id: Number(l['id']),
            situacao: String(l['situacao']),
            tipo: String(l['tipo_item']),
            beneficiario: String(l['beneficiario_documento']),
            bruto: Number(l['valor_bruto']),
            inss: Number(l['valor_inss']),
            irrf: Number(l['valor_irrf']),
            suspenso: Number(l['valor_suspenso']),
          })),
        );

      // O processo (suspensão de INSS do prestador, incluída no primeiro teste) suspende a retenção: R-2010 com o
      // suspenso e o item do processo. O título do profissional sem CPF no cadastro fica fora e é contado, com o id.
      const g1 = await executar('financeiro.reinfGerarEventos', { serie: 'R-2000', periodo: PERIODO });
      expect(g1).toMatchObject({ quantidadeGerados: 1, semDocumento: 1, titulosSemDocumento: String(tSem) });
      const [e1] = await r2010();
      expect(e1).toMatchObject({
        situacao: 'gerado',
        tipo: 'servico_tomado',
        beneficiario: CNPJ_PJ,
        bruto: 800,
        inss: 0,
        irrf: 0,
        suspenso: 88,
      });
      const [item] = await consultar(
        "SELECT processo_tributario_id, valor_suspenso FROM evento_reinf_item WHERE evento_reinf_id = ? AND tipo_item = 'processo_judicial'",
        [e1!.id],
      );
      expect(Number(item?.['processo_tributario_id'])).toBeGreaterThan(0);
      expect(Number(item?.['valor_suspenso'])).toBe(88);
      // Gerar a R-2000 não cancela nem altera os eventos da R-4000 da mesma competência.
      expect(await outros()).toEqual(antes);
      const p = await painel(m.est);
      expect(p.titulosSemDocumento).toEqual([tSem]);

      // A liminar caiu em setembro: a suspensão é encerrada (vale até o dia), sem apagar a linha. Na competência de
      // outubro o INSS volta a ser retido: o gerado é trocado (fica cancelado) pelo novo com o valor retido.
      const sus = p.processos.find((x) => x.tributo === 'inss')!;
      expect(sus).toMatchObject({ anulada: false, encerradaEm: null, vigenciaFim: null });
      const encerrar = (fim: string | null, motivo = 'LIMINAR CASSADA SINTETICA', est?: number) =>
        executar('financeiro.reinfEncerrarSuspensao', { suspensao: sus.suspensao, fim, motivo }, est);
      expect(await codigoDaGravacao(encerrar('2025-12-31'))).toBe('fim-antes-do-inicio');
      expect(await codigoDaGravacao(encerrar('2026-09-30', 'x'))).toBe('motivo-obrigatorio');
      expect(await codigoDaGravacao(encerrar('2026-09-30', undefined, m.outroEst))).toBe(
        'suspensao-inexistente',
      );
      expect(await encerrar('2026-09-30')).toMatchObject({ situacao: 'encerrada' });
      expect(await codigoDaGravacao(encerrar('2026-09-30'))).toBe('suspensao-ja-encerrada');
      const suspensoes = () =>
        consultar(
          `SELECT s.id, s.tributo, DATE_FORMAT(s.encerrada_em, '%Y-%m-%d') AS fim, s.anulada, s.motivo_encerramento
             FROM suspensao_processo_tributario s JOIN processo_tributario p ON p.id = s.processo_tributario_id
            WHERE p.estabelecimento_id = ? ORDER BY s.id`,
          [m.est],
        );
      let linhas = await suspensoes();
      expect(linhas.length).toBe(2);
      expect(linhas.find((l) => Number(l['id']) === sus.suspensao)).toMatchObject({
        fim: '2026-09-30',
        motivo_encerramento: 'LIMINAR CASSADA SINTETICA',
      });
      expect((await painel(m.est)).processos.find((x) => x.suspensao === sus.suspensao)).toMatchObject({
        encerradaEm: '2026-09-30',
        vigenciaFim: '2026-09-30',
        vigenciaFimProcesso: null,
      });
      const g2 = await executar('financeiro.reinfGerarEventos', { serie: 'R-2000', periodo: PERIODO });
      expect(g2).toMatchObject({ quantidadeGerados: 1, cancelados: 1 });
      let evs = await r2010();
      expect(evs.map((e) => e.situacao)).toEqual(['cancelado', 'gerado']);
      expect(evs[1]).toMatchObject({ inss: 88, suspenso: 0, irrf: 0 });

      // A encerrada não impede lançar de novo a mesma suspensão; a lançada por engano é anulada e nunca vale: a
      // geração seguinte não muda nada. As três linhas continuam no banco.
      const de = {
        tipo: 'judicial',
        numero: PROCESSO,
        vara: '0001',
        indicativo: '01',
        tributo: 'inss',
        beneficiario: CNPJ_PJ,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        dataDecisao: '2026-10-02',
      };
      const nova = Number((await executar('financeiro.reinfManterProcesso', de))['suspensao']);
      expect(
        await executar('financeiro.reinfEncerrarSuspensao', {
          suspensao: nova,
          fim: null,
          motivo: 'LANCADA POR ENGANO SINTETICA',
        }),
      ).toMatchObject({ situacao: 'anulada' });
      linhas = await suspensoes();
      expect(linhas.length).toBe(3);
      expect(linhas.find((l) => Number(l['id']) === nova)).toMatchObject({ fim: null, anulada: 1 });
      const g3 = await executar('financeiro.reinfGerarEventos', { serie: 'R-2000', periodo: PERIODO });
      expect(g3).toMatchObject({ gerados: '', iguais: 1, cancelados: 0 });
      evs = await r2010();
      expect(evs.length).toBe(2);

      // Os dados do processo mudam só pela operação própria, conferida, e valem para as suspensões em vigor.
      const processo = sus.processo;
      const alterar = (x: Record<string, unknown>, est?: number) =>
        executar(
          'financeiro.reinfAlterarProcesso',
          { processo, vara: '0002', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31', ...x },
          est,
        );
      expect(await codigoDaGravacao(alterar({ vigenciaFim: '2025-12-31' }))).toBe('vigencia-invalida');
      expect(await codigoDaGravacao(alterar({ vara: null }))).toBe('vara-obrigatoria');
      expect(await codigoDaGravacao(alterar({}, m.outroEst))).toBe('processo-inexistente');
      expect(await alterar({})).toMatchObject({ processo, suspensoes: 1 });
      const [pr] = await consultar(
        "SELECT codigo_vara, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim FROM processo_tributario WHERE id = ?",
        [processo],
      );
      expect(pr).toMatchObject({ codigo_vara: '0002', fim: '2026-12-31' });
      expect(await outros()).toEqual(antes);
    });

    it('as rotas do controlador, com o banco e com os corpos que a tela manda: mensagens, painel campo a campo e recusas', async () => {
      const [est] = await consultar('SELECT codigo FROM estabelecimento WHERE id = ?', [m.est]);
      const [usu] = await consultar('SELECT login FROM usuario WHERE id = ?', [m.lanca]);
      desligarMapaEstabelecimentos();
      await ligarMapaEstabelecimentos(CLIENTE, m.nucleo);
      const rotas = new ReinfEventosController(m.nucleo);
      const partes = ['financeiro.reinf.ler', 'financeiro.reinf.gerar'].map(partesDaPermissao);
      const req = (estabelecimentoAtivo: unknown = est?.['codigo']): RequisicaoAutorizada =>
        ({
          headers: { 'idempotency-key': `t0207-reinf-rotas-${randomUUID()}` },
          ip: '127.0.0.1',
          sgh: {
            sessao: {
              estabelecimentoAtivo,
              rede: '',
              unidadeAtiva: null,
              usuario: { id: String(m.lanca), login: usu?.['login'] },
            },
            ability: {
              can: (acao: string, sujeito: string) =>
                partes.some((x) => x.acao === acao && x.sujeito === sujeito),
            },
          },
        }) as unknown as RequisicaoAutorizada;

      // A permissão e a auditoria declaradas em cada rota (o guarda lê estes metadados).
      const meta = (chave: string, metodo: keyof ReinfEventosController) =>
        Reflect.getMetadata(chave, ReinfEventosController.prototype[metodo] as object) as string | undefined;
      for (const leitura of ['painel', 'xml'] as const)
        expect(meta(CHAVE_PERMISSAO, leitura)).toBe('financeiro.reinf.ler');
      for (const gravacao of [
        'processo',
        'alterarProcesso',
        'encerrarSuspensao',
        'gerar',
        'transmitir',
        'retorno',
      ] as const) {
        expect(meta(CHAVE_PERMISSAO, gravacao)).toBe('financeiro.reinf.gerar');
        expect(String(meta(CHAVE_AUDITADO_NO_HANDLER, gravacao) ?? '')).not.toBe('');
      }

      // POST processos: o corpo da tela (os nove campos, o fim da vigência nulo).
      const processoDaTela = {
        tipo: 'judicial',
        numero: '00076543220264013400',
        vara: '0012',
        indicativo: '01',
        tributo: 'ir',
        beneficiario: CPF,
        vigenciaInicio: '2026-10-01',
        vigenciaFim: null,
        dataDecisao: '2026-10-01',
      };
      expect(await resposta(() => rotas.processo(processoDaTela, req()))).toBe(
        'Processo com suspensão gravado.',
      );
      expect(await resposta(() => rotas.processo(processoDaTela, req()))).toBe('409:suspensao-repetida');

      // POST gerar: { serie, periodo }. A pessoa física tem título novo com IR, suspenso pelo processo dela; o título
      // sem documento da competência é avisado na mensagem.
      // O honorário do profissional com CPF entra pelo CPF dele (R-4010), como o do fornecedor pessoa física.
      await titulo(pf, 'L0207RF7', 600, [[ir, 9]]);
      await titulo({ profissional: medico }, 'L0207RF8', 300, [[ir, 4.5]]);
      expect(await resposta(() => rotas.gerar({ serie: 'R-4000', periodo: PERIODO }, req()))).toMatch(
        /^2 evento\(s\) gerado\(s\), 0 exclusão\(ões\), 0 igual\(is\) ao já enviado\. Atenção: 1 título\(s\) com retenção ficaram fora, sem CPF ou CNPJ do beneficiário no cadastro\.$/,
      );
      expect(await resposta(() => rotas.gerar({ serie: 'R-4000', periodo: PERIODO }, req()))).toMatch(
        /^0 evento\(s\) gerado\(s\), 0 exclusão\(ões\), 2 igual\(is\) ao já enviado\./,
      );

      // GET painel: o formato que a tela lê (api-reinf.ts), campo a campo.
      const p = (await rotas.painel(PERIODO, req())) as Awaited<ReturnType<typeof painelReinf>>;
      expect(Object.keys(p).sort()).toEqual(['eventos', 'periodo', 'processos', 'titulosSemDocumento']);
      expect(p.periodo).toBe(PERIODO);
      expect(p.titulosSemDocumento.length).toBe(1);
      const novo = p.eventos.find((e) => e.beneficiario === CPF && e.situacao === 'gerado')!;
      expect(novo).toEqual({
        id: expect.any(Number),
        evento: 'R-4010',
        acao: 'inclusao',
        situacao: 'gerado',
        recibo: null,
        retifica: null,
        beneficiario: CPF,
        valorBruto: 600,
        valorRetido: 0,
        valorSuspenso: 9,
        documentos: 1,
        processos: 1,
        retornos: 0,
        lote: null,
        protocolo: null,
        enviadoEm: null,
        processadoEm: null,
        mensagem: null,
      });
      expect(p.eventos.find((e) => e.beneficiario === CPF_MEDICO)).toMatchObject({
        evento: 'R-4010',
        situacao: 'gerado',
        valorBruto: 300,
        valorRetido: 4.5,
        valorSuspenso: 0,
        processos: 0,
      });
      const doCpf = p.processos.find((x) => x.beneficiario === CPF)!;
      expect(doCpf).toEqual({
        id: expect.any(Number),
        processo: doCpf.id,
        suspensao: expect.any(Number),
        tipo: 'judicial',
        numero: '00076543220264013400',
        indicativo: '01',
        tributo: 'ir',
        beneficiario: CPF,
        vigenciaInicio: '2026-10-01',
        vigenciaFim: null,
        vigenciaFimProcesso: null,
        situacao: 'ativo',
        vara: '0012',
        codigo: expect.any(String),
        dataDecisao: '2026-10-01',
        encerradaEm: null,
        anulada: false,
        motivoEncerramento: null,
      });

      // GET xml, POST transmitir ({ periodo, eventos }) e POST retorno (aceito com recibo; rejeitado com ocorrências).
      const x = await rotas.xml(String(novo.id), req());
      expect(x.xml).toContain('<vlrSusp>9.00</vlrSusp>');
      expect(await resposta(() => rotas.xml('0', req()))).toBe('400:entrada-invalida');
      const r2010 = p.eventos.find((e) => e.evento === 'R-2010' && e.situacao === 'gerado')!;
      expect(
        await resposta(() => rotas.transmitir({ periodo: PERIODO, eventos: [novo.id, r2010.id] }, req())),
      ).toMatch(/^Lote \d+ transmitido ao simulador \(protocolo SIM-\d+-\d+\)\.$/);
      expect(await resposta(() => rotas.transmitir({ periodo: PERIODO, eventos: [novo.id] }, req()))).toBe(
        '409:evento-nao-transmissivel',
      );
      expect(
        await resposta(() =>
          rotas.retorno(
            { evento: novo.id, aceito: true, recibo: '1.2.0000000000000000001', ocorrencias: null },
            req(),
          ),
        ),
      ).toBe('Evento aceito, recibo registrado.');
      expect(
        await resposta(() =>
          rotas.retorno(
            {
              evento: r2010.id,
              aceito: false,
              recibo: null,
              ocorrencias: 'Natureza do rendimento incompatível',
            },
            req(),
          ),
        ),
      ).toBe('Evento rejeitado, ocorrências registradas.');
      const depois = (await rotas.painel(PERIODO, req())) as Awaited<ReturnType<typeof painelReinf>>;
      expect(depois.eventos.find((e) => e.id === novo.id)).toMatchObject({
        situacao: 'aceito',
        recibo: '1.2.0000000000000000001',
        retornos: 1,
        lote: expect.any(Number),
        protocolo: expect.stringMatching(/^SIM-/),
        enviadoEm: expect.any(String),
        processadoEm: expect.any(String),
      });
      expect(depois.eventos.find((e) => e.id === r2010.id)).toMatchObject({
        situacao: 'rejeitado',
        mensagem: 'Natureza do rendimento incompatível',
        retornos: 1,
      });

      // POST processos/alterar e POST suspensoes/encerrar, com os corpos da tela.
      expect(
        await resposta(() =>
          rotas.alterarProcesso(
            { processo: doCpf.id, vara: '0013', vigenciaInicio: '2026-10-01', vigenciaFim: '2026-12-31' },
            req(),
          ),
        ),
      ).toBe('Processo alterado: vale para 1 suspensão(ões) em vigor.');
      expect(
        await resposta(() =>
          rotas.encerrarSuspensao(
            { suspensao: doCpf.suspensao, fim: '2026-10-31', motivo: 'Liminar cassada' },
            req(),
          ),
        ),
      ).toBe('Suspensão encerrada: gere de novo os eventos das competências seguintes.');
      expect(
        await resposta(() =>
          rotas.encerrarSuspensao({ suspensao: doCpf.suspensao, fim: null, motivo: 'Engano' }, req()),
        ),
      ).toBe('409:suspensao-ja-encerrada');
      // A trilha da suspensão encerrada fica na mesma transação (quem e quando), e a linha continua no banco.
      const [trilha] = await consultar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'suspensao_processo_tributario' AND entidade_id = ? AND usuario_id = ?",
        [doCpf.suspensao, m.lanca],
      );
      expect(Number(trilha?.['n'])).toBeGreaterThan(0);

      // O esquema é estrito contra o corpo: campo a mais ou série desconhecida não grava. Competência inválida: 400.
      // Estabelecimento que o cliente não tem: 409. Sem o banco do cliente: 503.
      expect(
        await resposta(() => rotas.gerar({ serie: 'R-4000', periodo: PERIODO, extra: 1 }, req())),
      ).toMatch(/^4(00|22):/);
      expect(await resposta(() => rotas.gerar({ serie: 'R-1000', periodo: PERIODO }, req()))).toMatch(
        /^4(00|22):/,
      );
      expect(await resposta(() => rotas.painel('2026-13', req()))).toBe('400:entrada-invalida');
      expect(await resposta(() => rotas.painel(PERIODO, req('L0207-NAO-EXISTE')))).toBe(
        '409:entrada-invalida',
      );
      const semBanco = new ReinfEventosController(null);
      expect(await resposta(() => semBanco.painel(PERIODO, req()))).toBe('503:indisponivel');
      expect(await resposta(() => semBanco.gerar({ serie: 'R-4000', periodo: PERIODO }, req()))).toBe(
        '503:indisponivel',
      );
    });
  },
);
