// Contrato de efeito da regra de plantão do repasse (C2-100, 06-FAT linha 47) contra o MariaDB real, massa SINTÉTICA:
// a inclusão grava regra_repasse_plantao (com auditoria e trilha na mesma transação), o realizado aprovado passa a
// valer pela regra mais específica (fim de semana, fator, hora extra), a regra de outro dia da semana não alcança, o
// recorte de outro estabelecimento é recusado, e o encerramento da vigência devolve o plantão à tarifa geral por hora.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { type ContextoNucleo, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import { PortaEscalaPropria } from '../escala/porta-escala-propria.js';
import { PortaRealizadoPropria } from '../escala/porta-realizado-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../../..');
const MARCA = `RP${Date.now().toString(36).slice(-5).toUpperCase()}`;

const codigoDe = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao
      ? String(e.problema['codigo'] ?? e.problema.title)
      : `outro: ${(e as Error).message}`;
  }
};
const linha = (evento: string, entidade: string, id: number | null = null): TrilhaDaGravacao =>
  ({
    acao: 'operacao',
    entidade,
    entidadeId: id,
    dadosAntes: null,
    dadosDepois: { evento },
    motivo: null,
  }) as never;

const regraBase = {
  profissional: null,
  escala: null,
  especialidade: null,
  diaSemana: null,
  forma: 'por_plantao' as const,
  horasPlantao: 12,
  valorPadrao: 1200,
  valorFimSemana: 1500,
  valorFeriado: null,
  percentualFeriado: null,
  fator: 1.2,
  valorHoraExtraAntes: null,
  percentualHoraExtraAntes: null,
  valorHoraExtraDepois: null,
  percentualHoraExtraDepois: 50,
  toleranciaMinutos: 15,
  inicio: '2031-01-01',
  fim: null,
  por: 'x',
};

describe.skipIf(SEM_BANCO)('regra de plantão do repasse (MariaDB, contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let escala: PortaEscalaPropria;
  let realizado: PortaRealizadoPropria;
  let m: {
    est: number;
    outroEst: number;
    setor: number;
    setorOutro: number;
    usuario: number;
    decisor: number;
    colab: number;
  };
  const ctx = (est = m.est, usuario = m.usuario): ContextoNucleo => ({
    cliente: CLIENTE,
    estabelecimento: est,
    usuario,
    correlacao: `t-${MARCA}`,
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `t-${MARCA}` }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
      cwd: RAIZ,
      encoding: 'utf8',
    });
    if (!lista.split('\n').some((l) => l.split('\t')[1] === CLIENTE))
      throw new Error(`Cliente de teste ${CLIENTE} ausente.`);
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-preparo` }, async (e) => {
      const agora = new Date();
      const est = (cod: string) =>
        e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `ESTAB ${cod} SINTETICO`, `ESTAB ${cod} SINTETICO`, agora],
        );
      const estId = await est(MARCA.toLowerCase());
      const outroEst = await est(`${MARCA.toLowerCase()}b`);
      const setor = (x: number, cod: string) =>
        e.inserir(
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'assistencial', ?)",
          [x, cod, `UTI ${cod} SINTETICA`, agora],
        );
      const sexo =
        Number((await e.uma<{ id: number }>("SELECT id FROM sexo WHERE sigla = 'F'"))?.id ?? 0) ||
        (await e.inserir(
          "INSERT INTO sexo (sigla, codigo, descricao, criado_em) VALUES ('F', 'feminino', 'Feminino', ?)",
          [agora],
        ));
      const usuario = (s: string) =>
        e.inserir(
          "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
          [`${MARCA.toLowerCase()}.${s}`, `USUARIO SINTETICO ${MARCA} ${s}`, agora],
        );
      const colab = await e.inserir(
        "INSERT INTO colaborador (nome, cpf, data_nascimento, sexo_id, grau_instrucao, criado_em) VALUES (?, ?, '1985-03-01', ?, '07', ?)",
        [`COLABORADOR ${MARCA} SINTETICO`, `7${String(Date.now()).slice(-10)}`, sexo, agora],
      );
      await e.inserir(
        `INSERT INTO valor_hora_plantao (estabelecimento_id, descricao, forma_pagamento, valor_hora, vigencia_inicio, criado_em)
         VALUES (?, 'HORA SINTETICA', 'hora', 120.00, '2031-01-01', ?)`,
        [estId, agora],
      );
      return {
        est: estId,
        outroEst,
        setor: await setor(estId, `${MARCA}-S`),
        setorOutro: await setor(outroEst, `${MARCA}-SB`),
        usuario: await usuario('coord'),
        decisor: await usuario('decisor'),
        colab,
      };
    });
    escala = new PortaEscalaPropria(nucleo);
    realizado = new PortaRealizadoPropria(nucleo);
  }, 120_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-limpeza` }, async (e) => {
        const ests = [m.est, m.outroEst];
        const em = 'estabelecimento_id IN (?, ?)';
        await e.executar(
          `DELETE pe FROM publicacao_escala pe JOIN escala x ON x.id = pe.escala_id WHERE x.${em}`,
          ests,
        );
        await e.executar(`DELETE FROM plantao WHERE ${em}`, ests);
        await e.executar(`DELETE FROM regra_repasse_plantao WHERE ${em}`, ests);
        await e.executar(`DELETE FROM valor_hora_plantao WHERE ${em}`, ests);
        await e.executar(`DELETE FROM escala WHERE ${em}`, ests);
        await e.executar('DELETE FROM colaborador WHERE id = ?', [m.colab]);
        await e.executar(`DELETE FROM setor_funcional WHERE ${em}`, ests);
      });
    await nucleo?.encerrar();
  });

  it('a regra mais específica dá o valor do aprovado; outro dia da semana não alcança; encerrada, volta a tarifa', async () => {
    const esc = await escala.gravarSgh(
      ctx(),
      (r: number) => linha('pessoas.escala.criada', 'escala', r),
      (g) =>
        g.incluirEscala({
          unidade: m.setor,
          setor: '',
          competencia: '2031-06',
          tipo: 'enfermagem',
          cobertura: { manha: 0, tarde: 0, noite: 0 },
          por: 'x',
        }),
    );
    // Sábado, 07h às 19h.
    const p = await escala.gravarSgh(
      ctx(),
      (r: number) => linha('pessoas.plantao.gravado', 'plantao', r),
      (g) =>
        g.incluirPlantao({
          escala: esc,
          vinculo: 0,
          pessoa: m.colab,
          profissional: null,
          registro: null,
          tipo: 'presencial',
          inicio: '2031-06-07T07:00',
          fim: '2031-06-07T19:00',
          chegadaMin: null,
          alertaConselho: null,
          redeNaoConferida: false,
          motivo: null,
          por: 'x',
        }),
    );
    await escala.gravarSgh(ctx(), linha('pessoas.escala.publicada', 'escala', esc), (g) =>
      g.publicarEscala({ id: esc, versao: 1, justificativaFuro: null, por: 'x' }),
    );
    await realizado.gravarSgh(
      ctx(),
      (r: number) => linha('pessoas.realizado.registrado', 'plantao', r),
      (g) =>
        g.incluirRealizado({
          plantao: p,
          vinculo: 0,
          inicio: '2031-06-07T07:00',
          fim: '2031-06-07T20:00',
          minutos: 0,
          origem: 'informado',
          observacao: null,
          por: 'x',
        }),
    );
    const r1 = (await realizado.realizado(ctx(), p))!;
    await realizado.gravarSgh(ctx(m.est, m.decisor), linha('pessoas.realizado.decidido', 'plantao', p), (g) =>
      g.decidirRealizado({
        id: p,
        versao: r1.versao,
        situacao: 'aprovado',
        motivo: null,
        tarifa: null,
        valorHora: null,
        valor: null,
        por: 'x',
      }),
    );
    // Sem regra: a tarifa geral por hora (13 h × 120).
    expect(await realizado.realizado(ctx(), p)).toMatchObject({
      valor: 1560,
      valorHora: 120,
      regraPlantao: null,
    });

    const incluir = (x: Record<string, unknown>, est = m.est) =>
      realizado.gravarSgh(
        ctx(est),
        (r: number) => linha('pessoas.tarifa_plantao.gravada', 'regra_repasse_plantao', r),
        (g) =>
          g.incluirRegraPlantao({ ...regraBase, descricao: 'UTI SINTETICA', setor: m.setor, ...x } as never),
      );
    // O recorte de outro estabelecimento é recusado, sem gravar.
    expect(await codigoDe(incluir({ setor: m.setorOutro }))).toBe('setor_funcional-inexistente');
    const regraSetor = await incluir({});
    // Mais específica (escala), mas só às quartas: não alcança o sábado.
    const regraQuarta = await incluir({
      descricao: 'QUARTA SINTETICA',
      escala: esc,
      diaSemana: 4,
      valorPadrao: 9999,
    });
    expect(
      await um(
        `SELECT estabelecimento_id, setor_funcional_id, forma_remuneracao, horas_plantao, valor_padrao, valor_fim_semana,
           fator, percentual_hora_extra_depois, tolerancia_minutos, vigencia_inicio, vigencia_fim, versao,
           criado_por, criado_em IS NOT NULL AS tem_criado_em
         FROM regra_repasse_plantao WHERE id = ?`,
        [regraSetor],
      ),
    ).toMatchObject({
      estabelecimento_id: m.est,
      setor_funcional_id: m.setor,
      forma_remuneracao: 'por_plantao',
      horas_plantao: '12.00',
      valor_padrao: '1200.00',
      valor_fim_semana: '1500.00',
      fator: '1.2000',
      percentual_hora_extra_depois: '50.0000',
      tolerancia_minutos: 15,
      vigencia_fim: null,
      versao: 1,
      criado_por: m.usuario,
      tem_criado_em: 1,
    });
    expect(
      await um(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'regra_repasse_plantao' AND entidade_id = ?",
        [regraSetor],
      ),
    ).toMatchObject({ n: 1 });
    // Fim de semana 1500 × 1,2 = 1800 + 1 h extra × (150 + 50%) = 225.
    const r2 = (await realizado.realizado(ctx(), p))!;
    expect(r2).toMatchObject({ valor: 2025, regraPlantao: regraSetor });
    expect(r2.parcelas).toContain('total R$ 2.025,00');
    expect((await realizado.regrasPlantao(ctx())).map((x) => x.id).sort()).toEqual(
      [regraSetor, regraQuarta].sort(),
    );
    expect(await realizado.regrasPlantao(ctx(m.outroEst))).toEqual([]);

    // Encerrar antes do plantão: volta a tarifa; fim antes do início é recusado.
    const encerrar = (id: number, fim: string) =>
      realizado.gravarSgh(ctx(), linha('pessoas.tarifa_plantao.gravada', 'regra_repasse_plantao', id), (g) =>
        g.encerrarRegraPlantao({ id, fim, por: 'x' }),
      );
    expect(await codigoDe(encerrar(regraSetor, '2030-12-31'))).toBe('vigencia-invalida');
    await encerrar(regraSetor, '2031-06-06');
    expect(
      await um('SELECT vigencia_fim, versao FROM regra_repasse_plantao WHERE id = ?', [regraSetor]),
    ).toMatchObject({
      versao: 2,
    });
    expect(await realizado.realizado(ctx(), p)).toMatchObject({ valor: 1560, regraPlantao: null });
  });
});
