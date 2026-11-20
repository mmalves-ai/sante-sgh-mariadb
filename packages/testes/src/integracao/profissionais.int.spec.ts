// D-PROF-39 sobre a cópia (sob a trava da cópia; tudo em transação desfeita): o profissional SINTÉTICO incluído pelo
// executor com os gatilhos do cadastro (retrato, linha mantida pelo cadastro, especialidade do CBO), o login do
// sistema ligado como o cadastro anterior liga (TBUSERS_TBPAPEL do papel Operador de sistema) e reconhecido pelo
// atendimento e pelo prontuário, a troca com justificativa e no histórico, inativar e reativar, a exclusão recusada
// com quantos e quais (o login que já foi ligado e os atos de um profissional real) e a do cadastrado por engano com o
// retrato de cada linha apagada. Contagens iguais depois do ROLLBACK. Saída só com contagens e códigos (nenhum nome).
import {
  agruparVinculos,
  lerFichaUsuario,
  ligacoesDoProfissional,
  loginDoRegistro,
  mapaDeDependencias,
  operacao,
  prescritoresDoUsuario,
  profissionalDoLogin,
  VINCULOS_SO_POR_CODIGO,
  vinculosDoProfissional,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cboMedicoClinico,
  cboMedicoOutro,
  cpfLivreProfissional,
  efeitosDaInclusao,
  encerrarRegistrosPorFora,
  medidaLoginUnico,
  numeroDoRegistro,
  eventoLegadoNoUsuario,
  eventosDoLogin,
  numeroConselhoLivre,
  pessoaDoProfissional,
  pessoaExiste,
  profissionalComAtos,
  profissionalExiste,
  registroDeOutroSemLogin,
  registrosAtivos,
  registrosNaUf,
  retratoDoProfissional,
  retratosDeExclusao,
  sobraDoProfissional,
} from '../massa/profissional.js';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];
const m = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));
const MARCA = 'SINTETICO DPROF';

async function codigoDa(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    const c = (e as { problema?: { codigo?: string } }).problema?.codigo;
    if (c) return c;
    throw e;
  }
}

describe.skipIf(!PODE_ESCREVER)('profissional do corpo clínico na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () => a.nucleo.lerSomente(ctx(a), (l) => retratoDoProfissional(l));

  async function usuario(e: Escritor, por: string): Promise<string> {
    const login = (
      await loginLivre(e, (Date.now() + Math.floor(Math.random() * 1e6)) % 1_000_000_000)
    ).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, por),
      { escritor: e },
    );
    return login;
  }

  async function incluir(e: Escritor, operador: string, ufCbo: { uf: string; cbo: number }) {
    const cpf = await cpfLivreProfissional(e, Date.now() % 80_000_000);
    const s = await a.executor.executar(
      operacao('cadastro.cadastrarProfissional'),
      a.cod,
      {
        nome: `MEDICA ${MARCA}`,
        cpf,
        sexo: 'F',
        registro: {
          conselho: 'CRM',
          numero: await numeroConselhoLivre(e),
          uf: ufCbo.uf,
          cbo: ufCbo.cbo,
          convenios: [],
        },
      },
      ctxOperacao(a, operador),
      { escritor: e },
    );
    return { profissional: num(s.resultado['profissional']), registro: num(s.resultado['registro']) };
  }

  it('o mapa de dependências na cópia: FKs declaradas, vínculos só por código e o número do conselho', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const mapa = await mapaDeDependencias(l);
      return {
        fk: mapa.filter((d) => d.origem === 'fk').length,
        codigo: mapa.filter((d) => d.origem === 'codigo').map((d) => `${d.tabela}.${d.coluna}`),
        numero: mapa.filter((d) => d.origem === 'numero').length,
      };
    });
    expect(r.fk).toBeGreaterThan(300);
    // O mapa documentado em packages/legado está todo no catálogo da cópia (nenhum vínculo por código esquecido).
    for (const d of VINCULOS_SO_POR_CODIGO) expect(r.codigo).toContain(`${d.tabela}.${d.coluna}`);
    expect(r.numero).toBe(2);
    console.log(
      `[${a.cod}] mapa de dependências do profissional: ${r.fk} FKs declaradas, ${r.codigo.length} vínculos só por código, ${r.numero} pelo número do conselho`,
    );
  });

  it('inclusão, login ligado e reconhecido, troca com justificativa, inativar/reativar e exclusão só sem vínculo', async () => {
    const antes = await retrato();
    const t0 = Date.now();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const operador = await usuario(e, 'SGH.TESTE');
      const cbo = await cboMedicoClinico(e);
      const { profissional, registro } = await incluir(e, operador, { uf: 'MG', cbo });
      const { sombra, retratos } = await efeitosDaInclusao(e, profissional);
      // Revisão: quem inclui (ou altera) o cadastro fica em TBPROFIS.ID_TBUSERS, mas NÃO vira o profissional: nem o
      // atendimento nem a prescrição o reconhecem (só o papel Operador de sistema ativo liga o login ao registro).
      const operadorNaoE =
        (await profissionalDoLogin(e, operador)) === null &&
        (await prescritoresDoUsuario(e, operador)).length === 0;

      // O login do médico: usuário sintético com o papel Operador de sistema (concedido pelo gestor de acessos).
      // (acesso.criarUsuario: ativo, num grupo sintético; o usuário de integração nasce inativo e não serve.)
      const grupo = `SGHDP${Date.now().toString(36).toUpperCase()}`.slice(0, 15);
      await a.executor.executar(
        operacao('acesso.criarGrupo'),
        a.cod,
        { nome: grupo },
        ctxOperacao(a, operador),
        {
          escritor: e,
        },
      );
      const medico = (await loginLivre(e, (Date.now() + 77) % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuario'),
        a.cod,
        { login: medico, nomeCompleto: `MEDICO ${MARCA}`, grupo },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      await a.executor.executar(
        operacao('acesso.concederPapelUsuario'),
        a.cod,
        { login: medico, papel: 4 },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const semLigar = await profissionalDoLogin(e, medico);
      // Segregação: ninguém liga o próprio login (o operador tentando ligar a si mesmo ao registro).
      const aSiMesmo = await codigoDa(
        a.executor.executar(
          operacao('cadastro.vincularLoginProfissional'),
          a.cod,
          { profissional, registro, login: operador, versao: '', justificativa: `Auto-ligação ${MARCA}` },
          ctxOperacao(a, operador),
          { escritor: e },
        ),
      );
      // A primeira ligação também exige a justificativa.
      const semJust1 = await codigoDa(
        a.executor.executar(
          operacao('cadastro.vincularLoginProfissional'),
          a.cod,
          { profissional, registro, login: medico, versao: '' },
          ctxOperacao(a, operador),
          { escritor: e },
        ),
      );
      const lig = await a.executor.executar(
        operacao('cadastro.vincularLoginProfissional'),
        a.cod,
        { profissional, registro, login: medico, versao: '', justificativa: `Ligado no teste ${MARCA}` },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const doLogin = await profissionalDoLogin(e, medico);
      // A trilha do legado como as gravações de acesso em TBUSERS_TBPAPEL: tipo 17, opção 5435, alvo o usuário.
      const ev17 = await eventoLegadoNoUsuario(e, lig.trilha, medico);
      // O papel Operador retirado (ATIVO 'F'; a linha fica com o registro): o login deixa de ser o profissional.
      // (o médico continua entrando por outro papel ativo: o último papel não se retira)
      await a.executor.executar(
        operacao('acesso.concederPapelUsuario'),
        a.cod,
        { login: medico, papel: 3 },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      await a.executor.executar(
        operacao('acesso.revogarPapelUsuario'),
        a.cod,
        { login: medico, papel: 4 },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const papelRetirado = await profissionalDoLogin(e, medico);
      // X-01: o "Profissional vinculado" da ficha do usuário segue o papel 4 ativo (retirado = nenhum).
      const fichaRetirado = await lerFichaUsuario(e, medico, { auditor: false });
      await a.executor.executar(
        operacao('acesso.reativarPapelUsuario'),
        a.cod,
        { login: medico, papel: 4 },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const papelDeVolta = await profissionalDoLogin(e, medico);
      const fichaDeVolta = await lerFichaUsuario(e, medico, { auditor: false });

      // Um login, um profissional: o mesmo login num profissional real é recusado.
      const outro = await registroDeOutroSemLogin(e, profissional);
      const deOutro = await codigoDa(
        a.executor.executar(
          operacao('cadastro.vincularLoginProfissional'),
          a.cod,
          {
            profissional: outro.profissional,
            registro: outro.registro,
            login: medico,
            versao: '',
            justificativa: `Outro profissional ${MARCA}`,
          },
          ctxOperacao(a, operador),
          { escritor: e },
        ),
      );
      // Trocar sem justificativa: recusado; desligar com justificativa: grava e vai ao histórico.
      const semJust = await codigoDa(
        a.executor.executar(
          operacao('cadastro.vincularLoginProfissional'),
          a.cod,
          { profissional, registro, login: null, versao: medico },
          ctxOperacao(a, operador),
          { escritor: e },
        ),
      );
      await a.executor.executar(
        operacao('cadastro.vincularLoginProfissional'),
        a.cod,
        {
          profissional,
          registro,
          login: null,
          versao: medico,
          justificativa: `Teste de integração ${MARCA}`,
        },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const eventosLogin = await eventosDoLogin(e, profissional);
      const semLogin = await profissionalDoLogin(e, medico);

      // Inativar e reativar (o gatilho leva o ATIVO à linha mantida pelo cadastro).
      await a.executor.executar(
        operacao('cadastro.inativarProfissional'),
        a.cod,
        { profissional, motivo: `Inativado no teste ${MARCA}` },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const inativos = await registrosAtivos(e, profissional);
      await a.executor.executar(
        operacao('cadastro.reativarProfissional'),
        a.cod,
        { profissional, motivo: `Reativado no teste ${MARCA}` },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const ativos = await registrosAtivos(e, profissional);
      // Reativar sem inativação deste sistema (encerrado por fora): recusado, nada religado.
      const encerradoPorFora = await incluir(e, operador, { uf: 'MG', cbo });
      await encerrarRegistrosPorFora(e, encerradoPorFora.profissional);
      const reativarPorFora = await codigoDa(
        a.executor.executar(
          operacao('cadastro.reativarProfissional'),
          a.cod,
          { profissional: encerradoPorFora.profissional, motivo: `Reativado no teste ${MARCA}` },
          ctxOperacao(a, operador),
          { escritor: e },
        ),
      );

      // Excluir: o login que já foi ligado é vínculo (SBIS NGS1.03.09 d) — recusado com quantos e quais.
      const comHistorico = await codigoDa(
        a.executor.executar(
          operacao('cadastro.excluirProfissional'),
          a.cod,
          { profissional, motivo: `Exclusão recusada ${MARCA}` },
          ctxOperacao(a, operador),
          { escritor: e },
        ),
      );
      // Um profissional real com atos: os vínculos por grupo.
      const real = await profissionalComAtos(e);
      const tReal = Date.now();
      const vReal = agruparVinculos(await vinculosDoProfissional(e, real));
      const msReal = Date.now() - tReal;
      const realRecusado = await codigoDa(
        a.executor.executar(
          operacao('cadastro.excluirProfissional'),
          a.cod,
          { profissional: real, motivo: `Exclusão recusada ${MARCA}` },
          ctxOperacao(a, operador),
          { escritor: e },
        ),
      );
      const realFica = await profissionalExiste(e, real);

      // O cadastrado por engano (sem login, sem atos): sai com o retrato de cada linha; TBPESSOA fica.
      const engano = await incluir(e, operador, { uf: 'MG', cbo });
      const pessoa = await pessoaDoProfissional(e, engano.profissional);
      const histAntes = await retratosDeExclusao(e);
      const exc = await a.executor.executar(
        operacao('cadastro.excluirProfissional'),
        a.cod,
        { profissional: engano.profissional, motivo: `Cadastro por engano ${MARCA}` },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const sobrou = await sobraDoProfissional(e, engano.profissional);
      const histDepois = await retratosDeExclusao(e);
      const pessoaFica = await pessoaExiste(e, pessoa);

      // O registro por engano (segundo registro, sem atos) também sai; o primeiro fica.
      const segundo = await a.executor.executar(
        operacao('cadastro.incluirRegistroProfissional'),
        a.cod,
        {
          profissional,
          conselho: 'CRM',
          numero: await numeroConselhoLivre(e),
          uf: 'RJ',
          cbo,
          convenios: [],
        },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      await a.executor.executar(
        operacao('cadastro.excluirRegistroProfissional'),
        a.cod,
        { registro: num(segundo.resultado['registro']), motivo: `Registro por engano ${MARCA}` },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const registrosFicam = await registrosNaUf(e, profissional, 'RJ');
      return {
        sombra,
        retratos,
        semLigar: semLigar === null,
        ligado: doLogin?.vinculo === registro && lig.resultado['semRegistroAtivo'] === 0,
        operadorNaoE,
        aSiMesmo,
        semJust1,
        ev17,
        papelRetirado: papelRetirado === null,
        papelDeVolta: papelDeVolta?.vinculo === registro,
        fichaRetirado: fichaRetirado !== null && fichaRetirado.profissionalVinculado === null,
        fichaDeVolta: fichaDeVolta?.profissionalVinculado?.id === profissional,
        reativarPorFora,
        deOutro,
        semJust,
        eventosLogin,
        desligado: semLogin === null,
        inativos,
        ativos,
        comHistorico,
        vReal,
        msReal,
        realRecusado,
        realFica,
        linhasExcluidas: num(exc.resultado['linhas']),
        sobrou,
        retratosGuardados: histDepois - histAntes,
        pessoaFica,
        registrosFicam,
      };
    });
    const depois = await retrato();
    expect(r.sombra).toBe(1);
    expect(r.retratos).toBeGreaterThan(0);
    expect(r.semLigar).toBe(true);
    expect(r.ligado).toBe(true);
    expect(r.operadorNaoE).toBe(true);
    expect(r.aSiMesmo).toBe('a-si-mesmo');
    expect(r.semJust1).toBe('justificativa-obrigatoria');
    expect(r.ev17).toBe(1);
    expect(r.papelRetirado).toBe(true);
    expect(r.papelDeVolta).toBe(true);
    expect(r.fichaRetirado).toBe(true);
    expect(r.fichaDeVolta).toBe(true);
    expect(r.reativarPorFora).toBe('reativar-registro-a-registro');
    expect(r.deOutro).toBe('login-de-outro-profissional');
    expect(r.semJust).toBe('justificativa-obrigatoria');
    expect(r.eventosLogin).toBe(2);
    expect(r.desligado).toBe(true);
    expect(r.inativos).toBe(0);
    expect(r.ativos).toBeGreaterThanOrEqual(2);
    expect(r.comHistorico).toBe('profissional-com-vinculos');
    expect(r.vReal.length).toBeGreaterThan(0);
    expect(r.realRecusado).toBe('profissional-com-vinculos');
    expect(r.realFica).toBe(1);
    expect(r.sobrou).toBe(0);
    expect(r.retratosGuardados).toBe(r.linhasExcluidas);
    expect(r.linhasExcluidas).toBeGreaterThanOrEqual(5);
    expect(r.pessoaFica).toBe(1);
    expect(r.registrosFicam).toBe(0);
    // Contagens iguais depois do ROLLBACK.
    expect(depois).toEqual(antes);
    console.log(
      `[${a.cod}] D-PROF-39 na cópia: inclusão com sombra e retrato; quem inclui não vira o profissional; ligar a si mesmo e sem justificativa recusados; login ligado (reconhecido pelo atendimento; trilha do legado tipo 17 no usuário), papel retirado deixa de reconhecer, recusado em outro profissional, troca sem justificativa recusada, desligado; inativar/reativar; reativar o encerrado por fora recusado; exclusão recusada (histórico do login; real com ${r.vReal.map((g) => `${g.grupo}: ${m(g.quantidade)}`).join('; ')} em ${r.msReal} ms); engano excluído com ${r.linhasExcluidas} linhas retratadas; registro por engano excluído; ${Date.now() - t0} ms; contagens iguais após o ROLLBACK`,
    );
  }, 300_000);

  // Login único por profissional (pergunta do dono, 18/11/2026: "por que tem 3 logins?"): o mesmo CRM em duas
  // ocupações; o SEGUNDO login recusado; trocar a ocupação move o mesmo login, com o histórico dos dois registros.
  it('login único: segundo login recusado; trocar a ocupação move o login; medida do dado herdado', async () => {
    const medida = await a.nucleo.lerSomente(ctx(a), (l) => medidaLoginUnico(l));
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const operador = await usuario(e, 'SGH.TESTE');
      const cbo = await cboMedicoClinico(e);
      const cbo2 = await cboMedicoOutro(e, cbo);
      const { profissional, registro } = await incluir(e, operador, { uf: 'MG', cbo });
      const numero = await numeroDoRegistro(e, registro);
      // O mesmo CRM (número e UF) na outra ocupação.
      const seg = await a.executor.executar(
        operacao('cadastro.incluirRegistroProfissional'),
        a.cod,
        { profissional, conselho: 'CRM', numero, uf: 'MG', cbo: cbo2, convenios: [] },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const registro2 = num(seg.resultado['registro']);
      // Dois logins de médico (papel Operador de sistema), concedidos pelo gestor de acessos.
      const grupo = `SGHLU${Date.now().toString(36).toUpperCase()}`.slice(0, 15);
      await a.executor.executar(
        operacao('acesso.criarGrupo'),
        a.cod,
        { nome: grupo },
        ctxOperacao(a, operador),
        {
          escritor: e,
        },
      );
      const medicos: string[] = [];
      for (const k of [11, 23]) {
        const login = (await loginLivre(e, (Date.now() + k) % 1_000_000_000)).toUpperCase();
        await a.executor.executar(
          operacao('acesso.criarUsuario'),
          a.cod,
          { login, nomeCompleto: `MEDICO ${MARCA}`, grupo },
          ctxOperacao(a, operador),
          { escritor: e },
        );
        await a.executor.executar(
          operacao('acesso.concederPapelUsuario'),
          a.cod,
          { login, papel: 4 },
          ctxOperacao(a, operador),
          { escritor: e },
        );
        medicos.push(login);
      }
      const [m1, m2] = medicos as [string, string];
      const vincular = (reg: number, login: string | null, versao: string, justificativa: string) =>
        a.executor.executar(
          operacao('cadastro.vincularLoginProfissional'),
          a.cod,
          { profissional, registro: reg, login, versao, justificativa },
          ctxOperacao(a, operador),
          { escritor: e },
        );
      await vincular(registro, m1, '', `Ligado no teste ${MARCA}`);
      // O SEGUNDO login, noutra ocupação do mesmo profissional: recusado, nada muda.
      const segundo = await codigoDa(vincular(registro2, m2, '', `Segundo login ${MARCA}`));
      const segundoNadaMudou =
        (await loginDoRegistro(e, registro2)) === '' && (await loginDoRegistro(e, registro)) === m1;
      // Trocar a ocupação: o MESMO login vai ao outro registro; o primeiro fica sem login.
      const mov = await vincular(registro2, m1, '', `Troca de ocupação ${MARCA}`);
      const ligacoes = await ligacoesDoProfissional(e, profissional);
      const doLogin = await profissionalDoLogin(e, m1);
      const eventos = await eventosDoLogin(e, profissional);
      // Agora o segundo login no registro do primeiro (que ficou livre) continua recusado.
      const terceiro = await codigoDa(vincular(registro, m2, '', `Segundo login de novo ${MARCA}`));
      // Trocar o login no registro em que ele está: passa (o profissional segue com um login só).
      await vincular(registro2, m2, m1, `Troca do login ${MARCA}`);
      const final = await ligacoesDoProfissional(e, profissional);
      // Revisão: por Usuários e Acessos o profissional não ganha um segundo login.
      const acesso = (nome: string, entrada: Record<string, unknown>) =>
        a.executor.executar(operacao(nome), a.cod, entrada, ctxOperacao(a, operador), { escritor: e });
      // (1) Conceder o papel Operador de sistema COM a ocupação de outro registro: a regra da ficha recusa.
      const m3 = (await loginLivre(e, (Date.now() + 37) % 1_000_000_000)).toUpperCase();
      await acesso('acesso.criarUsuario', { login: m3, nomeCompleto: `MEDICO ${MARCA}`, grupo });
      const comOcupacao = await codigoDa(
        acesso('acesso.concederPapelUsuario', { login: m3, papel: 4, idCbo: registro }),
      );
      // (2) O papel 4 retirado guarda o registro; reativado depois que OUTRO login foi ligado ao profissional: recusado.
      await vincular(registro2, null, m2, `Desligado no teste ${MARCA}`);
      await vincular(registro, m1, '', `De volta ao primeiro registro ${MARCA}`);
      await acesso('acesso.concederPapelUsuario', { login: m1, papel: 3 });
      await acesso('acesso.revogarPapelUsuario', { login: m1, papel: 4 });
      await vincular(registro2, m2, '', `Ligado com o papel do outro retirado ${MARCA}`);
      const reativar = await codigoDa(acesso('acesso.reativarPapelUsuario', { login: m1, papel: 4 }));
      const depoisReativar = await ligacoesDoProfissional(e, profissional);
      return {
        comOcupacao,
        reativar,
        depoisReativar,
        m2,
        segundo,
        segundoNadaMudou,
        anterior: num(mov.resultado['registroAnterior']) === registro,
        ligacoes,
        movido: doLogin?.vinculo === registro2,
        eventos,
        terceiro,
        final,
        registro2,
      };
    });
    const depois = await retrato();
    expect(r.segundo).toBe('outro-login-no-profissional');
    expect(r.segundoNadaMudou).toBe(true);
    expect(r.anterior).toBe(true);
    expect(r.ligacoes.map((x) => x.registro)).toEqual([r.registro2]);
    expect(r.movido).toBe(true);
    // ligado no 1º; ligado no 2º e desligado no 1º (a troca de ocupação).
    expect(r.eventos).toBe(3);
    expect(r.terceiro).toBe('outro-login-no-profissional');
    expect(r.final).toHaveLength(1);
    expect(r.comOcupacao).toBe('outro-login-no-profissional');
    expect(r.reativar).toBe('outro-login-no-profissional');
    expect(r.depoisReativar).toEqual([{ registro: r.registro2, login: r.m2 }]);
    expect(depois).toEqual(antes);
    console.log(
      `[${a.cod}] login único na cópia: ${medida.logins} logins ligados (papel Operador de sistema ativo); ${medida.variosRegistros} profissionais com mais de um registro; ${medida.variosLogins} com logins diferentes em registros diferentes; segundo login recusado (outro-login-no-profissional); troca da ocupação moveu o login com 3 eventos no histórico; troca do login no registro dele aceita; papel 4 concedido com a ocupação de outro registro recusado (outro-login-no-profissional); papel 4 reativado com o registro de um profissional que já tem outro login recusado (outro-login-no-profissional); contagens iguais após o ROLLBACK`,
    );
  }, 300_000);
});
