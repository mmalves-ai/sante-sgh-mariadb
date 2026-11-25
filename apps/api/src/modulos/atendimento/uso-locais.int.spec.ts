// Contrato de efeito do USO da configuração dos locais de atendimento (02-REC linha 34) contra o MariaDB real, no
// cliente de teste (f22_o1 por padrão). Massa SINTÉTICA própria (estabelecimento c2022, logins teste.c2022.*),
// idempotente e limpa antes e depois. A configuração é gravada pela manutenção (atendimento.manter_local) e o que fica
// no banco passa a valer para quem a usa:
//   - a fila do consultório lista só os locais que o usuário vê (os dele e os que eles consultam; sem vínculo, todos)
//     e diz o horário do local agora (aberto até, ou fechado);
//   - a recepção oferece como destino de encaminhamento só a lista do cadastro do local (sem lista, os outros locais
//     ativos da recepção; nenhum quando o local não encaminha), e a gravação do encaminhamento confere pela mesma
//     leitura; inativar um destino o tira da lista.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaRecepcaoPropria } from '../recepcao/porta-propria.js';
import { LocaisAtendimentoPropria } from './locais-atendimento.js';
import { PortaAtendimentoPropria } from './porta-propria.js';
import { encaminhamentoConfiguradoPermite } from './uso-locais-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c2022';
const LOGINS = ['teste.c2022.a', 'teste.c2022.b'] as const;

describe.skipIf(SEM_BANCO)('uso da configuração dos locais pela fila e pela recepção (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let manutencao: LocaisAtendimentoPropria;
  let atendimento: PortaAtendimentoPropria;
  let recepcao: PortaRecepcaoPropria;
  const ids = { est: 0, recepcao: 0, a: 0, b: 0, l1: 0, l2: 0, l3: 0, l4: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    const est = [ids.est];
    for (const t of [
      'local_atendimento_horario',
      'local_atendimento_encaminhamento',
      'local_atendimento_visibilidade',
      'usuario_local_atendimento',
    ])
      await e.executar(
        `DELETE x FROM ${t} x JOIN local_atendimento la ON la.id = x.local_atendimento_id WHERE la.estabelecimento_id = ?`,
        est,
      );
    await e.executar('DELETE FROM local_atendimento WHERE estabelecimento_id = ?', est);
  };
  const manter = (entrada: Record<string, unknown>) =>
    manutencao.manter(
      {
        hospital: EST,
        login: LOGINS[0],
        correlacao: 'teste-c2022',
        chaveIdempotencia: `c2022-${randomUUID()}`,
      },
      entrada,
    );
  const ctxAtendimento = (usuario: number) => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario,
    correlacao: 'teste-c2022',
    rede: 'rede-teste',
    hospital: EST,
  });
  const relogio = () => atendimento.relogio(ctxAtendimento(ids.a));
  const permite = (o: number, d: number) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2022' }, (l) =>
      encaminhamentoConfiguradoPermite(l, ids.est, o, d),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    manutencao = new LocaisAtendimentoPropria(nucleo, CLIENTE);
    atendimento = new PortaAtendimentoPropria(nucleo, CLIENTE);
    recepcao = new PortaRecepcaoPropria(nucleo, nucleo.criarExecutor(), CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2022' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      await limpar(e);
      for (const [i, login] of LOGINS.entries()) {
        const id = await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [login, `USUARIO SINTETICO C2022 ${i}`, agora],
        );
        if (i === 0) ids.a = id;
        else ids.b = id;
      }
      ids.recepcao = await garantir(
        e,
        'SELECT id FROM ponto_recepcao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'C2022'],
        'INSERT INTO ponto_recepcao (estabelecimento_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, 'C2022', 'RECEPCAO SINTETICA C2022', agora],
      );
    });
    const incluir = async (codigo: string, permiteEncaminhamento: boolean) =>
      Number(
        (
          await manter({
            acao: 'incluir',
            codigo,
            descricao: `CONSULTORIO SINTETICO ${codigo}`,
            recepcao: ids.recepcao,
            permiteEncaminhamento,
          })
        ).resultado['local'],
      );
    ids.l1 = await incluir('C1', true);
    ids.l2 = await incluir('C2', false);
    ids.l3 = await incluir('C3', true);
    ids.l4 = await incluir('C4', false);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2022' }, async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('a fila lista só os locais que o usuário vê; sem vínculo, todos', async () => {
    await manter({
      acao: 'usuarios',
      local: ids.l1,
      usuarios: [{ usuario: ids.a, atuaNoLocal: true, podeOperar: false }],
    });
    await manter({ acao: 'visibilidade', local: ids.l1, consultados: [ids.l2] });
    const doA = await atendimento.locais(ctxAtendimento(ids.a));
    const visiveis = (ls: typeof doA) =>
      ls
        .filter((l) => l.visivel)
        .map((l) => l.id)
        .sort((x, y) => x - y);
    expect(visiveis(doA)).toEqual([ids.l1, ids.l2]);
    expect(visiveis(await atendimento.locais(ctxAtendimento(ids.b)))).toEqual([
      ids.l1,
      ids.l2,
      ids.l3,
      ids.l4,
    ]);
    // A visibilidade retirada (exclusão lógica) deixa de valer.
    await manter({ acao: 'visibilidade', local: ids.l1, consultados: [] });
    expect(visiveis(await atendimento.locais(ctxAtendimento(ids.a)))).toEqual([ids.l1]);
  });

  it('a fila diz o horário do local agora pela semana gravada', async () => {
    const { agora } = await relogio();
    const dia = new Date(`${agora.slice(0, 10)}T00:00:00Z`).getUTCDay() + 1;
    const outroDia = (dia % 7) + 1;
    // L1 aberto o dia inteiro hoje (e nos dias não úteis); L2 só abre em outro dia da semana; L3 sem horário.
    await manter({
      acao: 'horario',
      local: ids.l1,
      faixas: [
        { diaSemana: dia, diaNaoUtil: false, inicio: '00:00', fim: '23:59' },
        { diaSemana: null, diaNaoUtil: true, inicio: '00:00', fim: '23:59' },
      ],
    });
    await manter({
      acao: 'horario',
      local: ids.l2,
      faixas: [{ diaSemana: outroDia, diaNaoUtil: false, inicio: '08:00', fim: '12:00' }],
    });
    const ls = await atendimento.locais(ctxAtendimento(ids.b));
    const de = (id: number) => ls.find((l) => l.id === id)?.horario;
    if (agora.slice(11, 16) < '23:59') expect(de(ids.l1)).toMatchObject({ aberto: true, fechaAs: '23:59' });
    expect(de(ids.l2)).toMatchObject({ aberto: false, semHorario: false, abreAs: null });
    expect(de(ids.l3)).toMatchObject({ aberto: true, semHorario: true });
  });

  it('a recepção encaminha só para a lista do cadastro do local, e a gravação confere pela mesma leitura', async () => {
    const encaminha = async (local: number) =>
      (await recepcao.recepcoes({ rede: 'rede-teste', hospital: EST }))
        .find((r) => r.id === ids.recepcao)!
        .locais.find((l) => l.id === local)!.encaminha;
    // Sem lista: os outros locais ativos da recepção; local que não encaminha, nenhum.
    expect(await encaminha(ids.l1)).toEqual([ids.l2, ids.l3, ids.l4].sort((x, y) => x - y));
    expect(await encaminha(ids.l2)).toEqual([]);
    // Com lista configurada: só ela.
    await manter({ acao: 'encaminhamentos', local: ids.l1, destinos: [ids.l3] });
    expect(await encaminha(ids.l1)).toEqual([ids.l3]);
    expect(await permite(ids.l1, ids.l3)).toBe(true);
    expect(await permite(ids.l1, ids.l2)).toBe(false);
    expect(await permite(ids.l2, ids.l1)).toBe(false);
    // Inativar o destino tira a ligação (exclusão lógica) e o destino sai da lista: volta a valer "os ativos".
    await manter({
      acao: 'dados',
      local: ids.l3,
      descricao: 'CONSULTORIO SINTETICO C3',
      permiteEncaminhamento: true,
      ativo: false,
    });
    expect(await permite(ids.l1, ids.l3)).toBe(false);
    expect(await encaminha(ids.l1)).toEqual([ids.l2, ids.l4].sort((x, y) => x - y));
  });
});
