// F3.8, 07-FIN linha 66 (C1-026): contrato de efeito dos dados bancários e da chave Pix do profissional e do prestador
// terceiro contra o MariaDB real (massa SINTÉTICA "L0207"). A conta do credor grava na coluna do tipo dele (uma só, o
// CHECK confere); credor inexistente, prestador de outro estabelecimento e credor ambíguo recusam sem gravar. A remessa
// por Pix paga o título do profissional com a chave dele; sem chave do profissional, com a do prestador terceiro ligado
// a ele; sem nenhuma das duas, recusa a remessa inteira. O documento do favorecido é o do titular da chave.
import { createHash, randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contasDoCredor,
  montarRemessaPix,
  OPERACOES_PAGAMENTO_ELETRONICO,
  parcelasParaPix,
} from '../pagamento-eletronico-propria.js';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';

const BANCO = 987;
const HOJE = new Date().toISOString().slice(0, 10);
const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `c1026-pe-${randomUUID()}` });
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const CPF_MEDICO = '52998224725';
const CNPJ_PRESTADOR = '11444777000161';
const DADOS = {
  tipoConta: 'corrente' as const,
  banco: null,
  agencia: '',
  digitoAgencia: '',
  conta: '',
  digitoConta: '',
  preferencial: false,
};

describe.skipIf(SEM_BANCO)(
  'dados bancários do profissional e do prestador e a remessa por Pix (MariaDB)',
  () => {
    let m: MassaFinanceiro;
    let porta: PortaFinanceiroPropria;
    let banco = 0;
    let profissional = 0;
    let prestador = 0;
    let prestadorOutroEst = 0;
    let documento = 670_000;
    const ler = <T>(fn: Parameters<MassaFinanceiro['nucleo']['lerSomente']>[1]) =>
      m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'pe-c1-026' }, fn) as Promise<T>;
    const uma = (sql: string, p: unknown[]) => ler<Record<string, unknown> | null>((l) => l.uma(sql, p));
    const contar = async (sql: string, p: unknown[]) => Number((await uma(sql, p))?.['n'] ?? 0);
    const escrever = (fn: Parameters<MassaFinanceiro['nucleo']['escrever']>[1]) =>
      m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-pe-c1-026' }, fn);
    const executar = (nome: keyof typeof OPERACOES_PAGAMENTO_ELETRONICO, entrada: unknown) =>
      m.nucleo
        .criarExecutor()
        .executar(OPERACOES_PAGAMENTO_ELETRONICO[nome] as never, CLIENTE, entrada, op(m.ctx(m.paga)))
        .then((r) => r.resultado as Record<string, unknown>);
    const codigo = async (p: Promise<unknown>) => {
      try {
        await p;
        return 'gravou';
      } catch (e) {
        return codigoDe(e);
      }
    };
    const contasDe = (coluna: 'profissional_id' | 'prestador_terceiro_id', id: number) =>
      contar(`SELECT COUNT(*) AS n FROM conta_bancaria_credor WHERE ${coluna} = ?`, [id]);
    /** Título do profissional (tipo médico) com uma parcela; devolve o id da parcela. */
    const parcelaDoProfissional = async (valor: number) => {
      documento += 1;
      const c = m.ctx(m.lanca);
      const t = await porta.executar(
        c,
        'financeiro.criarTituloPagar',
        { ...tituloDaMassa(m, documento, valor), tipo: 'M', credor: profissional, profissional },
        op(c),
      );
      const tituloPagar = Number(t.resultado['tituloPagar'] ?? 0);
      const p = await uma('SELECT id FROM parcela_pagar WHERE titulo_pagar_id = ? ORDER BY id LIMIT 1', [
        tituloPagar,
      ]);
      return Number(p?.['id']);
    };
    const montar = (parcelas: number[]) =>
      ler<Awaited<ReturnType<typeof montarRemessaPix>>>((l) =>
        montarRemessaPix(l, m.est, m.contaA, parcelas, HOJE),
      );
    const limparProprio = () =>
      escrever(async (e) => {
        const p = [profissional, prestador, prestadorOutroEst];
        await e.executar(
          `DELETE k FROM chave_pix_credor k JOIN conta_bancaria_credor c ON c.id = k.conta_bancaria_credor_id
          WHERE c.profissional_id = ? OR c.prestador_terceiro_id IN (?, ?)`,
          p,
        );
        await e.executar(
          'DELETE FROM conta_bancaria_credor WHERE profissional_id = ? OR prestador_terceiro_id IN (?, ?)',
          p,
        );
      });

    beforeAll(async () => {
      m = await montarMassa();
      porta = new PortaFinanceiroPropria(m.nucleo);
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      m = await montarMassa();
      banco = Number(
        (await uma('SELECT banco_id FROM conta_bancaria WHERE id = ?', [m.contaA]))?.['banco_id'],
      );
      profissional = Number(
        (
          await uma(
            `SELECT pr.id FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pf.nome = 'MEDICO SINTETICO L0207'`,
            [],
          )
        )?.['id'],
      );
      const agora = new Date();
      await escrever(async (e) => {
        await e.executar('UPDATE banco SET codigo_compensacao = ? WHERE id = ?', [String(BANCO), banco]);
        // O título do profissional é do tipo de credor médico.
        if (!(await e.uma("SELECT id FROM tipo_credor WHERE codigo = 'medico'", [])))
          await e.inserir(
            "INSERT INTO tipo_credor (codigo, descricao, natureza, criado_em) VALUES ('medico', 'Médico', 'medico', ?)",
            [agora],
          );
        const garantirPrestador = async (est: number, cod: string) => {
          const l = await e.uma<{ id: number }>(
            'SELECT id FROM prestador_terceiro WHERE estabelecimento_id = ? AND codigo = ?',
            [est, cod],
          );
          if (l) return Number(l.id);
          return e.inserir(
            `INSERT INTO prestador_terceiro (estabelecimento_id, codigo, nome, tipo_pessoa, cnpj, profissional_id, criado_em)
           VALUES (?, ?, 'PRESTADOR SINTETICO L0207', 'juridica', ?, ?, ?)`,
            [est, cod, CNPJ_PRESTADOR, profissional, agora],
          );
        };
        prestador = await garantirPrestador(m.est, 'L0207-PT');
        prestadorOutroEst = await garantirPrestador(m.outroEst, 'L0207-PT');
      });
      await limparProprio();
    }, 120_000);

    afterAll(async () => {
      if (!m) return;
      await limparProprio();
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await escrever((e) => e.executar('UPDATE banco SET codigo_compensacao = NULL WHERE id = ?', [banco]));
      await m.nucleo.encerrar?.();
    }, 120_000);

    it('grava a conta do profissional e a do prestador na coluna de cada um; recusa o que não fecha sem gravar', async () => {
      expect(profissional).toBeGreaterThan(0);
      const r = await executar('financeiro.manterContaCredor', {
        acao: 'incluir',
        tipoCredor: 'profissional',
        credor: profissional,
        titularNome: 'Médico Sintético L0207',
        titularDocumento: '529.982.247-25',
        tipoChavePix: 'cpf',
        chavePix: '529.982.247-25',
        ...DADOS,
      });
      expect(r).toMatchObject({
        tipoCredor: 'profissional',
        credor: profissional,
        fornecedor: null,
        preferencial: true,
      });
      const linha = await uma(
        `SELECT empresa_fornecedora_id, profissional_id, prestador_terceiro_id, chave_pix, tipo_chave_pix, titular_documento
         FROM conta_bancaria_credor WHERE id = ?`,
        [Number(r['contaCredor'])],
      );
      expect(linha).toMatchObject({
        empresa_fornecedora_id: null,
        prestador_terceiro_id: null,
        chave_pix: CPF_MEDICO,
        tipo_chave_pix: 'cpf',
        titular_documento: CPF_MEDICO,
      });
      expect(Number(linha?.['profissional_id'])).toBe(profissional);
      expect(
        await contar(
          'SELECT COUNT(*) AS n FROM chave_pix_credor WHERE conta_bancaria_credor_id = ? AND ativa = TRUE',
          [Number(r['contaCredor'])],
        ),
      ).toBe(1);
      const lista = await ler<Awaited<ReturnType<typeof contasDoCredor>>>((l) =>
        contasDoCredor(l, { tipo: 'profissional', id: profissional }),
      );
      expect(lista).toHaveLength(1);
      expect(JSON.stringify(lista)).not.toContain(CPF_MEDICO);

      const p = await executar('financeiro.manterContaCredor', {
        acao: 'incluir',
        tipoCredor: 'prestador',
        credor: prestador,
        titularNome: 'Prestador Sintético L0207',
        titularDocumento: CNPJ_PRESTADOR,
        tipoChavePix: 'email',
        chavePix: 'Repasse@Exemplo.com',
        ...DADOS,
      });
      expect(p).toMatchObject({ tipoCredor: 'prestador', credor: prestador });
      expect(
        await uma(
          'SELECT prestador_terceiro_id, profissional_id, chave_pix FROM conta_bancaria_credor WHERE id = ?',
          [Number(p['contaCredor'])],
        ),
      ).toMatchObject({ profissional_id: null, chave_pix: 'repasse@exemplo.com' });

      // Recusas sem gravar: credor inexistente, prestador de outro estabelecimento, credor ambíguo, tipo sem código.
      const antes = [
        await contasDe('profissional_id', profissional),
        await contasDe('prestador_terceiro_id', prestador),
      ];
      const base = {
        titularNome: 'Médico Sintético L0207',
        titularDocumento: CPF_MEDICO,
        tipoChavePix: null,
        chavePix: '',
        ...DADOS,
        banco: null,
      };
      const comConta = { ...base, tipoChavePix: 'cpf', chavePix: CPF_MEDICO };
      expect(
        await codigo(
          executar('financeiro.manterContaCredor', {
            acao: 'incluir',
            tipoCredor: 'profissional',
            credor: 999_999_991,
            ...comConta,
          }),
        ),
      ).toBe('credor-inexistente');
      expect(
        await codigo(
          executar('financeiro.manterContaCredor', {
            acao: 'incluir',
            tipoCredor: 'prestador',
            credor: prestadorOutroEst,
            ...comConta,
          }),
        ),
      ).toBe('credor-inexistente');
      expect(
        await codigo(
          executar('financeiro.manterContaCredor', {
            acao: 'incluir',
            tipoCredor: 'profissional',
            credor: profissional,
            fornecedor: m.fornecedor,
            ...comConta,
          }),
        ),
      ).toBe('credor-ambiguo');
      expect(
        await codigo(
          executar('financeiro.manterContaCredor', {
            acao: 'incluir',
            tipoCredor: 'profissional',
            ...comConta,
          }),
        ),
      ).toBe('credor-invalido');
      // A mesma chave no mesmo credor repete.
      expect(
        await codigo(
          executar('financeiro.manterContaCredor', {
            acao: 'incluir',
            tipoCredor: 'profissional',
            credor: profissional,
            ...comConta,
          }),
        ),
      ).toBe('conta-repetida');
      expect([
        await contasDe('profissional_id', profissional),
        await contasDe('prestador_terceiro_id', prestador),
      ]).toEqual(antes);
      expect(await contasDe('prestador_terceiro_id', prestadorOutroEst)).toBe(0);
    }, 120_000);

    it('a remessa por Pix paga o profissional pela chave dele e, sem ela, pela do prestador ligado', async () => {
      const p1 = await parcelaDoProfissional(180);
      expect(p1).toBeGreaterThan(0);
      const fila = await ler<Awaited<ReturnType<typeof parcelasParaPix>>>((l) => parcelasParaPix(l, m.est));
      expect(fila.find((x) => x.id === p1)).toMatchObject({
        credor: profissional,
        credorTipo: 'profissional',
        temChavePix: true,
        valor: 180,
      });
      const montada = await montar([p1]);
      expect(montada.titulos[0]).toMatchObject({
        tipoChavePix: 'cpf',
        chavePix: CPF_MEDICO,
        documento: CPF_MEDICO,
      });
      const r = await executar('financeiro.registrarRemessaPix', {
        conta: m.contaA,
        parcelas: [p1],
        dataPagamento: HOJE,
        hashArquivo: sha256(montada.conteudo),
        arquivo: null,
        destino: 'simulador',
      });
      const rem = Number(r['remessa']);
      expect(
        await uma(
          'SELECT situacao FROM parcela_remessa_bancaria WHERE remessa_bancaria_id = ? AND parcela_pagar_id = ?',
          [rem, p1],
        ),
      ).toMatchObject({ situacao: 'pendente' });
      expect(
        Number((await uma('SELECT valor_total FROM remessa_bancaria WHERE id = ?', [rem]))?.['valor_total']),
      ).toBe(180);

      // Sem a chave do profissional (conta desativada, a linha fica), vale a do prestador terceiro ligado a ele.
      const conta = await uma(
        'SELECT id, versao FROM conta_bancaria_credor WHERE profissional_id = ? AND ativo = TRUE',
        [profissional],
      );
      await executar('financeiro.manterContaCredor', {
        acao: 'desativar',
        contaCredor: Number(conta?.['id']),
        versao: Number(conta?.['versao']),
      });
      expect(await contasDe('profissional_id', profissional)).toBe(1);
      const p2 = await parcelaDoProfissional(75);
      const pelaDoPrestador = await montar([p2]);
      expect(pelaDoPrestador.titulos[0]).toMatchObject({
        tipoChavePix: 'email',
        chavePix: 'repasse@exemplo.com',
        documento: CNPJ_PRESTADOR,
      });

      // Sem nenhuma chave ativa (a do prestador também desativada), a remessa inteira é recusada e nada é gravado.
      const cp = await uma(
        'SELECT id, versao FROM conta_bancaria_credor WHERE prestador_terceiro_id = ? AND ativo = TRUE',
        [prestador],
      );
      await executar('financeiro.manterContaCredor', {
        acao: 'desativar',
        contaCredor: Number(cp?.['id']),
        versao: Number(cp?.['versao']),
      });
      const remessas = await contar(
        'SELECT COUNT(*) AS n FROM remessa_bancaria WHERE estabelecimento_id = ?',
        [m.est],
      );
      expect(await codigo(montar([p2]))).toBe('credor-sem-chave-pix');
      expect(
        await contar('SELECT COUNT(*) AS n FROM remessa_bancaria WHERE estabelecimento_id = ?', [m.est]),
      ).toBe(remessas);
      const fim = await ler<Awaited<ReturnType<typeof parcelasParaPix>>>((l) => parcelasParaPix(l, m.est));
      expect(fim.find((x) => x.id === p2)).toMatchObject({ temChavePix: false });
    }, 120_000);
  },
);
