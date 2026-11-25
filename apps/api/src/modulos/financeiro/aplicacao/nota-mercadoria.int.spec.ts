// F7, 07-FIN linha 114: contrato de efeito da NF-e de saída de mercadoria, contra o MariaDB real (massa SINTÉTICA
// "L0207NM", estabelecimento só deste teste; nenhuma pessoa real). A nota nasce da devolução ao fornecedor gravada
// (itens, lote e a nota de entrada referenciada vêm dela), é assinada (certificado sintético do simulador), autorizada
// pelo simulador da Sefaz e deixa no banco: a natureza de partida e a série 1 no cadastro, nota_mercadoria com chave,
// protocolo e totais, os itens com CFOP e lote, a referência, o evento de autorização e o XML no armazém e em
// `arquivo`; a devolução recebe número, série, chave e CFOP. A segunda nota da mesma devolução é recusada; repetir a
// chave de idempotência não emite de novo. Remessa para conserto a fornecedor de outra UF sai com CFOP 6915. Carta de
// correção é evento com sequência; cancelamento exige motivo e justificativa, mantém a nota (cancelada) e libera a
// devolução para outra nota. Pela porta da Sefaz (falsa, controlada pelo teste, com A1 sintético no "cofre"): sem
// resposta a nota fica assinada; a transmissão recusa enquanto a Sefaz não responde e depois a leva a autorizada (ou a
// rejeitada); a nota de produção cancela pela Sefaz. O histórico e o DANFE leem a nota fora da janela da lista, e a
// nota de entrada de outro estabelecimento não entra na NF-e.
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarRaizSintetica, emitirSintetico } from '@sgh/dominio-documento';
import { chaveAcessoNfe, chaveNfeValida } from '@sgh/dominio-financeiro';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../../teste/limpar-trilha.spec-util.js';
import { armazemFinanceiroMemoria } from '../armazem.js';
import { conferirAssinaturaNfe } from '../nfe-assinatura.js';
import { type TransmissorNfe, transmissorSimulador } from '../nfe-transmissao.js';
import { NotaMercadoriaController } from '../nota-mercadoria.controller.js';
import {
  apoioNotaMercadoria,
  danfeNotaMercadoria,
  historicoNotaMercadoria,
  notaMercadoriaPorId,
  notasMercadoria,
  type OperacaoNotaMercadoria,
  operacoesNotaMercadoria,
} from '../nota-mercadoria-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  type MassaFinanceiro,
  montarMassa,
  P,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const ARMAZEM = armazemFinanceiroMemoria();
const OPERACOES = operacoesNotaMercadoria(ARMAZEM, {});

/** A Sefaz falsa do teste: fora do ar, autorizando ou rejeitando, conforme o teste manda. */
const SEFAZ = { modo: 'fora' as 'fora' | 'autoriza' | 'rejeita', chamadas: [] as string[] };
const simulador = transmissorSimulador();
const SEFAZ_FALSA: TransmissorNfe = {
  async autorizar(p) {
    SEFAZ.chamadas.push('autorizar');
    if (SEFAZ.modo === 'fora') return null;
    if (SEFAZ.modo === 'rejeita')
      return {
        codigo: '539',
        mensagem: 'Rejeição: duplicidade de NF-e com diferença na chave',
        protocolo: null,
      };
    return { codigo: '100', mensagem: 'Autorizado o uso da NF-e', protocolo: `1359${p.chave.slice(-11)}` };
  },
  async consultar(p) {
    SEFAZ.chamadas.push('consultar');
    return SEFAZ.modo === 'fora' ? null : simulador.consultar(p);
  },
  async cancelar(p) {
    SEFAZ.chamadas.push('cancelar');
    return SEFAZ.modo === 'fora' ? null : simulador.cancelar(p);
  },
  async cartaCorrecao(p) {
    SEFAZ.chamadas.push('carta');
    return SEFAZ.modo === 'fora' ? null : simulador.cartaCorrecao(p);
  },
};

/** O A1 sintético do emitente (raiz do CNPJ do estabelecimento do teste) em arquivos temporários, como no cofre. */
function cofreSintetico(cnpjEmitente: string): NodeJS.ProcessEnv {
  const agora = new Date();
  const a1 = emitirSintetico(
    criarRaizSintetica(agora),
    { cpf: null, nome: `HOSPITAL SINTETICO NM:${cnpjEmitente}` },
    agora,
  );
  const dir = mkdtempSync(join(tmpdir(), 'nfe-a1-nm-'));
  // Linhas de 64, sem linha vazia antes do rodapé (o DER de 768 bytes dá base64 múltiplo de 64).
  const pem = (
    Buffer.from(a1.certificado)
      .toString('base64')
      .match(/.{1,64}/g) ?? []
  ).join('\n');
  writeFileSync(join(dir, 'c.pem'), `-----BEGIN CERTIFICATE-----\n${pem}\n-----END CERTIFICATE-----\n`);
  writeFileSync(join(dir, 'k.pem'), a1.chave.export({ type: 'pkcs8', format: 'pem' }).toString());
  return { NFE_CERTIFICADO_ARQUIVO: join(dir, 'c.pem'), NFE_CHAVE_ARQUIVO: join(dir, 'k.pem') };
}
const JUSTIFICATIVA = 'Devolução registrada em duplicidade pelo almoxarifado.';

/** CNPJ sintético válido a partir de 12 dígitos. */
function cnpj(base12: string): string {
  const dv = (b: string) => {
    let s = 0;
    let p = b.length - 7;
    for (const c of b) {
      s += Number(c) * p;
      p = p === 2 ? 9 : p - 1;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12);
  return `${base12}${d1}${dv(base12 + d1)}`;
}

function rotasDe(classe: { prototype: object }): string[] {
  const prefixo = String(Reflect.getMetadata(PATH_METADATA, classe) ?? '');
  const verbos = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
  return Object.getOwnPropertyNames(classe.prototype)
    .filter((m) => m !== 'constructor')
    .map((m) => Object.getOwnPropertyDescriptor(classe.prototype, m)?.value as object | undefined)
    .filter((fn): fn is object => typeof fn === 'function' && Reflect.hasMetadata(PATH_METADATA, fn))
    .map((fn) => {
      const caminho = String(Reflect.getMetadata(PATH_METADATA, fn));
      const verbo = verbos[Number(Reflect.getMetadata(METHOD_METADATA, fn))] ?? '?';
      return `${verbo} ${[prefixo, caminho].filter((x) => x && x !== '/').join('/')}`;
    });
}

describe('rotas da NF-e de saída', () => {
  it('declara listar, apoio, histórico, DANFE, emitir, transmitir, cancelar e corrigir', () => {
    expect(rotasDe(NotaMercadoriaController).sort()).toEqual(
      [
        'GET financeiro/fiscal/notas-mercadoria',
        'GET financeiro/fiscal/notas-mercadoria/apoio',
        'GET financeiro/fiscal/notas-mercadoria/:id/historico',
        'GET financeiro/fiscal/notas-mercadoria/:id/danfe',
        'POST financeiro/fiscal/notas-mercadoria',
        'POST financeiro/fiscal/notas-mercadoria/:id/transmitir',
        'POST financeiro/fiscal/notas-mercadoria/:id/cancelar',
        'POST financeiro/fiscal/notas-mercadoria/:id/corrigir',
      ].sort(),
    );
  });
});

describe.skipIf(SEM_BANCO)(
  'NF-e de saída de mercadoria: emissão, carta de correção e cancelamento (MariaDB)',
  () => {
    let m: MassaFinanceiro;
    const ids = { est: 0, fornSp: 0, fornRj: 0, insumo: 0, devolucao: 0, motivo: 0 };
    const corr = { cliente: CLIENTE, correlacao: 'nm-114' };
    const consultar = (sql: string, p: unknown[] = []) =>
      m.nucleo.lerSomente(corr, (l) => l.consultar(sql, p));
    const ctx = (): ContextoNucleo & { chaveIdempotencia: string } => ({
      ...m.ctx(m.lanca, ids.est),
      chaveIdempotencia: `t0207-nm-${randomUUID()}`,
    });
    const executar = (nome: OperacaoNotaMercadoria, entrada: unknown, c = ctx()) =>
      m.nucleo.criarExecutor().executar(OPERACOES[nome] as never, CLIENTE, entrada, c);
    const emitirDevolucao = (c = ctx()) =>
      executar(
        'financeiro.emitir_nota_mercadoria',
        { origem: 'devolucao_fornecedor', devolucao: ids.devolucao },
        c,
      );

    const limpar = () =>
      m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-nm-114' }, async (e) => {
        if (!ids.est) return;
        const x = (sql: string, p: unknown[] = [ids.est]) => e.executar(sql, p);
        const daNota = 'JOIN nota_mercadoria n ON n.id = x.nota_mercadoria_id WHERE n.estabelecimento_id = ?';
        await x(
          `DELETE t FROM tributo_item_nota_mercadoria t JOIN nota_mercadoria_item x ON x.id = t.nota_mercadoria_item_id ${daNota}`,
        );
        for (const t of ['evento_nota_mercadoria', 'nota_mercadoria_item', 'referencia_nota_mercadoria'])
          await x(`DELETE x FROM ${t} x ${daNota}`);
        await x('DELETE FROM nota_mercadoria WHERE estabelecimento_id = ?');
        await x("DELETE FROM arquivo WHERE entidade = 'nota_mercadoria' AND estabelecimento_id = ?");
        await x("DELETE FROM serie_documento_fiscal WHERE estabelecimento_id = ? AND tipo_documento = 'nfe'");
        await x(
          'DELETE i FROM devolucao_fornecedor_item i JOIN devolucao_fornecedor d ON d.id = i.devolucao_fornecedor_id WHERE d.estabelecimento_id = ?',
        );
        await x('DELETE FROM devolucao_fornecedor WHERE estabelecimento_id = ?');
        await e.executar('DELETE FROM nota_entrada WHERE numero_documento = ?', [`${P}NMX`]);
        await limparTrilhaDaMassa(e, { ids: [ids.est] });
      });

    beforeAll(async () => {
      m = await montarMassa();
      Object.assign(
        ids,
        await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-nm-114' }, async (e) => {
          const agora = new Date();
          const um = async (sql: string, p: unknown[] = []) =>
            Number((await e.uma<{ id: number }>(sql, p))?.id ?? 0);
          const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) =>
            (await um(sel, p)) || (await e.inserir(ins, pi));
          const municipio = (uf: string) =>
            um(
              'SELECT m.id FROM municipio_ibge m JOIN unidade_federativa u ON u.id = m.unidade_federativa_id WHERE u.sigla = ? ORDER BY m.id LIMIT 1',
              [uf],
            );
          const [munSp, munRj] = [await municipio('SP'), await municipio('RJ')];
          for (const [codigo, abr] of [
            ['5556', 'estadual'],
            ['6556', 'interestadual'],
            ['5915', 'estadual'],
            ['6915', 'interestadual'],
            ['1916', 'estadual'],
          ] as const)
            await garantir(
              'SELECT id FROM cfop WHERE codigo_cfop = ?',
              [codigo],
              "INSERT INTO cfop (codigo_cfop, descricao, sentido, abrangencia, versao_fonte, criado_em) VALUES (?, ?, ?, ?, 'teste', ?)",
              [codigo, `CFOP ${codigo}`, codigo.startsWith('1') ? 'entrada' : 'saida', abr, agora],
            );
          const est = await garantir(
            'SELECT id FROM estabelecimento WHERE codigo = ?',
            [`${P}NM`],
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, cnpj, municipio_ibge_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
            [
              `${P}NM`,
              'HOSPITAL SINTETICO NM',
              'HOSPITAL SINTETICO NM LTDA',
              cnpj('990591400001'),
              munSp,
              agora,
            ],
          );
          await e.executar('UPDATE estabelecimento SET cnpj = ?, municipio_ibge_id = ? WHERE id = ?', [
            cnpj('990591400001'),
            munSp,
            est,
          ]);
          const fornecedor = (base: string, mun: number) =>
            garantir(
              'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
              [cnpj(base)],
              "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, municipio_ibge_id, contribuinte_icms, inscricao_estadual, situacao, criado_em) VALUES ('juridica', ?, ?, ?, TRUE, '1234567', 'ativo', ?)",
              [cnpj(base), `FORNECEDOR SINTETICO ${base.slice(-4)}`, mun, agora],
            );
          const um1 = await um('SELECT id FROM unidade_medida ORDER BY id LIMIT 1');
          const insumo = await garantir(
            'SELECT id FROM insumo WHERE codigo = ?',
            [`${P}-NM-INS`],
            "INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, codigo_ncm, criado_em) VALUES (?, 'LUVA SINTETICA NM', 'material', ?, ?, '40151900', ?)",
            [`${P}-NM-INS`, await um('SELECT id FROM grupo_insumo ORDER BY id LIMIT 1'), um1, agora],
          );
          const motivoDev = await garantir(
            "SELECT id FROM motivo_devolucao_fornecedor WHERE codigo = 'avaria'",
            [],
            "INSERT INTO motivo_devolucao_fornecedor (codigo, descricao, tipo_fiscal, criado_em) VALUES ('avaria', 'Produto avariado', 'devolucao_compra', ?)",
            [agora],
          );
          const motivo = await garantir(
            'SELECT id FROM motivo_cancelamento_documento_fiscal WHERE codigo = ?',
            [`${P}-nm-canc`],
            'INSERT INTO motivo_cancelamento_documento_fiscal (codigo, descricao, ativo, aplica_nota_mercadoria, criado_em) VALUES (?, ?, TRUE, TRUE, ?)',
            [`${P}-nm-canc`, 'MOTIVO SINTETICO NF-E', agora],
          );
          return {
            est,
            fornSp: await fornecedor('990591400002', munSp),
            fornRj: await fornecedor('990591400003', munRj),
            insumo,
            motivo,
            motivoDev,
            um1,
            local: await um('SELECT id FROM local_estoque ORDER BY id LIMIT 1'),
          };
        }),
      );
      await limpar();
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-nm-114' }, async (e) => {
        const x = ids as typeof ids & { motivoDev: number; um1: number; local: number };
        const agora = new Date();
        x.devolucao = await e.inserir(
          `INSERT INTO devolucao_fornecedor (estabelecimento_id, numero, tipo, empresa_fornecedora_id, motivo_devolucao_fornecedor_id,
           local_estoque_id, devolvido_em, valor_total, situacao, criado_em)
         VALUES (?, ?, 'parcial', ?, ?, ?, ?, 31.5, 'rascunho', ?)`,
          [x.est, `${P}-NM-1`, x.fornSp, x.motivoDev, x.local, agora, agora],
        );
        await e.inserir(
          `INSERT INTO devolucao_fornecedor_item (devolucao_fornecedor_id, sequencia, insumo_id, unidade_medida_id, numero_lote,
           validade, quantidade, valor_unitario, valor_total, criado_em)
         VALUES (?, 1, ?, ?, 'LT-SINT', '2027-06-30', 3, 10.5, 31.5, ?)`,
          [x.devolucao, x.insumo, x.um1, agora],
        );
      });
    });

    afterAll(async () => {
      if (!m) return;
      await limpar();
      await m.nucleo.encerrar();
    });

    let primeira = 0;

    it('a devolução sem nota de entrada com chave é recusada (a devolução precisa da nota de origem)', async () => {
      expect(await codigoDaGravacao(emitirDevolucao())).toBe('devolucao-sem-referencia');
    });

    it('emite a NF-e da devolução: natureza, série, nota autorizada, item com lote, referência, evento e XML assinado', async () => {
      const origem = chaveAcessoNfe({
        uf: 'SP',
        emissao: new Date('2026-11-01T12:00:00Z'),
        cnpjEmitente: cnpj('990591400002'),
        serie: 1,
        numero: 77,
        codigoNumerico: 12345678,
      });
      const c = ctx();
      const r = await executar(
        'financeiro.emitir_nota_mercadoria',
        { origem: 'devolucao_fornecedor', devolucao: ids.devolucao, referencias: [origem] },
        c,
      );
      expect(r.resultado).toMatchObject({
        situacao: 'autorizada',
        cfop: '5556',
        valorTotal: 31.5,
        destino: 'simulador',
      });
      primeira = Number(r.resultado['nota']);
      const chave = String(r.resultado['chave']);
      expect(chaveNfeValida(chave)).toBe(true);
      const [n] = await consultar(
        `SELECT n.situacao, n.ambiente, n.finalidade_emissao, n.protocolo_autorizacao IS NOT NULL AS protocolo, n.valor_total,
              n.devolucao_fornecedor_id, n.empresa_fornecedora_id, n.xml_arquivo_id, s.serie, o.codigo AS natureza
         FROM nota_mercadoria n JOIN serie_documento_fiscal s ON s.id = n.serie_documento_fiscal_id
         JOIN natureza_operacao o ON o.id = n.natureza_operacao_id WHERE n.id = ?`,
        [primeira],
      );
      expect(n).toMatchObject({
        situacao: 'autorizada',
        ambiente: 'homologacao',
        finalidade_emissao: 'devolucao',
        serie: '1',
        natureza: 'devolucao_compra',
      });
      expect(Number(n!['protocolo'])).toBe(1);
      expect(Number(n!['devolucao_fornecedor_id'])).toBe(ids.devolucao);
      expect(Number(n!['empresa_fornecedora_id'])).toBe(ids.fornSp);
      const itens = await consultar(
        'SELECT i.quantidade, i.valor_total, i.numero_lote, i.codigo_ncm, c.codigo_cfop FROM nota_mercadoria_item i JOIN cfop c ON c.id = i.cfop_id WHERE i.nota_mercadoria_id = ?',
        [primeira],
      );
      expect(itens).toHaveLength(1);
      expect(itens[0]).toMatchObject({ numero_lote: 'LT-SINT', codigo_ncm: '40151900', codigo_cfop: '5556' });
      expect(Number(itens[0]!['valor_total'])).toBe(31.5);
      const refs = await consultar(
        'SELECT tipo_referencia, chave_acesso FROM referencia_nota_mercadoria WHERE nota_mercadoria_id = ?',
        [primeira],
      );
      expect(refs).toEqual([{ tipo_referencia: 'devolucao', chave_acesso: origem }]);
      const eventos = await consultar(
        'SELECT tipo_evento, codigo_status FROM evento_nota_mercadoria WHERE nota_mercadoria_id = ?',
        [primeira],
      );
      expect(eventos).toEqual([{ tipo_evento: 'autorizacao', codigo_status: '100' }]);
      const [arq] = await consultar('SELECT chave_armazenamento, entidade_id FROM arquivo WHERE id = ?', [
        n!['xml_arquivo_id'],
      ]);
      expect(Number(arq!['entidade_id'])).toBe(primeira);
      const xml = new TextDecoder().decode(
        (await ARMAZEM.ler(String(arq!['chave_armazenamento']))) ?? new Uint8Array(),
      );
      expect(xml).toContain(`Id="NFe${chave}"`);
      expect(conferirAssinaturaNfe(xml).ok).toBe(true);
      const [d] = await consultar(
        'SELECT d.chave_acesso, d.numero_nota_fiscal, d.situacao, c.codigo_cfop FROM devolucao_fornecedor d JOIN cfop c ON c.id = d.cfop_id WHERE d.id = ?',
        [ids.devolucao],
      );
      expect(d).toMatchObject({ chave_acesso: chave, situacao: 'emitida', codigo_cfop: '5556' });
      // Repetir o pedido com a mesma chave de idempotência não emite de novo.
      const repetida = await executar(
        'financeiro.emitir_nota_mercadoria',
        { origem: 'devolucao_fornecedor', devolucao: ids.devolucao, referencias: [origem] },
        c,
      );
      expect(repetida.repetida).toBe(true);
      const [q] = await consultar('SELECT COUNT(*) AS q FROM nota_mercadoria WHERE estabelecimento_id = ?', [
        ids.est,
      ]);
      expect(Number(q!['q'])).toBe(1);
    });

    it('a devolução com nota não recebe outra; a lista, o histórico, o apoio e o DANFE leem o banco', async () => {
      expect(await codigoDaGravacao(emitirDevolucao())).toBe('devolucao-com-nota');
      const ler = <T>(fn: Parameters<typeof m.nucleo.lerSomente<T>>[1]) => m.nucleo.lerSomente(corr, fn);
      const lista = await ler((l) => notasMercadoria(l, ids.est));
      expect(lista.map((n) => n.situacao)).toEqual(['autorizada']);
      const h = await ler((l) => historicoNotaMercadoria(l, ids.est, primeira));
      expect(h?.itens).toHaveLength(1);
      expect(h?.eventos.map((e) => e.tipo)).toEqual(['autorizacao']);
      const apoio = await ler((l) => apoioNotaMercadoria(l, ids.est));
      expect(apoio.devolucoes.some((d) => d.devolucao === ids.devolucao)).toBe(false);
      expect(apoio.naturezas.map((n) => n.codigo)).toContain('remessa_conserto');
      const danfe = await ler((l) => danfeNotaMercadoria(l, ids.est, primeira));
      expect(danfe).toContain('SEM VALOR FISCAL');
    });

    it('a remessa para conserto a fornecedor de outra UF sai com CFOP 6915 e sem referência', async () => {
      const r = await executar('financeiro.emitir_nota_mercadoria', {
        origem: 'conserto',
        fornecedor: ids.fornRj,
        itens: [
          {
            codigo: 'BEM-1',
            descricao: 'BOMBA DE INFUSAO SINTETICA',
            ncm: '90189099',
            quantidade: 1,
            valorUnitario: 4200,
          },
        ],
        tributos: { cstIcms: '41', aliquotaIcms: 0, aliquotaIpi: 0 },
        informacaoComplementar: 'Remessa para conserto; retorno previsto em 30 dias.',
      });
      expect(r.resultado).toMatchObject({ situacao: 'autorizada', cfop: '6915', valorTotal: 4200 });
      expect(Number(r.resultado['numero'])).toBe(2);
      const [n] = await consultar(
        'SELECT n.finalidade_emissao, o.codigo, (SELECT COUNT(*) FROM referencia_nota_mercadoria r WHERE r.nota_mercadoria_id = n.id) AS refs FROM nota_mercadoria n JOIN natureza_operacao o ON o.id = n.natureza_operacao_id WHERE n.id = ?',
        [r.resultado['nota']],
      );
      expect(n).toMatchObject({ finalidade_emissao: 'normal', codigo: 'remessa_conserto' });
      expect(Number(n!['refs'])).toBe(0);
    });

    it('a carta de correção é evento com sequência e confere o texto', async () => {
      const texto = 'Corrigir o endereço de entrega informado nos dados adicionais.';
      const a = await executar('financeiro.corrigir_nota_mercadoria', { nota: primeira, texto });
      const b = await executar('financeiro.corrigir_nota_mercadoria', {
        nota: primeira,
        texto: `${texto} Bloco B.`,
      });
      expect([a.resultado['sequencia'], b.resultado['sequencia']]).toEqual([1, 2]);
      expect(
        await codigoDaGravacao(
          executar('financeiro.corrigir_nota_mercadoria', { nota: primeira, texto: 'curto' }),
        ),
      ).toBe('cce-texto');
      const ev = await consultar(
        "SELECT sequencia_evento, codigo_status FROM evento_nota_mercadoria WHERE nota_mercadoria_id = ? AND tipo_evento = 'carta_correcao' ORDER BY id",
        [primeira],
      );
      expect(ev).toEqual([
        { sequencia_evento: 1, codigo_status: '135' },
        { sequencia_evento: 2, codigo_status: '135' },
      ]);
    });

    it('cancela com motivo e justificativa: a nota fica cancelada e a devolução volta a aceitar nota', async () => {
      expect(
        await codigoDaGravacao(
          executar('financeiro.cancelar_nota_mercadoria', {
            nota: primeira,
            motivo: ids.motivo,
            justificativa: 'curta',
          }),
        ),
      ).toBe('cancelar-justificativa');
      const r = await executar('financeiro.cancelar_nota_mercadoria', {
        nota: primeira,
        motivo: ids.motivo,
        justificativa: JUSTIFICATIVA,
      });
      expect(r.resultado['situacao']).toBe('cancelada');
      const [n] = await consultar(
        'SELECT situacao, cancelada_em IS NOT NULL AS cancelada, motivo_cancelamento_documento_fiscal_id AS motivo FROM nota_mercadoria WHERE id = ?',
        [primeira],
      );
      expect(n).toMatchObject({ situacao: 'cancelada' });
      expect(Number(n!['motivo'])).toBe(ids.motivo);
      const [d] = await consultar('SELECT chave_acesso FROM devolucao_fornecedor WHERE id = ?', [
        ids.devolucao,
      ]);
      expect(d!['chave_acesso']).toBeNull();
      expect(
        await codigoDaGravacao(
          executar('financeiro.corrigir_nota_mercadoria', {
            nota: primeira,
            texto: 'Texto de correção depois do cancelamento.',
          }),
        ),
      ).toBe('cce-situacao');
      // A devolução recebe outra nota (com a referência informada de novo); a cancelada continua no banco.
      const origem = chaveAcessoNfe({
        uf: 'SP',
        emissao: new Date('2026-11-01T12:00:00Z'),
        cnpjEmitente: cnpj('990591400002'),
        serie: 1,
        numero: 78,
        codigoNumerico: 1,
      });
      const nova = await executar('financeiro.emitir_nota_mercadoria', {
        origem: 'devolucao_fornecedor',
        devolucao: ids.devolucao,
        referencias: [origem],
      });
      expect(nova.resultado).toMatchObject({ situacao: 'autorizada', numero: 3 });
      const [q] = await consultar(
        "SELECT COUNT(*) AS q, SUM(situacao = 'cancelada') AS c FROM nota_mercadoria WHERE devolucao_fornecedor_id = ?",
        [ids.devolucao],
      );
      expect([Number(q!['q']), Number(q!['c'])]).toEqual([2, 1]);
    });

    it('a nota de entrada de outro estabelecimento não entra na NF-e (nem a chave dela)', async () => {
      const outra = await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-nm-114' }, async (e) => {
        const um = async (sql: string, p: unknown[] = []) =>
          Number((await e.uma<{ id: number }>(sql, p))?.id ?? 0);
        const est = await um('SELECT id FROM estabelecimento WHERE id <> ? ORDER BY id LIMIT 1', [ids.est]);
        const agora = new Date();
        return e.inserir(
          `INSERT INTO nota_entrada (estabelecimento_id, numero, empresa_fornecedora_id, local_estoque_id,
             tipo_entrada_estoque_id, numero_documento, data_emissao, data_entrada, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            est,
            900_000_000 + Math.floor(Math.random() * 99_999_999),
            ids.fornSp,
            await um('SELECT id FROM local_estoque ORDER BY id LIMIT 1'),
            await um('SELECT id FROM tipo_entrada_estoque ORDER BY id LIMIT 1'),
            `${P}NMX`,
            agora,
            agora,
            agora,
          ],
        );
      });
      expect(
        await codigoDaGravacao(
          executar('financeiro.emitir_nota_mercadoria', {
            origem: 'conserto',
            fornecedor: ids.fornSp,
            notaEntrada: outra,
            itens: [
              {
                codigo: 'BEM-X',
                descricao: 'MONITOR SINTETICO',
                ncm: '90181980',
                quantidade: 1,
                valorUnitario: 10,
              },
            ],
            tributos: { cstIcms: '41', aliquotaIcms: 0, aliquotaIpi: 0 },
          }),
        ),
      ).toBe('nota-entrada');
    });

    it('o histórico e o DANFE leem a nota pelo id, sem a janela das 300 mais recentes da lista', async () => {
      const sqls: string[] = [];
      const h = await m.nucleo.lerSomente(corr, (l) =>
        historicoNotaMercadoria(
          new Proxy(l, {
            get: (alvo, k) =>
              k === 'consultar'
                ? (sql: string, p?: readonly unknown[]) => {
                    sqls.push(sql);
                    return alvo.consultar(sql, p);
                  }
                : Reflect.get(alvo, k),
          }),
          ids.est,
          primeira,
        ),
      );
      expect(h?.nota).toMatchObject({ nota: primeira, situacao: 'cancelada' });
      // A nota vem de uma leitura só, pelo id e pelo estabelecimento, sem LIMIT; a lista não é lida.
      expect(sqls[0]).toMatch(/n\.id = \?$/);
      expect(sqls.some((q) => /LIMIT 300/.test(q))).toBe(false);
      const ler = <T>(fn: Parameters<typeof m.nucleo.lerSomente<T>>[1]) => m.nucleo.lerSomente(corr, fn);
      expect(await ler((l) => notaMercadoriaPorId(l, ids.est + 1_000_000, primeira))).toBeNull();
      expect(await ler((l) => danfeNotaMercadoria(l, ids.est, primeira))).toContain('SEM VALOR FISCAL');
    });

    it('pela Sefaz: sem resposta a nota fica assinada; a transmissão recusa e depois autoriza ou rejeita', async () => {
      const [est] = await consultar('SELECT cnpj FROM estabelecimento WHERE id = ?', [ids.est]);
      const ops = operacoesNotaMercadoria(ARMAZEM, cofreSintetico(String(est!['cnpj'])), {
        simulador,
        sefaz: SEFAZ_FALSA,
      });
      const pela = (nome: OperacaoNotaMercadoria, entrada: Record<string, unknown>) =>
        m.nucleo
          .criarExecutor()
          .executar(ops[nome] as never, CLIENTE, { ...entrada, destino: 'sefaz' }, ctx());
      const conserto = {
        origem: 'conserto',
        fornecedor: ids.fornSp,
        itens: [
          {
            codigo: 'BEM-2',
            descricao: 'BOMBA SINTETICA',
            ncm: '90189099',
            quantidade: 1,
            valorUnitario: 100,
          },
        ],
        tributos: { cstIcms: '41', aliquotaIcms: 0, aliquotaIpi: 0 },
      };
      SEFAZ.modo = 'fora';
      const a = await pela('financeiro.emitir_nota_mercadoria', conserto);
      expect(a.resultado).toMatchObject({ situacao: 'assinada', destino: 'sefaz' });
      const nota = Number(a.resultado['nota']);
      const [n0] = await consultar(
        'SELECT situacao, ambiente, protocolo_autorizacao, (SELECT COUNT(*) FROM evento_nota_mercadoria e WHERE e.nota_mercadoria_id = n.id) AS eventos FROM nota_mercadoria n WHERE id = ?',
        [nota],
      );
      expect(n0).toMatchObject({ situacao: 'assinada', ambiente: 'producao', protocolo_autorizacao: null });
      expect(Number(n0!['eventos'])).toBe(0);
      // A Sefaz segue fora: nada muda; a nota de produção não vai ao simulador.
      expect(await codigoDaGravacao(pela('financeiro.transmitir_nota_mercadoria', { nota }))).toBe(
        'sefaz-indisponivel',
      );
      expect(
        await codigoDaGravacao(
          m.nucleo
            .criarExecutor()
            .executar(
              ops['financeiro.transmitir_nota_mercadoria'] as never,
              CLIENTE,
              { nota, destino: 'simulador' },
              ctx(),
            ),
        ),
      ).toBe('sefaz-indisponivel');
      SEFAZ.modo = 'autoriza';
      SEFAZ.chamadas = [];
      const t = await pela('financeiro.transmitir_nota_mercadoria', { nota });
      expect(t.resultado).toMatchObject({ situacao: 'autorizada' });
      expect(SEFAZ.chamadas).toEqual(['consultar', 'autorizar']);
      const [n1] = await consultar(
        'SELECT situacao, protocolo_autorizacao, autorizada_em IS NOT NULL AS em, codigo_retorno FROM nota_mercadoria WHERE id = ?',
        [nota],
      );
      expect(n1).toMatchObject({ situacao: 'autorizada', codigo_retorno: '100' });
      expect(String(n1!['protocolo_autorizacao'])).toMatch(/^1359/);
      expect(Number(n1!['em'])).toBe(1);
      const ev = await consultar(
        'SELECT tipo_evento, codigo_status, arquivo_id IS NOT NULL AS xml FROM evento_nota_mercadoria WHERE nota_mercadoria_id = ?',
        [nota],
      );
      expect(ev).toEqual([{ tipo_evento: 'autorizacao', codigo_status: '100', xml: 1 }]);
      expect(await codigoDaGravacao(pela('financeiro.transmitir_nota_mercadoria', { nota }))).toBe(
        'transmitir-situacao',
      );
      // O cancelamento da nota de produção vai à Sefaz; sem resposta, nada muda.
      SEFAZ.modo = 'fora';
      expect(
        await codigoDaGravacao(
          pela('financeiro.cancelar_nota_mercadoria', {
            nota,
            motivo: ids.motivo,
            justificativa: JUSTIFICATIVA,
          }),
        ),
      ).toBe('sefaz-indisponivel');
      SEFAZ.modo = 'autoriza';
      const c = await pela('financeiro.cancelar_nota_mercadoria', {
        nota,
        motivo: ids.motivo,
        justificativa: JUSTIFICATIVA,
      });
      expect(c.resultado['situacao']).toBe('cancelada');
      // A segunda nota, rejeitada na transmissão: fica rejeitada, com o evento, e não é ativa.
      SEFAZ.modo = 'fora';
      const b = Number((await pela('financeiro.emitir_nota_mercadoria', conserto)).resultado['nota']);
      SEFAZ.modo = 'rejeita';
      const r = await pela('financeiro.transmitir_nota_mercadoria', { nota: b });
      expect(r.resultado).toMatchObject({ situacao: 'rejeitada' });
      const evb = await consultar(
        'SELECT tipo_evento, codigo_status FROM evento_nota_mercadoria WHERE nota_mercadoria_id = ?',
        [b],
      );
      expect(evb).toEqual([{ tipo_evento: 'rejeicao', codigo_status: '539' }]);
    });
  },
);
