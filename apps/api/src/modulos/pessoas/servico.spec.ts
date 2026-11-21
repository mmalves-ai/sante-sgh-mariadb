// M52.1, corretor: o serviço da gestão de pessoas sobre a porta EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco),
// nos achados da revisão: a lista por unidade, setor e CPF (filtro exato pelo HMAC), o fim do dependente (nunca
// apagado), as unidades onde o profissional atende na ficha, a validade conferida de registro sem número, e o
// desligamento: recusado quando o CPF não decifra com a chave atual, recusado ao perfil só de auditoria e ao login de
// painel em uso, com a sessão que não caiu devolvida como pendente, e a chave de idempotência por usuário nunca cortada.
import { afterEach, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { estadoAcessoSintetico, idUsuarioSintetico } from '../acesso/fonte-sintetica.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import {
  type ChaveLiberacao,
  type PrerequisitoRecurso,
  fonteConfiguracaoMemoria,
} from '../config/public-api.js';
import { CifraCpf } from './cifra-cpf.js';
import { cpfSintetico, PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from './porta-memoria.js';
import type { PortaPessoas } from './porta.js';
import { chaveDoBloqueio, ServicoPessoas } from './servico.js';
import { ctxTeste } from './sesmt/contexto-teste.spec-util.js';

type UsuarioPessoa = NonNullable<Awaited<ReturnType<PortaPessoas['usuarioPorId']>>>;

const ligada: ChaveLiberacao = {
  id: 'pessoas.colaborador',
  tipo: 'recurso',
  chave: 'pessoas.colaborador',
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
};
const conferencia: PrerequisitoRecurso = {
  recurso: 'pessoas.colaborador',
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
};
const C = PESSOAS_SINTETICAS_M52;
const IDEM = /^[A-Za-z0-9._:-]{8,80}$/;

function montar(
  porta = new PortaPessoasMemoria(),
  cifra: CifraCpf | null = new CifraCpf(Buffer.alloc(32, 7)),
) {
  porta.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const servico = new ServicoPessoas(
    porta,
    trilha,
    fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => [ligada],
      prerequisitosIniciais: () => [conferencia],
    }),
    null,
    cifra,
  );
  return { porta, trilha, servico };
}
let k = 0;
function sessao(
  hospital: string,
  login = 'SINT.RH',
  perfil: { perfil: string; complementares?: string[] } | null = null,
): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m52-servico-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null, ...(perfil ? { perfil } : {}) } },
    } as never,
    hospital,
    rede: 'rede-sintetica',
    login,
    porta: ctxTeste(hospital, 'rede-sintetica'),
    pode: () => true,
  };
}
const admissao = (extra: Record<string, unknown> = {}) => ({
  cpf: C.comLogin.cpf,
  nome: 'ENFERMEIRA SINTETICA UM',
  tipo: 'clt' as const,
  admissao: '2026-10-01',
  cargo: 'Enfermeira assistencial',
  funcao: null,
  cargaSemanalHoras: 36,
  lotacao: { centroCusto: 9521, unidade: 1, setor: 'Clínica médica' },
  matricula: 'SINT-S-001',
  profissional: C.comLogin.profissional as number | null,
  usuario: idUsuarioSintetico(C.comLogin.login) as number | null,
  ...extra,
});
const desligamento = (vinculo: number) => ({
  vinculo,
  data: '2026-10-25',
  tipoRescisao: 1,
  motivo: 'Pedido de demissão sintético',
});
async function recusa(p: Promise<unknown>): Promise<{ status: number; codigo: unknown }> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  const x = e as ErroProblema;
  return { status: x.getStatus(), codigo: x.extras['codigo'] };
}

afterEach(() => {
  estadoAcessoSintetico().bloqueio.delete(C.comLogin.login);
});

describe('serviço da gestão de pessoas (corretor do M52.1)', () => {
  it('lista por unidade, por setor e pelo CPF digitado (filtro exato pelo HMAC; o CPF nunca volta)', async () => {
    const { servico } = montar();
    const s = () => sessao('t-lista');
    const v1 = (await servico.admitir(s(), admissao())).id;
    const v2 = (
      await servico.admitir(
        s(),
        admissao({
          cpf: C.nova.cpf,
          nome: 'PESSOA NOVA SINTETICA',
          matricula: 'SINT-S-002',
          profissional: null,
          usuario: null,
          lotacao: { centroCusto: 9522, unidade: null, setor: 'Pronto atendimento' },
        }),
      )
    ).id;
    const ids = async (f: Record<string, unknown>) =>
      (await servico.lista(s(), { estado: 'ativo', limite: 50, ...f })).itens.map((x) => x.vinculo);
    expect(await ids({})).toEqual([v1, v2]);
    expect(await ids({ unidade: 1 })).toEqual([v1]);
    expect(await ids({ setor: 'pronto' })).toEqual([v2]);
    const mascarado = `${C.nova.cpf.slice(0, 3)}.${C.nova.cpf.slice(3, 6)}.${C.nova.cpf.slice(6, 9)}-${C.nova.cpf.slice(9)}`;
    expect(await ids({ termo: mascarado })).toEqual([v2]);
    expect(await ids({ termo: C.comLogin.cpf })).toEqual([v1]);
    // Um número que não é CPF válido segue como termo (nome ou matrícula): nada casa.
    expect(await ids({ termo: '12345678900' })).toEqual([]);
    const lista = await servico.lista(s(), { estado: 'ativo', limite: 50, termo: C.nova.cpf });
    expect(JSON.stringify(lista)).not.toContain(C.nova.cpf);
  });

  it('a ficha mostra onde o profissional atende, por registro', async () => {
    const { servico } = montar();
    const v = (await servico.admitir(sessao('t-ficha'), admissao())).id;
    const f = await servico.ficha(sessao('t-ficha'), v);
    expect(f.profissional?.registros[0]?.unidades).toEqual([
      { codigo: 1, nome: 'Unidade sintética', ativo: true },
    ]);
  });

  it('o dependente se encerra com data e motivo (sai da ficha, nunca apagado); repetir dá 404; data futura, 409', async () => {
    const { servico, trilha } = montar();
    const h = 't-dep';
    const v = (await servico.admitir(sessao(h), admissao())).id;
    const d = (
      await servico.incluirDependente(sessao(h), {
        vinculo: v,
        nome: 'FILHO SINTETICO',
        nascimento: '2020-05-10',
        parentesco: '03',
        cpf: cpfSintetico('900520019'),
        dependenteIr: true,
        dependenteSalarioFamilia: false,
      })
    ).id;
    const fim = { vinculo: v, dependente: d, motivo: 'Incluído por engano no cadastro' };
    expect(await recusa(servico.encerrarDependente(sessao(h), { ...fim, ate: '2026-10-26' }))).toMatchObject({
      status: 409,
      codigo: 'fim-futuro',
    });
    expect(await recusa(servico.encerrarDependente(sessao(h), { ...fim, ate: '2019-01-01' }))).toMatchObject({
      codigo: 'fim-antes-do-nascimento',
    });
    const r = await servico.encerrarDependente(sessao(h), { ...fim, ate: '2026-10-25' });
    expect(r).toEqual({ id: d, mensagem: 'Dependente encerrado.' });
    expect((await servico.ficha(sessao(h), v)).dependentes).toEqual([]);
    expect(trilha.eventos.some((l) => l.evento === 'pessoas.dependente.encerrado')).toBe(true);
    expect(await recusa(servico.encerrarDependente(sessao(h), { ...fim, ate: '2026-10-25' }))).toMatchObject({
      status: 404,
    });
    // De outro vínculo: 404 (o dependente é procurado só no vínculo da rota).
    const outro = (
      await servico.admitir(
        sessao(h),
        admissao({
          cpf: C.nova.cpf,
          nome: 'OUTRA PESSOA',
          matricula: 'SINT-S-9',
          profissional: null,
          usuario: null,
        }),
      )
    ).id;
    expect(
      await recusa(servico.encerrarDependente(sessao(h), { ...fim, vinculo: outro, ate: '2026-10-25' })),
    ).toMatchObject({ status: 404 });
  });

  it('a validade conferida vale para o registro sem número (COD 0 normalizado como nas leituras)', async () => {
    class SemNumero extends PortaPessoasMemoria {
      override async profissionais(...a: Parameters<PortaPessoasMemoria['profissionais']>) {
        return (await super.profissionais(...a)).map((p) => ({
          ...p,
          registros: p.registros.map((r) => ({ ...r, numero: null })),
        }));
      }
      override async registroConselho(...a: Parameters<PortaPessoasMemoria['registroConselho']>) {
        const r = await super.registroConselho(...a);
        return r ? { ...r, numero: null } : null;
      }
    }
    const { servico } = montar(new SemNumero());
    const v = (await servico.admitir(sessao('t-cod'), admissao())).id;
    await servico.registrarHabilitacao(sessao('t-cod'), {
      registro: C.comLogin.registro,
      validade: '2027-12-31',
      conferidoEm: '2026-10-25',
      observacao: null,
    });
    const f = await servico.ficha(sessao('t-cod'), v);
    expect(f.profissional?.registros[0]).toMatchObject({ validade: '2027-12-31', situacao: 'valida' });
  });

  it('desligamento com o CPF ilegível pela chave atual (chave trocada) é recusado e nada muda', async () => {
    const porta = new PortaPessoasMemoria();
    const antiga = montar(porta, new CifraCpf(Buffer.alloc(32, 7)));
    // A pessoa sem usuário ligado ao vínculo: antes, só o CPF achava os acessos dela (e era pulado sem decifrar).
    const v = (
      await antiga.servico.admitir(
        sessao('t-chave'),
        admissao({ cpf: C.nova.cpf, nome: 'PESSOA NOVA SINTETICA', profissional: null, usuario: null }),
      )
    ).id;
    const nova = montar(porta, new CifraCpf(Buffer.alloc(32, 8)));
    expect(
      await recusa(nova.servico.desligar(sessao('t-chave'), desligamento(v), Date.now(), null)),
    ).toMatchObject({ status: 409, codigo: 'cpf-ilegivel' });
    expect((await porta.vinculo(ctxTeste('t-chave', ''), v))?.desligamento).toBeNull();
    expect(estadoAcessoSintetico().bloqueio.get(C.comLogin.login) ?? false).toBe(false);
    // Sem chave nenhuma: o desligamento fica desligado como a admissão (403), sem gravar.
    const sem = montar(porta, null);
    expect(
      await recusa(sem.servico.desligar(sessao('t-chave'), desligamento(v), Date.now(), null)),
    ).toMatchObject({
      status: 403,
      codigo: 'chave-cpf-ausente',
    });
  });

  it('o perfil só de auditoria não desliga (a mesma segregação da tela de usuários)', async () => {
    const { servico } = montar();
    const v = (await servico.admitir(sessao('t-aud'), admissao())).id;
    expect(
      await recusa(
        servico.desligar(
          sessao('t-aud', 'SINT.AUDITOR', { perfil: 'auditor' }),
          desligamento(v),
          Date.now(),
          null,
        ),
      ),
    ).toMatchObject({ status: 409, codigo: 'auditor-nao-altera' });
    expect(estadoAcessoSintetico().bloqueio.get(C.comLogin.login) ?? false).toBe(false);
  });

  it('o login de painel (TV ou totem) passa pela conferência do aparelho antes de qualquer bloqueio', async () => {
    class Painel extends PortaPessoasMemoria {
      override async pessoaPorCpf(...a: Parameters<PortaPessoasMemoria['pessoaPorCpf']>) {
        const r = await super.pessoaPorCpf(...a);
        return { ...r, usuarios: r.usuarios.map((u): UsuarioPessoa => ({ ...u, grupo: 'PAINEIS' })) };
      }
      override async usuarioPorId(...a: Parameters<PortaPessoasMemoria['usuarioPorId']>) {
        const u = await super.usuarioPorId(...a);
        return u ? { ...u, grupo: 'PAINEIS' } : null;
      }
    }
    const { servico, porta } = montar(new Painel());
    const v = (await servico.admitir(sessao('t-painel'), admissao())).id;
    // Sem a conferência ligada: falha fechada (503).
    expect(
      await recusa(servico.desligar(sessao('t-painel'), desligamento(v), Date.now(), null)),
    ).toMatchObject({ status: 503 });
    const conferidos: string[] = [];
    const emUso = async (_s: SessaoCadastro, login: string) => {
      conferidos.push(login);
      throw new ErroProblema('recusa-de-negocio', 409, 'Bloqueio recusado', 'O totem ainda usa este login.', {
        codigo: 'login-de-painel-em-uso',
      });
    };
    expect(
      await recusa(servico.desligar(sessao('t-painel'), desligamento(v), Date.now(), null, emUso)),
    ).toMatchObject({ status: 409, codigo: 'login-de-painel-em-uso' });
    expect(conferidos).toEqual([C.comLogin.login]);
    expect(estadoAcessoSintetico().bloqueio.get(C.comLogin.login) ?? false).toBe(false);
    expect((await porta.vinculo(ctxTeste('t-painel', ''), v))?.desligamento).toBeNull();
    // Conferido (o aparelho já passou ao novo): o desligamento segue.
    const r = await servico.desligar(
      sessao('t-painel'),
      desligamento(v),
      Date.now(),
      null,
      async () => undefined,
    );
    expect(r.usuarios).toEqual([expect.objectContaining({ login: C.comLogin.login, acao: 'bloqueado' })]);
  });

  it('a sessão que não cai (armazém fora) volta como pendente, com a pendência na trilha; o desligamento fica', async () => {
    const { servico, trilha, porta } = montar();
    const v = (await servico.admitir(sessao('t-sessao'), admissao())).id;
    const r = await servico.desligar(sessao('t-sessao'), desligamento(v), Date.now(), async () => {
      throw new Error('armazém das sessões fora do ar');
    });
    expect(r.usuarios).toEqual([expect.objectContaining({ login: C.comLogin.login, acao: 'bloqueado' })]);
    expect(r.sessoesEncerradas).toBe(0);
    expect(r.sessoesPendentes).toEqual([C.comLogin.login]);
    expect((await porta.vinculo(ctxTeste('t-sessao', ''), v))?.desligamento).toBe('2026-10-25');
    expect(
      trilha.eventos.some(
        (l) =>
          l.evento === 'pessoas.colaborador.desligado' &&
          l.resultado === 'falha' &&
          String(l.recurso).includes(C.comLogin.login),
      ),
    ).toBe(true);
  });

  it('a chave de idempotência por usuário cabe em 80 caracteres e nunca se repete entre usuários', () => {
    const base = 'x'.repeat(80);
    const a = chaveDoBloqueio(base, 101);
    const b = chaveDoBloqueio(base, 102);
    expect(a).not.toBe(b);
    for (const x of [a, b, chaveDoBloqueio('m52-curta', 7)]) expect(x).toMatch(IDEM);
    expect(chaveDoBloqueio(base, 101)).toBe(a);
    expect(chaveDoBloqueio(`${'x'.repeat(79)}y`, 101)).not.toBe(a);
  });
});
