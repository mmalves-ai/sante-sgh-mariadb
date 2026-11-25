// Contrato de efeito do USO da configuração dos locais de atendimento (02-REC linha 34) contra o MariaDB real, no
// cliente de teste (f22_o1 por padrão). Massa SINTÉTICA própria (estabelecimento c2022, logins teste.c2022.*),
// idempotente e limpa antes e depois. A configuração é gravada pela manutenção (atendimento.manter_local) e o que fica
// no banco passa a valer para quem a usa:
//   - a fila do consultório lista só os locais que o usuário vê (os dele e os que eles consultam; sem vínculo, todos)
//     e diz o horário do local agora (aberto até, ou fechado);
//   - a recepção oferece como destino de encaminhamento só a lista do cadastro do local (sem lista, os outros locais
//     ativos da recepção; nenhum quando o local não encaminha), e a gravação do encaminhamento confere pela mesma
//     leitura; inativar um destino o tira da lista;
//   - o serviço da fila (GET /api/atendimento/fila) devolve só os locais visíveis, recusa em silêncio o local que o
//     usuário não vê (local nulo, sem itens) e leva o horário do local escolhido;
//   - a gravação do encaminhamento (recepcao.registrarEventoSenha, evento 'encaminhar') grava para o destino da
//     lista e recusa com 'destino-nao-permitido' o destino fora dela ou inativado.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { montarMassa } from '../recepcao/massa-recepcao.spec-util.js';
import { PortaRecepcaoPropria } from '../recepcao/porta-propria.js';
import { LocaisAtendimentoPropria } from './locais-atendimento.js';
import { PortaAtendimentoPropria } from './porta-propria.js';
import { ServicoAtendimento } from './servico.js';
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
  let atendimentoBase: Record<string, unknown> = {};
  const ids = { est: 0, recepcao: 0, gerador: 0, a: 0, b: 0, l1: 0, l2: 0, l3: 0, l4: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    const est = [ids.est];
    const senhas = 'SELECT id FROM senha_emitida WHERE estabelecimento_id = ?';
    await e.executar(`DELETE FROM evento_senha WHERE senha_emitida_id IN (${senhas})`, est);
    await e.executar(`DELETE FROM atendimento_senha WHERE senha_emitida_id IN (${senhas})`, est);
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM senha_emitida WHERE estabelecimento_id = ?', est);
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
  const gravacao = () => ({
    login: LOGINS[0],
    correlacao: 'teste-c2022',
    chaveIdempotencia: `c2022-${randomUUID()}`,
  });
  const recepcaoDe = { rede: 'rede-teste', hospital: EST };
  const emitir = async () =>
    Number(
      (
        await recepcao.executar(
          recepcaoDe,
          'recepcao.emitirSenha',
          { gerador: ids.gerador, prioridade: '2', origem: 'balcao' },
          gravacao(),
        )
      ).resultado['senha'],
    );
  // A senha com atendimento aberto no local (efeito da abertura do atendimento, que não é o assunto deste contrato).
  const emAtendimento = async () => {
    const senha = await emitir();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2022' }, async (e) => {
      const atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ids.est,
          `C2022-${senha}`.slice(0, 20),
          atendimentoBase['paciente_id'],
          atendimentoBase['categoria_atendimento_id'],
          atendimentoBase['carater_atendimento_tiss_id'],
          atendimentoBase['fonte_pagadora_id'],
          atendimentoBase['profissional_id'],
          new Date(),
          new Date(),
        ],
      );
      await e.executar(
        'INSERT INTO atendimento_senha (atendimento_id, senha_emitida_id, criado_em) VALUES (?, ?, ?)',
        [atendimento, senha, new Date()],
      );
      await e.executar("UPDATE senha_emitida SET situacao = 'em_atendimento' WHERE id = ?", [senha]);
    });
    return senha;
  };
  const encaminhar = (senha: number, local: number, destino: number) =>
    recepcao.executar(
      recepcaoDe,
      'recepcao.registrarEventoSenha',
      { senha, evento: 'encaminhar', local, guiche: 0, destino },
      gravacao(),
    );
  const recusada = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
    } catch (e) {
      if (e instanceof ErroOperacao) return e.problema.codigo ?? '';
      throw e;
    }
    throw new Error('a gravação deveria ser recusada');
  };
  const situacaoDa = (senha: number) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2022' }, async (l) => {
      const x = await l.uma(
        `SELECT s.situacao, s.local_atendimento_id AS local,
                (SELECT COUNT(*) FROM evento_senha ev WHERE ev.senha_emitida_id = s.id) AS eventos
           FROM senha_emitida s WHERE s.id = ?`,
        [senha],
      );
      return {
        situacao: String(x?.['situacao']),
        local: x?.['local'] == null ? null : Number(x['local']),
        eventos: Number(x?.['eventos']),
      };
    });
  const destinoDoEvento = (senha: number) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2022' }, async (l) => {
      const x = await l.uma(
        'SELECT destino_local_atendimento_id AS destino FROM evento_senha WHERE senha_emitida_id = ? ORDER BY id DESC LIMIT 1',
        [senha],
      );
      return x?.['destino'] == null ? null : Number(x['destino']);
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    manutencao = new LocaisAtendimentoPropria(nucleo, CLIENTE);
    atendimento = new PortaAtendimentoPropria(nucleo, CLIENTE);
    recepcao = new PortaRecepcaoPropria(nucleo, nucleo.criarExecutor(), CLIENTE);
    // Paciente, profissional e catálogos do atendimento sintético vêm da massa sintética da recepção.
    const massa = await montarMassa(nucleo);
    atendimentoBase =
      (await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c2022' }, (l) =>
        l.uma(
          `SELECT paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id
             FROM atendimento WHERE id = ?`,
          [massa.atendimento],
        ),
      )) ?? {};
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
      ids.gerador = await garantir(
        e,
        'SELECT id FROM gerador_senha WHERE ponto_recepcao_id = ? AND prefixo = ?',
        [ids.recepcao, 'CE'],
        'INSERT INTO gerador_senha (ponto_recepcao_id, prefixo, descricao, criado_em) VALUES (?, ?, ?, ?)',
        [ids.recepcao, 'CE', 'SERVICO SINTETICO C2022', agora],
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

  it('o serviço da fila devolve só os locais visíveis, nada do local que o usuário não vê, e o horário', async () => {
    // Estado dos casos anteriores: A atua só no L1, sem locais consultados; L1 aberto o dia inteiro hoje.
    const servico = new ServicoAtendimento(atendimento);
    const { agora } = await relogio();
    const semProfissional = { crm: null, profissional: null };
    const escondido = await servico.fila(ctxAtendimento(ids.a), { local: ids.l2, ...semProfissional });
    expect(escondido.local).toBeNull();
    expect(escondido.itens).toEqual([]);
    expect(escondido.locais.map((l) => l.id)).toEqual([ids.l1]);
    const doL1 = await servico.fila(ctxAtendimento(ids.a), { local: ids.l1, ...semProfissional });
    expect(doL1.locais.map((l) => l.id)).toEqual([ids.l1]);
    expect(doL1.local).toMatchObject({ id: ids.l1 });
    expect(doL1.local?.horario).toBeTruthy();
    if (agora.slice(11, 16) < '23:59')
      expect(doL1.local?.horario).toMatchObject({ aberto: true, fechaAs: '23:59' });
    // Sem vínculo (B), todos os locais ativos aparecem, e o L2 leva o horário dele (fechado hoje).
    const doB = await servico.fila(ctxAtendimento(ids.b), { local: ids.l2, ...semProfissional });
    expect(doB.locais.map((l) => l.id).sort((x, y) => x - y)).toEqual([ids.l1, ids.l2, ids.l3, ids.l4]);
    expect(doB.local?.horario).toMatchObject({ aberto: false, semHorario: false });
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
    // A gravação do encaminhamento pela recepção usa a mesma conferência, no leitor da transação de escrita.
    const s1 = await emAtendimento();
    expect(await recusada(encaminhar(s1, ids.l1, ids.l2))).toBe('destino-nao-permitido');
    expect(await situacaoDa(s1)).toEqual({ situacao: 'em_atendimento', local: null, eventos: 0 });
    await encaminhar(s1, ids.l1, ids.l3);
    expect(await situacaoDa(s1)).toEqual({ situacao: 'encaminhada', local: ids.l3, eventos: 1 });
    expect(await destinoDoEvento(s1)).toBe(ids.l3);
    // A origem que não encaminha recusa qualquer destino.
    const s2 = await emAtendimento();
    expect(await recusada(encaminhar(s2, ids.l2, ids.l1))).toBe('destino-nao-permitido');
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
    // E a gravação: encaminhar para o destino inativado recusa; para um dos ativos, grava.
    expect(await recusada(encaminhar(s2, ids.l1, ids.l3))).toBe('destino-nao-permitido');
    expect(await situacaoDa(s2)).toEqual({ situacao: 'em_atendimento', local: null, eventos: 0 });
    await encaminhar(s2, ids.l1, ids.l4);
    expect(await situacaoDa(s2)).toEqual({ situacao: 'encaminhada', local: ids.l4, eventos: 1 });
  });
});
