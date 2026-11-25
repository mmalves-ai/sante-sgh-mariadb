// Contrato de efeito do e-mail do sistema (01-ADM L77) no MariaDB:
// - o servidor de saída gravado pela tela guarda só a referência da senha no cofre (a senha no lugar da referência é
//   recusada sem gravar); um padrão por alcance (marcar outro desmarca o anterior, sem tocar no de outro
//   estabelecimento); versão lida diferente é conflito; código repetido é recusado;
// - o teste de conexão grava quando foi e se deu certo (ultimo_teste_em, ultimo_teste_sucesso); o teste neutralizado
//   não grava; mudar o endereço apaga o resultado do teste anterior;
// - o modelo de mensagem gravado mantém os campos iguais aos marcadores do texto: o que sai é marcado como excluído
//   (a linha fica) e volta se o marcador voltar; marcador mal escrito e finalidade inexistente são recusados;
// - o painel devolve servidores, modelos e o registro de envio do próprio estabelecimento e do que vale para todos;
//   o de outro estabelecimento não aparece nem pode ser alterado. Massa sintética (prefixo L77E).
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { EmailConfiguracaoPropria } from './email-configuracao-propria.js';
import type { ResultadoTesteConexao, ServidorParaTeste } from './email-teste-conexao.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L77E';
const T0 = new Date('2026-11-24T09:00:00.000');

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    return `outro: ${(e as Error)?.message ?? ''}`;
  }
}

describe.skipIf(SEM_BANCO)('e-mail do sistema no banco próprio', () => {
  const nucleo = new NucleoProprio();
  let teste: ResultadoTesteConexao = { sucesso: true, detalhe: 'Servidor respondeu.' };
  let testados = 0;
  let testadoCom: ServidorParaTeste | null = null;
  let agora = T0;
  let porta: EmailConfiguracaoPropria;
  const ids = { est: 0, est2: 0, usuario: 0, fin: 0 };
  const ctx = (hospital = P) => ({
    hospital,
    login: `${P}.A`,
    correlacao: 'teste-l77e',
    chaveIdempotencia: `tl77e-${randomUUID()}`,
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l77e' }, (l) => l.uma(sql, p));
  const todos = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l77e' }, (l) => l.consultar(sql, p));
  const servidorBase = (extra: Record<string, unknown> = {}) => ({
    codigo: `${P}.S1`,
    nome: 'SERVIDOR SINTETICO',
    host: 'smtp.sintetico.invalid',
    porta: 587,
    seguranca: 'starttls',
    exigeAutenticacao: true,
    usuarioAutenticacao: 'envio-sintetico',
    referenciaCofre: 'email/saida/sintetico',
    remetenteEmail: 'nao-responda@sintetico.invalid',
    padrao: true,
    ...extra,
  });
  const modeloBase = (extra: Record<string, unknown> = {}) => ({
    finalidade: `${P}.FIN`,
    codigo: `${P}.M1`,
    nome: 'MODELO SINTETICO',
    assunto: 'Aviso {{pedido.numero}}',
    corpoHtml: '<p>{{pessoa.nome}}: pedido {{pedido.numero}}.</p>',
    vigenciaInicio: '2026-12-01',
    campos: [{ marcador: 'pessoa.nome', descricao: 'Nome da pessoa', exemplo: 'PESSOA SINTETICA' }],
    ...extra,
  });

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l77e' }, async (e) => {
      const envios = `SELECT id FROM envio_email WHERE assunto LIKE '${P}%'`;
      await e.executar(`DELETE FROM envio_email_destinatario WHERE envio_email_id IN (${envios})`, []);
      await e.executar(`DELETE FROM envio_email WHERE assunto LIKE '${P}%'`, []);
      await e.executar(
        `DELETE FROM modelo_email_campo WHERE modelo_email_id IN (SELECT id FROM modelo_email WHERE codigo LIKE '${P}%')`,
        [],
      );
      await e.executar(`DELETE FROM modelo_email WHERE codigo LIKE '${P}%'`, []);
      await e.executar(`DELETE FROM servidor_email WHERE codigo LIKE '${P}%'`, []);
      await e.executar(`DELETE FROM finalidade_email WHERE codigo LIKE '${P}%'`, []);
      await limparTrilhaDaMassa(e, { codigos: [P, `${P}2`] });
    });
  }

  beforeAll(async () => {
    if ((await nucleo.cliente(CLIENTE)).banco !== `cliente_${CLIENTE}`)
      throw new Error('Cliente de teste inesperado.');
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l77e' }, async (e) => {
      const hoje = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      for (const [k, cod] of [
        ['est', P],
        ['est2', `${P}2`],
      ] as const)
        ids[k] = await g(
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `ESTAB ${cod} SINTETICO`, `ESTAB ${cod} SINTETICO`, hoje],
        );
      ids.usuario = await g(
        'SELECT id FROM usuario WHERE login = ?',
        [`${P}.A`],
        "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'PESSOA SINTETICA', TRUE, 'pessoa', ?)",
        [`${P}.A`, hoje],
      );
      ids.fin = await e.inserir(
        "INSERT INTO finalidade_email (codigo, descricao, criado_em) VALUES (?, 'FINALIDADE SINTETICA', ?)",
        [`${P}.FIN`, hoje],
      );
    });
    porta = new EmailConfiguracaoPropria(
      nucleo,
      CLIENTE,
      false,
      async (s) => {
        testados++;
        testadoCom = s;
        return teste;
      },
      () => agora,
    );
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  let servidor = 0;

  it('grava o servidor só com a referência da senha no cofre; a senha no lugar dela é recusada sem gravar', async () => {
    expect(await codigo(porta.gravarServidor(ctx(), servidorBase({ referenciaCofre: 'Segredo#2026' })))).toBe(
      'referencia-cofre-invalida',
    );
    expect(await codigo(porta.gravarServidor(ctx(), servidorBase({ referenciaCofre: null })))).toBe(
      'autenticacao-incompleta',
    );
    expect(await um(`SELECT COUNT(*) AS n FROM servidor_email WHERE codigo LIKE '${P}%'`, [])).toMatchObject({
      n: 0,
    });
    const r = await porta.gravarServidor(ctx(), servidorBase({ host: 'SMTP.Sintetico.invalid' }));
    servidor = r.resultado.servidor;
    const l = await um('SELECT * FROM servidor_email WHERE id = ?', [servidor]);
    expect(l).toMatchObject({
      estabelecimento_id: ids.est,
      codigo: `${P}.S1`,
      host: 'smtp.sintetico.invalid',
      porta: 587,
      seguranca: 'starttls',
      exige_autenticacao: 1,
      usuario_autenticacao: 'envio-sintetico',
      referencia_cofre: 'email/saida/sintetico',
      padrao: 1,
      ativo: 1,
      ultimo_teste_em: null,
      ultimo_teste_sucesso: null,
      versao: 1,
      criado_por: ids.usuario,
    });
    // Nenhuma coluna do cadastro guarda senha.
    expect(Object.keys(l ?? {}).filter((k) => /senha|segredo|password/i.test(k))).toEqual([]);
  });

  it('código repetido e versão lida diferente são recusados; a alteração sobe a versão', async () => {
    expect(await codigo(porta.gravarServidor(ctx(), servidorBase()))).toBe('codigo-duplicado');
    expect(await codigo(porta.gravarServidor(ctx(), servidorBase({ id: servidor })))).toBe(
      'versao-obrigatoria',
    );
    expect(await codigo(porta.gravarServidor(ctx(), servidorBase({ id: servidor, versao: 9 })))).toBe(
      'conflito-versao',
    );
    await porta.gravarServidor(
      ctx(),
      servidorBase({ id: servidor, versao: 1, nome: 'SERVIDOR SINTETICO B' }),
    );
    expect(
      await um('SELECT nome, versao, alterado_por FROM servidor_email WHERE id = ?', [servidor]),
    ).toMatchObject({
      nome: 'SERVIDOR SINTETICO B',
      versao: 2,
      alterado_por: ids.usuario,
    });
  });

  it('um servidor padrão por alcance: marcar outro desmarca o anterior, sem tocar no de outro estabelecimento', async () => {
    const outro = await porta.gravarServidor(ctx(`${P}2`), servidorBase({ codigo: `${P}.S9` }));
    const b = await porta.gravarServidor(
      ctx(),
      servidorBase({
        codigo: `${P}.S2`,
        exigeAutenticacao: false,
        usuarioAutenticacao: null,
        referenciaCofre: null,
      }),
    );
    const l = await todos(
      `SELECT codigo, padrao FROM servidor_email WHERE codigo LIKE '${P}%' ORDER BY codigo`,
      [],
    );
    expect(l.map((x) => [x['codigo'], Number(x['padrao'])])).toEqual([
      [`${P}.S1`, 0],
      [`${P}.S2`, 1],
      [`${P}.S9`, 1],
    ]);
    expect(b.resultado.servidor).not.toBe(servidor);
    // O estabelecimento não altera nem testa o servidor de outro.
    const v9 = await um('SELECT versao FROM servidor_email WHERE id = ?', [outro.resultado.servidor]);
    expect(
      await codigo(
        porta.gravarServidor(
          ctx(),
          servidorBase({ id: outro.resultado.servidor, versao: Number(v9?.['versao']), codigo: `${P}.S9` }),
        ),
      ),
    ).toBe('servidor-inexistente');
    expect(await codigo(porta.testarServidor(ctx(), { servidor: outro.resultado.servidor }))).toBe(
      'servidor-inexistente',
    );
  });

  it('o teste de conexão grava quando foi e se deu certo; o neutralizado não grava; mudar o endereço apaga o teste', async () => {
    agora = new Date(T0.getTime() + 60_000);
    const ok = await porta.testarServidor(ctx(), { servidor });
    expect(ok.resultado).toMatchObject({ servidor, sucesso: true });
    // C1-063: servidor que exige autenticação vai ao teste com o usuário e a referência da senha (nunca a senha).
    expect(testadoCom).toMatchObject({
      usuario: 'envio-sintetico',
      referenciaCofre: 'email/saida/sintetico',
    });
    let l = await um(
      'SELECT ultimo_teste_em, ultimo_teste_sucesso, versao FROM servidor_email WHERE id = ?',
      [servidor],
    );
    expect((l?.['ultimo_teste_em'] as Date).getTime()).toBe(agora.getTime());
    expect(l).toMatchObject({ ultimo_teste_sucesso: 1, versao: 4 });

    teste = { sucesso: false, detalhe: 'Error: conexão recusada' };
    agora = new Date(T0.getTime() + 120_000);
    const falha = await porta.testarServidor(ctx(), { servidor });
    expect(falha.resultado).toMatchObject({ sucesso: false, detalhe: 'Error: conexão recusada' });
    l = await um('SELECT ultimo_teste_em, ultimo_teste_sucesso, versao FROM servidor_email WHERE id = ?', [
      servidor,
    ]);
    expect((l?.['ultimo_teste_em'] as Date).getTime()).toBe(agora.getTime());
    expect(l).toMatchObject({ ultimo_teste_sucesso: 0, versao: 5 });

    teste = { neutralizado: true };
    expect(await codigo(porta.testarServidor(ctx(), { servidor }))).toBe('teste-neutralizado');
    expect(await um('SELECT versao FROM servidor_email WHERE id = ?', [servidor])).toMatchObject({
      versao: 5,
    });
    expect(testados).toBe(3);

    await porta.gravarServidor(
      ctx(),
      servidorBase({ id: servidor, versao: 5, padrao: false, host: 'smtp2.sintetico.invalid' }),
    );
    expect(
      await um('SELECT host, ultimo_teste_em, ultimo_teste_sucesso FROM servidor_email WHERE id = ?', [
        servidor,
      ]),
    ).toMatchObject({ host: 'smtp2.sintetico.invalid', ultimo_teste_em: null, ultimo_teste_sucesso: null });
  });

  let modelo = 0;
  const camposDe = (m: number) =>
    todos(
      'SELECT marcador, descricao, exemplo, sequencia, excluido_em IS NOT NULL AS excluido FROM modelo_email_campo WHERE modelo_email_id = ? ORDER BY sequencia',
      [m],
    ).then((l) => l.map((x) => [x['marcador'], x['descricao'], Number(x['excluido'])]));

  it('grava o modelo com os campos iguais aos marcadores do texto; recusas do domínio não gravam', async () => {
    expect(await codigo(porta.gravarModelo(ctx(), modeloBase({ corpoHtml: 'Olá {{Pessoa Nome}}' })))).toBe(
      'marcador-invalido',
    );
    expect(await codigo(porta.gravarModelo(ctx(), modeloBase({ finalidade: `${P}.NAO` })))).toBe(
      'finalidade-inexistente',
    );
    expect(
      await codigo(
        porta.gravarModelo(ctx(), modeloBase({ vigenciaInicio: '2026-12-02', vigenciaFim: '2026-12-01' })),
      ),
    ).toBe('vigencia-invertida');
    expect(await um(`SELECT COUNT(*) AS n FROM modelo_email WHERE codigo LIKE '${P}%'`, [])).toMatchObject({
      n: 0,
    });

    const r = await porta.gravarModelo(ctx(), modeloBase());
    modelo = r.resultado.modelo;
    expect(r.resultado.campos).toBe(2);
    expect(await um('SELECT * FROM modelo_email WHERE id = ?', [modelo])).toMatchObject({
      estabelecimento_id: ids.est,
      finalidade_email_id: ids.fin,
      codigo: `${P}.M1`,
      assunto: 'Aviso {{pedido.numero}}',
      corpo_html: '<p>{{pessoa.nome}}: pedido {{pedido.numero}}.</p>',
      ativo: 1,
      versao: 1,
    });
    expect(await camposDe(modelo)).toEqual([
      ['pedido.numero', 'pedido.numero', 0],
      ['pessoa.nome', 'Nome da pessoa', 0],
    ]);
    // O mesmo código no modelo padrão do cliente (outro alcance) é aceito; no mesmo alcance, recusado.
    expect(await codigo(porta.gravarModelo(ctx(), modeloBase()))).toBe('codigo-duplicado');
    const padrao = await porta.gravarModelo(ctx(), modeloBase({ todosEstabelecimentos: true }));
    expect(
      await um('SELECT estabelecimento_id FROM modelo_email WHERE id = ?', [padrao.resultado.modelo]),
    ).toEqual({
      estabelecimento_id: null,
    });
  });

  it('o marcador que sai do texto fica marcado como excluído (a linha continua) e volta se o marcador voltar', async () => {
    await porta.gravarModelo(
      ctx(),
      modeloBase({ id: modelo, versao: 1, corpoHtml: '<p>Pedido {{pedido.numero}} pronto.</p>', campos: [] }),
    );
    expect(await um('SELECT versao FROM modelo_email WHERE id = ?', [modelo])).toMatchObject({ versao: 2 });
    expect(await camposDe(modelo)).toEqual([
      ['pedido.numero', 'pedido.numero', 0],
      ['pessoa.nome', 'Nome da pessoa', 1],
    ]);
    expect(await codigo(porta.gravarModelo(ctx(), modeloBase({ id: modelo, versao: 1 })))).toBe(
      'conflito-versao',
    );
    await porta.gravarModelo(ctx(), modeloBase({ id: modelo, versao: 2, campos: [] }));
    expect(await camposDe(modelo)).toEqual([
      ['pedido.numero', 'pedido.numero', 0],
      ['pessoa.nome', 'Nome da pessoa', 0],
    ]);
  });

  it('o painel devolve servidores, modelos e o registro de envio do estabelecimento e do que vale para todos', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l77e' }, async (e) => {
      for (const [est, assunto] of [
        [ids.est, `${P} ENVIO A`],
        [ids.est2, `${P} ENVIO B`],
        [null, `${P} ENVIO C`],
      ] as const) {
        const envio = await e.inserir(
          `INSERT INTO envio_email (estabelecimento_id, modelo_email_id, remetente, assunto, situacao, tentativas,
              identificador_mensagem, ocorrido_em, criado_em) VALUES (?, ?, 'nao-responda@sintetico.invalid', ?, 'capturado', 2, ?, ?, ?)`,
          [
            est,
            est === ids.est ? modelo : null,
            assunto,
            `<${assunto.replace(/ /g, '-')}@sintetico.invalid>`,
            T0,
            T0,
          ],
        );
        await e.inserir(
          "INSERT INTO envio_email_destinatario (envio_email_id, sequencia, email, situacao, criado_em) VALUES (?, 1, 'destino@sintetico.invalid', 'capturado', ?)",
          [envio, T0],
        );
      }
    });
    const p = await porta.painel(ctx());
    expect(p.saidaDeTeste).toBe(true);
    expect(p.finalidades.some((f) => f.codigo === `${P}.FIN`)).toBe(true);
    const meus = p.servidores.filter((s) => s.codigo.startsWith(P));
    expect(meus.map((s) => s.codigo).sort()).toEqual([`${P}.S1`, `${P}.S2`]);
    expect(meus.find((s) => s.codigo === `${P}.S1`)).toMatchObject({
      referenciaCofre: 'email/saida/sintetico',
      ultimoTesteSucesso: null,
      padrao: false,
    });
    const modelos = p.modelos.filter((m) => m.codigo.startsWith(P));
    expect(modelos.map((m) => m.todosEstabelecimentos).sort()).toEqual([false, true]);
    expect(modelos.find((m) => !m.todosEstabelecimentos)).toMatchObject({
      finalidade: `${P}.FIN`,
      vigenciaInicio: '2026-12-01',
      campos: [
        { marcador: 'pedido.numero', descricao: 'pedido.numero', exemplo: null },
        { marcador: 'pessoa.nome', descricao: 'Nome da pessoa', exemplo: 'PESSOA SINTETICA' },
      ],
    });
    const envios = p.envios.filter((x) => x.assunto.startsWith(P));
    expect(envios.map((x) => x.assunto).sort()).toEqual([`${P} ENVIO A`, `${P} ENVIO C`]);
    expect(envios.find((x) => x.assunto === `${P} ENVIO A`)).toMatchObject({
      situacao: 'capturado',
      tentativas: 2,
      modelo: `${P}.M1`,
      identificadorMensagem: `<${P}-ENVIO-A@sintetico.invalid>`,
      destinatarios: [{ tipo: 'para', email: 'destino@sintetico.invalid', situacao: 'capturado' }],
    });
    // O outro estabelecimento vê o que é dele e o que vale para todos.
    const p2 = await porta.painel(ctx(`${P}2`));
    expect(p2.servidores.filter((s) => s.codigo.startsWith(P)).map((s) => s.codigo)).toEqual([`${P}.S9`]);
    expect(p2.modelos.filter((m) => m.codigo.startsWith(P)).map((m) => m.todosEstabelecimentos)).toEqual([
      true,
    ]);
  });
});
