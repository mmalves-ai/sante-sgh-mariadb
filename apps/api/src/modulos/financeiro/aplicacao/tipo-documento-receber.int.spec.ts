// F3.8, 07-FIN linha 99 (C1-044): contrato de efeito do tipo por perfil no título a receber, contra o MariaDB real
// (cliente f22_o2, massa SINTÉTICA "L0207"). O alvo da lista nesta operação é o tipo de documento financeiro a receber
// (fatura, nota, recibo).
// - Liberado ao perfil só um tipo de documento: o título a receber com o documento padrão é recusado e nada grava.
// - Com o tipo liberado escolhido na criação, o título grava com esse tipo de documento.
// - Tipo de documento que não serve a receber: recusado na liberação e na criação, sem gravar.
// - A liberação fica com o tipo de documento (nunca com credor nem lançamento), no estabelecimento, e a marca de restrito
//   vale só para o título a receber (o movimento bancário do perfil continua livre).
// - A tela da emissão lê os tipos com a marca do que os perfis do usuário liberam (a mesma regra da trava).
// - A renegociação (acordo) cria um título a receber com o tipo do título de origem: fora da lista, recusada sem gravar
//   acordo nem título; com o tipo liberado, o título do acordo grava com ele.
// Só contagens e ids sintéticos.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tiposDocumentoReceberDoUsuario } from '../gestao-propria.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import { OPERACOES_RENEGOCIACAO } from '../renegociacao-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

describe.skipIf(SEM_BANCO)(
  'tipo de documento por perfil no título a receber (MariaDB, cliente f22_o2)',
  () => {
    let m: MassaFinanceiro;
    let porta: PortaFinanceiroPropria;
    let perfil = 0;
    let docPadrao = 0;
    let docLiberado = 0;
    let docPagar = 0;
    const consultar = (sql: string, p: unknown[]) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c1-044' }, (l) => l.consultar(sql, p));
    const escrever = <T>(fn: Parameters<MassaFinanceiro['nucleo']['escrever']>[1]) =>
      m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c1-044' }, fn) as Promise<T>;
    const executar = (nome: string, entrada: unknown) => {
      const c = m.ctx(m.lanca);
      return porta.executar(c, nome, entrada, { ...c, chaveIdempotencia: `c1-044-${randomUUID()}` });
    };
    const titulos = async () =>
      Number(
        (
          await consultar('SELECT COUNT(*) AS n FROM titulo_receber WHERE estabelecimento_id = ?', [m.est])
        )[0]?.['n'],
      );

    beforeAll(async () => {
      m = await montarMassa();
      porta = new PortaFinanceiroPropria(m.nucleo);
      ({ perfil, docPadrao, docLiberado, docPagar } = await escrever<{
        perfil: number;
        docPadrao: number;
        docLiberado: number;
        docPagar: number;
      }>(async (e) => {
        const agora = new Date();
        const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
          const l = await e.uma<{ id: number }>(sel, p);
          return l ? Number(l.id) : e.inserir(ins, pi);
        };
        const padrao = await e.uma<{ id: number }>(
          `SELECT id FROM tipo_documento_financeiro WHERE ativo = TRUE AND sentido IN ('receber','ambos')
          ORDER BY (codigo = 'fatura') DESC, nativo_sistema DESC, id LIMIT 1`,
          [],
        );
        return {
          perfil: await garantir(
            "SELECT id FROM perfil_acesso WHERE codigo = 'L0207-TR'",
            [],
            "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'L0207-TR', 'PERFIL SINTETICO L0207 RECEBER', ?)",
            [m.est, agora],
          ),
          docPadrao: Number(padrao?.id),
          docLiberado: await garantir(
            "SELECT id FROM tipo_documento_financeiro WHERE codigo = 'l0207_recibo'",
            [],
            "INSERT INTO tipo_documento_financeiro (codigo, descricao, sentido, criado_em) VALUES ('l0207_recibo', 'RECIBO SINTETICO L0207', 'receber', ?)",
            [agora],
          ),
          docPagar: await garantir(
            "SELECT id FROM tipo_documento_financeiro WHERE codigo = 'l0207_pagar'",
            [],
            "INSERT INTO tipo_documento_financeiro (codigo, descricao, sentido, criado_em) VALUES ('l0207_pagar', 'DOCUMENTO SINTETICO L0207 A PAGAR', 'pagar', ?)",
            [agora],
          ),
        };
      }));
      await escrever(async (e) => {
        for (const t of ['permissao_tipo_lancamento', 'restricao_tipo_lancamento_perfil', 'usuario_perfil'])
          await e.executar(`DELETE FROM ${t} WHERE perfil_acesso_id = ?`, [perfil]);
        await e.executar(
          'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
          [m.lanca, perfil, m.est, '2000-01-01', new Date()],
        );
      });
    }, 180_000);

    afterAll(async () => {
      if (!m) return;
      await escrever(async (e) => {
        for (const t of ['permissao_tipo_lancamento', 'restricao_tipo_lancamento_perfil', 'usuario_perfil'])
          await e.executar(`DELETE FROM ${t} WHERE perfil_acesso_id = ?`, [perfil]);
      });
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    });

    it('fora da lista o título a receber é recusado e nada grava; com o documento liberado, grava com ele', async () => {
      expect(docPadrao).toBeGreaterThan(0);
      expect(docLiberado).not.toBe(docPadrao);
      const conta = m.contasHospitalares[0]!;
      const criar = (tipoDocumento: number | null) =>
        executar('financeiro.criarTituloReceber', {
          contas: [{ conta, versao: null }],
          vencimento: '2026-12-15',
          documento: 920_441,
          referente: '',
          tipoDocumento,
        });

      // Tipo de documento a pagar não entra na lista do título a receber.
      expect(
        await codigoDaGravacao(
          executar('financeiro.manterTipoLancamento', {
            perfil,
            tipo: docPagar,
            liberado: true,
            operacao: 'contas_receber',
          }),
        ),
      ).toBe('tipo-inexistente');

      // Liberado só o recibo: a primeira liberação restringe o perfil no título a receber.
      const r = await executar('financeiro.manterTipoLancamento', {
        perfil,
        tipo: docLiberado,
        liberado: true,
        operacao: 'contas_receber',
      });
      expect((r.resultado as Record<string, unknown>)['restringiu']).toBe(true);

      // O documento padrão (fora da lista) é recusado e não grava título nenhum.
      const n0 = await titulos();
      expect(await codigoDaGravacao(criar(null))).toBe('tipo-lancamento-nao-liberado');
      expect(await codigoDaGravacao(criar(docPadrao))).toBe('tipo-lancamento-nao-liberado');
      // Documento que não serve a receber: recusado antes da lista, sem gravar.
      expect(await codigoDaGravacao(criar(docPagar))).toBe('tipo-documento-invalido');
      expect(await titulos()).toBe(n0);

      // Com o recibo liberado, o título grava com esse tipo de documento.
      const ok = await criar(docLiberado);
      const id = Number((ok.resultado as Record<string, unknown>)['titulo']);
      expect(id).toBeGreaterThan(0);
      expect(await titulos()).toBe(n0 + 1);
      const [t] = await consultar(
        'SELECT tipo_documento_financeiro_id AS d FROM titulo_receber WHERE id = ?',
        [id],
      );
      expect(Number(t?.['d'])).toBe(docLiberado);

      // A liberação fica com o tipo de documento, no estabelecimento, com quem gravou.
      const linhas = await consultar(
        `SELECT tipo_credor_id, tipo_lancamento_bancario_id, tipo_documento_financeiro_id, estabelecimento_id, criado_por,
              excluido_em IS NULL AS vale
         FROM permissao_tipo_lancamento WHERE perfil_acesso_id = ? AND operacao = 'contas_receber'`,
        [perfil],
      );
      expect(
        linhas.map((x) => [
          x['tipo_credor_id'],
          x['tipo_lancamento_bancario_id'],
          Number(x['tipo_documento_financeiro_id']),
          Number(x['estabelecimento_id']),
          Number(x['criado_por']),
          Number(x['vale']),
        ]),
      ).toEqual([[null, null, docLiberado, m.est, m.lanca, 1]]);
      // A marca de restrito vale só no título a receber.
      const marcas = await consultar(
        'SELECT operacao FROM restricao_tipo_lancamento_perfil WHERE perfil_acesso_id = ? AND excluido_em IS NULL',
        [perfil],
      );
      expect(marcas.map((x) => String(x['operacao']))).toEqual(['contas_receber']);

      // Retirar o recibo: a linha fica (marcada), o perfil segue restrito e nada mais passa.
      await executar('financeiro.manterTipoLancamento', {
        perfil,
        tipo: docLiberado,
        liberado: false,
        operacao: 'contas_receber',
      });
      const [fora] = await consultar(
        `SELECT COUNT(*) AS n, SUM(excluido_em IS NOT NULL) AS fora FROM permissao_tipo_lancamento
        WHERE perfil_acesso_id = ? AND operacao = 'contas_receber'`,
        [perfil],
      );
      expect([Number(fora?.['n']), Number(fora?.['fora'])]).toEqual([1, 1]);
      expect(
        await codigoDaGravacao(
          executar('financeiro.criarTituloReceber', {
            contas: [{ conta: m.contasHospitalares[1]!, versao: null }],
            vencimento: '2026-12-15',
            documento: 920_442,
            referente: '',
            tipoDocumento: docLiberado,
          }),
        ),
      ).toBe('tipo-lancamento-nao-liberado');
      expect(await titulos()).toBe(n0 + 1);
      console.info(`[c1-044] título a receber: 1 gravado com o documento liberado; 4 recusas sem gravar`);
    });

    it('a emissão lê os tipos liberados ao usuário; a renegociação respeita a lista do título a receber', async () => {
      const EM_30_DIAS = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const executor = m.nucleo.criarExecutor();
      const renegociar = (titulo: number) =>
        executor.executar(
          OPERACOES_RENEGOCIACAO['financeiro.renegociarTitulosReceber'] as never,
          CLIENTE,
          { titulos: [titulo], quantidadeParcelas: 1, primeiroVencimento: EM_30_DIAS },
          { ...m.ctx(m.lanca), chaveIdempotencia: `c1-044-${randomUUID()}` },
        );
      const contar = async (tabela: 'renegociacao' | 'titulo_receber') =>
        Number(
          (await consultar(`SELECT COUNT(*) AS n FROM ${tabela} WHERE estabelecimento_id = ?`, [m.est]))[0]?.[
            'n'
          ],
        );
      const tiposDaTela = () =>
        m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c1-044' }, (l) =>
          tiposDocumentoReceberDoUsuario(l, m.est, m.lanca),
        );

      // Perfil livre de novo: a tela marca todos os tipos como liberados e os dois títulos de origem gravam.
      await executar('financeiro.manterRestricaoTipoLancamento', {
        perfil,
        restrito: false,
        operacao: 'contas_receber',
      });
      const livre = await tiposDaTela();
      expect(livre.restrito).toBe(false);
      expect(livre.padrao).toBe(docPadrao);
      expect(livre.tipos.every((t) => t.liberado)).toBe(true);
      expect(livre.tipos.map((t) => t.tipo)).not.toContain(docPagar);
      const emitir = async (conta: number, documento: number, tipoDocumento: number) =>
        Number(
          (
            (
              await executar('financeiro.criarTituloReceber', {
                contas: [{ conta, versao: null }],
                vencimento: EM_30_DIAS,
                documento,
                referente: '',
                tipoDocumento,
              })
            ).resultado as Record<string, unknown>
          )['titulo'],
        );
      const daFatura = await emitir(m.contasHospitalares[1]!, 920_443, docPadrao);
      const doRecibo = await emitir(m.contasHospitalares[2]!, 920_444, docLiberado);
      expect(daFatura).toBeGreaterThan(0);
      expect(doRecibo).toBeGreaterThan(0);

      // Liberado só o recibo: a tela mostra o perfil restrito e só o recibo liberado.
      await executar('financeiro.manterTipoLancamento', {
        perfil,
        tipo: docLiberado,
        liberado: true,
        operacao: 'contas_receber',
      });
      const restrito = await tiposDaTela();
      expect(restrito.restrito).toBe(true);
      expect(restrito.tipos.filter((t) => t.liberado).map((t) => t.tipo)).toEqual([docLiberado]);

      // O acordo do título da fatura (fora da lista) é recusado: nem acordo nem título novo.
      const [a0, t0] = [await contar('renegociacao'), await contar('titulo_receber')];
      expect(await codigoDaGravacao(renegociar(daFatura))).toBe('tipo-lancamento-nao-liberado');
      expect([await contar('renegociacao'), await contar('titulo_receber')]).toEqual([a0, t0]);
      const [origem] = await consultar('SELECT situacao FROM titulo_receber WHERE id = ?', [daFatura]);
      expect(String(origem?.['situacao'])).not.toBe('renegociado');

      // O acordo do título do recibo (liberado) grava, e o título do acordo leva o recibo.
      const ok = await renegociar(doRecibo);
      expect(ok).toBeTruthy();
      expect([await contar('renegociacao'), await contar('titulo_receber')]).toEqual([a0 + 1, t0 + 1]);
      const [novo] = await consultar(
        `SELECT t.tipo_documento_financeiro_id AS d, t.tipo_origem FROM renegociacao r
           JOIN titulo_receber t ON t.id = r.novo_titulo_receber_id
          WHERE r.estabelecimento_id = ? ORDER BY r.id DESC LIMIT 1`,
        [m.est],
      );
      expect([Number(novo?.['d']), String(novo?.['tipo_origem'])]).toEqual([docLiberado, 'acordo']);
      console.info(
        '[c1-044] renegociação: 1 recusa sem gravar (fora da lista), 1 acordo com o tipo liberado',
      );
    });
  },
);
