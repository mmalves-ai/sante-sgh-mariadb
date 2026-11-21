// Integração da porta PRÓPRIA da notificação compulsória (F2.2, lote 04-03) contra o MariaDB do cliente de teste da onda 4 (f22_o4).
// O caso de agravo e os gatilhos aguardam o mapeamento: a porta lê o relógio, fica em consulta e recusa a gravação.
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { ctxBanco, encerrarMassaQualidade, type MassaQualidade, prepararMassaQualidade, SEM_BANCO_QUA, semFalhaFechada } from './massa.spec-util.js';
import { PortaAgravoPropria } from './porta-agravo-propria.js';

const T: TrilhaDaGravacao = { estabelecimento: null, usuario: null, acao: 'operacao', entidade: 'teste', entidadeId: null, correlacao: 'teste-l0403' };
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe.skipIf(SEM_BANCO_QUA)('porta própria da notificação compulsória contra o MariaDB (f22_o4)', () => {
  let m: MassaQualidade;
  let porta: PortaAgravoPropria;
  let c: ReturnType<typeof ctxBanco>;

  beforeAll(async () => {
    m = await prepararMassaQualidade('A');
    porta = new PortaAgravoPropria(m.nucleo);
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
    const r = await semFalhaFechada(porta, ['relogio'], c);
    expect(r.chamadas).toBeGreaterThan(5);
    expect(r.erradas).toEqual([]);
  });

  // Os fluxos que o sistema anterior fazia nesta tela aguardam o mapeamento (pedido em saida/04-03.json): pendentes,
  // não afirmados como vazios.
  it.todo('a fila real e o caso aberto pelo gatilho do exame, com o prazo e a ficha (notificacao_agravo, agravo_notificavel)');
  it.todo('a notificação do caso, o descarte com o motivo e o exame que confirma ou descarta');
  it.todo('os tempos das leituras da fila e do caso');
});
