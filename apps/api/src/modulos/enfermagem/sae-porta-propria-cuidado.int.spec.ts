// Integração da prescrição de enfermagem na porta própria (família sae-atendimento) contra o MariaDB real (cliente
// f22_o2). Massa SINTÉTICA (nenhuma pessoa real). Contrato de efeito: a atividade prescrita a partir da intervenção do
// plano vigente (horários do dia), a repetição pela chave do pedido, a checagem do horário (e a recusa de checar duas
// vezes), o estorno (registro novo; a checagem fica) e a nova checagem do mesmo horário, a suspensão e a revisão do
// processo (a atividade deixa de ser vigente); as recusas como na porta de memória. SGH_NUCLEO_SEM_BANCO=1 pula.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contextoDe,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  P,
  SEM_BANCO,
} from './massa-enfermagem.spec-util.js';
import { PortaSaePropria } from './sae-porta-propria.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const recusada = async (p: Promise<unknown>) =>
  codigoDe(
    await p.then(
      () => null,
      (e: unknown) => e,
    ),
  );

describe.skipIf(SEM_BANCO)('porta própria da prescrição de enfermagem (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSaePropria;
  let m: MassaEnfermagem | null = null;
  let processo = 0;
  let intervencao = 0;
  let atividade = 0;
  let checagem = 0;
  const marca = `${Date.now()}`;
  const dia = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-cuidado' }, async (l) =>
      Number((await l.uma<{ n: number }>(sql, p))?.n ?? 0),
    );

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo, `${P}K`, false);
    porta = new PortaSaePropria(nucleo);
  }, 60_000);

  afterAll(async () => {
    if (m) {
      const ests = [m.est, m.outroEst];
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-cuidado-limpeza' }, async (e) => {
        for (const t of [
          'estorno_checagem_cuidado_enfermagem',
          'checagem_cuidado_enfermagem',
          'atividade_cuidado_enfermagem',
        ])
          await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN (?, ?)`, ests);
      });
    }
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  const c = () => contextoDe(m!);
  const registrar = (versaoVista: number) =>
    porta.gravarSgh(c(), null, (g) =>
      g.registrarSae({
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        versaoVista,
        sistema: 'NNN',
        versaoTerminologia: '2024',
        avaliacao: 'Avaliação sintética do processo.',
        diagnosticos: [
          {
            codigo: `${m!.marca}-D1`,
            descricao: 'Diagnóstico sintético',
            caracteristicas: [`${m!.marca}-C1`],
            fatores: [],
            resultados: [],
            intervencoes: [{ codigo: `${m!.marca}-I1`, descricao: 'Intervenção' }],
          },
        ],
        vinculo: m!.profissional,
        usuario: m!.login,
        chave: null,
      }),
    );
  const prescrever = (sae: number, iv: number, chave: string) =>
    porta.gravarSgh(c(), null, (g) =>
      g.prescrever({
        sae,
        paciente: m!.paciente,
        atendimento: m!.atendimento,
        atividades: [
          {
            intervencao: iv,
            codigo: 'ATV-1',
            descricao: 'Mudança de decúbito',
            frequenciaDia: 2,
            horarios: ['08:00', '20:00'],
            inicio: `${dia}T07:00`,
            fim: null,
          },
        ],
        vinculo: m!.profissional,
        usuario: m!.login,
        chave,
      }),
    );
  const checar = (previsto = `${dia}T08:00`, chave: string | null = null) =>
    porta.gravarSgh(c(), null, (g) =>
      g.checar({
        atividade,
        atendimento: m!.atendimento,
        previsto,
        feita: true,
        motivo: null,
        horaReal: `${dia}T08:05`,
        origemOffline: false,
        categoria: 'tecnico',
        vinculo: m!.profissional,
        usuario: m!.login,
        chave,
      }),
    );
  const estornar = (id: number) =>
    porta.gravarSgh(c(), null, (g) =>
      g.estornar({
        checagem: id,
        atendimento: m!.atendimento,
        motivo: 'Checado no paciente errado',
        categoria: 'enfermeiro',
        vinculo: m!.profissional,
        usuario: m!.login,
      }),
    );

  it('prescreve a atividade da intervenção vigente; repetição pela chave; recusas', async () => {
    const r = await registrar(0);
    processo = r.id;
    const s = await porta.sae(c(), m!.atendimento);
    intervencao = s.itens.find((i) => i.tipo === 'intervencao')!.id;
    expect(await recusada(prescrever(processo + 999_999, intervencao, `k1-${marca}`))).toBe('sae-mudou');
    expect(await recusada(prescrever(processo, 987_654_321, `k2-${marca}`))).toBe(
      'intervencao-de-outro-processo',
    );
    const p = await prescrever(processo, intervencao, `k3-${marca}`);
    expect(p.repetida).toBe(false);
    expect(p.ids).toHaveLength(1);
    atividade = p.ids[0]!;
    expect(await prescrever(processo, intervencao, `k3-${marca}`)).toEqual({ ids: p.ids, repetida: true });
    const v = await porta.atividadesVigentes(c(), [m!.atendimento, m!.atendimento]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      id: atividade,
      codigo: 'ATV-1',
      frequenciaDia: 2,
      horarios: ['08:00', '20:00'],
      inicio: `${dia}T07:00`,
      fim: null,
      suspensa: null,
      usuario: m!.login,
      atendimento: m!.atendimento,
      sae: processo,
    });
    expect(await porta.atividadesVigentes(contextoDe(m!, m!.outroEst), [m!.atendimento])).toEqual([]);
    expect(await porta.atividadesVigentes(c(), [])).toEqual([]);
    // A trilha da operação: o registro do processo e a prescrição (alvo: o processo).
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'processo_enfermagem' AND entidade_id = ?",
        [processo],
      ),
    ).toBeGreaterThanOrEqual(2);
  });

  it('checa o horário, recusa a segunda checagem, estorna e checa de novo', async () => {
    const r = await checar(undefined, `ch-${marca}`);
    checagem = r.id;
    expect(r.repetida).toBe(false);
    expect((await checar(undefined, `ch-${marca}`)).repetida).toBe(true);
    expect(await recusada(checar())).toBe('ja-checado');
    const lidas = await porta.checagens(c(), {
      atividades: [atividade],
      de: `${dia}T00:00`,
      ate: `${dia}T23:59`,
    });
    expect(lidas.cortada).toBe(false);
    expect(lidas.itens).toHaveLength(1);
    expect(lidas.itens[0]).toMatchObject({
      id: checagem,
      atividade,
      atendimento: m!.atendimento,
      previsto: `${dia}T08:00`,
      feita: true,
      horaReal: `${dia}T08:05`,
      categoria: 'tecnico',
      usuario: m!.login,
      estorno: null,
    });
    const e = await estornar(checagem);
    expect(await recusada(estornar(checagem))).toBe('ja-estornado');
    expect(await recusada(estornar(987_654_321))).toBe('nao-encontrado');
    expect((await porta.checagem(c(), checagem))?.estorno).toEqual({
      id: e,
      motivo: 'Checado no paciente errado',
      usuario: m!.login,
    });
    expect(await porta.checagem(contextoDe(m!, m!.outroEst), checagem)).toBeNull();
    // O estorno não apaga: a checagem fica e o horário pode ser checado de novo (nova geração).
    const de2 = await checar();
    expect(de2.id).not.toBe(checagem);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM checagem_cuidado_enfermagem WHERE atividade_cuidado_enfermagem_id = ?',
        [atividade],
      ),
    ).toBe(2);
  });

  it('suspende a atividade; a revisão do processo a tira das vigentes', async () => {
    const id = await porta.gravarSgh(c(), null, (g) =>
      g.suspender({
        atividade,
        atendimento: m!.atendimento,
        motivo: 'Paciente deambulando',
        vinculo: m!.profissional,
        usuario: m!.login,
      }),
    );
    expect(id).toBe(atividade);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'atividade_cuidado_enfermagem' AND entidade_id = ?",
        [atividade],
      ),
    ).toBe(1);
    expect(
      await recusada(
        porta.gravarSgh(c(), null, (g) =>
          g.suspender({
            atividade,
            atendimento: m!.atendimento,
            motivo: 'De novo',
            vinculo: m!.profissional,
            usuario: m!.login,
          }),
        ),
      ),
    ).toBe('ja-suspensa');
    expect(await recusada(checar(`${dia}T20:00`))).toBe('atividade-suspensa');
    const a = await porta.atividade(c(), atividade);
    expect(a?.suspensa).toMatchObject({ motivo: 'Paciente deambulando', usuario: m!.login });
    expect(a).toMatchObject({ paciente: m!.paciente, revisadoEm: null });
    await registrar(1);
    expect(await porta.atividadesVigentes(c(), [m!.atendimento])).toEqual([]);
    expect((await porta.atividade(c(), atividade))?.revisadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(await porta.atividade(contextoDe(m!, m!.outroEst), atividade)).toBeNull();
  });
});
