// F7 (08-SGO linha 98, C2-116): contrato de efeito das regras de franquia no MariaDB real (cliente f22_o2, massa
// sintética "L0209"). A porta inclui a regra do plano (regra_franquia_plano com limite, percentual, teto por guia,
// janela e internação gravados, trilha na mesma transação), recusa o que o domínio recusa (problemasDaFranquia), o
// escopo duplo e a vigência sobreposta sem gravar nada, encerra pela vigência (a linha fica) e soma o acumulado da
// janela só com os lançamentos válidos (a fatura cancelada sai da conta). SGH_NUCLEO_SEM_BANCO=1 pula.
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

const COD = `${P}-RF`;
const hoje = new Date().toISOString().slice(0, 10);
const competencia = hoje.slice(0, 7);

describe.skipIf(SEM_BANCO)('regras de franquia do plano (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRegrasFranquiaPropria;
  let servico: ServicoCobrancaOperadora;
  let m: MassaOperadora;
  let s: SessaoCadastro;
  let plano: number;
  let tipoFranquia: number;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2116f' }, (l) => l.consultar(sql, p));
  const escrever = (sql: string, p: unknown[] = []) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2116f-massa' }, (e) => e.executar(sql, p));
  const limparRegras = async () => {
    await escrever('DELETE FROM regra_franquia_plano WHERE operadora_saude_id = ? AND codigo LIKE ?', [
      m.operadora,
      `${COD}%`,
    ]);
    await escrever('DELETE FROM regra_coparticipacao WHERE operadora_saude_id = ? AND codigo LIKE ?', [
      m.operadora,
      `${COD}%`,
    ]);
  };
  const trilha = () => trilhaTela(m, 'regra_franquia_plano', 'operadora.franquia.regra.incluida');
  const base = (): RegraFranquiaCadastro => ({
    codigo: `${COD}-MES`,
    descricao: 'FRANQUIA MENSAL SINTETICA C2116',
    tipoFranquia,
    plano,
    contrato: null,
    grupo: null,
    regime: null,
    valor: 200,
    percentual: 50,
    fator: null,
    tetoPorGuia: 80,
    periodoAcumulo: 'mes',
    diasInternacao: 3,
    cobraGuiaAmbulatorialNaInternacao: false,
    inicio: '2020-01-01',
    fim: null,
  });
  const contar = async () =>
    Number(
      (
        await ler(
          'SELECT COUNT(*) AS n FROM regra_franquia_plano WHERE operadora_saude_id = ? AND codigo LIKE ?',
          [m.operadora, `${COD}%`],
        )
      )[0]?.['n'],
    );
  const recusada = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return codigoDe(e);
    }
  };

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
    porta = new PortaRegrasFranquiaPropria(nucleo, CLIENTE);
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
      login: 'c2116f.teste',
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

  it('inclui a franquia do plano (efeito no banco e na trilha) e a lista como vigente', async () => {
    expect(plano).toBeGreaterThan(0);
    const g = await porta.incluir(contexto(m), m.operadora, base(), trilha());
    const [linha] = await ler(
      `SELECT plano_comercializado_id, contrato_plano_id, tipo_franquia_id, valor, percentual, fator, teto_por_guia,
              periodo_acumulo, dias_internacao, cobra_guia_ambulatorial_na_internacao, vigencia_fim, ativo
         FROM regra_franquia_plano WHERE id = ?`,
      [g.id],
    );
    expect(linha).toMatchObject({
      plano_comercializado_id: plano,
      contrato_plano_id: null,
      tipo_franquia_id: tipoFranquia,
      fator: null,
      periodo_acumulo: 'mes',
      dias_internacao: 3,
      vigencia_fim: null,
    });
    expect(['valor', 'percentual', 'teto_por_guia'].map((k) => Number(linha?.[k]))).toEqual([200, 50, 80]);
    expect(Number(linha?.['cobra_guia_ambulatorial_na_internacao'])).toBe(0);
    const t = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'regra_franquia_plano' AND entidade_id = ?",
      [String(g.id)],
    );
    expect(Number(t[0]?.['n'])).toBeGreaterThanOrEqual(1);
    const lidas = await porta.regras(contexto(m), m.operadora, { plano, contrato: null });
    expect(lidas.find((r) => r.id === g.id)).toMatchObject({
      codigo: `${COD}-MES`,
      vigente: true,
      tetoPorGuia: 80,
    });
  });

  it('recusa percentual com fator, teto acima do limite, escopo duplo e vigência sobreposta sem gravar nada', async () => {
    const antes = await contar();
    const tentar = (x: Partial<RegraFranquiaCadastro>) =>
      recusada(porta.incluir(contexto(m), m.operadora, { ...base(), ...x }, trilha()));
    expect(await tentar({ codigo: `${COD}-X1`, fator: 0.5 })).toBe('franquia-percentual-ou-fator');
    expect(await tentar({ codigo: `${COD}-X2`, tetoPorGuia: 500 })).toBe('franquia-teto-acima-do-limite');
    expect(await tentar({ codigo: `${COD}-X3`, contrato: m.contrato })).toBe('escopo-invalido');
    expect(await tentar({ codigo: `${COD}-X4`, inicio: '2024-01-01' })).toBe('regra-sobreposta');
    expect(await contar()).toBe(antes);
  });

  it('soma o acumulado da janela só com os lançamentos válidos (a fatura cancelada sai da conta)', async () => {
    const [r] = (await porta.regras(contexto(m), m.operadora, { plano, contrato: null })).filter(
      (x) => x.codigo === `${COD}-MES`,
    );
    const vazio = await porta.acumulado(contexto(m), r!.id, m.dependente, hoje);
    expect(vazio).toMatchObject({ acumulado: 0, restante: 200 });
    expect(vazio.janela.inicio).toBe(`${competencia}-01`);
    // O lançamento de franquia na cobrança é o próximo item da linha; aqui a regra aponta o tipo de lançamento de um
    // lançamento já existente para provar a soma na janela.
    await escrever(
      `INSERT INTO regra_coparticipacao (operadora_saude_id, codigo, descricao, plano_comercializado_id,
         tipo_coparticipacao, percentual, vigencia_inicio, ativo, criado_em)
       VALUES (?, ?, 'COPARTICIPACAO SINTETICA C2116F', ?, 'percentual', 50, '2020-01-01', TRUE, NOW(3))`,
      [m.operadora, `${COD}-COP`, plano],
    );
    await escrever(
      "UPDATE regra_franquia_plano SET tipo_lancamento_fatura_id = (SELECT id FROM tipo_lancamento_fatura WHERE codigo = 'coparticipacao') WHERE id = ?",
      [r!.id],
    );
    const f = await servico.coparticipacao(s, {
      beneficiario: m.dependente,
      competencia,
      vencimento: `${competencia}-28`,
      valorEvento: 60,
      descricao: 'EVENTO SINTETICO FRANQUIA C2116',
      tipoGuia: null,
    });
    const [v] = await ler('SELECT valor_total FROM fatura_plano WHERE id = ?', [f.id]);
    const lancado = Number(v?.['valor_total']);
    expect(lancado).toBeGreaterThan(0);
    expect(await porta.acumulado(contexto(m), r!.id, m.dependente, hoje)).toMatchObject({
      acumulado: lancado,
      restante: Math.round((200 - lancado) * 100) / 100,
    });
    await escrever(
      "UPDATE fatura_plano SET situacao = 'cancelada', cancelada_em = NOW(3), motivo_cancelamento = 'TESTE SINTETICO C2116' WHERE id = ?",
      [f.id],
    );
    expect((await porta.acumulado(contexto(m), r!.id, m.dependente, hoje)).acumulado).toBe(0);
  });

  it('encerra pela vigência: a linha fica, deixa de valer e o fim antes do início recusa', async () => {
    const [r] = (await porta.regras(contexto(m), m.operadora, { plano, contrato: null })).filter(
      (x) => x.codigo === `${COD}-MES`,
    );
    expect(
      await recusada(porta.encerrar(contexto(m), r!.id, { versao: r!.versao, fim: '2019-12-31' }, trilha())),
    ).toBe('fim-antes-do-inicio');
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const g = await porta.encerrar(contexto(m), r!.id, { versao: r!.versao, fim: ontem }, trilha());
    expect(g.versao).toBe(r!.versao + 1);
    const depois = (await porta.regras(contexto(m), m.operadora, { plano, contrato: null })).find(
      (x) => x.id === r!.id,
    );
    expect(depois).toMatchObject({ vigente: false, fim: ontem });
  });
});
