// Contrato de efeito do registro das rotinas agendadas do worker (01-SIS L95) sobre o MariaDB real:
// - a primeira volta cadastra a rotina pelo código (a segunda usa a mesma linha) e a volta com trabalho deixa a
//   execução (agendada, volumes, início e fim, correlação) e as etapas; a rotina fica ociosa, com última e próxima;
// - a volta sem trabalho só marca a rotina viva (nenhuma execução nova) e a volta que falhou deixa a mensagem (só o
//   tipo do erro) e a rotina "com falha";
// - o pedido manual pendente (aguardando) é tomado pela volta seguinte: a mesma linha, disparo manual, encerrada;
// - a rotina suspensa não roda pelo registrador e continua suspensa depois de uma volta já em curso;
// - o pedido manual chega à volta como disparo 'manual' (o serviço muda o trabalho por ele) e o cadastro acompanha a
//   definição do worker (acionamento manual e suspensão, guardada nos parâmetros);
// - a rotina não suspensível (vigia da plataforma) segue registrando mesmo se ficou suspensa de antes.
// Massa sintética (código teste.l95w.*), apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENTE, escrever, garantirCliente, SEM_BANCO } from './importadores/integracao.spec-util.js';
import { RegistroRotinasProprio, type VoltaRotina } from './rotinas-registro-proprio.js';
import { RegistradorRotinas } from './rotinas-worker.js';

const P = 'teste.l95w';
const T0 = new Date('2026-11-25T10:00:00.000Z');
const def = (n: string) => ({
  codigo: `${P}.${n}`,
  nome: `ROTINA SINTETICA ${n}`,
  descricao: 'MASSA SINTETICA',
  categoria: 'manutencao' as const,
  intervaloSegundos: 60,
  toleranciaAtrasoSegundos: 600,
  permiteAcionamentoManual: true,
});
const volta = (n: string, extra: Partial<VoltaRotina> = {}): VoltaRotina => ({
  definicao: def(n),
  situacao: 'concluida',
  inicioEm: T0,
  fimEm: new Date(T0.getTime() + 2000),
  lidos: 3,
  gravados: 2,
  rejeitados: 0,
  etapas: [
    {
      nome: 'EST-A',
      situacao: 'concluida',
      inicioEm: T0,
      fimEm: new Date(T0.getTime() + 1000),
      lidos: 3,
      gravados: 2,
      rejeitados: 0,
    },
    {
      nome: 'EST-B',
      situacao: 'falhou',
      inicioEm: T0,
      fimEm: new Date(T0.getTime() + 2000),
      lidos: 0,
      gravados: 0,
      rejeitados: 0,
      mensagem: 'Error',
    },
  ],
  historico: true,
  correlacao: 'teste-l95w',
  servidor: 'worker-teste',
  ...extra,
});

describe.skipIf(SEM_BANCO)('registro das rotinas agendadas do worker sobre o banco próprio', () => {
  let nucleo: NucleoProprio;
  let porta: RegistroRotinasProprio;
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l95w' }, (l) => l.consultar(sql, p));
  const rotina = async (n: string) =>
    (
      await ler('SELECT * FROM rotina_agendada WHERE estabelecimento_id IS NULL AND codigo = ?', [
        `${P}.${n}`,
      ])
    )[0];
  const execucoes = (id: number) =>
    ler('SELECT * FROM execucao_rotina WHERE rotina_agendada_id = ? ORDER BY id', [id]);

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      const rot = `SELECT id FROM rotina_agendada WHERE codigo LIKE '${P}.%'`;
      await e.executar(
        `DELETE FROM execucao_rotina_etapa WHERE execucao_rotina_id IN (SELECT id FROM execucao_rotina WHERE rotina_agendada_id IN (${rot}))`,
        [],
      );
      await e.executar(`DELETE FROM execucao_rotina WHERE rotina_agendada_id IN (${rot})`, []);
      await e.executar(`DELETE FROM rotina_agendada WHERE codigo LIKE '${P}.%'`, []);
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    porta = new RegistroRotinasProprio(nucleo, CLIENTE);
    await limpar();
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('cadastra a rotina pelo código (idempotente) e grava execução e etapas da volta com trabalho', async () => {
    expect(await porta.estado(`${P}.a`)).toBeNull();
    const r1 = await porta.registrar(volta('a'));
    const r2 = await porta.registrar(volta('a', { gravados: 5 }));
    expect(r2.rotina).toBe(r1.rotina);
    const rot = await rotina('a');
    expect(rot).toMatchObject({
      codigo: `${P}.a`,
      categoria: 'manutencao',
      tipo_agenda: 'intervalo',
      intervalo_segundos: 60,
      tolerancia_atraso_segundos: 600,
      situacao: 'ociosa',
      versao: 3,
    });
    expect((rot?.['ultima_execucao_em'] as Date).getTime()).toBe(T0.getTime() + 2000);
    expect((rot?.['proxima_execucao_em'] as Date).getTime()).toBe(T0.getTime() + 62_000);
    const ex = await execucoes(r1.rotina);
    expect(ex).toHaveLength(2);
    expect(ex[0]).toMatchObject({
      disparo: 'agendado',
      situacao: 'concluida',
      usuario_id: null,
      registros_lidos: 3,
      registros_gravados: 2,
      registros_rejeitados: 0,
      correlacao: 'teste-l95w',
      servidor: 'worker-teste',
      mensagem_erro: null,
    });
    expect(ex[1]?.['registros_gravados']).toBe(5);
    const et = await ler(
      'SELECT * FROM execucao_rotina_etapa WHERE execucao_rotina_id = ? ORDER BY sequencia',
      [r1.execucao],
    );
    expect(
      et.map((x) => [x['sequencia'], x['nome'], x['situacao'], x['registros_gravados'], x['mensagem']]),
    ).toEqual([
      [1, 'EST-A', 'concluida', 2, null],
      [2, 'EST-B', 'falhou', 0, 'Error'],
    ]);
  });

  it('volta sem trabalho só marca a rotina; volta com falha guarda o tipo do erro e deixa a rotina com falha', async () => {
    const r = await porta.registrar(volta('b', { historico: false, lidos: 0, gravados: 0, etapas: [] }));
    expect(r.execucao).toBeNull();
    expect(await execucoes(r.rotina)).toHaveLength(0);
    expect((await rotina('b'))?.['ultima_execucao_em']).not.toBeNull();
    const f = await porta.registrar(
      volta('b', { situacao: 'falhou', mensagemErro: 'TypeError', etapas: [] }),
    );
    const [ex] = await execucoes(f.rotina);
    expect(ex).toMatchObject({ situacao: 'falhou', mensagem_erro: 'TypeError' });
    expect((await rotina('b'))?.['situacao']).toBe('com_falha');
    // A falha sem mensagem é recusada pelo domínio (nada gravado).
    await expect(
      porta.registrar(volta('b', { situacao: 'falhou', mensagemErro: null })),
    ).rejects.toMatchObject({
      problema: { codigo: 'falha-sem-mensagem' },
    });
    expect(await execucoes(f.rotina)).toHaveLength(1);
  });

  it('o pedido manual pendente é tomado pela volta seguinte (mesma linha, disparo manual)', async () => {
    const r = await porta.registrar(volta('c', { historico: false, etapas: [] }));
    const pedido = await escrever(nucleo, (e) =>
      e.inserir(
        "INSERT INTO execucao_rotina (rotina_agendada_id, ocorrido_em, disparo, situacao, criado_em) VALUES (?, ?, 'manual', 'aguardando', ?)",
        [r.rotina, T0, T0],
      ),
    );
    expect(await porta.estado(`${P}.c`)).toMatchObject({ ativo: true, manualPendente: true });
    const t = await porta.registrar(volta('c', { historico: false, lidos: 0, gravados: 0, etapas: [] }));
    expect(t).toMatchObject({ execucao: pedido, disparo: 'manual' });
    const ex = await execucoes(r.rotina);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ id: pedido, disparo: 'manual', situacao: 'concluida' });
    expect(await porta.estado(`${P}.c`)).toMatchObject({ manualPendente: false });
  });

  it('a rotina suspensa não roda pelo registrador e continua suspensa depois de uma volta em curso', async () => {
    const r = await porta.registrar(volta('d', { historico: false, etapas: [] }));
    await escrever(nucleo, (e) =>
      e.executar("UPDATE rotina_agendada SET situacao = 'suspensa' WHERE id = ?", [r.rotina]),
    );
    const registrador = new RegistradorRotinas(() => porta);
    let rodou = false;
    const x = await registrador.rodar(CLIENTE, def('d'), 'teste-l95w', async () => {
      rodou = true;
      return { resultado: 1 };
    });
    expect([x, rodou]).toEqual([null, false]);
    await porta.registrar(volta('d'));
    expect((await rotina('d'))?.['situacao']).toBe('suspensa');
  });

  it('o registrador grava a volta com volume pela porta e repassa a falha da volta', async () => {
    const registrador = new RegistradorRotinas(() => porta);
    const x = await registrador.rodar(CLIENTE, def('e'), 'teste-l95w', async () => ({
      resultado: 7,
      lidos: 4,
      gravados: 1,
      rejeitados: 1,
    }));
    expect(x).toBe(7);
    const rot = await rotina('e');
    const [ex] = await execucoes(Number(rot?.['id']));
    expect(ex).toMatchObject({
      situacao: 'concluida_com_avisos',
      registros_lidos: 4,
      registros_rejeitados: 1,
    });
    await expect(
      registrador.rodar(CLIENTE, def('e'), 'teste-l95w', async () => {
        throw new RangeError('VALOR QUE NAO VAI AO BANCO');
      }),
    ).rejects.toThrow(RangeError);
    const ex2 = await execucoes(Number(rot?.['id']));
    expect(ex2[1]).toMatchObject({ situacao: 'falhou', mensagem_erro: 'RangeError' });
    expect((await rotina('e'))?.['situacao']).toBe('com_falha');
  });

  it('o pedido manual chega à volta como disparo manual e o cadastro segue a definição do worker', async () => {
    const registrador = new RegistradorRotinas(() => porta);
    const disparos: string[] = [];
    const medir = async (d: string) => {
      disparos.push(d);
      return { resultado: d, gravados: d === 'manual' ? 1 : 0 };
    };
    await registrador.rodar(CLIENTE, def('f'), 'teste-l95w', medir);
    const id = Number((await rotina('f'))?.['id']);
    const pedido = await escrever(nucleo, (e) =>
      e.inserir(
        "INSERT INTO execucao_rotina (rotina_agendada_id, ocorrido_em, disparo, situacao, criado_em) VALUES (?, ?, 'manual', 'aguardando', ?)",
        [id, T0, T0],
      ),
    );
    expect(await registrador.rodar(CLIENTE, def('f'), 'teste-l95w', medir)).toBe('manual');
    expect(disparos).toEqual(['agendado', 'manual']);
    const ex = await execucoes(id);
    expect(ex.find((x) => x['id'] === pedido)).toMatchObject({
      disparo: 'manual',
      situacao: 'concluida',
      registros_gravados: 1,
    });
    // A definição mudou no worker: sem acionamento manual e sem suspensão; a linha já cadastrada acompanha.
    await porta.registrar(
      volta('f', { definicao: { ...def('f'), permiteAcionamentoManual: false, permiteSuspensao: false } }),
    );
    const rot = await rotina('f');
    expect(Boolean(rot?.['permite_acionamento_manual'])).toBe(false);
    // O driver devolve a coluna JSON já lida (objeto) ou como texto, conforme a versão.
    const par: unknown = rot?.['parametros'];
    expect(typeof par === 'string' ? JSON.parse(par) : par).toEqual({ suspensivel: false });
  });

  it('a rotina não suspensível segue registrando mesmo se ficou suspensa de antes', async () => {
    const naoSusp = { ...def('g'), permiteSuspensao: false };
    const r = await porta.registrar(volta('g', { definicao: naoSusp, historico: false, etapas: [] }));
    await escrever(nucleo, (e) =>
      e.executar("UPDATE rotina_agendada SET situacao = 'suspensa' WHERE id = ?", [r.rotina]),
    );
    const registrador = new RegistradorRotinas(() => porta);
    const x = await registrador.rodar(CLIENTE, naoSusp, 'teste-l95w', async () => ({
      resultado: 1,
      avisos: 2,
    }));
    expect(x).toBe(1);
    const [ex] = await execucoes(r.rotina);
    expect(ex).toMatchObject({ situacao: 'concluida_com_avisos' });
  });
});
