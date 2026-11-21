// Integração da porta PRÓPRIA da CCIH (F2.2, lote 04-03) contra o MariaDB do cliente de teste da onda 4 (f22_o4).
// Os registros da vigilância aguardam o mapeamento: a porta lê o relógio e os setores, fica em consulta e recusa a
// gravação.
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { ctxBanco, encerrarMassaQualidade, type MassaQualidade, prepararMassaQualidade, SEM_BANCO_QUA, semFalhaFechada } from './massa.spec-util.js';
import { PortaCcihPropria } from './porta-ccih-propria.js';

const T: TrilhaDaGravacao = { estabelecimento: null, usuario: null, acao: 'operacao', entidade: 'teste', entidadeId: null, correlacao: 'teste-l0403' };
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe.skipIf(SEM_BANCO_QUA)('porta própria da CCIH contra o MariaDB (f22_o4)', () => {
  let m: MassaQualidade;
  let porta: PortaCcihPropria;
  let c: ReturnType<typeof ctxBanco>;

  beforeAll(async () => {
    m = await prepararMassaQualidade('C');
    porta = new PortaCcihPropria(m.nucleo);
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
  }, 60_000);
  afterAll(() => encerrarMassaQualidade(m));

  it('o relógio do estabelecimento e a tela em consulta (a liberação diz o motivo)', async () => {
    expect(await porta.relogio(c)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(await porta.podeGravar(c, 'qualquer')).toMatchObject({ pode: false, codigo: 'modelo-pendente' });
  });

  it('a gravação recusa com modelo-pendente sem gravar nada, e a sessão sem estabelecimento é recusada', async () => {
    let chamou = false;
    expect(
      await codigo(
        porta.gravarSgh(c, T, async () => {
          chamou = true;
          return 1;
        }),
      ),
    ).toBe('modelo-pendente');
    expect(chamou).toBe(false);
    expect(await codigo(porta.relogio({ ...c, estabelecimento: null }))).toBe('sem-estabelecimento');
  });

  it('as leituras ainda sem mapeamento falham fechadas (503 modelo-pendente), nunca vazio nem zero', async () => {
    const r = await semFalhaFechada(porta, ['relogio', 'unidades'], c);
    expect(r.chamadas).toBeGreaterThan(5);
    expect(r.erradas).toEqual([]);
  });

  // Os fluxos que o sistema anterior fazia nesta tela aguardam o mapeamento (pedido em saida/04-03.json): pendentes,
  // não afirmados como vazios.
  it.todo('a vigilância e o dispositivo invasivo (dispositivo_invasivo_paciente, caso_infeccao)');
  it.todo('a precaução refletida no mapa de leitos (isolamento_paciente)');
  it.todo('os denominadores do censo e os tempos das leituras');
});
