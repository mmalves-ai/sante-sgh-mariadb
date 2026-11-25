// F3.8, 07-FIN linha 108 (C2-007): contrato de efeito do lado das receitas da EFD-Contribuições e da guarda do arquivo
// entregue, contra o MariaDB real (massa SINTÉTICA "L0207", competência 2026-09; nenhuma pessoa nem nota real).
//   - A receita vem das notas de serviço autorizadas em produção; a de homologação e a cancelada ficam fora; a nota
//     que espera a autorização recusa a geração sem gravar nada.
//   - O arquivo gerado só com receitas traz o bloco A das notas e o M200/M210 e M600/M610; o resumo gravado leva a
//     receita e a contribuição a recolher; o texto vai à guarda e fica registrado em `arquivo` (hash, tamanho, imutável,
//     guarda legal de 5 anos), ligado ao arquivo da EFD.
//   - Depois da entrega, uma nota nova muda a receita: o entregue continua baixável pela guarda, com o hash dele; a
//     retificadora sai com a receita nova.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { armazemFinanceiroMemoria } from '../armazem.js';
import {
  hashDoArquivoEfd,
  type OperacaoEscrituracao,
  operacoesEscrituracao,
  painelEscrituracao,
  textoDoArquivoEfd,
} from '../escrituracao-efd-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-efdrec-${randomUUID()}` });
const PERIODO = '2026-09';
const COMPETENCIA = '2026-09-01';
const CNPJ = '92070000000199';
const TOMADOR_PJ = '92070000000280';

describe.skipIf(SEM_BANCO)(
  'EFD-Contribuições: receita das notas de serviço, contribuição apurada e guarda do arquivo entregue (MariaDB)',
  () => {
    let m: MassaFinanceiro;
    let pendente = 0;
    let municipio = 0;
    let motivo = 0;
    const armazem = armazemFinanceiroMemoria();
    const operacoes = operacoesEscrituracao(armazem);
    const consultar = (sql: string, p: unknown[]) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'efd-rec' }, (l) => l.consultar(sql, p));
    const executar = (nome: OperacaoEscrituracao, entrada: unknown) =>
      m.nucleo
        .criarExecutor()
        .executar(operacoes[nome] as never, CLIENTE, entrada, op(m.ctx(m.lanca)))
        .then((r) => r.resultado as Record<string, unknown>);
    const texto = (id: number) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'efd-rec' }, (l) =>
        textoDoArquivoEfd(l, m.est, id, armazem),
      );
    const gerar = (regime = 'nao_cumulativo') =>
      executar('financeiro.efdContribuicoesGerar', { periodo: PERIODO, regime });
    const nota = (
      rps: number,
      o: {
        valor: number;
        desconto?: number;
        situacao?: string;
        ambiente?: string;
        pj?: boolean;
        pis?: number;
        cofins?: number;
      },
    ) =>
      m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-efd-rec' }, (e) =>
        e.inserir(
          `INSERT INTO nota_servico (estabelecimento_id, numero_rps, serie_rps, numero_nota, ambiente, data_emissao,
             competencia, municipio_prestacao_id, tipo_tomador, tomador_nome, tomador_documento, discriminacao,
             valor_servicos, valor_desconto_incondicionado, base_calculo, valor_pis, valor_cofins, valor_liquido, situacao,
             cancelada_em, motivo_cancelamento_documento_fiscal_id, criado_em)
           VALUES (?, ?, 'RC', ?, ?, '2026-09-10 10:00:00', ?, ?, ?, 'TOMADOR SINTETICO L0207', ?,
             'SERVICOS HOSPITALARES SINTETICOS', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
          [
            m.est,
            rps,
            `L0207R${rps}`,
            o.ambiente ?? 'producao',
            COMPETENCIA,
            municipio,
            o.pj === false ? 'pessoa_fisica' : 'pessoa_juridica',
            o.pj === false ? '92070000017' : TOMADOR_PJ,
            o.valor,
            o.desconto ?? 0,
            o.valor - (o.desconto ?? 0),
            o.pis ?? 0,
            o.cofins ?? 0,
            o.valor,
            o.situacao ?? 'autorizada',
            // A cancelada leva a data e o motivo (ck_nota_servico_cancelamento).
            o.situacao === 'cancelada' ? '2026-09-11 10:00:00' : null,
            o.situacao === 'cancelada' ? motivo : null,
          ],
        ),
      );
    const limparProprio = () =>
      m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-efd-rec' }, async (e) => {
        const guardados = await e.consultar<{ arquivo_id: number | null }>(
          'SELECT arquivo_id FROM arquivo_efd_contribuicoes WHERE estabelecimento_id = ? AND competencia = ?',
          [m.est, COMPETENCIA],
        );
        await e.executar(
          'DELETE FROM arquivo_efd_contribuicoes WHERE estabelecimento_id = ? AND competencia = ? ORDER BY sequencia_envio DESC',
          [m.est, COMPETENCIA],
        );
        for (const g of guardados)
          if (g.arquivo_id) await e.executar('DELETE FROM arquivo WHERE id = ?', [g.arquivo_id]);
        await e.executar(
          "DELETE FROM nota_servico WHERE estabelecimento_id = ? AND numero_nota LIKE 'L0207R%'",
          [m.est],
        );
        await e.executar('UPDATE estabelecimento SET cnpj = NULL WHERE id = ? AND cnpj = ?', [m.est, CNPJ]);
        await e.executar("DELETE FROM motivo_cancelamento_documento_fiscal WHERE codigo = 'L0207-CANC'", []);
      });

    beforeAll(async () => {
      m = await montarMassa();
      await limparProprio();
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-efd-rec' }, async (e) => {
        municipio = Number(
          (await e.uma<{ id: number }>('SELECT id FROM municipio_ibge ORDER BY id LIMIT 1'))!.id,
        );
        await e.executar('UPDATE estabelecimento SET cnpj = ? WHERE id = ? AND cnpj IS NULL', [CNPJ, m.est]);
        motivo = await e.inserir(
          `INSERT INTO motivo_cancelamento_documento_fiscal (codigo, descricao, criado_em)
           VALUES ('L0207-CANC', 'MOTIVO SINTETICO L0207', NOW(3))`,
          [],
        );
      });
      // Receita: 10000 (PJ, retidos PIS 65 e COFINS 300) + 5000 com desconto de 1000 (PF) = base 14000.
      await nota(970001, { valor: 10000, pis: 65, cofins: 300 });
      await nota(970002, { valor: 5000, desconto: 1000, pj: false });
      // Fora da receita: a de homologação e a cancelada.
      await nota(970003, { valor: 777, ambiente: 'homologacao' });
      await nota(970004, { valor: 888, situacao: 'cancelada' });
      // Aguardando a autorização: impede a geração.
      pendente = await nota(970005, { valor: 999, situacao: 'rps_gerado' });
    }, 120_000);

    afterAll(async () => {
      if (!m) return;
      await limparProprio();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }, 120_000);

    it('a nota aguardando a autorização recusa a geração sem gravar; a receita aparece no painel por regime', async () => {
      expect(await codigoDaGravacao(gerar())).toBe('receita-pendente');
      const n = await consultar(
        'SELECT COUNT(*) AS n FROM arquivo_efd_contribuicoes WHERE estabelecimento_id = ? AND competencia = ?',
        [m.est, COMPETENCIA],
      );
      expect(Number(n[0]!['n'])).toBe(0);
      const p = await m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'efd-rec' }, (l) =>
        painelEscrituracao(l, m.est, PERIODO),
      );
      expect(p.receitas.naoCumulativo).toMatchObject({ notas: 2, aguardando: 1 });
      // 14000 x 1,65% = 231,00 - 65,00 retido = 166,00; 14000 x 7,6% = 1064,00 - 300,00 = 764,00.
      expect(p.receitas.naoCumulativo.pis).toMatchObject({
        receitaBruta: 15000,
        base: 14000,
        apurada: 231,
        aRecolher: 166,
      });
      expect(p.receitas.naoCumulativo.cofins).toMatchObject({ apurada: 1064, aRecolher: 764 });
      // Cumulativo: 14000 x 0,65% = 91,00 - 65,00 = 26,00; 14000 x 3% = 420,00 - 300,00 = 120,00.
      expect(p.receitas.cumulativo.pis).toMatchObject({
        codigoContribuicao: '51',
        apurada: 91,
        aRecolher: 26,
      });
      expect(p.receitas.cumulativo.cofins).toMatchObject({ apurada: 420, aRecolher: 120 });
    }, 120_000);

    it('gera só com a receita: bloco A das notas, M200/M210 e M600/M610; o texto vai à guarda e fica em arquivo', async () => {
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-efd-rec' }, (e) =>
        e.executar("UPDATE nota_servico SET situacao = 'rejeitada' WHERE id = ?", [pendente]),
      );
      const r = await gerar();
      expect(r).toMatchObject({
        finalidade: 'original',
        igual: false,
        notas: 2,
        receita: 15000,
        pisRecolher: 166,
        cofinsRecolher: 764,
      });
      const id = Number(r['arquivo']);
      const [arq] = await consultar(
        'SELECT hash_sha256, arquivo_id, mensagem_validacao FROM arquivo_efd_contribuicoes WHERE id = ?',
        [id],
      );
      expect(String(arq!['mensagem_validacao'])).toContain(
        'notas=2; receita=15000.00; pis_apurado=231.00; pis_recolher=166.00; cofins_apurado=1064.00; cofins_recolher=764.00',
      );
      expect(arq!['arquivo_id']).not.toBeNull();
      const [g] = await consultar(
        `SELECT entidade, entidade_id, finalidade, tipo_mime, tamanho_bytes, hash_sha256, chave_armazenamento,
                retencao_ate >= DATE_ADD(CURDATE(), INTERVAL 5 YEAR) - INTERVAL 1 DAY AS cinco_anos
           FROM arquivo WHERE id = ?`,
        [arq!['arquivo_id']],
      );
      expect(g).toMatchObject({
        entidade: 'arquivo_efd_contribuicoes',
        finalidade: 'efd_contribuicoes',
        tipo_mime: 'text/plain',
        hash_sha256: arq!['hash_sha256'],
      });
      expect(Number(g!['entidade_id'])).toBe(id);
      expect(Number(g!['cinco_anos'])).toBe(1);
      const guardado = armazem.objetos.get(String(g!['chave_armazenamento']));
      expect(guardado).toBeDefined();
      expect(Number(g!['tamanho_bytes'])).toBe(guardado!.length);
      expect(hashDoArquivoEfd(new TextDecoder().decode(guardado))).toBe(arq!['hash_sha256']);
      const t = await texto(id);
      if (t === null || t === 'desatualizado') throw new Error('texto indisponível');
      const ls = t.conteudo.trimEnd().split('\r\n');
      // Duas notas de saída no bloco A (a de homologação e a cancelada não vão); o tomador pessoa física sem participante.
      const saidas = ls.filter((l) => l.startsWith('|A100|1|'));
      expect(saidas.length).toBe(2);
      expect(saidas.filter((l) => l.startsWith(`|A100|1|0|${TOMADOR_PJ}|`)).length).toBe(1);
      expect(saidas.filter((l) => l.startsWith('|A100|1|0||')).length).toBe(1);
      expect(ls.find((l) => l.startsWith('|M200|'))).toBe(
        '|M200|231,00|0,00|0,00|231,00|65,00|0,00|166,00|0,00|0,00|0,00|0,00|166,00|',
      );
      expect(ls.find((l) => l.startsWith('|M210|'))).toContain('|01|15000,00|14000,00|');
      expect(ls.find((l) => l.startsWith('|M600|'))).toContain(
        '|1064,00|0,00|0,00|1064,00|300,00|0,00|764,00|',
      );
      expect(ls.at(-1)).toBe(`|9999|${ls.length}|`);
    }, 120_000);

    it('depois da entrega, a nota nova muda a receita: o entregue continua baixável pela guarda; a retificadora traz a receita nova', async () => {
      const [orig] = await consultar(
        "SELECT id, hash_sha256 FROM arquivo_efd_contribuicoes WHERE estabelecimento_id = ? AND competencia = ? AND situacao = 'gerado'",
        [m.est, COMPETENCIA],
      );
      const original = Number(orig!['id']);
      await executar('financeiro.efdContribuicoesRegistrarEntrega', {
        arquivo: original,
        recibo: 'REC-SINT-R001',
      });
      await nota(970006, { valor: 2000 });
      const t = await texto(original);
      if (t === null || t === 'desatualizado') throw new Error('o entregue deixou de ser baixável');
      expect(t.guardado).toBe(true);
      expect(hashDoArquivoEfd(t.conteudo)).toBe(orig!['hash_sha256']);
      expect(t.conteudo).toContain('|M210|01|15000,00|14000,00|');

      const r = await gerar();
      expect(r).toMatchObject({ sequencia: 2, finalidade: 'retificadora', notas: 3, receita: 17000 });
      const t2 = await texto(Number(r['arquivo']));
      if (t2 === null || t2 === 'desatualizado') throw new Error('retificadora indisponível');
      expect(t2.conteudo.split('\r\n')[0]).toContain('|0000|006|1||REC-SINT-R001|');
      // 16000 x 1,65% = 264,00.
      expect(t2.conteudo).toContain('|M210|01|17000,00|16000,00|0,00|0,00|16000,00|1,6500|||264,00|');
      const guardas = await consultar(
        `SELECT COUNT(*) AS n FROM arquivo a JOIN arquivo_efd_contribuicoes x ON x.arquivo_id = a.id
          WHERE x.estabelecimento_id = ? AND x.competencia = ?`,
        [m.est, COMPETENCIA],
      );
      expect(Number(guardas[0]!['n'])).toBe(2);
    }, 120_000);
  },
);
