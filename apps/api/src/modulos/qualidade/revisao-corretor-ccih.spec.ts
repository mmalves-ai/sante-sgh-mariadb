// Revisão do W0-04 (corretor, 18/11/2026), CCIH e aba de dispositivos pela HTTP, sobre a porta EM MEMÓRIA (dados
// SINTÉTICOS):
//   - a correção do dispositivo que desfaria a associação com a ficha de IRAS confirmada é recusada (tipo trocado,
//     inserção depois da data da infecção); a correção da data da ficha refaz a associação na mesma versão;
//   - a correção pelo autor: quem não é autor e não tem a permissão recebe 403; a CCIH corrige o de outro só com a
//     senha; vale para o dispositivo, a precaução, a sessão de higiene das mãos e o checklist do bundle;
//   - o checklist do bundle se corrige por versão (a indicação revisada tira o alerta) e se estorna com motivo e senha
//     (fica visível, sai do alerta, o turno se registra de novo);
//   - a aba corrige e cancela o próprio dispositivo, com o responsável pela inserção;
//   - a gravação pela aba confere o vínculo com o paciente (restrição do M23).
import { criarAppQualidade, ctxTeste, TRILHA_TESTE } from './teste.spec-util.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { EstadoProntuario } from '../pep/sessao-prontuario.js';
import { CcihController } from './ccih.controller.js';
import { INTERNACAO_SINTETICA_CCIH, PortaCcihMemoria } from './porta-ccih-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-11-03 12:00 em São Paulo (turno da manhã). */
const agora = () => new Date('2026-11-03T15:00:00Z');

interface Sessao {
  cookie: string;
  csrf: string;
}
let app: NestFastifyApplication;
let porta: PortaCcihMemoria;
let ccih: Sessao;
let enf: Sessao;
let enf2: Sessao;

async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode, r.body).toBe(201);
  const set = r.headers['set-cookie'] as string[];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf },
    payload: payload as object,
  });
const codigo = (r: { json(): unknown }) => (r.json() as { codigo?: string }).codigo;
const C = '/qualidade/ccih';

beforeAll(async () => {
  porta = new PortaCcihMemoria({ agora });
  app = await criarAppQualidade(env, {
    trilha: new RegistradorTrilhaMemoria(),
    ccih: porta,
    vigiaEnfermagem: null,
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  ccih = await entrar('SINT.CCIH');
  enf = await entrar('SINT.ENF.PLANTAO');
  enf2 = await entrar('SINT.ENF.UTI');
});
afterAll(async () => {
  await app.close();
});

describe('revisão do W0-04: a associação da ficha de IRAS confirmada', () => {
  let cvc = 0;
  let ficha = 0;
  it('a correção do dispositivo que desfaria a associação é recusada (tipo e inserção), com a lista das fichas', async () => {
    const d = await post(ccih, `${C}/dispositivos`, {
      internacao: INTERNACAO_SINTETICA_CCIH,
      tipo: 'cvc',
      sitio: 'Subclávia direita',
      inseridoEm: '2026-10-29T10:00',
      itemPrescricao: null,
      observacao: null,
    });
    expect(d.statusCode, d.body).toBe(201);
    cvc = (d.json() as { id: number }).id;
    const f = await post(ccih, `${C}/iras`, {
      internacao: INTERNACAO_SINTETICA_CCIH,
      sitio: 'ipcs',
      dataInfeccao: '2026-11-01',
      criterios: ['hemoculturaPatogeno', 'febre'],
      nivelIsc: null,
      cirurgia: null,
      implante: false,
      exame: null,
      microrganismo: 'Klebsiella pneumoniae',
      multirresistente: false,
      descricao: null,
    });
    expect(f.statusCode, f.body).toBe(201);
    expect((f.json() as { dispositivoAssociado: number }).dispositivoAssociado).toBe(cvc);
    ficha = (f.json() as { id: number }).id;
    const base = {
      versao: 1,
      tipo: 'cvc',
      sitio: 'Subclávia direita',
      inseridoEm: '2026-10-29T10:00',
      retiradoEm: null,
      justificativa: 'Tipo lançado errado na admissão',
    };
    const tipo = await post(ccih, `${C}/dispositivos/${String(cvc)}/correcao`, {
      ...base,
      tipo: 'sondaVesical',
    });
    expect([tipo.statusCode, codigo(tipo)]).toEqual([409, 'associacao-desfeita']);
    expect((tipo.json() as { avisos: string[] }).avisos).toEqual([
      `Fichas de IRAS confirmadas (1): nº ${String(ficha)}.`,
    ]);
    const depois = await post(ccih, `${C}/dispositivos/${String(cvc)}/correcao`, {
      ...base,
      inseridoEm: '2026-11-01T08:00',
    });
    expect([depois.statusCode, codigo(depois)]).toEqual([409, 'associacao-desfeita']);
    // A correção que mantém a associação passa.
    const ok = await post(ccih, `${C}/dispositivos/${String(cvc)}/correcao`, {
      ...base,
      inseridoEm: '2026-10-29T09:00',
    });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('a correção da data da ficha refaz a associação na mesma versão (o retrato guarda a anterior)', async () => {
    // Com a infecção em 30/10, o CVC de 29/10 não tem 2 dias: a ficha deixa de ser associada a ele.
    const r = await post(ccih, `${C}/iras/${String(ficha)}/correcao`, {
      versao: 1,
      dataInfeccao: '2026-10-30',
      criterios: ['hemoculturaPatogeno', 'febre'],
      microrganismo: 'Klebsiella pneumoniae',
      multirresistente: false,
      descricao: null,
      justificativa: 'Data da hemocultura lançada errada',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect((r.json() as { dispositivoAssociado: number | null }).dispositivoAssociado).toBeNull();
    expect((await porta.iras(ctxTeste('aa'), ficha))?.dispositivo).toBeNull();
    const vs = (await get(ccih, `${C}/versoes/iras/${String(ficha)}`)).json() as {
      itens: { dados: { dispositivo: number | null } }[];
    };
    expect(vs.itens[0]?.dados.dispositivo).toBe(cvc);
    // Sem a ficha associada, o CVC pode trocar de tipo.
    const livre = await post(ccih, `${C}/dispositivos/${String(cvc)}/correcao`, {
      versao: 2,
      tipo: 'cateterArterial',
      sitio: 'Radial',
      inseridoEm: '2026-10-29T09:00',
      retiradoEm: null,
      justificativa: 'Era um cateter arterial',
    });
    expect([livre.statusCode, codigo(livre)]).not.toEqual([409, 'associacao-desfeita']);
  });
});

describe('revisão do W0-04: correção pelo autor e o checklist do bundle', () => {
  let sonda = 0;
  let bundle = 0;
  const aba = () => get(enf, `${C}/enfermagem/paciente/48002/dispositivos`);
  type Aba = {
    login: string;
    itens: {
      id: number;
      alerta: unknown;
      bundleDoTurno: boolean;
      responsavel: { registro: number; nome: string } | null;
      bundles: { id: number; versao: number; estornadoEm: string | null; indicacaoRevisada: boolean }[];
    }[];
  };
  it('a enfermagem registra com o responsável pela inserção; corrige o próprio pela aba', async () => {
    const busca = (await get(enf, `${C}/enfermagem/profissionais?q=intensiv`)).json() as {
      itens: { id: number; nome: string }[];
    };
    expect(busca.itens.map((p) => p.nome)).toEqual(['SINT MEDICO INTENSIVISTA']);
    const inexistente = await post(enf, `${C}/enfermagem/dispositivos`, {
      internacao: 4802,
      tipo: 'sondaVesical',
      sitio: null,
      inseridoEm: '2026-11-01T08:00',
      itemPrescricao: null,
      observacao: null,
      responsavel: 1,
    });
    expect([inexistente.statusCode, codigo(inexistente)]).toEqual([422, 'responsavel-inexistente']);
    const r = await post(enf, `${C}/enfermagem/dispositivos`, {
      internacao: 4802,
      tipo: 'sondaVesical',
      sitio: null,
      inseridoEm: '2026-11-01T08:00',
      itemPrescricao: null,
      observacao: null,
      responsavel: busca.itens[0]!.id,
    });
    expect(r.statusCode, r.body).toBe(201);
    sonda = (r.json() as { id: number }).id;
    const lida = ((await aba()).json() as Aba).itens.find((x) => x.id === sonda)!;
    expect(lida.responsavel).toEqual({ registro: 9103, nome: 'SINT MEDICO INTENSIVISTA' });
    // O autor corrige o próprio (sem senha), trocando só o responsável.
    const c = await post(enf, `${C}/enfermagem/dispositivos/${String(sonda)}/correcao`, {
      versao: 1,
      tipo: 'sondaVesical',
      sitio: null,
      inseridoEm: '2026-11-01T08:00',
      retiradoEm: null,
      responsavel: 9101,
      justificativa: 'Quem passou a sonda foi o plantonista',
    });
    expect(c.statusCode, c.body).toBe(201);
  });

  it('quem não é autor e não tem a permissão recebe 403; a CCIH corrige o de outro só com a senha', async () => {
    const corpo = {
      versao: 2,
      tipo: 'sondaVesical',
      sitio: 'Uretral',
      inseridoEm: '2026-11-01T08:00',
      retiradoEm: null,
      justificativa: 'Sítio esquecido no registro da sonda',
    };
    const outra = await post(enf2, `${C}/enfermagem/dispositivos/${String(sonda)}/correcao`, corpo);
    expect([outra.statusCode, codigo(outra)]).toEqual([403, 'nao-e-autor']);
    const semSenha = await post(ccih, `${C}/dispositivos/${String(sonda)}/correcao`, corpo);
    expect(semSenha.statusCode).toBe(401);
    const comSenha = await post(ccih, `${C}/dispositivos/${String(sonda)}/correcao`, {
      ...corpo,
      senha: SENHA,
    });
    expect(comSenha.statusCode, comSenha.body).toBe(201);
  });

  it('o checklist do bundle se corrige por versão (a indicação tira o alerta) e se estorna; o turno se refaz', async () => {
    const itens = {
      indicacao: false,
      sistemaFechado: true,
      bolsaAbaixo: true,
      higieneMeato: true,
      fixacao: true,
    };
    const b = await post(enf, `${C}/enfermagem/dispositivos/${String(sonda)}/bundle`, {
      data: '2026-11-03',
      turno: 'manha',
      itens,
      observacao: null,
    });
    expect(b.statusCode, b.body).toBe(201);
    bundle = (b.json() as { id: number }).id;
    let s = ((await aba()).json() as Aba).itens.find((x) => x.id === sonda)!;
    expect(s.alerta).not.toBeNull();
    // A outra enfermeira não corrige o checklist que não é dela.
    const outra = await post(enf2, `${C}/enfermagem/bundles/${String(bundle)}/correcao`, {
      versao: 1,
      itens: { ...itens, indicacao: true },
      observacao: null,
      justificativa: 'Indicação revisada esquecida',
    });
    expect([outra.statusCode, codigo(outra)]).toEqual([403, 'nao-e-autor']);
    const curta = await post(enf, `${C}/enfermagem/bundles/${String(bundle)}/correcao`, {
      versao: 1,
      itens: { ...itens, indicacao: true },
      observacao: null,
      justificativa: 'curta',
    });
    expect(curta.statusCode).toBe(400);
    const c = await post(enf, `${C}/enfermagem/bundles/${String(bundle)}/correcao`, {
      versao: 1,
      itens: { ...itens, indicacao: true },
      observacao: null,
      justificativa: 'Indicação revisada esquecida no turno',
    });
    expect(c.statusCode, c.body).toBe(201);
    s = ((await aba()).json() as Aba).itens.find((x) => x.id === sonda)!;
    expect(s.alerta).toBeNull();
    expect(s.bundles[0]).toMatchObject({ id: bundle, versao: 2, indicacaoRevisada: true });
    const vs = (await get(enf, `${C}/enfermagem/versoes/bundle/${String(bundle)}`)).json() as {
      itens: { acao: string; dados: { indicacaoRevisada: boolean } }[];
    };
    expect(vs.itens[0]).toMatchObject({ acao: 'correcao', dados: { indicacaoRevisada: false } });
    // Estorno: crítico (senha), fica visível, sai do alerta e libera o turno.
    const semSenha = await post(enf, `${C}/enfermagem/bundles/${String(bundle)}/estorno`, {
      versao: 2,
      justificativa: 'Checklist lançado no dispositivo errado',
    });
    expect(semSenha.statusCode).toBe(401);
    const e = await post(enf, `${C}/enfermagem/bundles/${String(bundle)}/estorno`, {
      versao: 2,
      justificativa: 'Checklist lançado no dispositivo errado',
      senha: SENHA,
    });
    expect(e.statusCode, e.body).toBe(201);
    s = ((await aba()).json() as Aba).itens.find((x) => x.id === sonda)!;
    expect(s.bundles.find((x) => x.id === bundle)?.estornadoEm).not.toBeNull();
    expect(s.bundleDoTurno).toBe(false);
    expect(s.alerta).not.toBeNull();
    const deNovo = await post(enf, `${C}/enfermagem/bundles/${String(bundle)}/correcao`, {
      versao: 3,
      itens,
      observacao: null,
      justificativa: 'Tentativa depois do estorno',
    });
    expect([deNovo.statusCode, codigo(deNovo)]).toEqual([409, 'bundle-estornado']);
    const refeito = await post(enf, `${C}/enfermagem/dispositivos/${String(sonda)}/bundle`, {
      data: '2026-11-03',
      turno: 'manha',
      itens: { ...itens, indicacao: true },
      observacao: null,
    });
    expect(refeito.statusCode, refeito.body).toBe(201);
  });

  it('a aba cancela o próprio dispositivo com motivo e senha (fica visível como inativo)', async () => {
    const r = await post(enf, `${C}/enfermagem/dispositivos`, {
      internacao: 4802,
      tipo: 'cvc',
      sitio: null,
      inseridoEm: '2026-11-02T08:00',
      itemPrescricao: null,
      observacao: null,
    });
    const id = (r.json() as { id: number }).id;
    const dep = (await get(enf, `${C}/enfermagem/dispositivos/${String(id)}/dependentes`)).json() as {
      podeCancelar: boolean;
    };
    expect(dep.podeCancelar).toBe(true);
    const outra = await post(enf2, `${C}/enfermagem/dispositivos/${String(id)}/cancelamento`, {
      versao: 1,
      justificativa: 'Lançado no paciente errado',
      senha: SENHA,
    });
    expect([outra.statusCode, codigo(outra)]).toEqual([403, 'nao-e-autor']);
    const c = await post(enf, `${C}/enfermagem/dispositivos/${String(id)}/cancelamento`, {
      versao: 1,
      justificativa: 'Lançado no paciente errado',
      senha: SENHA,
    });
    expect(c.statusCode, c.body).toBe(201);
  });
});

describe('revisão do W0-04: a sessão de higiene das mãos também é do autor', () => {
  it('a CCIH corrige e estorna a sessão de outro observador só com a senha', async () => {
    const { id } = await porta.gravarSgh(ctxTeste('aa'), TRILHA_TESTE, (g) =>
      g.registrarObservacaoMaos({
        unidade: 2,
        setor: 'UTI',
        observadoEm: '2026-11-03T09:00',
        categoria: 'enfermeiro',
        oportunidades: 1,
        conformes: 1,
        detalhe: [{ momento: 'antesContato', acao: 'friccao', luvas: false }],
        observacao: null,
        usuario: 'SINT.OUTRO.OBSERVADOR',
      }),
    );
    const corpo = {
      versao: 1,
      observadoEm: '2026-11-03T09:00',
      categoria: 'medico',
      oportunidades: [{ momento: 'antesContato', acao: 'friccao', luvas: false }],
      observacao: null,
      justificativa: 'Categoria conferida na planilha do observador',
    };
    const semSenha = await post(ccih, `${C}/maos/observacoes/${String(id)}/correcao`, corpo);
    expect(semSenha.statusCode).toBe(401);
    const c = await post(ccih, `${C}/maos/observacoes/${String(id)}/correcao`, { ...corpo, senha: SENHA });
    expect(c.statusCode, c.body).toBe(201);
  });
});

describe('revisão do W0-04: a gravação pela aba confere o vínculo com o paciente (M23)', () => {
  const montar = () => {
    const memoria = new PortaCcihMemoria({ agora });
    const ctrl = new CcihController(
      memoria,
      new RegistradorTrilhaMemoria(),
      null,
      null,
      new EstadoProntuario(),
      null,
      new VinculoSintetico([]),
      null,
    );
    const permissoes = ['qualidade.dispositivoInvasivo.registrar', 'qualidade.dispositivoInvasivo.ler'];
    const req = {
      headers: {},
      ip: '127.0.0.1',
      sgh: {
        real: true,
        permissao: 'qualidade.dispositivoInvasivo.registrar',
        ability: criarAbility(regrasDeAcesso(permissoes, null)),
        sessao: {
          usuario: { id: '1', nome: 'Enfermeira sintética', login: 'SINT.ENF.PLANTAO' },
          rede: 'rede-teste',
          estabelecimentos: [],
          estabelecimentoAtivo: 'aa',
          unidadeAtiva: null,
          permissoes,
          restricaoVinculo: true,
          sintetica: true,
          bloqueioInatividadeSegundos: 0,
          expiraEm: '',
        },
      },
    } as unknown as RequisicaoAutorizada;
    return { ctrl, req, memoria };
  };
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as ErroProblema;
    }
    return null;
  };
  it('sem vínculo, o checklist, a retirada e a correção são recusados (403 sem-vinculo)', async () => {
    const { ctrl, req, memoria } = montar();
    const { id } = await memoria.gravarSgh(ctxTeste('aa'), TRILHA_TESTE, (g) =>
      g.registrarDispositivo({
        reg: 4802,
        paciente: 48_002,
        leito: { bloco: 'UTI', acomodacao: '01', leito: 'C' },
        tipo: 'sondaVesical',
        sitio: null,
        inseridoEm: '2026-11-01T08:00',
        itemPrescricao: null,
        observacao: null,
        usuario: 'SINT.ENF.PLANTAO',
      }),
    );
    const bundle = await erro(
      ctrl.registrarBundle(
        String(id),
        { data: '2026-11-03', turno: 'manha', itens: { indicacao: true }, observacao: null },
        req,
      ),
    );
    expect(bundle).toBeInstanceOf(ErroProblema);
    expect(bundle).toMatchObject({ tipo: 'sem-vinculo' });
    const retirada = await erro(
      ctrl.retirarDispositivoEnfermagem(
        String(id),
        { versao: 1, retiradoEm: '2026-11-03T10:00', motivo: 'eletiva', observacao: null },
        req,
      ),
    );
    expect(retirada).toMatchObject({ tipo: 'sem-vinculo' });
    const correcao = await erro(
      ctrl.corrigirDispositivoEnfermagem(
        String(id),
        {
          versao: 1,
          tipo: 'sondaVesical',
          sitio: 'Uretral',
          inseridoEm: '2026-11-01T08:00',
          retiradoEm: null,
          justificativa: 'Sítio esquecido no registro',
        },
        req,
      ),
    );
    expect(correcao).toMatchObject({ tipo: 'sem-vinculo' });
  });
});
