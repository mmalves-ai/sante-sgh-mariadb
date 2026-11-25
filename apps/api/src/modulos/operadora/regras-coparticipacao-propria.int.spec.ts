// F7 (08-SGO linha 98, C2-116): contrato de efeito das regras de coparticipação por escopo no MariaDB real (cliente
// f22_o2, massa sintética "L0209"). A porta inclui a regra geral do plano e a do tipo de guia com tetos (regra_coparticipacao
// com o escopo e os tetos gravados, trilha na mesma transação), recusa tetos invertidos, escopo duplo e vigência
// sobreposta sem gravar nada, encerra pela vigência (a linha fica) e o lançamento da coparticipação usa a regra mais
// específica que casa com o evento. SGH_NUCLEO_SEM_BANCO=1 pula.
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
import { PortaRegrasCoparticipacaoPropria } from './regras-coparticipacao-propria.js';

const COD = `${P}-RC`;
const hoje = new Date().toISOString().slice(0, 10);
const competencia = hoje.slice(0, 7);

describe.skipIf(SEM_BANCO)('regras de coparticipação por escopo (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRegrasCoparticipacaoPropria;
  let servico: ServicoCobrancaOperadora;
  let m: MassaOperadora;
  let s: SessaoCadastro;
  let plano: number;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2116' }, (l) => l.consultar(sql, p));
  const limparRegras = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2116-massa' }, (e) =>
      e.executar('DELETE FROM regra_coparticipacao WHERE operadora_saude_id = ? AND codigo LIKE ?', [
        m.operadora,
        `${COD}%`,
      ]),
    );
  const trilha = () => trilhaTela(m, 'regra_coparticipacao', 'operadora.coparticipacao.regra.incluida');
  const base = () => ({
    codigo: `${COD}-GERAL`,
    descricao: 'REGRA GERAL SINTETICA C2116',
    plano,
    contrato: null,
    tipo: 'percentual' as const,
    valor: 30,
    tetoEvento: null,
    tetoMensal: null,
    tetoAnual: null,
    procedimento: null,
    grupo: null,
    tipoGuia: null,
    regime: null,
    inicio: '2020-01-01',
    fim: null,
  });
  const contar = async () =>
    Number(
      (
        await ler(
          'SELECT COUNT(*) AS n FROM regra_coparticipacao WHERE operadora_saude_id = ? AND codigo LIKE ?',
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
  const lancar = (tipoGuia: number | null) =>
    servico.coparticipacao(s, {
      beneficiario: m.dependente,
      competencia,
      vencimento: `${competencia}-28`,
      valorEvento: 100,
      descricao: 'EVENTO SINTETICO C2116',
      tipoGuia,
    });

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
    porta = new PortaRegrasCoparticipacaoPropria(nucleo, CLIENTE);
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
      login: 'c2116.teste',
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

  it('inclui a regra geral e a do tipo de guia com tetos (efeito no banco e na trilha)', async () => {
    expect(plano).toBeGreaterThan(0);
    const g = await porta.incluir(contexto(m), m.operadora, base(), trilha());
    const e = await porta.incluir(
      contexto(m),
      m.operadora,
      {
        ...base(),
        codigo: `${COD}-GUIA`,
        descricao: 'REGRA DO TIPO DE GUIA C2116',
        tipo: 'valor_fixo',
        valor: 10,
        tetoEvento: 10,
        tetoMensal: 40,
        tetoAnual: 300,
        tipoGuia: m.tipoGuia,
      },
      trilha(),
    );
    const [linha] = await ler(
      `SELECT plano_comercializado_id, contrato_plano_id, tipo_guia_plano_id, tipo_coparticipacao, percentual, valor,
              teto_por_evento, teto_mensal, teto_anual, vigencia_fim, ativo, criado_por
         FROM regra_coparticipacao WHERE id = ?`,
      [e.id],
    );
    expect(linha).toMatchObject({
      plano_comercializado_id: plano,
      contrato_plano_id: null,
      tipo_guia_plano_id: m.tipoGuia,
      tipo_coparticipacao: 'valor_fixo',
      percentual: null,
      vigencia_fim: null,
    });
    expect(['valor', 'teto_por_evento', 'teto_mensal', 'teto_anual'].map((k) => Number(linha?.[k]))).toEqual([
      10, 10, 40, 300,
    ]);
    const t = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'regra_coparticipacao' AND entidade_id IN (?, ?)",
      [String(g.id), String(e.id)],
    );
    expect(Number(t[0]?.['n'])).toBeGreaterThanOrEqual(2);
    const lidas = await porta.regras(contexto(m), m.operadora, { plano, contrato: null });
    expect(lidas.filter((r) => r.codigo.startsWith(COD)).map((r) => [r.codigo, r.vigente])).toEqual(
      expect.arrayContaining([
        [`${COD}-GERAL`, true],
        [`${COD}-GUIA`, true],
      ]),
    );
  });

  it('recusa teto invertido, escopo duplo e vigência sobreposta sem gravar nada', async () => {
    const antes = await contar();
    expect(
      await recusada(
        porta.incluir(
          contexto(m),
          m.operadora,
          { ...base(), codigo: `${COD}-X1`, tetoEvento: 500, tetoMensal: 100 },
          trilha(),
        ),
      ),
    ).toBe('coparticipacao-teto-invalido');
    expect(
      await recusada(
        porta.incluir(
          contexto(m),
          m.operadora,
          { ...base(), codigo: `${COD}-X2`, contrato: m.contrato },
          trilha(),
        ),
      ),
    ).toBe('escopo-invalido');
    expect(
      await recusada(
        porta.incluir(
          contexto(m),
          m.operadora,
          { ...base(), codigo: `${COD}-X3`, inicio: '2024-01-01' },
          trilha(),
        ),
      ),
    ).toBe('regra-sobreposta');
    expect(await contar()).toBe(antes);
  });

  it('o lançamento usa a regra mais específica: tipo de guia (valor fixo 10) ou a geral (30% de 100)', async () => {
    const r1 = await lancar(m.tipoGuia);
    const r2 = await lancar(null);
    const v = await ler('SELECT id, valor_total FROM fatura_plano WHERE id IN (?, ?) ORDER BY id', [
      r1.id,
      r2.id,
    ]);
    expect(v.map((x) => Number(x['valor_total']))).toEqual([10, 30]);
  });

  it('encerra a regra pela vigência: a linha fica, deixa de valer e o fim antes do início recusa', async () => {
    const [r] = (await porta.regras(contexto(m), m.operadora, { plano, contrato: null })).filter(
      (x) => x.codigo === `${COD}-GUIA`,
    );
    expect(
      await recusada(porta.encerrar(contexto(m), r!.id, { versao: r!.versao, fim: '2019-12-31' }, trilha())),
    ).toBe('fim-antes-do-inicio');
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const g = await porta.encerrar(contexto(m), r!.id, { versao: r!.versao, fim: ontem }, trilha());
    expect(g.versao).toBe(r!.versao + 1);
    const [linha] = await ler('SELECT vigencia_fim, ativo FROM regra_coparticipacao WHERE id = ?', [r!.id]);
    expect(linha?.['vigencia_fim']).not.toBeNull();
    const depois = (await porta.regras(contexto(m), m.operadora, { plano, contrato: null })).find(
      (x) => x.id === r!.id,
    );
    expect(depois).toMatchObject({ vigente: false, fim: ontem });
  });
});
