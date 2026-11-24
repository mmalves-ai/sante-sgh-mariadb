// Integração do envio agendado sobre o MariaDB real (cliente f22_o5; lote F2.2 05-17). Contrato de efeito: o vencido do
// estabelecimento aparece (o do outro estabelecimento e o de relatório suspenso não); os destinatários saem do cadastro
// (usuário, lista e endereço, sem repetir, sem o usuário inativo, sem a lista de OUTRO estabelecimento), com a forma de
// cada um e o avisar_falha; a reserva grava a linha "nao_enviado", a versão do agendamento sobe e o próximo envio anda;
// duas reservas concorrentes do mesmo vencimento dão uma só; a repetida (mesma chave) e a do vencimento velho não
// reservam; o job da fila repetido não reserva de novo; a conclusão grava situação, quantidade, motivo e destinatários
// mascarados, e não conclui duas vezes; as falhas seguidas contam do histórico e zeram com o envio feito; o
// agendamento de outro estabelecimento é recusado. Massa sintética (e-mails
// .invalid), apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { limparTrilhaDaMassa } from '../teste/limpar-trilha.spec-util.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  garantirUsuario,
  SEM_BANCO,
} from '../importadores/integracao.spec-util.js';
import { PortaEnvioRelatorioPropria } from './envio-agendado-proprio.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const EST = 'fo517r';
const OUTRO = 'fo517s';

describe.skipIf(SEM_BANCO)('envio agendado de relatório sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaEnvioRelatorioPropria;
  const marca = `f517${Date.now() % 1_000_000}`;
  const ids = {
    modulo: 0,
    est: 0,
    outro: 0,
    relatorio: 0,
    suspenso: 0,
    lista: 0,
    listaOutro: 0,
    ag: 0,
    agOutro: 0,
    agSuspenso: 0,
    dono: 0,
    membro: 0,
    inativo: 0,
  };
  const agora = new Date('2026-11-21T09:00:00Z');

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    porta = new PortaEnvioRelatorioPropria(nucleo, CLIENTE);
    await escrever(nucleo, async (e) => {
      ids.est = await garantirEstabelecimento(e, EST);
      ids.outro = await garantirEstabelecimento(e, OUTRO);
      ids.dono = await garantirUsuario(e, `${marca}d`);
      ids.membro = await garantirUsuario(e, `${marca}m`);
      ids.inativo = await garantirUsuario(e, `${marca}i`);
      await e.executar('UPDATE usuario SET email = ? WHERE id = ?', [
        `dono.${marca}@exemplo.invalid`,
        ids.dono,
      ]);
      await e.executar('UPDATE usuario SET email = ? WHERE id = ?', [
        `membro.${marca}@exemplo.invalid`,
        ids.membro,
      ]);
      await e.executar("UPDATE usuario SET email = ?, situacao = 'inativo' WHERE id = ?", [
        `inativo.${marca}@exemplo.invalid`,
        ids.inativo,
      ]);
      const modulo = await e.uma('SELECT id FROM modulo_sistema WHERE codigo = ?', ['f517teste']);
      ids.modulo = modulo
        ? Number(modulo['id'])
        : await e.inserir('INSERT INTO modulo_sistema (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
            'f517teste',
            'Módulo sintético do teste 05-17',
            new Date(),
          ]);
      const relatorio = (codigo: string, situacao: string) =>
        e.inserir(
          `INSERT INTO relatorio (codigo, titulo, modulo_sistema_id, consulta_definicao, situacao, conferencia, criado_em)
           VALUES (?, ?, ?, ?, ?, 'conferida', ?)`,
          [codigo, 'Relatório sintético', ids.modulo, 'sintetico', situacao, new Date()],
        );
      ids.relatorio = await relatorio(marca, 'liberado');
      ids.suspenso = await relatorio(`${marca}s`, 'suspenso');
      ids.lista = await e.inserir(
        'INSERT INTO lista_distribuicao_email (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, marca, 'Lista sintética', new Date()],
      );
      await e.inserir(
        'INSERT INTO lista_distribuicao_email_membro (lista_distribuicao_email_id, sequencia, usuario_id, criado_em) VALUES (?, 1, ?, ?)',
        [ids.lista, ids.membro, new Date()],
      );
      await e.inserir(
        `INSERT INTO lista_distribuicao_email_membro (lista_distribuicao_email_id, sequencia, email, tipo_envio, criado_em)
         VALUES (?, 2, ?, 'copia_oculta', ?)`,
        [ids.lista, `lista.${marca}@exemplo.invalid`, new Date()],
      );
      ids.listaOutro = await e.inserir(
        'INSERT INTO lista_distribuicao_email (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
        [ids.outro, `${marca}o`, 'Lista sintética de outro estabelecimento', new Date()],
      );
      await e.inserir(
        'INSERT INTO lista_distribuicao_email_membro (lista_distribuicao_email_id, sequencia, email, criado_em) VALUES (?, 1, ?, ?)',
        [ids.listaOutro, `vizinho.${marca}@exemplo.invalid`, new Date()],
      );
      const agendar = (est: number, nome: string, relatorioId = ids.relatorio) =>
        e.inserir(
          `INSERT INTO agendamento_relatorio (estabelecimento_id, relatorio_id, nome, periodicidade, hora_envio, dia_semana,
             parametros, entrega, validade_link_horas, dono_usuario_id, proximo_envio_em, criado_em)
           VALUES (?, ?, ?, 'semanal', '07:30:00', 2, ?, 'link', 24, ?, ?, ?)`,
          [
            est,
            relatorioId,
            nome,
            JSON.stringify({ mesFim: 'mesAnterior' }),
            ids.dono,
            new Date('2026-11-20T07:30:00Z'),
            new Date(),
          ],
        );
      ids.ag = await agendar(ids.est, `${marca} a`);
      ids.agOutro = await agendar(ids.outro, `${marca} b`);
      ids.agSuspenso = await agendar(ids.est, `${marca} c`, ids.suspenso);
      const destino = (
        seq: number,
        tipo: string,
        usuario: number | null,
        lista: number | null,
        email: string | null,
        forma = 'para',
      ) =>
        e.inserir(
          `INSERT INTO agendamento_relatorio_destinatario (agendamento_relatorio_id, sequencia, tipo_destinatario, usuario_id,
             lista_distribuicao_email_id, email, forma_envio, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [ids.ag, seq, tipo, usuario, lista, email, forma, new Date()],
        );
      await destino(1, 'usuario', ids.membro, null, null);
      await destino(2, 'lista_distribuicao', null, ids.lista, null);
      await destino(3, 'endereco', null, null, `avulso.${marca}@exemplo.invalid`, 'cc');
      await destino(4, 'usuario', ids.inativo, null, null);
      await destino(5, 'lista_distribuicao', null, ids.listaOutro, null);
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(nucleo, async (e) => {
      const ag = [ids.ag, ids.agOutro, ids.agSuspenso];
      // A trilha dos dois estabelecimentos sintéticos sai na ordem das chaves (dependentes, fecho, cabeça e linhas):
      // apagar só a linha da trilha dá o erro 1451 desde a cadeia por hash.
      await limparTrilhaDaMassa(e, { ids: [ids.est, ids.outro] });
      await e.executar('DELETE FROM envio_relatorio WHERE agendamento_relatorio_id IN (?, ?, ?)', ag);
      await e.executar(
        'DELETE FROM agendamento_relatorio_destinatario WHERE agendamento_relatorio_id IN (?, ?, ?)',
        ag,
      );
      await e.executar('DELETE FROM agendamento_relatorio WHERE id IN (?, ?, ?)', ag);
      await e.executar(
        'DELETE FROM lista_distribuicao_email_membro WHERE lista_distribuicao_email_id IN (?, ?)',
        [ids.lista, ids.listaOutro],
      );
      await e.executar('DELETE FROM lista_distribuicao_email WHERE id IN (?, ?)', [
        ids.lista,
        ids.listaOutro,
      ]);
      await e.executar('DELETE FROM relatorio WHERE id IN (?, ?)', [ids.relatorio, ids.suspenso]);
      await e.executar('DELETE FROM modulo_sistema WHERE id = ?', [ids.modulo]).catch(() => 0);
      await e
        .executar('DELETE FROM usuario WHERE id IN (?, ?, ?)', [ids.dono, ids.membro, ids.inativo])
        .catch(() =>
          e.executar('UPDATE usuario SET email = NULL WHERE id IN (?, ?, ?)', [
            ids.dono,
            ids.membro,
            ids.inativo,
          ]),
        );
    });
    await nucleo.encerrar();
  });

  it('o vencido é do estabelecimento e do relatório liberado; destinatários do cadastro, na fronteira', async () => {
    const v = await porta.vencidos(EST, agora);
    const meu = v.find((x) => x.id === ids.ag);
    expect(meu).toMatchObject({
      relatorio: marca,
      titulo: `${marca} a`,
      parametros: { mesFim: 'mesAnterior' },
      dono: ids.dono,
    });
    expect(meu!.proximoEnvioEm).toBeInstanceOf(Date);
    expect(v.some((x) => x.id === ids.agOutro)).toBe(false);
    expect(v.some((x) => x.id === ids.agSuspenso)).toBe(false);
    expect((await porta.vencidos(OUTRO, agora)).some((x) => x.id === ids.agOutro)).toBe(true);
    const d = await porta.destinatarios(EST, ids.ag);
    expect([...d.destinatarios].sort()).toEqual(
      [
        `avulso.${marca}@exemplo.invalid`,
        `lista.${marca}@exemplo.invalid`,
        `membro.${marca}@exemplo.invalid`,
      ].sort(),
    );
    expect(d.destinatarios).not.toContain(`vizinho.${marca}@exemplo.invalid`);
    expect(d.formas).toEqual({ para: 1, copia: 1, copia_oculta: 1 });
    expect(d.avisarFalha).toBe(true);
    expect(d.dono).toBe(`dono.${marca}@exemplo.invalid`);
    expect(await porta.destinatarios(OUTRO, ids.ag)).toEqual({
      destinatarios: [],
      dono: null,
      avisarFalha: true,
    });
    await escrever(nucleo, (e) =>
      e.executar('UPDATE agendamento_relatorio SET avisar_falha = FALSE WHERE id = ?', [ids.ag]),
    );
    expect((await porta.destinatarios(EST, ids.ag)).avisarFalha).toBe(false);
    await escrever(nucleo, (e) =>
      e.executar('UPDATE agendamento_relatorio SET avisar_falha = TRUE WHERE id = ?', [ids.ag]),
    );
    expect(await porta.nomeEstabelecimento(EST)).toBeTruthy();
  });

  it('reserva antes do envio: uma só entre concorrentes; repetida e vencimento velho não reservam', async () => {
    const lido = (await porta.vencidos(EST, agora)).find((x) => x.id === ids.ag)!;
    const antes = await escrever(nucleo, (e) =>
      e.uma('SELECT versao FROM agendamento_relatorio WHERE id = ?', [ids.ag]),
    );
    const origem = { tipo: 'vencido' as const, previsto: lido.proximoEnvioEm };
    const outraPorta = new PortaEnvioRelatorioPropria(nucleo, CLIENTE);
    const [a, b] = await Promise.all([
      porta.reservar(EST, ids.ag, origem, agora),
      outraPorta.reservar(EST, ids.ag, origem, agora),
    ]);
    const ganhas = [a, b].filter((x) => x !== null);
    expect(ganhas).toHaveLength(1);
    const reserva = ganhas[0]!;
    expect(reserva.proximoEnvio.getTime()).toBeGreaterThan(agora.getTime());
    const linha = await escrever(nucleo, (e) =>
      e.uma('SELECT situacao, mensagem_erro, dados FROM envio_relatorio WHERE id = ?', [reserva.envio]),
    );
    expect(linha).toMatchObject({ situacao: 'nao_enviado' });
    expect(String(linha!['mensagem_erro'])).toMatch(/reservado/);
    const dados =
      typeof linha!['dados'] === 'string' ? JSON.parse(linha!['dados'] as string) : linha!['dados'];
    expect(dados).toMatchObject({
      origem: 'vencido',
      entregaPedida: 'link',
      linhasAvaliadas: false,
      parametros: { mesFim: 'mesAnterior' },
    });
    const ag = await escrever(nucleo, (e) =>
      e.uma('SELECT versao, proximo_envio_em FROM agendamento_relatorio WHERE id = ?', [ids.ag]),
    );
    expect(Number(ag!['versao'])).toBe(Number(antes!['versao']) + 1);
    expect((await porta.vencidos(EST, agora)).some((x) => x.id === ids.ag)).toBe(false);
    expect(await porta.reservar(EST, ids.ag, origem, agora)).toBeNull();
    const envios = await escrever(nucleo, (e) =>
      e.uma('SELECT COUNT(*) AS n FROM envio_relatorio WHERE agendamento_relatorio_id = ?', [ids.ag]),
    );
    expect(Number(envios!['n'])).toBe(1);
    // A falha: motivo e destinatários mascarados, trilha; não conclui duas vezes.
    await porta.concluir(EST, reserva.envio, {
      situacao: 'falhou',
      falha: `envio recusado (550 <x.${marca}@exemplo.invalid>)`,
      falhasSeguidas: 1,
      destinatarios: 3,
      enderecos: [`membro.${marca}@exemplo.invalid`],
      formas: { para: 1, copia: 0, copia_oculta: 0 },
    });
    const fim = await escrever(nucleo, (e) =>
      e.uma(
        'SELECT situacao, quantidade_destinatarios, mensagem_erro, dados FROM envio_relatorio WHERE id = ?',
        [reserva.envio],
      ),
    );
    expect(fim).toMatchObject({
      situacao: 'falhou',
      quantidade_destinatarios: 3,
      mensagem_erro: 'envio recusado (550 <***@***>)',
    });
    const dadosFim = typeof fim!['dados'] === 'string' ? JSON.parse(fim!['dados'] as string) : fim!['dados'];
    expect(dadosFim).toMatchObject({
      origem: 'vencido',
      falhasSeguidas: 1,
      destinatarios: ['m***@exemplo.invalid'],
    });
    expect(JSON.stringify(dadosFim)).not.toContain(marca);
    const trilha = await escrever(nucleo, (e) =>
      e.uma(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'envio_relatorio' AND entidade_id = ?",
        [reserva.envio],
      ),
    );
    expect(Number(trilha!['n'])).toBeGreaterThanOrEqual(2);
    expect(
      (await escrever(nucleo, (e) =>
        e.uma('SELECT ultimo_envio_em FROM agendamento_relatorio WHERE id = ?', [ids.ag]),
      ))!['ultimo_envio_em'],
    ).toBeNull();
    await expect(
      porta.concluir(EST, reserva.envio, {
        situacao: 'enviado',
        falha: null,
        falhasSeguidas: 0,
        destinatarios: 3,
      }),
    ).rejects.toMatchObject({ name: 'ErroOperacao' });
    expect(await porta.falhasSeguidas(EST, ids.ag)).toBe(1);
  });

  it('job da fila repetido não reserva de novo; o envio feito zera as seguidas e marca o último envio', async () => {
    const origem = { tipo: 'fila' as const, job: `relatorio-f22-o5:${marca}` };
    const r = await porta.reservar(EST, ids.ag, origem, agora);
    expect(r).not.toBeNull();
    expect(await porta.reservar(EST, ids.ag, origem, agora)).toBeNull();
    await porta.concluir(EST, r!.envio, {
      situacao: 'enviado',
      falha: null,
      falhasSeguidas: 0,
      destinatarios: 3,
    });
    expect(await porta.falhasSeguidas(EST, ids.ag)).toBe(0);
    const ag = await escrever(nucleo, (e) =>
      e.uma('SELECT ultimo_envio_em FROM agendamento_relatorio WHERE id = ?', [ids.ag]),
    );
    expect(ag!['ultimo_envio_em']).not.toBeNull();
  });

  it('recusa o agendamento de outro estabelecimento e o de relatório não liberado', async () => {
    await expect(
      porta.reservar(OUTRO, ids.ag, { tipo: 'fila', job: `${marca}-outro` }, agora),
    ).rejects.toMatchObject({ name: 'ErroOperacao' });
    await expect(
      porta.reservar(EST, ids.agSuspenso, { tipo: 'fila', job: `${marca}-suspenso` }, agora),
    ).rejects.toMatchObject({ name: 'ErroOperacao', problema: { codigo: 'relatorio-nao-liberado' } });
  });
});
