// Contrato de efeito da autoliberação do resultado (F8, 05-SADT linha 11) no MariaDB real (cliente f22_o2; massa
// SINTÉTICA). Prova o que fica no banco: o cadastro da regra (condições conferidas na hora; recusa sem gravar), do
// limite de delta e da substância interferente, cada um com a trilha; a digitação dentro da regra sai liberada pela
// regra (resultado autoliberado, exame liberado, avaliação "liberado_automaticamente" com a regra); a digitação com
// variação acima do limite contra o resultado anterior do paciente fica retida (avaliação "retido_para_revisao" com o
// motivo delta) e entra na fila do responsável técnico; a nova digitação com a condição da amostra interferente
// acrescenta o motivo; a liberação manual do retido grava a conferência e tira da fila; a desativação não apaga.
// Saída só com contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoAutoliberacao } from './autoliberacao-propria.js';
import { ServicoResultadoSadt } from './resultado-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const COR = { cliente: CLIENTE, correlacao: 't-c2058' };
const hoje = () => new Date().toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('autoliberação do resultado (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let resultados: ServicoResultadoSadt;
  let autolib: ServicoAutoliberacao;
  let m: MassaSadt | null = null;
  let faixa = 0;
  let inscricao = 0;
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(COR, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['q'] ?? 0);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'C58');
    resultados = new ServicoResultadoSadt(nucleo);
    autolib = new ServicoAutoliberacao(nucleo);
    const mm = m;
    await nucleo.escrever(COR, async (e) => {
      const ea = await e.uma('SELECT id FROM exame_analito WHERE exame_id = ? AND analito_id = ?', [
        mm.exameLab,
        mm.analito,
      ]);
      faixa = await e.inserir(
        `INSERT INTO faixa_referencia (exame_analito_id, referencia_minima, referencia_maxima, critico_minimo, critico_maximo,
           absurdo_minimo, absurdo_maximo, referencia_texto, vigencia_inicio, criado_em)
         VALUES (?, 10, 20, 5, 30, 0, 100, '10 a 20', '2020-01-01', ?)`,
        [ea!['id'], new Date()],
      );
      await e.executar("UPDATE exame_item SET situacao = 'em_analise' WHERE id IN (?, ?)", [
        mm.itemLab,
        mm.itemLab2,
      ]);
    });
  }, 60_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever(COR, async (e) => {
        const itens = [m!.itemLab, m!.itemLab2];
        await e.executar(
          `DELETE a FROM avaliacao_regra_resultado a JOIN resultado_exame r ON r.id = a.resultado_exame_id
            WHERE r.exame_item_id IN (?, ?)`,
          itens,
        );
        for (const t of ['aviso_valor_critico', 'resultado_observacao', 'resultado_analito'])
          await e.executar(
            `DELETE x FROM ${t} x JOIN resultado_exame r ON r.id = x.resultado_exame_id WHERE r.exame_item_id IN (?, ?)`,
            itens,
          );
        await e.executar(
          'DELETE c FROM condicao_autoliberacao c JOIN regra_autoliberacao r ON r.id = c.regra_autoliberacao_id WHERE r.exame_id = ?',
          [m!.exameLab],
        );
        await e.executar('DELETE FROM regra_autoliberacao WHERE exame_id = ?', [m!.exameLab]);
        await e.executar('DELETE FROM substancia_interferente WHERE exame_id = ?', [m!.exameLab]);
        await e.executar('DELETE FROM limite_delta_analito WHERE estabelecimento_id = ?', [m!.base.est]);
        if (faixa) await e.executar('DELETE FROM faixa_referencia WHERE id = ?', [faixa]);
        if (inscricao) await e.executar('DELETE FROM inscricao_conselho WHERE id = ?', [inscricao]);
      });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 60_000);

  it('libera pela regra, retém pelo delta e pelo interferente, confere na liberação e desativa sem apagar', async () => {
    const c = contexto(m!);
    const an = m!.analito;
    const tenta = (p: Promise<unknown>) => p.then(() => 'ok').catch(codigoDe);

    // Cadastro conferido na hora: a regra que libera sem faixa é recusada e nada é gravado.
    expect(
      await tenta(
        autolib.incluirRegra(c, {
          codigo: `${m!.marca}X`,
          descricao: 'Sem condição',
          exame: m!.exameLab,
          setor: null,
          acao: 'liberar',
          prioridade: 1,
          vigenciaInicio: '2020-01-01',
          vigenciaFim: null,
          condicoes: [],
        }),
      ),
    ).toBe('regra-sem-condicao');
    expect(
      await contar('SELECT COUNT(*) AS q FROM regra_autoliberacao WHERE exame_id = ?', [m!.exameLab]),
    ).toBe(0);

    const regra = await autolib.incluirRegra(c, {
      codigo: `${m!.marca}R1`,
      descricao: 'Faixa usual liberada',
      exame: m!.exameLab,
      setor: m!.setorLab,
      acao: 'liberar',
      prioridade: 1,
      vigenciaInicio: '2020-01-01',
      vigenciaFim: null,
      condicoes: [
        {
          tipo: 'faixa',
          analito: an,
          operador: 'entre',
          valor: null,
          minimo: 8,
          maximo: 40,
          deltaPercentual: null,
          deltaJanelaHoras: null,
        },
      ],
    });
    expect(regra.id).toBeGreaterThan(0);
    expect(
      await contar('SELECT COUNT(*) AS q FROM condicao_autoliberacao WHERE regra_autoliberacao_id = ?', [
        regra.id,
      ]),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'regra_autoliberacao' AND entidade_id = ?",
        [regra.id],
      ),
    ).toBeGreaterThan(0);

    // Dentro da regra, sem trava: liberado pela regra.
    const r1 = await resultados.registrar(c, m!.itemLab, { valores: [{ analito: an, numero: 15 }] });
    expect(r1).toMatchObject({ situacao: 'liberado', autoliberado: true, critico: false });
    expect(await um('SELECT situacao FROM exame_item WHERE id = ?', [m!.itemLab])).toMatchObject({
      situacao: 'liberado',
    });
    expect(
      await um(
        'SELECT decisao, regra_autoliberacao_id FROM avaliacao_regra_resultado WHERE resultado_exame_id = ?',
        [r1.resultado],
      ),
    ).toMatchObject({ decisao: 'liberado_automaticamente' });

    // Delta check: 15 -> 25 passa de 20% contra o anterior do paciente: retido para conferência.
    const delta = await autolib.incluirLimiteDelta(c, {
      analito: an,
      tipo: 'percentual',
      variacaoMaxima: 20,
      janelaHoras: 72,
      acao: 'reter_revisao',
      vigenciaInicio: hoje(),
      vigenciaFim: null,
    });
    expect(delta.id).toBeGreaterThan(0);
    const r2 = await resultados.registrar(c, m!.itemLab2, { valores: [{ analito: an, numero: 25 }] });
    expect(r2).toMatchObject({ situacao: 'digitado', autoliberado: false });
    const ultima = () =>
      um(
        `SELECT decisao, JSON_LENGTH(dados, '$.motivos') AS q, JSON_UNQUOTE(JSON_EXTRACT(dados, '$.motivos[0]')) AS m1
           FROM avaliacao_regra_resultado WHERE resultado_exame_id = ? ORDER BY id DESC LIMIT 1`,
        [r2.resultado],
      );
    expect(await ultima()).toMatchObject({ decisao: 'retido_para_revisao', m1: 'delta' });
    let fila = await autolib.fila(c);
    expect(fila.filter((f) => f.exameItem === m!.itemLab2).map((f) => f.motivos)).toEqual([['delta']]);
    expect(fila.some((f) => f.exameItem === m!.itemLab)).toBe(false);

    // Condição da amostra interferente apontada pela bancada: nova avaliação com os dois motivos.
    const hemolise = await autolib.incluirInterferente(c, {
      exame: m!.exameLab,
      analito: null,
      principioAtivo: null,
      substancia: 'Hemólise',
      efeito: 'variavel',
      mensagem: null,
      bloqueia: true,
    });
    await resultados.registrar(c, m!.itemLab2, {
      valores: [{ analito: an, numero: 25 }],
      interferentesAmostra: [hemolise.id],
    });
    expect(Number((await ultima())!['q'])).toBe(2);
    expect(
      await contar('SELECT COUNT(*) AS q FROM avaliacao_regra_resultado WHERE resultado_exame_id = ?', [
        r2.resultado,
      ]),
    ).toBe(2);

    // A liberação manual pelo habilitado é a conferência: grava quem conferiu e sai da fila.
    await nucleo.escrever(COR, async (e) => {
      const cbo = await e.uma(
        "SELECT id FROM ocupacao_cbo WHERE codigo_cbo LIKE '2212%' ORDER BY id LIMIT 1",
        [],
      );
      const cc = await e.uma('SELECT id FROM conselho_classe ORDER BY id LIMIT 1', []);
      const uf = await e.uma('SELECT id FROM unidade_federativa ORDER BY id LIMIT 1', []);
      const seq = await e.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM inscricao_conselho WHERE profissional_id = ?',
        [m!.base.profissional],
      );
      inscricao = await e.inserir(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, TRUE, 'ativa', ?)`,
        [
          m!.base.profissional,
          seq!['s'],
          cc!['id'],
          uf!['id'],
          `${m!.marca}8`.slice(0, 20),
          cbo!['id'],
          new Date(),
        ],
      );
    });
    const lib = await resultados.liberar(c, m!.itemLab2, {});
    expect(lib).toMatchObject({ situacao: 'liberado', autoliberado: false });
    const conf = await um(
      'SELECT conferido_por_profissional_id AS p, conferido_em, liberado_por_profissional_id AS l FROM resultado_exame WHERE id = ?',
      [r2.resultado],
    );
    expect(Number(conf!['p'])).toBe(m!.base.profissional);
    expect(conf!['conferido_em']).not.toBeNull();
    fila = await autolib.fila(c);
    expect(fila.some((f) => f.exameItem === m!.itemLab2)).toBe(false);

    // Desativar não apaga; desativar de novo é recusado.
    await autolib.desativar(c, 'regras', regra.id);
    expect(await um('SELECT ativo FROM regra_autoliberacao WHERE id = ?', [regra.id])).toMatchObject({
      ativo: 0,
    });
    expect(await tenta(autolib.desativar(c, 'regras', regra.id))).toBe('ja-desativado');
    const cad = await autolib.listar(c);
    expect(cad.regras.find((r) => r.id === regra.id)).toMatchObject({ ativo: false });
    expect(cad.limitesDelta.some((d) => d.id === delta.id)).toBe(true);
    expect(cad.interferentes.some((i) => i.id === hemolise.id)).toBe(true);
  }, 120_000);
});
