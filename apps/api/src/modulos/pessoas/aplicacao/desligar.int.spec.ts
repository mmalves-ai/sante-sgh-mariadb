// Regras 1 e 2 do M52 sobre a cópia (transação DESFEITA; ficha, seção 5 e campo 10): a admissão de uma pessoa
// sintética (CPF de dígito calculado sobre base inventada) grava SGH_PES_VINCULO e o histórico, e o segundo vínculo da
// mesma pessoa reusa o agrupador; o desligamento do vínculo ligado a um usuário livre da cópia (só o ID e o login, em
// memória) bloqueia o usuário pelo executor (`acesso.bloquearUsuario`, a receita do M10) e derruba a sessão dele, sem
// apagar o usuário (a contagem de TBUSERS não muda) e sem tocar no cadastro de profissionais; o vínculo desligado, a
// linha do histórico e o evento PESSOAS_COLABORADOR_DESLIGADO ficam na mesma transação SGH_. Corretor: a lista por
// unidade, setor e CPF (filtro exato pelo HMAC), as unidades onde o profissional atende na ficha (TBCBOPRO_TBUNIDAD)
// com o p95 medido de novo, e o fim do dependente (ATE e motivo; nunca apagado). Só contagens.
import { type ChaveGravada, chaveEvento, type PrerequisitoGravado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import {
  type AmbienteM27,
  ambienteM27,
  PODE_ESCREVER,
  percentil,
  usuariosAtivos,
} from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';
import { gravarConselhoDiaPesSgh, somenteSgh, ultimoConselhoDiaPesSgh } from '@sgh/legado';
import { cpfSintetico } from '../porta-memoria.js';
import { ServicoPessoas } from '../servico.js';

const ligada: ChaveGravada = {
  id: 'pessoas.colaborador',
  tipo: 'recurso',
  chave: 'pessoas.colaborador',
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-25T10:00:00',
};
const conferencia: PrerequisitoGravado = {
  recurso: 'pessoas.colaborador',
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-25T10:00:00',
};
const CPF = cpfSintetico('900529001');
const n = (v: unknown) => Number(v ?? 0);

describe.skipIf(!PODE_ESCREVER)('desligamento ligado ao acesso (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('admitir → segundo vínculo da mesma pessoa → desligar: usuário bloqueado, sessão derrubada, nada apagado', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m52-desligar' }, async (e) => {
      const u = await usuariosAtivos(e);
      const [alvo] = await e.consultar('SELECT ID_TBUSERS FROM TBUSERS WHERE NOME = ?', [u.b], { teto: 1 });
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        {
          teto: 1,
        },
      );
      const [t] = await e.consultar('SELECT FIRST 1 ID FROM FPTIPORESC ORDER BY ID', [], { teto: 1 });
      const [h] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
        teto: 1,
      });
      const hoje = String(h?.['H']);
      const [u0] = await e.consultar('SELECT COUNT(*) N FROM TBUSERS', [], { teto: 1 });
      const [p0] = await e.consultar('SELECT COUNT(*) N FROM TBPROFIS', [], { teto: 1 });
      const trilha = new RegistradorTrilhaMemoria();
      const servico = new ServicoPessoas(
        portaPessoasNaTransacao(e, a.executor),
        trilha,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => [ligada],
          prerequisitosIniciais: () => [conferencia],
        }),
        null,
        new CifraCpf(Buffer.alloc(32, 52)),
      );
      let k = 0;
      const sessao = (): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m52-desl-${Date.now().toString(36)}-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: a.c.hospital,
        rede: a.c.rede,
        login: u.a,
        porta: a.c,
        pode: () => true,
      });
      // A pessoa sintética não existe no cadastro: a prévia não acha profissional nem usuário.
      const previa = await servico.previa(sessao(), CPF);
      const base = {
        cpf: CPF,
        nome: 'COLABORADOR SINTETICO M52',
        admissao: hoje,
        cargo: 'Técnico de enfermagem',
        funcao: null,
        cargaSemanalHoras: 36,
        lotacao: { centroCusto: n(cc?.['COD']), unidade: null, setor: null },
        profissional: null,
        usuario: null,
      };
      const v1 = (await servico.admitir(sessao(), { ...base, tipo: 'clt', matricula: 'SINT-M52-1' })).id;
      const v2 = (await servico.admitir(sessao(), { ...base, tipo: 'pj', matricula: 'SINT-M52-2' })).id;
      const pessoas = await e.consultar(
        'SELECT DISTINCT PESSOA FROM SGH_PES_VINCULO WHERE ID IN (?, ?)',
        [v1, v2],
        { teto: 2 },
      );
      // O vínculo ligado ao usuário livre da cópia (como a admissão faria com o CPF dele).
      await e.executar('UPDATE SGH_PES_VINCULO SET ID_TBUSERS = ? WHERE ID IN (?, ?)', [
        n(alvo?.['ID_TBUSERS']),
        v1,
        v2,
      ]);
      const revogados: string[] = [];
      const revogar = async (_r: string, _h: string, login: string) => {
        revogados.push(login);
        return 1;
      };
      // Com o outro vínculo ativo, o acesso fica (D-DESL-52).
      const mantido = await servico.desligar(
        sessao(),
        { vinculo: v2, data: hoje, tipoRescisao: n(t?.['ID']), motivo: 'Término de contrato sintético' },
        Date.now(),
        revogar,
      );
      const [b1] = await e.consultar('SELECT BLOQUEADO FROM TBUSERS WHERE NOME = ?', [u.b], { teto: 1 });
      const desl = await servico.desligar(
        sessao(),
        { vinculo: v1, data: hoje, tipoRescisao: n(t?.['ID']), motivo: 'Pedido de demissão sintético' },
        Date.now(),
        revogar,
      );
      const [b2] = await e.consultar('SELECT BLOQUEADO FROM TBUSERS WHERE NOME = ?', [u.b], { teto: 1 });
      const [u1] = await e.consultar('SELECT COUNT(*) N FROM TBUSERS', [], { teto: 1 });
      const [p1] = await e.consultar('SELECT COUNT(*) N FROM TBPROFIS', [], { teto: 1 });
      const [vd] = await e.consultar(
        'SELECT COUNT(*) N FROM SGH_PES_VINCULO WHERE ID IN (?, ?) AND DESLIGAMENTO IS NOT NULL',
        [v1, v2],
        { teto: 1 },
      );
      const [hd] = await e.consultar(
        "SELECT COUNT(*) N FROM SGH_PES_HISTORICO WHERE ID_VINCULO IN (?, ?) AND TIPO = 'desligamento'",
        [v1, v2],
        { teto: 1 },
      );
      const [ob] = await e.consultar(
        "SELECT COUNT(*) N FROM SGH_OUTBOX WHERE TIPO = 'PESSOAS_COLABORADOR_DESLIGADO' AND CHAVE_EVENTO IN (?, ?)",
        [
          chaveEvento(`pessoas:desligamento:${a.c.hospital}:${v1}`),
          chaveEvento(`pessoas:desligamento:${a.c.hospital}:${v2}`),
        ],
        { teto: 1 },
      );
      return {
        previaVazia: previa.profissional === null && previa.usuarios.length === 0,
        mesmaPessoa: pessoas.length,
        mantido: mantido.usuarios.map((x) => x.acao),
        livreDepoisDoPrimeiro: String(b1?.['BLOQUEADO']).trim(),
        desligado: desl.usuarios.map((x) => x.acao),
        bloqueado: String(b2?.['BLOQUEADO']).trim(),
        revogadoOAlvo: revogados.length === 1 && revogados[0] === u.b,
        usuariosIguais: n(u1?.['N']) === n(u0?.['N']),
        profissionaisIguais: n(p1?.['N']) === n(p0?.['N']),
        vinculosDesligados: n(vd?.['N']),
        historico: n(hd?.['N']),
        outbox: n(ob?.['N']),
      };
    });
    console.info(`[m52] desligamento na cópia: ${JSON.stringify(r)}`);
    expect(r.previaVazia).toBe(true);
    expect(r.mesmaPessoa).toBe(1);
    expect(r.mantido).toEqual(['mantido']);
    expect(r.livreDepoisDoPrimeiro).toBe('F');
    expect(r.desligado).toEqual(['bloqueado']);
    expect(r.bloqueado).toBe('T');
    expect(r.revogadoOAlvo).toBe(true);
    expect(r.usuariosIguais).toBe(true);
    expect(r.profissionaisIguais).toBe(true);
    expect(r.vinculosDesligados).toBe(2);
    expect(r.historico).toBe(2);
    expect(r.outbox).toBe(2);
  }, 900_000);

  it('ficha, lista e alertas do conselho sobre o banco (SQL real, p95 < 500 ms), a validade conferida e o retrato do dia', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m52-ficha' }, async (e) => {
      const u = await usuariosAtivos(e);
      // Um profissional com registro ativo no conselho (só o ID, em memória).
      const [p] = await e.consultar(
        "SELECT FIRST 1 c.ID_TBPROFIS P, c.ID R FROM TBCBOPRO c WHERE c.ATIVO = 'T' AND c.ID_TBPROFIS > 2 ORDER BY c.ID DESC",
        [],
        { teto: 1 },
      );
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        {
          teto: 1,
        },
      );
      const [h] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
        teto: 1,
      });
      const hoje = String(h?.['H']);
      const trilha = new RegistradorTrilhaMemoria();
      const servico = new ServicoPessoas(
        portaPessoasNaTransacao(e, a.executor),
        trilha,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => [ligada],
          prerequisitosIniciais: () => [conferencia],
        }),
        null,
        new CifraCpf(Buffer.alloc(32, 53)),
      );
      let k = 0;
      const sessao = (): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m52-ficha-${Date.now().toString(36)}-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: a.c.hospital,
        rede: a.c.rede,
        login: u.a,
        porta: a.c,
        pode: () => true,
      });
      const v = (
        await servico.admitir(sessao(), {
          cpf: cpfSintetico('900529002'),
          nome: 'PROFISSIONAL SINTETICO M52',
          tipo: 'clt',
          admissao: hoje,
          cargo: 'Enfermeiro',
          funcao: null,
          cargaSemanalHoras: 36,
          lotacao: { centroCusto: n(cc?.['COD']), unidade: null, setor: null },
          matricula: 'SINT-M52-9',
          profissional: null,
          usuario: null,
        })
      ).id;
      // Liga o vínculo SINTÉTICO a um profissional da cópia (como a admissão faria com o CPF dele).
      await e.executar('UPDATE SGH_PES_VINCULO SET ID_TBPROFIS = ? WHERE ID = ?', [n(p?.['P']), v]);
      const tempos: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        await servico.ficha(sessao(), v);
        tempos.push(performance.now() - t0);
      }
      const temposLista: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        await servico.lista(sessao(), { estado: 'ativo', limite: 200, centroCusto: n(cc?.['COD']) });
        temposLista.push(performance.now() - t0);
      }
      const ficha = await servico.ficha(sessao(), v);
      const antes = await servico.painelConselho(sessao(), { situacao: 'todas', limite: 200 });
      const reg = n(p?.['R']);
      await servico.registrarHabilitacao(sessao(), {
        registro: reg,
        validade: hoje,
        conferidoEm: hoje,
        observacao: null,
      });
      const depois = await servico.painelConselho(sessao(), { situacao: 'aVencer', limite: 200 });
      await gravarConselhoDiaPesSgh(somenteSgh(e), {
        hospital: a.c.hospital,
        dia: hoje,
        janelaDias: 60,
        registros: 1,
        vencidos: 0,
        aVencer: 1,
        semValidade: 0,
      });
      await gravarConselhoDiaPesSgh(somenteSgh(e), {
        hospital: a.c.hospital,
        dia: hoje,
        janelaDias: 60,
        registros: 2,
        vencidos: 0,
        aVencer: 1,
        semValidade: 1,
      });
      const retrato = await ultimoConselhoDiaPesSgh(e, a.c.hospital);
      return {
        p95Ficha: Math.round(percentil(tempos, 95)),
        p95Lista: Math.round(percentil(temposLista, 95)),
        cpfMascarado: /^\*\*\*\.\*\*\*\.\d{3}-\d{2}$/.test(ficha.cpfMascarado ?? ''),
        registros: ficha.profissional?.registros.length ?? 0,
        semValidadeAntes: antes.itens.some((x) => x.registro === reg && x.situacao === 'semValidade'),
        aVencerDepois: depois.itens.some(
          (x) => x.registro === reg && x.situacao === 'aVencer' && x.diasParaVencer === 0,
        ),
        retrato: retrato ? `${retrato.registros}/${retrato.aVencer}/${retrato.semValidade}` : null,
      };
    });
    console.info(`[m52] ficha e alertas na cópia: ${JSON.stringify(r)}`);
    expect(r.p95Ficha).toBeLessThan(500);
    expect(r.p95Lista).toBeLessThan(500);
    expect(r.cpfMascarado).toBe(true);
    expect(r.registros).toBeGreaterThan(0);
    expect(r.semValidadeAntes).toBe(true);
    expect(r.aVencerDepois).toBe(true);
    expect(r.retrato).toBe('2/1/1');
  }, 900_000);

  it('corretor: lista por unidade, setor e CPF; unidades do registro na ficha; fim do dependente (p95 < 500 ms)', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m52-corretor' }, async (e) => {
      const u = await usuariosAtivos(e);
      // Um registro de conselho com unidade de atendimento (só os IDs, em memória).
      const [p] = await e.consultar(
        'SELECT FIRST 1 c.ID_TBPROFIS P, c.ID R FROM TBCBOPRO c WHERE c.ID_TBPROFIS > 2 AND c.ID NOT IN (1, 488) AND EXISTS (SELECT 1 FROM TBCBOPRO_TBUNIDAD t WHERE t.CBOPRO = c.ID AND t.UNIDAD > 0) ORDER BY c.ID DESC',
        [],
        { teto: 1 },
      );
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        { teto: 1 },
      );
      const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
        teto: 1,
      });
      const [h] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
        teto: 1,
      });
      const hoje = String(h?.['H']);
      const trilha = new RegistradorTrilhaMemoria();
      const servico = new ServicoPessoas(
        portaPessoasNaTransacao(e, a.executor),
        trilha,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => [ligada],
          prerequisitosIniciais: () => [conferencia],
        }),
        null,
        new CifraCpf(Buffer.alloc(32, 54)),
      );
      let k = 0;
      const sessao = (): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m52-corr-${Date.now().toString(36)}-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: a.c.hospital,
        rede: a.c.rede,
        login: u.a,
        porta: a.c,
        pode: () => true,
      });
      const cpf = cpfSintetico('900529003');
      const unidade = n(un?.['COD']);
      const v = (
        await servico.admitir(sessao(), {
          cpf,
          nome: 'COLABORADOR SINTETICO M52 C',
          tipo: 'clt',
          admissao: hoje,
          cargo: 'Enfermeiro',
          funcao: null,
          cargaSemanalHoras: 36,
          lotacao: { centroCusto: n(cc?.['COD']), unidade, setor: 'Setor sintético M52' },
          matricula: 'SINT-M52-C1',
          profissional: null,
          usuario: null,
        })
      ).id;
      await e.executar('UPDATE SGH_PES_VINCULO SET ID_TBPROFIS = ? WHERE ID = ?', [n(p?.['P']), v]);
      const tempos: number[] = [];
      let porUnidade = 0;
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        const l = await servico.lista(sessao(), { estado: 'ativo', limite: 200, unidade });
        tempos.push(performance.now() - t0);
        porUnidade = l.itens.filter((x) => x.vinculo === v).length;
      }
      const porSetor = (
        await servico.lista(sessao(), { estado: 'todos', limite: 200, setor: 'sintético m52' })
      ).itens.map((x) => x.vinculo);
      const t1 = performance.now();
      const porCpf = (await servico.lista(sessao(), { estado: 'todos', limite: 50, termo: cpf })).itens.map(
        (x) => x.vinculo,
      );
      const tCpf = performance.now() - t1;
      const temposFicha: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        await servico.ficha(sessao(), v);
        temposFicha.push(performance.now() - t0);
      }
      const ficha = await servico.ficha(sessao(), v);
      const reg = ficha.profissional?.registros.find((x) => x.registro === n(p?.['R']));
      const d = (
        await servico.incluirDependente(sessao(), {
          vinculo: v,
          nome: 'DEPENDENTE SINTETICO M52',
          nascimento: '2020-01-01',
          parentesco: '03',
          cpf: null,
          dependenteIr: true,
          dependenteSalarioFamilia: false,
        })
      ).id;
      await servico.encerrarDependente(sessao(), {
        vinculo: v,
        dependente: d,
        ate: hoje,
        motivo: 'Incluído por engano (integração sintética)',
      });
      const [dep] = await e.consultar(
        'SELECT COUNT(*) N FROM SGH_PES_DEPENDENTE WHERE ID = ? AND ATE IS NOT NULL AND MOTIVO_FIM IS NOT NULL AND ENCERRADO_POR IS NOT NULL',
        [d],
        { teto: 1 },
      );
      const depoisDoFim = (await servico.ficha(sessao(), v)).dependentes.length;
      return {
        p95ListaUnidade: Math.round(percentil(tempos, 95)),
        msListaCpf: Math.round(tCpf),
        p95Ficha: Math.round(percentil(temposFicha, 95)),
        porUnidade,
        porSetor: porSetor.includes(v),
        porCpf: porCpf.length === 1 && porCpf[0] === v,
        registroNaFicha: reg !== undefined,
        unidadesDoRegistro: (reg?.unidades.length ?? 0) > 0,
        dependenteEncerrado: n(dep?.['N']),
        dependentesNaFicha: depoisDoFim,
      };
    });
    console.info(`[m52] corretor na cópia: ${JSON.stringify(r)}`);
    expect(r.p95ListaUnidade).toBeLessThan(500);
    expect(r.msListaCpf).toBeLessThan(500);
    expect(r.p95Ficha).toBeLessThan(500);
    expect(r.porUnidade).toBe(1);
    expect(r.porSetor).toBe(true);
    expect(r.porCpf).toBe(true);
    expect(r.registroNaFicha).toBe(true);
    expect(r.unidadesDoRegistro).toBe(true);
    expect(r.dependenteEncerrado).toBe(1);
    expect(r.dependentesNaFicha).toBe(0);
  }, 900_000);
});
