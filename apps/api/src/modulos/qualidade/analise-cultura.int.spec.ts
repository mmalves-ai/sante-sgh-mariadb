// Contrato de efeito da análise da cultura positiva (F7, 09-AREA linha 68) contra o MariaDB do cliente de teste.
// Massa SINTÉTICA: a do SADT (estabelecimento, paciente, atendimento, requisição e resultado liberado) com a cultura
// estruturada acrescentada aqui (resultado_cultura com crescimento, dois germes, um multirresistente). Prova o que fica
// no banco: a conduta do cadastro, a análise por germe com a precaução herdada, a recusa da análise repetida e do
// germe ausente, a correção com versão conferida e a versão anterior na trilha, e a leitura restrita ao estabelecimento.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from '../sadt/aplicacao/copia.spec-util.js';
import { contextoDe } from '../enfermagem/massa-enfermagem.spec-util.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaAnaliseCulturaPropria } from './porta-analise-cultura-propria.js';

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe.skipIf(SEM_BANCO)('análise da cultura positiva (porta própria, MariaDB)', () => {
  const nucleo = new NucleoProprio();
  let m: MassaSadt | null = null;
  let porta: PortaAnaliseCulturaPropria;
  let cultura = 0;
  let germeMr = 0;
  let germe2 = 0;
  let condutaContato = 0;
  const marcaConduta = `T${Date.now().toString(36).slice(-6).toUpperCase()}`;
  const trilha = (id: number, entidade = 'analise_cultura_positiva'): TrilhaDaGravacao => ({
    estabelecimento: m?.base.est ?? null,
    usuario: m?.base.usuario ?? null,
    acao: 'operacao',
    entidade,
    entidadeId: id,
    correlacao: 'teste-analise-cultura',
  });
  const trilhaConduta = (id: number) => trilha(id, 'conduta_analise_cultura');
  const ctx = () => contextoDe(m!.base) as unknown as Parameters<PortaAnaliseCulturaPropria['culturas']>[0];
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-acp' }, (l) => l.consultar<T>(sql, p, { teto: 50 }));

  beforeAll(async () => {
    m = await montarMassaSadt(nucleo, 'ACP');
    porta = new PortaAnaliseCulturaPropria(nucleo);
    const ids = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-acp' }, async (e) => {
      const agora = new Date();
      const material = Number(
        (await e.uma<{ id: number }>("SELECT id FROM material_biologico WHERE codigo = 'SANGUE-T'", []))!.id,
      );
      const germe = async (cod: string) => {
        const r = await e.uma<{ id: number }>('SELECT id FROM microrganismo WHERE codigo = ?', [cod]);
        return r
          ? Number(r.id)
          : e.inserir(
              "INSERT INTO microrganismo (codigo, descricao, ativo, grupo, criado_em) VALUES (?, ?, TRUE, 'bacteria', ?)",
              [cod, `GERME SINTETICO ${cod}`, agora],
            );
      };
      const mo1 = await germe('ACP-G1');
      const mo2 = await germe('ACP-G2');
      const rc = await e.inserir(
        `INSERT INTO resultado_cultura (resultado_exame_id, material_biologico_id, crescimento, situacao, notifica_controle_infeccao,
           criado_em, versao) VALUES (?, ?, 'com_crescimento', 'final', TRUE, ?, 1)`,
        [m!.resultado, material, agora],
      );
      const iso = (seq: number, mo: number, mr: boolean) =>
        e.inserir(
          `INSERT INTO isolado_microbiano (resultado_cultura_id, sequencia, microrganismo_id, multirresistente, criado_em, versao)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [rc, seq, mo, mr, agora],
        );
      return { rc, g1: await iso(1, mo1, true), g2: await iso(2, mo2, false) };
    });
    cultura = ids.rc;
    germeMr = ids.g1;
    germe2 = ids.g2;
  }, 120_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-acp' }, async (e) => {
        await e.executar('DELETE FROM analise_cultura_positiva WHERE resultado_cultura_id = ?', [cultura]);
        await e.executar('DELETE FROM isolado_microbiano WHERE resultado_cultura_id = ?', [cultura]);
        await e.executar('DELETE FROM resultado_cultura WHERE id = ?', [cultura]);
        await e.executar('DELETE FROM conduta_analise_cultura WHERE codigo LIKE ?', [`${marcaConduta}%`]);
      });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 120_000);

  it('cadastra a conduta (código único) e a lista', async () => {
    const r = await porta.registrarConduta(
      ctx(),
      m!.base.login,
      {
        codigo: `${marcaConduta}-CONTATO`,
        descricao: 'Precaução de contato e orientar o prescritor',
        classificacaoAplicavel: null,
        abreCaso: false,
        indicaPrecaucao: true,
        exigeResposta: true,
      },
      trilhaConduta,
    );
    condutaContato = r.id;
    expect(
      await codigo(
        porta.registrarConduta(
          ctx(),
          m!.base.login,
          {
            codigo: `${marcaConduta}-CONTATO`,
            descricao: 'Repetida',
            classificacaoAplicavel: null,
            abreCaso: false,
            indicaPrecaucao: false,
            exigeResposta: false,
          },
          trilhaConduta,
        ),
      ),
    ).toBe('conduta-ja-cadastrada');
    expect((await porta.condutas(ctx())).some((x) => x.id === condutaContato && x.indicaPrecaucao)).toBe(
      true,
    );
  });

  it('lista a cultura pendente com os dois germes, só no estabelecimento da sessão', async () => {
    const lista = await porta.culturas(ctx(), '2000-01-01', m!.base.paciente);
    const c = lista.find((x) => x.id === cultura);
    expect(c?.pendente).toBe(true);
    expect(c?.germes.map((g) => [g.id, g.multirresistente, g.analisado])).toEqual([
      [germeMr, true, false],
      [germe2, false, false],
    ]);
    const outro = await porta.culturas(contextoDe(m!.base, m!.base.outroEst) as never, '2000-01-01');
    expect(outro.some((x) => x.id === cultura)).toBe(false);
  });

  it('recusa sem germe escolhido e sem o prescritor orientado; grava a análise com a precaução herdada', async () => {
    const base = {
      classificacao: 'colonizacao',
      isolado: null,
      conduta: condutaContato,
      condutaDescricao: null,
      precaucaoIndicada: false,
      prescritorOrientado: false,
      casoInfeccao: null,
    };
    expect(await codigo(porta.registrar(ctx(), m!.base.login, cultura, base, trilha as never))).toBe(
      'isolado-obrigatorio',
    );
    expect(
      await codigo(
        porta.registrar(ctx(), m!.base.login, cultura, { ...base, isolado: germeMr }, trilha as never),
      ),
    ).toBe('prescritor-nao-orientado');
    const r = await porta.registrar(
      ctx(),
      m!.base.login,
      cultura,
      { ...base, isolado: germeMr, prescritorOrientado: true },
      (x) => trilha(x.id),
    );
    expect(r.pendencias).toEqual(['aplicar-precaucao']);
    const [linha] = await ler<Record<string, unknown>>(
      `SELECT estabelecimento_id, paciente_id, isolado_microbiano_id, classificacao, precaucao_indicada,
              prescritor_orientado, conduta_analise_cultura_id, analista_usuario_id, versao
         FROM analise_cultura_positiva WHERE id = ?`,
      [r.id],
    );
    expect(linha).toMatchObject({
      estabelecimento_id: m!.base.est,
      paciente_id: m!.base.paciente,
      isolado_microbiano_id: germeMr,
      classificacao: 'colonizacao',
      conduta_analise_cultura_id: condutaContato,
      analista_usuario_id: m!.base.usuario,
      versao: 1,
    });
    expect(Number(linha!['precaucao_indicada'])).toBe(1);
    expect(Number(linha!['prescritor_orientado'])).toBe(1);
    expect(
      await codigo(
        porta.registrar(
          ctx(),
          m!.base.login,
          cultura,
          { ...base, isolado: germeMr, prescritorOrientado: true },
          trilha as never,
        ),
      ),
    ).toBe('analise-ja-registrada');
    const trilhas = await ler<{ q: number }>(
      "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'analise_cultura_positiva' AND entidade_id = ?",
      [String(r.id)],
    );
    expect(Number(trilhas[0]!.q)).toBe(1);
  });

  it('corrige com a versão conferida e guarda a anterior na trilha; a cultura segue pendente pelo outro germe', async () => {
    const [a] = await porta.analises(ctx(), { cultura });
    const entrada = {
      classificacao: 'contaminacao',
      isolado: null,
      conduta: null,
      condutaDescricao: 'Contaminante de coleta, sem conduta',
      precaucaoIndicada: false,
      prescritorOrientado: false,
      casoInfeccao: null,
    };
    expect(
      await codigo(
        porta.corrigir(ctx(), m!.base.login, a!.id, a!.versao + 5, entrada, 'revisão', (x) => trilha(x.id)),
      ),
    ).toBe('versao-desatualizada');
    const r = await porta.corrigir(
      ctx(),
      m!.base.login,
      a!.id,
      a!.versao,
      entrada,
      'revisão da comissão',
      (x) => trilha(x.id),
    );
    expect(r.versao).toBe(2);
    const [depois] = await porta.analises(ctx(), { paciente: m!.base.paciente });
    expect(depois).toMatchObject({ id: a!.id, classificacao: 'contaminacao', conduta: null, versao: 2 });
    const t = await ler<{ q: number }>(
      `SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'analise_cultura_positiva' AND entidade_id = ?
          AND JSON_EXTRACT(dados_depois, '$.dados.versaoAnterior.versao') = 1`,
      [String(a!.id)],
    );
    expect(Number(t[0]!.q)).toBe(1);
    const c = (await porta.culturas(ctx(), '2000-01-01')).find((x) => x.id === cultura);
    expect(c?.pendente).toBe(true);
    expect(c?.germes.find((g) => g.id === germe2)?.analisado).toBe(false);
  });

  it('relê as pendências: a infecção sem ficha de IRAS deixa a cultura na fila mesmo com todos os germes analisados', async () => {
    const r = await porta.registrar(
      ctx(),
      m!.base.login,
      cultura,
      {
        classificacao: 'infeccao',
        isolado: germe2,
        conduta: null,
        condutaDescricao: 'Infecção de corrente sanguínea: discutir com o prescritor',
        precaucaoIndicada: false,
        prescritorOrientado: true,
        casoInfeccao: null,
      },
      (x) => trilha(x.id),
    );
    expect(r.pendencias).toEqual(['abrir-ficha-iras']);
    const lidas = await porta.analises(ctx(), { cultura });
    expect(lidas.find((a) => a.id === r.id)?.pendencias).toEqual(['abrir-ficha-iras']);
    const c = (await porta.culturas(ctx(), '2000-01-01', m!.base.paciente)).find((x) => x.id === cultura);
    expect(c).toMatchObject({ faltaAnalisar: false, pendencias: ['abrir-ficha-iras'], pendente: true });
  });

  it('a retificação do laudo depois da análise pede revisão; a correção grava laudo_retificado e fecha a revisão', async () => {
    // O laboratório retifica o laudo (simulado na massa: a retificação estruturada é da 05-SADT linha 12).
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-acp' }, (e) =>
      e.executar(
        "UPDATE resultado_cultura SET situacao = 'retificado', alterado_em = NOW(3), versao = versao + 1 WHERE id = ?",
        [cultura],
      ),
    );
    const antes = await porta.analises(ctx(), { cultura });
    expect(antes.length).toBe(2);
    for (const a of antes) {
      expect(a.laudoRetificado).toBe(true);
      expect(a.pendencias).toContain('rever-laudo-retificado');
    }
    const daInfeccao = antes.find((a) => a.isolado === germe2)!;
    const [gravadoAntes] = await ler<{ laudo_retificado: number }>(
      'SELECT laudo_retificado FROM analise_cultura_positiva WHERE id = ?',
      [daInfeccao.id],
    );
    expect(Number(gravadoAntes!.laudo_retificado)).toBe(0);
    const r = await porta.corrigir(
      ctx(),
      m!.base.login,
      daInfeccao.id,
      daInfeccao.versao,
      {
        classificacao: 'colonizacao',
        isolado: null,
        conduta: null,
        condutaDescricao: 'Revista após a retificação do laudo: colonização',
        precaucaoIndicada: false,
        prescritorOrientado: true,
        casoInfeccao: null,
      },
      'laudo retificado pelo laboratório',
      (x) => trilha(x.id),
    );
    expect(r.pendencias).toEqual([]);
    const [gravado] = await ler<{ laudo_retificado: number; versao: number }>(
      'SELECT laudo_retificado, versao FROM analise_cultura_positiva WHERE id = ?',
      [daInfeccao.id],
    );
    expect(Number(gravado!.laudo_retificado)).toBe(1);
    expect(Number(gravado!.versao)).toBe(daInfeccao.versao + 1);
    const depois = await porta.analises(ctx(), { cultura });
    expect(depois.find((a) => a.id === daInfeccao.id)).toMatchObject({
      laudoRetificado: true,
      pendencias: [],
    });
    expect(depois.find((a) => a.isolado === germeMr)?.pendencias).toEqual(['rever-laudo-retificado']);
    const c = (await porta.culturas(ctx(), '2000-01-01', m!.base.paciente)).find((x) => x.id === cultura);
    expect(c).toMatchObject({ faltaAnalisar: false, pendencias: ['rever-laudo-retificado'], pendente: true });
  });
});
