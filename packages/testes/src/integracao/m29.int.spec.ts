// Farmácia sobre a cópia (ficha do M29, seção 10, e regras 2, 5, 6, 8 e 11), sempre em transação desfeita e sob a trava
// da cópia:
//   - dispensação de um horário real (internação com conta aberta, item com saldo no local da farmácia): a dispensação,
//     o lançamento, a dose, a saída a internado consolidada pelo gatilho (o valor e a baixa do saldo), a ligação
//     horário × saída × dose e o controle de entrega em 7 (regra 11: o mat/med vai à conta pela saída do estoque);
//   - repetir com a mesma Idempotency-Key não dispensa de novo; com outra chave, "já dispensada" (regra 2);
//   - fila disputada (regra 2): outra conexão segura o horário (WITH LOCK) e a dispensação passa adiante: "ocupada";
//   - suspensão no meio: o horário suspenso por fora antes da gravação é recusado ("item suspenso");
//   - entrega (regra 5): o aceite por outro usuário grava o 8 numa linha nova; o próprio dispensador é recusado;
//   - devolução da dose (regra 6): volta a quantidade dispensada; o excesso é recusado;
//   - valor nunca visto (regra 8): a avaliação no outro sistema (2, 3, 4) sem a decisão da DP-25 é recusada.
// O retrato antes e depois (maiores IDs das tabelas da dispensação, as linhas do horário e o saldo do item) prova que o
// ROLLBACK desfez tudo. Massa: internação, prescrição, horário e item da cópia (só IDs); os operadores sintéticos.
import { ErroOperacao, operacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { horarioDispensavel, suspenderHorarioPorFora } from '../massa/reproducao-farmacia.js';
import { CENTRO_SETOR, LOCAL_CENTRAL, usuarioEstoque } from '../massa/reproducao-suprimentos.js';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).message}`;
  }
}

describe.skipIf(!PODE_ESCREVER)('M29: farmácia na cópia (transação desfeita)', () => {
  let a: Ambiente;
  let massa: Awaited<ReturnType<typeof horarioDispensavel>>;
  beforeAll(async () => {
    a = await prepararAmbiente();
    massa = await a.nucleo.lerSomente(ctx(a), (l) =>
      horarioDispensavel(l as unknown as Escritor, { local: LOCAL_CENTRAL, minimo: 3 }),
    );
  }, 600_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      cad: await contar(l, 'SELECT MAX(ID) N FROM GECADDISPENSACAO'),
      lan: await contar(l, 'SELECT MAX(ID) N FROM GELANDISPENSACAO'),
      dose: await contar(l, 'SELECT MAX(ID) N FROM GEDISPHOR'),
      ctrl: await contar(l, 'SELECT MAX(ID) N FROM GECTRLENTREGADOCSAIDA'),
      saida: await contar(l, 'SELECT MAX(ID) N FROM GECADSAI'),
      integ: await contar(l, 'SELECT COUNT(*) N FROM PRINTEGRACAOESTOQUE WHERE ID_PRCHKGERAL = ?', [
        massa.horario,
      ]),
      doseHorario: await contar(l, 'SELECT COUNT(*) N FROM GEDISPHOR WHERE ID_PRCHKGERAL = ?', [
        massa.horario,
      ]),
      estoque: await contar(l, 'SELECT ESTOQUE N FROM GEITENS WHERE COD = ?', [massa.item]),
      aceites: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_ENTREGA_ACEITE'),
    }));

  async function operador(e: Escritor) {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    await usuarioEstoque(e, login);
    const exec = (op: string, x: unknown, chave?: string) =>
      a.executor.executar(operacao(op), a.cod, x, ctxOperacao(a, login, chave), { escritor: e });
    return { login, exec };
  }
  const entrada = () => ({
    atendimento: massa.reg,
    local: LOCAL_CENTRAL,
    centroCusto: CENTRO_SETOR,
    doses: [
      {
        horario: massa.horario,
        quantidade: 1,
        lotes: massa.lote ? [{ ...massa.lote, quantidade: 1 }] : [],
      },
    ],
  });

  it('dispensa o horário: dispensação, dose, saída consolidada pelo gatilho, ligação e controle em 7; a mesma chave não repete (regras 2 e 11)', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await operador(e);
      const chave = `int-m29-${Date.now().toString(36)}`;
      const x = await p.exec('suprimentos.dispensarHorario', entrada(), chave);
      const y = await p.exec('suprimentos.dispensarHorario', entrada(), chave);
      const outra = await codigo(p.exec('suprimentos.dispensarHorario', entrada()));
      const saida = num(x.resultado['saida']);
      const [c] = await e.consultar(
        'SELECT CONSOL, DEST, ORIGEM, ID_PRESC FROM GECADSAI WHERE ID = ?',
        [saida],
        { teto: 1 },
      );
      const [s] = await e.consultar(
        'SELECT s.VLRMED, s.HM, s.CONSOL FROM GELANSAI s JOIN GEDISPHOR d ON d.ID_GELANSAI = s.ID_GELANSAI WHERE d.ID_PRCHKGERAL = ?',
        [massa.horario],
        { teto: 1 },
      );
      const ctrl = await contar(
        e,
        'SELECT COUNT(*) N FROM GECTRLENTREGADOCSAIDA WHERE ID_GECADSAI = ? AND ID_TBSITUACAOFARMACIA = 7',
        [saida],
      );
      const integ = await contar(
        e,
        'SELECT COUNT(*) N FROM PRINTEGRACAOESTOQUE WHERE ID_PRCHKGERAL = ? AND ID_GEDISPHOR IS NOT NULL AND ID_GELANSAI IS NOT NULL',
        [massa.horario],
      );
      const estoque = await contar(e, 'SELECT ESTOQUE N FROM GEITENS WHERE COD = ?', [massa.item]);
      return { x, y, outra, c, s, ctrl, integ, estoque };
    });
    expect(r.x.repetida).toBe(false);
    expect(num(r.x.resultado['doses'])).toBe(1);
    expect(r.y.repetida).toBe(true);
    expect(r.outra).toBe('dose-ja-dispensada');
    expect(r.c?.['CONSOL']).toBe('T');
    expect(num(r.c?.['DEST'])).toBe(1);
    expect(String(r.c?.['ORIGEM']).trim()).toBe('E');
    expect(num(r.s?.['VLRMED'])).toBeGreaterThan(0);
    expect(String(r.s?.['CONSOL']).trim()).toBe('T');
    expect(r.ctrl).toBe(1);
    expect(r.integ).toBe(1);
    expect(r.estoque).toBe(antes.estoque - 1);
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('fila disputada: outra conexão segura o horário e a dose passa adiante ("ocupada"), nada gravado (regra 2)', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (trava) => {
      await trava.consultar('SELECT ID FROM PRCHKGERAL WHERE ID = ? WITH LOCK', [massa.horario], { teto: 1 });
      return a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const p = await operador(e);
        return codigo(p.exec('suprimentos.dispensarHorario', entrada()));
      });
    });
    expect(['doses-ocupadas', 'registro-em-edicao']).toContain(r);
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('suspensão no meio: o horário suspenso por fora antes de gravar é recusado; o centro sem integração também', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await operador(e);
      const semIntegracao = await codigo(
        p.exec('suprimentos.dispensarHorario', { ...entrada(), centroCusto: 9999 }),
      );
      await suspenderHorarioPorFora(e, massa.horario);
      const suspenso = await codigo(p.exec('suprimentos.dispensarHorario', entrada()));
      return { semIntegracao, suspenso };
    });
    expect(r.semIntegracao).toBe('centro-sem-integracao');
    expect(r.suspenso).toBe('item-suspenso');
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('entrega por outro usuário grava o 8 numa linha nova; o dispensador não aceita; a devolução da dose volta e o excesso é recusado (regras 5 e 6)', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const farm = await operador(e);
      const x = await farm.exec('suprimentos.dispensarHorario', entrada());
      const controle = num(x.resultado['controle']);
      const proprio = await codigo(farm.exec('suprimentos.confirmarEntrega', { controle, modo: 'tablet' }));
      const enf = await operador(e);
      const aceite = await enf.exec('suprimentos.confirmarEntrega', {
        controle,
        modo: 'tablet',
        dispositivo: 'TABLET SINTETICO',
      });
      const linhas = await contar(e, 'SELECT COUNT(*) N FROM GECTRLENTREGADOCSAIDA WHERE ID_GECADSAI = ?', [
        num(x.resultado['saida']),
      ]);
      const aceites = await contar(
        e,
        'SELECT COUNT(*) N FROM SGH_SUP_ENTREGA_ACEITE WHERE ID_GECTRLENTREGA = ?',
        [controle],
      );
      const dose = Number(String(x.resultado['idsDoses']).split(',')[0]);
      const excesso = await codigo(
        farm.exec('suprimentos.devolverDose', {
          dose,
          local: LOCAL_CENTRAL,
          quantidade: 5,
          motivo: 'nao-administrado',
          ...(massa.lote ? { lote: massa.lote.lote } : {}),
        }),
      );
      const dev = await farm.exec('suprimentos.devolverDose', {
        dose,
        local: LOCAL_CENTRAL,
        quantidade: 1,
        motivo: 'nao-administrado',
        ...(massa.lote ? { lote: massa.lote.lote } : {}),
      });
      const estoque = await contar(e, 'SELECT ESTOQUE N FROM GEITENS WHERE COD = ?', [massa.item]);
      return { proprio, aceite, linhas, aceites, excesso, dev, estoque };
    });
    expect(r.proprio).toBe('aceite-pelo-dispensador');
    expect(num(r.aceite.resultado['controle'])).toBeGreaterThan(0);
    expect(r.linhas).toBe(2);
    expect(r.aceites).toBe(1);
    expect(r.excesso).toBe('quantidade-maior-que-a-saida');
    expect(num(r.dev.resultado['doc'])).toBeGreaterThan(0);
    // D-MOTOR-28 (herdado): a devolução não repõe o saldo do item na empresa, que o outro sistema grava sem gatilho na
    // consolidação; por isso a devolução da dose nasce desligada até o cenário controlado do M36.
    expect(r.estoque).toBe(antes.estoque - 1);
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('valor nunca visto: a avaliação no outro sistema sem a decisão da DP-25 é recusada (regra 8)', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await operador(e);
      return codigo(p.exec('suprimentos.avaliarPrescricao', { horario: massa.horario, decisao: 'valido' }));
    });
    expect(['valor-nunca-visto', 'operacao-nao-liberada']).toContain(r);
    expect(await retrato()).toEqual(antes);
  }, 600_000);
});
