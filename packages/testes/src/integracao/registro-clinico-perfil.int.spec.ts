// Perfil do registro clínico na cópia (corretor do M22): o que as receitas assumem do comportamento do outro
// sistema, conferido por CONTAGENS (só leitura, nada gravado; contagens de 1 a 4 saem como "<5"):
//   - rascunho reaberto e salvo de novo: o Delphi encadeia (linha nova com ID_PRCABEVOLTMP = a anterior, o mesmo
//     lançamento) e marca a anterior; nunca altera no lugar;
//   - correção de registro: o registro novo aponta o original (ID_PRCABEVOL_ORIG_CORREC), do mesmo paciente;
//   - residente com preceptor (ID_TBPROFIS_ACOMP_RESP) e as preferências de PRLOCPACDEFAULT (por usuário, sem
//     modelo nem local).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERFIL_REGISTRO } from '../massa/registro-clinico-perfil.js';
import { type Ambiente, ctx, num, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

type Linha = Record<string, unknown>;
const agregado = (n: number) => (n > 0 && n < 5 ? '<5' : n);
const mostrar = (ls: readonly Linha[]) =>
  JSON.stringify(
    ls.map((l) =>
      Object.fromEntries(Object.entries(l).map(([k, v]) => [k, k === 'N' ? agregado(num(v)) : num(v)])),
    ),
  );
const total = (ls: readonly Linha[], f: (l: Linha) => boolean = () => true) =>
  ls.filter(f).reduce((a, l) => a + num(l['N']), 0);

describe.skipIf(!PODE_ESCREVER)('perfil do registro clínico na cópia (só leitura, contagens)', () => {
  let a: Ambiente;
  const ler = (sql: string) =>
    a.nucleo.lerSomente(ctx(a), (l) => l.consultar(sql, [], { teto: 500, tempoMaximoMs: 600_000 }));
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('rascunho encadeado: a linha nova aponta a anterior, herda o lançamento e o ato; a anterior fica fechada', async () => {
    const pai = await ler(PERFIL_REGISTRO.anterior);
    const filho = await ler(PERFIL_REGISTRO.encadeado);
    const herda = await ler(PERFIL_REGISTRO.herda);
    // Folhas (o último rascunho de cada cadeia, sem encadeado): o estado e se há registro do mesmo ato (atendimento,
    // modelo, CBO e horário clínico) gravado depois do lançamento do rascunho: a finalização.
    const folhas = await ler(PERFIL_REGISTRO.folhas);
    const irmaos = await ler(PERFIL_REGISTRO.irmaos);
    const quando = await ler(PERFIL_REGISTRO.quando);
    const todos = await ler(PERFIL_REGISTRO.todos);
    console.log(`[${a.cod}] rascunho: estado do anterior (A=arquivado, E=excluído) ${mostrar(pai)}`);
    console.log(`[${a.cod}] rascunho: estado do encadeado ${mostrar(filho)}`);
    console.log(
      `[${a.cod}] rascunho: L=lançamento herdado, M=ID maior, MO=modelo, C=CBO, HA/HP=retratos, ATD=atendimento, EV=horário ${mostrar(herda)}`,
    );
    console.log(
      `[${a.cod}] rascunho: folhas dos últimos 180 dias (A, E, R=registro do mesmo ato) ${mostrar(folhas)}`,
    );
    console.log(`[${a.cod}] rascunho: anteriores com mais de um encadeado ${mostrar(irmaos)}`);
    console.log(
      `[${a.cod}] rascunho: exclusão do anterior (0 sem, 1 depois do lançamento, 2 antes) ${mostrar(quando)}`,
    );
    console.log(`[${a.cod}] rascunho: todos (A, E, F=encadeado) ${mostrar(todos)}`);
    const n = total(pai);
    expect(n).toBeGreaterThan(0);
    // O anterior nunca fica aberto quando há encadeado (o Delphi o fecha ao encadear).
    expect(total(pai, (l) => num(l['A']) === 0 && num(l['E']) === 0) / n).toBeLessThan(0.005);
    // O encadeado herda o lançamento, tem ID maior e é do mesmo modelo, profissional e atendimento.
    const mesmo = (l: Linha) =>
      num(l['L']) === 1 &&
      num(l['M']) === 1 &&
      num(l['MO']) === 1 &&
      num(l['C']) === 1 &&
      num(l['ATD']) === 1;
    expect(total(herda, mesmo) / n).toBeGreaterThan(0.995);
  });

  it('correção: o registro novo aponta o original, do mesmo paciente', async () => {
    const orig = await ler(PERFIL_REGISTRO.correcaoOriginal);
    const ordem = await ler(PERFIL_REGISTRO.correcaoOrdem);
    const varias = await ler(PERFIL_REGISTRO.correcaoVarias);
    const semOriginal = await ler(PERFIL_REGISTRO.correcaoSemOriginal);
    const ano = await ler(PERFIL_REGISTRO.correcaoAno);
    const tmp = await ler(PERFIL_REGISTRO.correcaoRascunho);
    console.log(
      `[${a.cod}] correção: S=original suspenso, P=paciente, M=modelo, C=CBO, HA=retrato do atendimento ${mostrar(orig)}`,
    );
    console.log(
      `[${a.cod}] correção: Q (1 lançada depois da suspensão), QS=quem suspendeu corrige, CS=correção suspensa ${mostrar(ordem)}`,
    );
    console.log(
      `[${a.cod}] correção: originais corrigidos mais de uma vez ${mostrar(varias)}; sem original ${mostrar(semOriginal)}`,
    );
    console.log(`[${a.cod}] correção por ano ${mostrar(ano)}; no rascunho ${mostrar(tmp)}`);
    const n = total(orig);
    expect(n).toBeGreaterThan(0);
    expect(total(orig, (l) => num(l['P']) === 1) / n).toBeGreaterThan(0.995);
  });

  it('residente com preceptor e as preferências do PEP por usuário', async () => {
    const acomp = await ler(PERFIL_REGISTRO.preceptor);
    const pref = await ler(PERFIL_REGISTRO.preferencias);
    console.log(`[${a.cod}] preceptor: registros com ID_TBPROFIS_ACOMP_RESP por ano ${mostrar(acomp)}`);
    console.log(`[${a.cod}] PRLOCPACDEFAULT: U=com usuário ${mostrar(pref)}`);
    expect(total(pref)).toBeGreaterThan(0);
  });
});
