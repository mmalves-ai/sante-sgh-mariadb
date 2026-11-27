// Contrato de efeito da adesão à ata de registro de preços (C2-017, 09-AREA linha 81; Lei 14.133, art. 86) contra o
// MariaDB real (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: a ata do estabelecimento
// A (100 registrados) recebe a carona do estabelecimento B; acima de 50% por órgão é recusada sem gravar; a solicitação
// fica com a registrada e o preço relidos da ata; a repetição pela mesma chave não grava de novo; a autorização sem o
// aceite do fornecedor é recusada; com os dois aceites e a documentação, fica autorizada com a aderida, o ofício, quem
// avaliou e quando; a nova carona do mesmo órgão passa do limite pela aderida; a ata de outro órgão grava o gerenciador
// e a negação guarda o motivo. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { fimMaximoVigenciaAta } from '@sgh/contratos/regras-suprimentos';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { EntradaAdesao } from './adesao-ata.js';
import { PortaAtaEmpenhoPropria } from './ata-empenho.js';
import { hojeNoEstabelecimento } from './porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';

const k = () => `t-ade-${randomUUID()}`;
const MARCA = Date.now().toString(36).toUpperCase();
type L = Record<string, unknown>;

describe.skipIf(SEM_BANCO)('adesão à ata de registro de preços (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtaEmpenhoPropria;
  let m: MassaSuprimentos;
  let cA: ContextoPortaM18;
  let cB: ContextoPortaM18;
  let ata = 0;
  let hoje = '';
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2017-ade' }, (l) => l.uma<L>(sql, p));
  const contar = async () =>
    Number(
      (
        await um('SELECT COUNT(*) AS n FROM adesao_ata_registro_preco WHERE estabelecimento_id IN (?, ?)', [
          m.estA,
          m.estB,
        ])
      )?.['n'],
    );
  const adesao = (x: Partial<EntradaAdesao> = {}): EntradaAdesao => ({
    numero: `AD${MARCA}`,
    tipo: 'carona',
    ata,
    orgaoGerenciador: null,
    numeroProcesso: null,
    numeroPregao: null,
    insumo: m.insumo,
    fornecedor: m.fornecedor,
    quantidadeRegistrada: null,
    quantidadeSolicitada: 40,
    valorUnitario: null,
    dataSolicitacao: hoje,
    justificativa: 'Preço registrado abaixo da pesquisa de mercado sintética.',
    ...x,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaAtaEmpenhoPropria(nucleo);
    cA = contexto(m, m.estA, 't-c2017-ade') as ContextoPortaM18;
    cB = contexto(m, m.estB, 't-c2017-ade') as ContextoPortaM18;
    hoje = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2017-ade' }, (l) =>
      hojeNoEstabelecimento(l, m.estB),
    );
    const inicio = `${hoje.slice(0, 7)}-01`;
    const fim = fimMaximoVigenciaAta(inicio);
    ata = (
      await porta.registrarAta(
        cA,
        {
          numero: `ARPA${MARCA}`,
          objeto: 'Material médico sintético',
          vigenciaInicio: inicio,
          vigenciaFim: fim,
          processo: null,
          observacao: null,
          itens: [
            { insumo: m.insumo, fornecedor: m.fornecedor, quantidade: 100, valorUnitario: 2.5, marca: null },
          ],
        },
        k(),
      )
    ).id;
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2017-ade-limpa' }, async (e) => {
        await e.executar('DELETE FROM adesao_ata_registro_preco WHERE estabelecimento_id IN (?, ?)', [
          m.estA,
          m.estB,
        ]);
        await e.executar(
          'DELETE i FROM ata_registro_preco_item i JOIN ata_registro_preco a ON a.id = i.ata_registro_preco_id WHERE a.estabelecimento_id IN (?, ?)',
          [m.estA, m.estB],
        );
        await e.executar('DELETE FROM ata_registro_preco WHERE estabelecimento_id IN (?, ?)', [
          m.estA,
          m.estB,
        ]);
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  it('a carona respeita 50% por órgão, exige os aceites e fica autorizada com quem avaliou', async () => {
    const antes = await contar();
    expect(await codigoDe(porta.solicitarAdesao(cB, adesao({ quantidadeSolicitada: 51 }), k()))).toBe(
      'adesao-acima-do-limite-do-orgao',
    );
    expect(await codigoDe(porta.solicitarAdesao(cB, adesao({ valorUnitario: 3 }), k()))).toBe(
      'adesao-preco-acima-do-registrado',
    );
    expect(await contar()).toBe(antes);

    const chave = k();
    const r = await porta.solicitarAdesao(cB, adesao(), chave);
    expect(r).toMatchObject({ itens: 1, valorTotal: 100 });
    expect((await porta.solicitarAdesao(cB, adesao(), chave)).id).toBe(r.id);
    expect(await contar()).toBe(antes + 1);
    const gravada = await um(
      'SELECT tipo, situacao, quantidade_registrada, quantidade_solicitada, valor_unitario, ata_registro_preco_id, versao FROM adesao_ata_registro_preco WHERE id = ?',
      [r.id],
    );
    expect(gravada).toMatchObject({ tipo: 'carona', situacao: 'solicitada', ata_registro_preco_id: ata });
    expect(Number(gravada?.['quantidade_registrada'])).toBe(100);
    expect(Number(gravada?.['valor_unitario'])).toBe(2.5);
    const versao = Number(gravada?.['versao']);

    const decisao = {
      decisao: 'autorizar' as const,
      versao,
      quantidadeAderida: 30,
      numeroOficio: 'OF-1/2026',
      aceiteGerenciador: true,
      aceiteFornecedor: false,
      documentacaoConferida: true,
    };
    expect(await codigoDe(porta.decidirAdesao(cB, r.id, decisao, k()))).toBe('adesao-sem-aceite-fornecedor');
    // Outro estabelecimento não decide a adesão de B.
    expect(await codigoDe(porta.decidirAdesao(cA, r.id, { ...decisao, aceiteFornecedor: true }, k()))).toBe(
      'adesao-inexistente',
    );
    await porta.decidirAdesao(
      cB,
      r.id,
      { ...decisao, aceiteFornecedor: true, aceiteFornecedorEm: hoje },
      k(),
    );
    const autorizada = await um(
      'SELECT situacao, quantidade_aderida, numero_oficio, oficio_autorizado, aceite_fornecedor, documentacao_conferida, avaliador_usuario_id, avaliado_em FROM adesao_ata_registro_preco WHERE id = ?',
      [r.id],
    );
    expect(autorizada).toMatchObject({
      situacao: 'autorizada',
      numero_oficio: 'OF-1/2026',
      avaliador_usuario_id: m.usuario,
    });
    expect(Number(autorizada?.['quantidade_aderida'])).toBe(30);
    expect(Number(autorizada?.['oficio_autorizado'])).toBe(1);
    expect(Number(autorizada?.['aceite_fornecedor'])).toBe(1);
    expect(autorizada?.['avaliado_em']).not.toBeNull();

    // O mesmo órgão já ocupa 30 (a aderida): mais 21 passaria de 50.
    expect(
      await codigoDe(
        porta.solicitarAdesao(cB, adesao({ numero: `AE${MARCA}`, quantidadeSolicitada: 21 }), k()),
      ),
    ).toBe('adesao-acima-do-limite-do-orgao');
    expect((await porta.adesoes(cB)).find((a) => a.id === r.id)).toMatchObject({
      situacao: 'autorizada',
      quantidadeAderida: 30,
      aceiteFornecedor: true,
    });
    expect((await porta.adesoes(cA)).find((a) => a.id === r.id)).toBeUndefined();
  });

  it('a ata de outro órgão grava o gerenciador e a negação guarda o motivo', async () => {
    expect(
      await codigoDe(
        porta.solicitarAdesao(
          cA,
          adesao({ numero: `AX${MARCA}`, ata: null, quantidadeRegistrada: 200, valorUnitario: 4 }),
          k(),
        ),
      ),
    ).toBe('adesao-sem-gerenciador');
    const r = await porta.solicitarAdesao(
      cA,
      adesao({
        numero: `AX${MARCA}`,
        ata: null,
        orgaoGerenciador: 'Secretaria sintética de saúde',
        numeroPregao: 'PE-9/2026',
        quantidadeRegistrada: 200,
        valorUnitario: 4,
        quantidadeSolicitada: 100,
      }),
      k(),
    );
    const v = Number(
      (await um('SELECT versao FROM adesao_ata_registro_preco WHERE id = ?', [r.id]))?.['versao'],
    );
    expect(
      await codigoDe(porta.decidirAdesao(cA, r.id, { decisao: 'negar', versao: v, motivo: 'curto' }, k())),
    ).toBe('adesao-sem-motivo');
    await porta.decidirAdesao(
      cA,
      r.id,
      { decisao: 'negar', versao: v, motivo: 'Gerenciador não autorizou a adesão.' },
      k(),
    );
    expect(
      await um(
        'SELECT situacao, orgao_gerenciador, numero_pregao, motivo_decisao FROM adesao_ata_registro_preco WHERE id = ?',
        [r.id],
      ),
    ).toMatchObject({
      situacao: 'negada',
      orgao_gerenciador: 'Secretaria sintética de saúde',
      numero_pregao: 'PE-9/2026',
      motivo_decisao: 'Gerenciador não autorizou a adesão.',
    });
  });
});
