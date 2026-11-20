// Revisão de segurança do suporte técnico (ADR 0021), sem HTTP e sem banco: o código TOTP vale uma vez, as
// tentativas contam por e-mail e origem, a plataforma revoga outra conta da plataforma (nunca a si mesma), o
// aviso ao Auditor gravado pela outbox chega ao worker no formato que ele confere, e o Corrigir não grava em
// dev sobre a cópia. Contas, segredos e senhas são sintéticos, gerados no próprio teste.
import { randomBytes } from 'node:crypto';
import { conferirAlertaSuporte } from '@sgh/contratos';
import { cifrarSenha, codigoTotp } from '@sgh/dominio-acesso';
import { conferirCarga, dadosDoJobOutbox, type PendenteOutbox } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import {
  FonteComoLegado,
  type NucleoSuporte,
  RepositorioPlataformaLegado,
  RepositorioPlataformaMemoria,
} from './repositorio.js';
import { ServicoComo } from './servico-como.js';
import { type ContaComAtribuicoes, ErroPlataforma, ServicoPlataforma } from './servico-plataforma.js';

const SENHA = 'Senha#Sintetica#Teste#1';
const cifraBarata = (s: string) => cifrarSenha(s, { memoria: 8_192, passes: 1, paralelismo: 1 });
const ev = { ator: null, evento: 'teste', detalhe: null, estacao: null };

async function montar(ambiente = 'homolog') {
  let agora = 1_792_000_000_000;
  const relogio = { agora: () => agora, avancar: (ms: number) => (agora += ms) };
  const repo = new RepositorioPlataformaMemoria(relogio.agora);
  const armazem = new ArmazemMemoria(relogio.agora);
  const servico = new ServicoPlataforma(repo, armazem, {
    ambiente,
    produto: 'Produto sintético',
    chaveMestra: randomBytes(32),
    agora: relogio.agora,
  });
  const cifra = await cifraBarata(SENHA);
  const base = { nome: null, cifra, conviteHash: null, conviteAte: null, criadoPor: null };
  const dono = await repo.criarConta({ ...base, email: 'dono@sintetico.invalid', papel: 'PLATAFORMA' }, ev);
  const outra = await repo.criarConta({ ...base, email: 'outra@sintetico.invalid', papel: 'PLATAFORMA' }, ev);
  return { repo, servico, relogio, dono, outra };
}

const erroDe = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof ErroPlataforma ? e.tipo : e),
  );

describe('segundo fator: o mesmo código não vale duas vezes (RFC 6238 §5.2)', () => {
  it('cadastro e login: o código já aceito é recusado; o do passo seguinte entra', async () => {
    const { servico, relogio } = await montar();
    const pedido = { email: 'dono@sintetico.invalid', senha: SENHA };
    const cad = await servico.entrar(pedido, 'rede-teste', null, 'T:1', '10.0.0.1');
    expect(cad).toMatchObject({ tipo: 'segundo-fator', segundoFator: 'cadastrar' });
    const segredo = new URL((cad as { otpauth: string }).otpauth).searchParams.get(['sec', 'ret'].join(''))!;
    const codigo = codigoTotp(segredo, relogio.agora());
    expect((await servico.entrar({ ...pedido, codigo }, 'rede-teste', null, 'T:1', '10.0.0.1')).tipo).toBe(
      'sessao',
    );
    // Reuso logo depois (phishing em tempo real): recusado, ainda dentro da janela de ±1 passo.
    relogio.avancar(5_000);
    expect(await erroDe(servico.entrar({ ...pedido, codigo }, 'rede-teste', null, 'T:2', '10.0.0.2'))).toBe(
      'credencial-invalida',
    );
    relogio.avancar(30_000);
    expect(await erroDe(servico.entrar({ ...pedido, codigo }, 'rede-teste', null, 'T:2', '10.0.0.2'))).toBe(
      'credencial-invalida',
    );
    const seguinte = codigoTotp(segredo, relogio.agora());
    expect(
      (await servico.entrar({ ...pedido, codigo: seguinte }, 'rede-teste', null, 'T:1', '10.0.0.1')).tipo,
    ).toBe('sessao');
  });
});

describe('tentativas por e-mail e origem', () => {
  it('erros de outro endereço não fecham a porta do dono; o mesmo endereço fecha', async () => {
    const { servico } = await montar('dev');
    const errado = { email: 'Dono@Sintetico.invalid', senha: 'errada-errada-errada' };
    for (let i = 0; i < 5; i++)
      expect(await erroDe(servico.entrar(errado, 'rede-teste', null, 'T:x', '203.0.113.9'))).toBe(
        'credencial-invalida',
      );
    expect(await erroDe(servico.entrar(errado, 'rede-teste', null, 'T:x', '203.0.113.9'))).toBe(
      'muitas-tentativas',
    );
    // A caixa do e-mail não abre outro contador.
    expect(
      await erroDe(
        servico.entrar(
          { ...errado, email: 'dono@sintetico.invalid' },
          'rede-teste',
          null,
          'T:x',
          '203.0.113.9',
        ),
      ),
    ).toBe('muitas-tentativas');
    const r = await servico.entrar(
      { email: 'dono@sintetico.invalid', senha: SENHA },
      'rede-teste',
      null,
      'T:1',
      '10.0.0.1',
    );
    expect(r.tipo).toBe('sessao');
  });

  it('um endereço que varre muitas contas também é contido', async () => {
    const { servico } = await montar('dev');
    let ultimo: unknown = null;
    for (let i = 0; i < 31; i++)
      ultimo = await erroDe(
        servico.entrar(
          { email: `x${i}@sintetico.invalid`, senha: 'errada-errada-errada' },
          'rede-teste',
          null,
          'T',
          '198.51.100.7',
        ),
      );
    expect(ultimo).toBe('muitas-tentativas');
  }, 30_000); // conta inexistente gasta o tempo de uma conferência Argon2id (de propósito)
});

describe('credencial redefinida e contas da plataforma', () => {
  it('a sessão da plataforma cai quando a credencial muda; outra plataforma redefine e desativa, a própria não', async () => {
    const { servico, repo, dono, outra } = await montar('dev');
    const entrar = async (email: string) => {
      const r = await servico.entrar({ email, senha: SENHA }, 'rede-teste', null, 'T', '10.0.0.1');
      if (r.tipo !== 'sessao') throw new Error('sem sessão');
      return r.id;
    };
    const sDono = await entrar('dono@sintetico.invalid');
    const sOutra = await entrar('outra@sintetico.invalid');
    const ator = (await servico.ler(sDono, 'rede-teste'))!.conta;
    expect(await servico.ler(sOutra, 'rede-teste')).not.toBeNull();
    await servico.novoConvite(ator, outra, 'T');
    expect(await servico.ler(sOutra, 'rede-teste')).toBeNull();
    expect(await erroDe(servico.definirFuncao(ator, dono, false, 'T'))).toBe('conflito');
    expect(await erroDe(servico.novoConvite(ator, dono, 'T'))).toBe('conflito');
    await servico.definirFuncao(ator, outra, false, 'T');
    expect((await repo.contaPorId(outra))?.ativo).toBe(false);
    // A sessão do dono continua (a marca dele não mudou).
    expect(await servico.ler(sDono, 'rede-teste')).not.toBeNull();
  });
});

describe('aviso ao Auditor pela outbox chega ao worker no formato conferido', () => {
  /** Núcleo falso: a SGH_SUP_SESSAO "grava" e a outbox passa pela MESMA conferência da carga do núcleo. */
  function nucleoFalso(outbox: PendenteOutbox[], corrigidos: string[]) {
    const escritor = {
      hospital: 'plat',
      consultar: () =>
        Promise.resolve([
          { ID: '4242', I: new Date('2026-10-20T10:00:00Z'), F: new Date('2026-10-20T11:00:00Z') },
        ]),
      executar: () => Promise.resolve(1),
      executarRetornando: () => Promise.resolve({}),
      lerBlob: () => Promise.resolve(Buffer.alloc(0)),
    };
    const n = {
      rede: 'rede-teste',
      gravarSgh: (_c: unknown, fn: (e: unknown) => Promise<unknown>) => fn(escritor),
      gravarSghComOutbox: (
        ctx: { rede: string; hospital: string },
        fn: (
          e: unknown,
          o: (ev: { tipo: string; chave: string; carga: Record<string, string> }) => Promise<string>,
        ) => Promise<unknown>,
      ) =>
        fn(escritor, (ev) => {
          const carga = JSON.parse(conferirCarga(ev.carga)) as Record<string, string>;
          outbox.push({
            id: '1',
            rede: ctx.rede,
            hospital: ctx.hospital,
            tipo: ev.tipo,
            chave: ev.chave,
            carga,
            tentativas: 0,
          });
          return Promise.resolve('1');
        }),
      lerSomente: () => Promise.resolve([]),
      corrigirComo: () => {
        corrigidos.push('chamou');
        return Promise.resolve(
          corrigidos.includes('com-feitas') ? [{ imagem: '1', correcao: '2', compensacao: 'UPDATE' }] : [],
        );
      },
    };
    return n as unknown as NucleoSuporte;
  }

  const conta: ContaComAtribuicoes = {
    id: '7',
    email: 'dono@sintetico.invalid',
    nome: null,
    papel: 'PLATAFORMA',
    ativo: true,
    cifra: null,
    totpEnv: null,
    totpAtivo: false,
    conviteHash: null,
    conviteAte: null,
    criadoEm: new Date(0),
    atribuicoes: [],
  };

  function como(nucleo: NucleoSuporte, corrigirLiberado = true, invalidados: string[] = []) {
    const s = new ServicoComo(
      new RepositorioPlataformaLegado(nucleo, 'plat'),
      new FonteComoLegado(nucleo, corrigirLiberado),
      new ArmazemMemoria(),
      {
        rede: 'rede-teste',
        estabelecimentos: () => [{ codigo: 'aa', nome: 'Sintético', disponivel: true }],
        minutos: 60,
        avisoAuditor: true,
      },
    );
    const sessao = {
      conferirAlvoComo: () => Promise.resolve({ id: 900123 }),
      abrirComo: () =>
        Promise.resolve({ sessao: { usuario: { id: '900123' } }, idSessao: 'x', csrf: 'y', ttlSegundos: 60 }),
      sair: () => Promise.resolve(),
      servicoAutorizacao: {
        invalidarEstabelecimento: (rede: string, hospital: string) => {
          invalidados.push(`${rede}:${hospital}`);
          return Promise.resolve();
        },
      },
    };
    s.ligarSessao(sessao as unknown as ServicoSessao);
    return s;
  }

  it('carga gravada pelo repositório do banco → relay → conferência do worker: estabelecimento do alvo', async () => {
    const outbox: PendenteOutbox[] = [];
    await como(nucleoFalso(outbox, [])).entrar(
      conta,
      { estabelecimento: 'aa', login: 'SINT.ALVO', motivo: 'CHAMADO-1' },
      'rede-teste',
      null,
      'T',
    );
    expect(outbox).toHaveLength(1);
    const job = conferirAlertaSuporte(dadosDoJobOutbox(outbox[0]!));
    expect(job).toEqual({
      rede: 'rede-teste',
      hospital: 'plat',
      estabelecimento: 'aa',
      idSessao: '4242',
      atorTipo: 'plataforma',
      idUsuario: '900123',
      // O banco devolve a hora civil de São Paulo (10:00 e 11:00): o instante real é 3 h depois (instanteDoBanco).
      inicio: '2026-10-20T13:00:00.000Z',
      fim: '2026-10-20T14:00:00.000Z',
      motivo: 'CHAMADO-1',
    });
    // Sem os campos (a carga antiga), o worker recusa.
    expect(() =>
      conferirAlertaSuporte({ rede: 'r', hospital: 'h', idSessao: '1', atorTipo: 'x', motivo: 'm' }),
    ).toThrow();
  });

  it('dev sobre a cópia: o Corrigir é recusado (409) e o núcleo não é chamado', async () => {
    const chamadas: string[] = [];
    const s = como(nucleoFalso([], chamadas), false);
    const pedido = { estabelecimento: 'aa', sessao: '4242', previa: false, resumo: 'a'.repeat(64) };
    // A sessão existe no banco da plataforma (lida pelo repositório).
    (s.repo as RepositorioPlataformaLegado).sessaoComo = () =>
      Promise.resolve({
        id: '4242',
        idConta: '7',
        atorTipo: 'plataforma',
        rede: 'rede-teste',
        hospital: 'aa',
        alvoLogin: 'SINT.ALVO',
        motivo: null,
        modo: 'como',
        inicio: new Date(0),
        expiraEm: new Date(1),
        fim: new Date(1),
        encerramento: 'voltou',
        escritas: 1,
        atosClinicos: 0,
      });
    expect(await erroDe(s.corrigir(conta, pedido, 'T', 'c'))).toBe('conflito');
    expect(chamadas).toEqual([]);
  });

  it('Corrigir com passo desfeito troca a geração das permissões do estabelecimento (decisão 12 do ADR 0022)', async () => {
    const chamadas = ['com-feitas'];
    const invalidados: string[] = [];
    const s = como(nucleoFalso([], chamadas), true, invalidados);
    (s.repo as RepositorioPlataformaLegado).sessaoComo = () =>
      Promise.resolve({
        id: '4242',
        idConta: '7',
        atorTipo: 'plataforma',
        rede: 'rede-teste',
        hospital: 'aa',
        alvoLogin: 'SINT.ALVO',
        motivo: null,
        modo: 'acesso-total',
        inicio: new Date(0),
        expiraEm: new Date(1),
        fim: new Date(1),
        encerramento: 'voltou',
        escritas: 1,
        atosClinicos: 0,
      });
    (s.repo as RepositorioPlataformaLegado).acoes = () => Promise.resolve([]);
    (s.repo as RepositorioPlataformaLegado).registrarEventoConta = () => Promise.resolve();
    const pedido = { estabelecimento: 'aa', sessao: '4242', previa: false, resumo: 'a'.repeat(64) };
    const r = await s.corrigir(conta, pedido, 'T', 'c');
    expect(r).toMatchObject({ corrigidos: 1, permissoes: 'recalculadas' });
    expect(invalidados).toEqual(['rede-teste:aa']);
    // Nada desfeito: nada a recalcular.
    chamadas.length = 0;
    const nada = await s.corrigir(conta, pedido, 'T', 'c');
    expect(nada.permissoes).toBeUndefined();
    expect(invalidados).toHaveLength(1);
  });
});
