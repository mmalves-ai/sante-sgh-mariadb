// F7 (08-SGO linha 98, C2-116, decisão 56): contrato de efeito do lançamento da franquia na cobrança, no MariaDB real
// (cliente f22_o2, massa sintética). O serviço lê a regra de franquia vigente na data do evento (a do contrato prevalece
// sobre a do plano), soma o que o beneficiário já acumulou na janela (fatura cancelada não conta), calcula pelo domínio
// (calcularFranquia: percentual, teto por guia, limite da janela) e grava a fatura de fator moderador com o item no tipo
// de lançamento "franquia". Sem regra, recusa e nada grava (nada trava o resto da cobrança). SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { PortaCobrancaOperadoraPropria } from './cobranca-porta-propria.js';
import { ServicoCobrancaOperadora } from './cobranca-servico.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparNegocio,
  type MassaOperadora,
  P,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';
import { PortaRegrasFranquiaPropria, type RegraFranquiaCadastro } from './regras-franquia-propria.js';

const COD = `${P}-FL`;
const hoje = new Date().toISOString().slice(0, 10);
const competencia = hoje.slice(0, 7);
const vencimento = `${competencia}-28`;

describe.skipIf(SEM_BANCO)('lançamento da franquia na cobrança (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let regras: PortaRegrasFranquiaPropria;
  let servico: ServicoCobrancaOperadora;
  let m: MassaOperadora;
  let s: SessaoCadastro;
  let plano: number;
  let tipoFranquia: number;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2116l' }, (l) => l.consultar(sql, p));
  const escrever = (sql: string, p: unknown[] = []) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2116l-massa' }, (e) => e.executar(sql, p));
  const limparRegras = () =>
    escrever('DELETE FROM regra_franquia_plano WHERE operadora_saude_id = ? AND codigo LIKE ?', [
      m.operadora,
      `${COD}%`,
    ]);
  const incluir = (x: Partial<RegraFranquiaCadastro>) =>
    regras.incluir(
      contexto(m),
      m.operadora,
      {
        codigo: `${COD}-MES`,
        descricao: 'FRANQUIA MENSAL SINTETICA C2116L',
        tipoFranquia,
        plano,
        contrato: null,
        grupo: null,
        regime: null,
        valor: 100,
        percentual: 50,
        fator: null,
        tetoPorGuia: 40,
        periodoAcumulo: 'mes',
        diasInternacao: null,
        cobraGuiaAmbulatorialNaInternacao: false,
        inicio: '2020-01-01',
        fim: null,
        ...x,
      },
      trilhaTela(m, 'regra_franquia_plano', 'operadora.franquia.regra.incluida'),
    );
  const lancar = (valorEvento: number, dataEvento = hoje) =>
    servico.franquia(s, {
      beneficiario: m.dependente,
      competencia,
      vencimento,
      dataEvento,
      valorEvento,
      descricao: 'CONSULTA SINTETICA FRANQUIA C2116',
    });
  const recusada = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return codigoDe(e) ?? JSON.stringify(e);
    }
  };
  const faturas = async () =>
    Number(
      (
        await ler(
          `SELECT COUNT(*) AS n FROM fatura_plano f JOIN fatura_plano_item i ON i.fatura_plano_id = f.id
            WHERE f.estabelecimento_id = ? AND i.descricao LIKE 'Franquia:%'`,
          [m.est],
        )
      )[0]?.['n'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparNegocio(nucleo, m);
    await limparRegras();
    plano = Number(
      (
        await ler(
          'SELECT id FROM plano_comercializado WHERE estabelecimento_id = ? AND produto_plano_id = ?',
          [m.est, m.produto],
        )
      )[0]?.['id'],
    );
    const cod = `${P}-TF`;
    if (!(await ler('SELECT id FROM tipo_franquia WHERE codigo = ?', [cod])).length)
      await escrever(
        "INSERT INTO tipo_franquia (codigo, descricao, base_calculo, criado_em) VALUES (?, 'FRANQUIA POR PERIODO SINTETICA', 'periodo', NOW(3))",
        [cod],
      );
    tipoFranquia = Number((await ler('SELECT id FROM tipo_franquia WHERE codigo = ?', [cod]))[0]?.['id']);
    if (!(await ler("SELECT id FROM tipo_lancamento_fatura WHERE codigo = 'franquia'")).length)
      await escrever(
        "INSERT INTO tipo_lancamento_fatura (codigo, descricao, natureza, criado_em) VALUES ('franquia', 'franquia sintetico', 'debito', NOW(3))",
      );
    regras = new PortaRegrasFranquiaPropria(nucleo, CLIENTE);
    servico = new ServicoCobrancaOperadora(
      new PortaCobrancaOperadoraPropria(nucleo, CLIENTE),
      { exigir: async () => undefined } as unknown as ConstructorParameters<
        typeof ServicoCobrancaOperadora
      >[1],
      null,
      'teste',
    );
    const c = contexto(m);
    s = {
      req: { headers: {}, ip: '127.0.0.1', sgh: { sessao: { unidadeAtiva: null } } } as never,
      hospital: c.hospital,
      rede: c.rede,
      login: 'c2116l.teste',
      porta: c,
      pode: () => true,
    };
  }, 120_000);
  afterAll(async () => {
    if (m) {
      await limparNegocio(nucleo, m);
      await limparRegras();
    }
    await nucleo?.encerrar();
  });

  it('sem regra de franquia: recusa franquia-sem-regra e nada grava', async () => {
    expect(await recusada(lancar(80))).toMatch(/franquia-sem-regra/);
    expect(await faturas()).toBe(0);
  });

  it('regra do plano: percentual e teto por guia, item no tipo "franquia", limite da janela e fatura cancelada fora', async () => {
    expect(plano).toBeGreaterThan(0);
    await incluir({});
    const a = await lancar(60); // 50% de 60 = 30
    const [f] = await ler(
      `SELECT f.tipo_fatura, f.valor_total, i.valor, i.valor_unitario, i.beneficiario_plano_id, t.codigo AS lancamento
         FROM fatura_plano f JOIN fatura_plano_item i ON i.fatura_plano_id = f.id
         JOIN tipo_lancamento_fatura t ON t.id = i.tipo_lancamento_fatura_id WHERE f.id = ?`,
      [a.id],
    );
    expect(f).toMatchObject({
      tipo_fatura: 'coparticipacao',
      beneficiario_plano_id: m.dependente,
      lancamento: 'franquia',
    });
    expect([f?.['valor_total'], f?.['valor'], f?.['valor_unitario']].map(Number)).toEqual([30, 30, 60]);
    expect(a.avisos.join(' ')).toMatch(/Falta R\$ 70\.00/);
    const b = await lancar(200); // 50% de 200 = 100, teto por guia 40
    expect(
      Number((await ler('SELECT valor_total FROM fatura_plano WHERE id = ?', [b.id]))[0]?.['valor_total']),
    ).toBe(40);
    expect(b.avisos.join(' ')).toMatch(/teto por guia/);
    const c = await lancar(200); // falta 30 do limite de 100
    expect(
      Number((await ler('SELECT valor_total FROM fatura_plano WHERE id = ?', [c.id]))[0]?.['valor_total']),
    ).toBe(30);
    expect(await recusada(lancar(50))).toMatch(/franquia-zero/);
    expect(await faturas()).toBe(3);
    // A fatura cancelada sai do acumulado: volta a caber franquia na janela.
    await escrever(
      "UPDATE fatura_plano SET situacao = 'cancelada', cancelada_em = NOW(3), motivo_cancelamento = 'TESTE SINTETICO C2116' WHERE id = ?",
      [c.id],
    );
    const d = await lancar(20);
    expect(
      Number((await ler('SELECT valor_total FROM fatura_plano WHERE id = ?', [d.id]))[0]?.['valor_total']),
    ).toBe(10);
  });

  it('a regra do contrato prevalece sobre a do plano; fora da vigência de todas, recusa sem gravar', async () => {
    await incluir({
      codigo: `${COD}-CTR`,
      plano: null,
      contrato: m.contrato,
      valor: null,
      percentual: null,
      fator: 0.1,
      tetoPorGuia: null,
      periodoAcumulo: 'evento',
    });
    const r = await lancar(150);
    expect(
      Number((await ler('SELECT valor_total FROM fatura_plano WHERE id = ?', [r.id]))[0]?.['valor_total']),
    ).toBe(15);
    const antes = await faturas();
    expect(await recusada(lancar(150, '2019-06-10'))).toMatch(/franquia-sem-regra/);
    expect(await faturas()).toBe(antes);
  });
});
