// Regra 7 do M27 sobre a cópia (transação desfeita): a mensagem não carrega dado do paciente no texto (recusada antes do
// banco), o paciente entra como o atendimento de contexto, o conteúdo fica na SGH_ADM_MENSAGEM e NÃO vai à SGH_TRILHA
// (só o evento, o remetente e a contagem); a expansão do grupo dá os usuários ativos dele; a leitura e a ciência do
// destinatário; as mensagens do sistema anterior e o dicionário pelo executor. Só contagens na saída.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { portaComunicacaoNaTransacao } from '../comunicacao-porta.js';
import { ServicoComunicacao } from './comunicacao.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER, usuariosAtivos } from './copia.spec-util.js';

const TEXTO = 'Texto sintetico da integracao M27 que nao pode ir para a trilha';

describe.skipIf(!PODE_ESCREVER)('mensagem interna na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('o texto fica na mensagem e não vai à trilha; o atendimento de contexto vai como identificador', async () => {
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m27-mensagem' }, async (e) => {
      const u = await usuariosAtivos(e);
      const porta = portaComunicacaoNaTransacao(e, a.executor);
      const s = new ServicoComunicacao(porta, null);
      const autor = { login: u.a, estacao: 'INT-M27', correlacao: 'int-m27-mensagem-1' };
      const [at] = await e.consultar('SELECT FIRST 1 ID FROM ATCABECATEND ORDER BY ID DESC', [], { teto: 1 });
      const atendimento = Number(at?.['ID']);
      // O texto com CPF é recusado antes do banco.
      await expect(
        s.enviar(
          a.c,
          autor,
          {
            assunto: 'Paciente',
            texto: 'CPF 123.456.789-09',
            destinos: [{ tipo: 'usuario', valor: u.b }],
            cienciaObrigatoria: false,
            contextoAtendimento: null,
          },
          'int-m27-cpf-0001',
        ),
      ).rejects.toMatchObject({ extras: { codigo: 'dado-do-paciente' } });
      const r = await s.enviar(
        a.c,
        autor,
        {
          assunto: 'Integracao M27',
          texto: TEXTO,
          destinos: [{ tipo: 'usuario', valor: u.b }],
          cienciaObrigatoria: true,
          contextoAtendimento: atendimento,
        },
        'int-m27-msg-0001',
        { podeLerProntuario: true },
      );
      // Revisão do M27: sem acesso ao prontuário, o contexto é recusado; o atendimento inexistente também.
      const comContexto = (n: number) => ({
        assunto: 'Contexto',
        texto: 'Mensagem com contexto.',
        destinos: [{ tipo: 'usuario' as const, valor: u.b }],
        cienciaObrigatoria: false,
        contextoAtendimento: n,
      });
      await expect(
        s.enviar(a.c, autor, comContexto(atendimento), 'int-m27-ctx-0001', { podeLerProntuario: false }),
      ).rejects.toMatchObject({ extras: { codigo: 'contexto-sem-acesso' } });
      await expect(
        s.enviar(a.c, autor, comContexto(atendimento + 1_000_000_000), 'int-m27-ctx-0002', {
          podeLerProntuario: true,
        }),
      ).rejects.toMatchObject({ extras: { codigo: 'contexto-invalido' } });
      expect(r.destinatarios).toBe(1);
      const [m] = await e.consultar(
        'SELECT TEXTO, ID_ATCABECATEND FROM SGH_ADM_MENSAGEM WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
        [String(r.id)],
        { teto: 1 },
      );
      expect(String(m?.['TEXTO'])).toBe(TEXTO);
      expect(Number(m?.['ID_ATCABECATEND'])).toBe(atendimento);
      const trilha = await e.consultar(
        "SELECT * FROM SGH_TRILHA WHERE HOSPITAL = ? AND CORRELACAO STARTING WITH 'int-m27-mensagem'",
        [a.cod],
        { teto: 20 },
      );
      expect(trilha.length).toBeGreaterThan(0);
      expect(JSON.stringify(trilha)).not.toContain('Texto sintetico');
      const envio = trilha.find((t) => String(t['EVENTO']).trim() === 'acesso.mensagem.enviada');
      expect(Number(envio?.['REG'])).toBe(atendimento);
      expect(String(envio?.['CHAVE_NATURAL_ALVO']).trim()).toBe('destinatarios:1;ciencia:T');
      // O destinatário: caixa, aviso, leitura e ciência.
      const dest = { login: u.b, estacao: 'INT-M27', correlacao: 'int-m27-mensagem-2' };
      const caixa = await s.caixa(a.c, u.b);
      expect(caixa.recebidas.some((x) => x.id === r.id && x.contextoAtendimento === atendimento)).toBe(true);
      expect((await s.avisos(a.c, u.b, 0)).avisos.some((x) => x.link === `/mensagens?id=${r.id}`)).toBe(true);
      expect((await s.abrir(a.c, dest, r.id)).lidaEm).not.toBeNull();
      expect((await s.ciencia(a.c, dest, r.id)).cienciaEm).not.toBeNull();
      const aviso = (await s.avisos(a.c, u.b, 0)).avisos.find((x) => x.link === `/mensagens?id=${r.id}`);
      expect(aviso?.estado).toBe('resolvido');
      // O grupo: um destinatário por usuário ativo dele.
      const g = await s.enviar(
        a.c,
        autor,
        {
          assunto: 'Grupo',
          texto: 'Mensagem ao grupo.',
          destinos: [{ tipo: 'grupo', valor: u.grupo }],
          cienciaObrigatoria: false,
          contextoAtendimento: null,
        },
        'int-m27-grupo-0001',
      );
      expect(g.destinatarios).toBe(u.doGrupo);
      console.log(
        `[int-m27] grupo expandido: ${u.doGrupo < 5 ? '<5' : u.doGrupo} destinatário(s); trilha: ${trilha.length} linha(s)`,
      );
    });
  });

  it('mensagens do sistema anterior: só as do login, até 100; dicionário pelo executor', async () => {
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m27-anteriores' }, async (e) => {
      const porta = portaComunicacaoNaTransacao(e, a.executor);
      const s = new ServicoComunicacao(porta, null);
      const [x] = await e.consultar(
        'SELECT FIRST 1 USUARIO, COUNT(*) N FROM TBMENSAG GROUP BY USUARIO ORDER BY 2 DESC',
        [],
        { teto: 1 },
      );
      const login = String(x?.['USUARIO'] ?? '').trim();
      const inicio = performance.now();
      const ant = await s.anteriores(a.c, login);
      const ms = performance.now() - inicio;
      expect(ant.length).toBe(Math.min(100, Number(x?.['N'])));
      const u = await usuariosAtivos(e);
      const ctx = {
        rede: a.c.rede,
        hospital: a.cod,
        traceId: 'int-m27-dic',
        usuarioLegado: u.a,
        idempotencyKey: `int-m27-dic-${Date.now().toString(36)}`,
        reautenticadoEm: Date.now(),
      };
      const antes = (await s.dicionario(a.c, u.a)).palavras.length;
      await s.gravarPalavra(a.c, 'incluir', 'sghintegracaoxyz', ctx);
      expect((await s.dicionario(a.c, u.a)).palavras.length).toBe(antes + 1);
      await s.gravarPalavra(a.c, 'excluir', 'sghintegracaoxyz', {
        ...ctx,
        idempotencyKey: `${ctx.idempotencyKey}-x`,
      });
      expect((await s.dicionario(a.c, u.a)).palavras.length).toBe(antes);
      console.log(
        `[int-m27] mensagens anteriores do login mais frequente: ${ant.length} em ${Math.round(ms)} ms`,
      );
    });
  });
});
