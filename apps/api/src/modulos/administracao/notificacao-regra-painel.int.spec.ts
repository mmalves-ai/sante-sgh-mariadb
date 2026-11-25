// Contrato de efeito da manutenção das regras de alerta pela tela (01-ADM L75) no MariaDB:
// - o painel devolve a regra INTEIRA (descrição, bloqueio, justificativa, sexo, idades, intervalo, escopo) e os perfis
//   de acesso que podem receber; a tela regrava o que leu;
// - ativar ou desativar na linha (a regra lida, só com a situação trocada) muda `regra_alerta.ativo`, grava a versão
//   nova e deixa o conteúdo e os destinatários (perfil e usuário) como estavam;
// - a regra de todos os estabelecimentos vem marcada como global e sem edição de conteúdo para o estabelecimento
//   (com edição para a administração da plataforma); desativá-la pela linha grava só o registro do estabelecimento,
//   sem tocar a regra. Massa sintética (prefixo L75A).
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { NotificacaoRegraPropria, type RegraAlertaLida } from './notificacao-regra-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L75A';

/** O corpo que a tela manda ao regravar a regra lida (o mesmo mapeamento de `regra-alerta-tela.ts`). */
function corpoDaLida(r: RegraAlertaLida, ativo: boolean) {
  return {
    id: r.id,
    versao: r.versao,
    codigo: r.codigo,
    nome: r.nome,
    cenario: r.cenario,
    descricao: r.descricao,
    mensagem: r.mensagem,
    gravidade: r.gravidade,
    bloqueante: r.bloqueante,
    exigeJustificativa: r.exigeJustificativa,
    sexo: r.sexo,
    idadeMinima: r.idadeMinima,
    idadeMaxima: r.idadeMaxima,
    repeticao: r.repeticao,
    intervaloMinutos: r.repeticao === 'intervalo' ? r.intervaloMinutos : null,
    notificaTela: r.notifica.tela,
    notificaEmail: r.notifica.email,
    notificaSms: r.notifica.sms,
    notificaAplicativo: r.notifica.aplicativo,
    consolidacao: r.consolidacao,
    vigenciaInicio: r.vigenciaInicio,
    vigenciaFim: r.vigenciaFim,
    ativo,
    destinatarios: r.destinatarios,
  };
}

describe.skipIf(SEM_BANCO)('regras de alerta pela tela no banco próprio', () => {
  const nucleo = new NucleoProprio();
  let porta: NotificacaoRegraPropria;
  const ids = { est: 0, usuario: 0, perfil: 0, cenario: 0 };
  const quem = { hospital: P, login: `${P}.A` };
  const ctx = () => ({ ...quem, correlacao: 'teste-l75a', chaveIdempotencia: `tl75a-${randomUUID()}` });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l75a' }, (l) => l.uma(sql, p));
  const todos = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l75a' }, (l) => l.consultar(sql, p));
  const CONTEUDO = `SELECT mensagem, descricao, gravidade, bloqueante, exige_justificativa, sexo_aplicavel, idade_minima_anos,
       idade_maxima_anos, repeticao, intervalo_repeticao_minutos, notifica_tela, notifica_email, ativo, numero_versao_vigente
  FROM regra_alerta WHERE id = ?`;

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l75a' }, async (e) => {
      const regras = `SELECT id FROM regra_alerta WHERE codigo LIKE '${P}%'`;
      await e.executar(`DELETE FROM regra_alerta_destinatario WHERE regra_alerta_id IN (${regras})`, []);
      await e.executar(`DELETE FROM regra_alerta_versao WHERE regra_alerta_id IN (${regras})`, []);
      await e.executar(`DELETE FROM regra_alerta_estabelecimento WHERE regra_alerta_id IN (${regras})`, []);
      await e.executar(`DELETE FROM regra_alerta WHERE codigo LIKE '${P}%'`, []);
      await limparTrilhaDaMassa(e, { codigos: [P] });
    });
  }

  beforeAll(async () => {
    if ((await nucleo.cliente(CLIENTE)).banco !== `cliente_${CLIENTE}`)
      throw new Error('Cliente de teste inesperado.');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l75a' }, async (e) => {
      const hoje = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, hoje],
      );
      ids.usuario = await g(
        'SELECT id FROM usuario WHERE login = ?',
        [`${P}.A`],
        "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'PESSOA SINTETICA', TRUE, 'pessoa', ?)",
        [`${P}.A`, hoje],
      );
      ids.perfil = await g(
        'SELECT id FROM perfil_acesso WHERE codigo = ?',
        [`${P}_PERFIL`],
        "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, administrador, criado_em) VALUES (?, ?, 'PERFIL SINTETICO L75A', FALSE, ?)",
        [ids.est, `${P}_PERFIL`, hoje],
      );
      ids.cenario = await g(
        'SELECT id FROM cenario_alerta WHERE codigo = ?',
        [P],
        "INSERT INTO cenario_alerta (codigo, descricao, verificador, criado_em) VALUES (?, 'CENARIO SINTETICO L75A', 'sintetico', ?)",
        [P, hoje],
      );
    });
    await limpar();
    porta = new NotificacaoRegraPropria(nucleo, CLIENTE, false);
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  const nova = {
    codigo: `${P}R1`,
    nome: 'REGRA SINTETICA L75A',
    cenario: P,
    descricao: 'DESCRICAO SINTETICA',
    mensagem: 'MENSAGEM SINTETICA',
    gravidade: 'critico' as const,
    bloqueante: true,
    exigeJustificativa: true,
    sexo: 'feminino' as const,
    idadeMinima: 12,
    idadeMaxima: 60,
    repeticao: 'intervalo' as const,
    intervaloMinutos: 30,
    notificaTela: true,
    notificaEmail: true,
    vigenciaInicio: '2026-11-01',
    destinatarios: [
      { tipo: 'perfil' as const, codigo: `${P}_PERFIL` },
      { tipo: 'usuario' as const, codigo: `${P}.A` },
    ],
  };
  const lida = async (plataforma = false) => {
    const p = await porta.painel({ ...quem, ...(plataforma ? { plataforma: true } : {}) });
    const r = p.regras.find((x) => x.codigo === nova.codigo);
    if (!r) throw new Error('regra não veio no painel');
    return { painel: p, regra: r };
  };
  let regra = 0;

  it('o painel devolve a regra inteira e os perfis que podem receber', async () => {
    const g = await porta.gravarRegraAlerta(ctx(), nova);
    regra = g.resultado.regra;
    const { painel, regra: r } = await lida();
    expect(painel.perfis).toContainEqual({ codigo: `${P}_PERFIL`, nome: 'PERFIL SINTETICO L75A' });
    expect(painel.cenarios).toContainEqual({ codigo: P, descricao: 'CENARIO SINTETICO L75A' });
    expect(r).toMatchObject({
      id: regra,
      descricao: 'DESCRICAO SINTETICA',
      gravidade: 'critico',
      bloqueante: true,
      exigeJustificativa: true,
      sexo: 'feminino',
      idadeMinima: 12,
      idadeMaxima: 60,
      repeticao: 'intervalo',
      intervaloMinutos: 30,
      notifica: { tela: true, email: true, sms: false, aplicativo: false },
      ativo: true,
      editavel: true,
      global: false,
      conteudoEditavel: true,
      numeroVersao: 1,
    });
    expect(r.destinatarios).toEqual([
      { tipo: 'perfil', codigo: `${P}_PERFIL` },
      { tipo: 'usuario', codigo: `${P}.A` },
    ]);
    expect(
      await todos(
        'SELECT tipo_destinatario, perfil_acesso_id, usuario_id, ativo FROM regra_alerta_destinatario WHERE regra_alerta_id = ? ORDER BY id',
        [regra],
      ),
    ).toMatchObject([
      { tipo_destinatario: 'perfil', perfil_acesso_id: ids.perfil, ativo: 1 },
      { tipo_destinatario: 'usuario', usuario_id: ids.usuario, ativo: 1 },
    ]);
  });

  it('desativar e ativar na linha muda só a situação: conteúdo e destinatários ficam, com versão nova', async () => {
    const antes = await um(CONTEUDO, [regra]);
    await porta.gravarRegraAlerta(ctx(), corpoDaLida((await lida()).regra, false));
    const depois = await um(CONTEUDO, [regra]);
    expect(depois).toMatchObject({ ...antes, ativo: 0, numero_versao_vigente: 2 });
    expect(
      await um(
        'SELECT COUNT(*) AS n, SUM(ativo) AS ativos FROM regra_alerta_destinatario WHERE regra_alerta_id = ?',
        [regra],
      ),
    ).toMatchObject({ n: 2, ativos: '2' });
    const r2 = (await lida()).regra;
    expect(r2).toMatchObject({ ativo: false, numeroVersao: 2, mensagem: 'MENSAGEM SINTETICA' });
    await porta.gravarRegraAlerta(ctx(), corpoDaLida(r2, true));
    expect(await um(CONTEUDO, [regra])).toMatchObject({ ...antes, ativo: 1, numero_versao_vigente: 3 });
    const versoes = await todos(
      'SELECT numero_versao, operacao FROM regra_alerta_versao WHERE regra_alerta_id = ? ORDER BY numero_versao',
      [regra],
    );
    expect(versoes.map((v) => Number(v['numero_versao']))).toEqual([1, 2, 3]);
  });

  it('regra de todos os estabelecimentos: marcada no painel; desativar na linha grava só o registro do estabelecimento', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l75a' }, (e) =>
      e.executar('UPDATE regra_alerta SET estabelecimento_id = NULL WHERE id = ?', [regra]),
    );
    const doEstabelecimento = (await lida()).regra;
    expect(doEstabelecimento).toMatchObject({ global: true, conteudoEditavel: false, ativo: true });
    expect((await lida(true)).regra).toMatchObject({ global: true, conteudoEditavel: true });
    const antes = await um(CONTEUDO, [regra]);
    await porta.gravarRegraAlerta(ctx(), corpoDaLida(doEstabelecimento, false));
    // A regra não mudou (nem a situação geral nem a versão); o estabelecimento ficou com o registro próprio.
    expect(await um(CONTEUDO, [regra])).toMatchObject({ ...antes });
    expect(
      await um(
        'SELECT ativo FROM regra_alerta_estabelecimento WHERE regra_alerta_id = ? AND estabelecimento_id = ?',
        [regra, ids.est],
      ),
    ).toMatchObject({ ativo: 0 });
    expect((await lida()).regra).toMatchObject({ ativo: false, global: true });
  });
});
