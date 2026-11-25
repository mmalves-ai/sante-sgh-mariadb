// Rota do lote de trabalho da bancada (F3.5, 05-SADT linha 8): o que o controller garante antes de chegar ao serviço.
// Cada rota exige a permissão de digitar o resultado e declara a auditoria; sem o banco do cliente responde 503; sem
// sessão, 401; sem a Idempotency-Key, 400; o corpo inválido é recusado com 400 sem chamar o serviço; o corpo válido chega ao serviço com o
// contexto da sessão; a lista devolve os lotes do dia e a fila fora de lote de cada bancada. O efeito no banco (e a
// recusa do lote e da bancada de outro estabelecimento) está em aplicacao/lote-trabalho.int.spec.ts.
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_AUDITAR, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoLoteTrabalho } from './aplicacao/lote-trabalho-propria.js';
import { LoteTrabalhoController } from './lote-trabalho.controller.js';

const CHAVE = 'tela-lote-0001';
const comSessao = (headers: Record<string, string> = { 'idempotency-key': CHAVE }) =>
  ({
    headers,
    sgh: {
      sessao: { estabelecimentoAtivo: 'hsint', rede: 'rede-sint', usuario: { id: '7', login: 'SINT' } },
    },
  }) as unknown as RequisicaoAutorizada;
const semSessao = () => ({ headers: {} }) as unknown as RequisicaoAutorizada;
const status = (e: unknown) => (e instanceof ErroProblema ? e.getStatus() : String(e));
const capturar = async (f: () => unknown) => {
  try {
    await f();
    return 'sem-erro';
  } catch (e) {
    return status(e);
  }
};

function servicoFalso() {
  const chamadas: { metodo: string; usuario: unknown; entrada: unknown }[] = [];
  const chaves: unknown[] = [];
  const registrar =
    (metodo: string) => (c: { usuario: unknown; chaveIdempotencia?: unknown }, entrada: unknown) => {
      chamadas.push({ metodo, usuario: c.usuario, entrada });
      chaves.push(c.chaveIdempotencia);
      return Promise.resolve(
        metodo === 'listar' ? [{ id: 1 }] : metodo === 'fila' ? [{ bancada: 3, foraDeLote: 2 }] : { id: 1 },
      );
    };
  const servico = {
    listar: registrar('listar'),
    fila: registrar('fila'),
    abrir: registrar('abrir'),
    fechar: registrar('fechar'),
    imprimir: registrar('imprimir'),
  } as unknown as ServicoLoteTrabalho;
  return { servico, chamadas, chaves };
}

describe('rota do lote de trabalho da bancada', () => {
  const rotas = ['listar', 'abrir', 'fechar', 'imprimir'] as const;

  it('toda rota exige a permissão de digitar o resultado e declara a auditoria', () => {
    for (const r of rotas) {
      const alvo = LoteTrabalhoController.prototype[r];
      expect(Reflect.getMetadata(CHAVE_PERMISSAO, alvo), r).toBe('sadt.resultado.digitar');
      expect(
        Reflect.getMetadata(r === 'listar' ? CHAVE_AUDITAR : CHAVE_AUDITADO_NO_HANDLER, alvo),
        r,
      ).toBeTruthy();
    }
  });

  it('sem o banco do cliente responde 503; sem sessão, 401', async () => {
    const semBanco = new LoteTrabalhoController(null);
    expect(await capturar(() => semBanco.listar({}, comSessao()))).toBe(503);
    expect(await capturar(() => semBanco.abrir({ bancada: 1 }, comSessao()))).toBe(503);
    expect(await capturar(() => semBanco.fechar({ lote: 1 }, comSessao()))).toBe(503);
    expect(await capturar(() => semBanco.imprimir({ lote: 1 }, comSessao()))).toBe(503);
    const { servico, chamadas } = servicoFalso();
    const c = new LoteTrabalhoController(servico);
    expect(await capturar(() => c.abrir({ bancada: 1 }, semSessao()))).toBe(401);
    expect(await capturar(() => c.listar({}, semSessao()))).toBe(401);
    expect(chamadas).toEqual([]);
  });

  it('o corpo inválido é recusado com 400 sem chamar o serviço', async () => {
    const { servico, chamadas } = servicoFalso();
    const c = new LoteTrabalhoController(servico);
    for (const corpo of [null, {}, { bancada: 0 }, { bancada: '3' }, { bancada: 3, outro: 1 }])
      expect(await capturar(() => c.abrir(corpo, comSessao())), JSON.stringify(corpo)).toBe(400);
    for (const corpo of [null, {}, { lote: -1 }, { lote: 1.5 }, { lote: 2, bancada: 3 }]) {
      expect(await capturar(() => c.fechar(corpo, comSessao())), JSON.stringify(corpo)).toBe(400);
      expect(await capturar(() => c.imprimir(corpo, comSessao())), JSON.stringify(corpo)).toBe(400);
    }
    expect(chamadas).toEqual([]);
  });

  it('a gravação sem a Idempotency-Key do pedido é recusada com 400 sem chamar o serviço', async () => {
    const { servico, chamadas } = servicoFalso();
    const c = new LoteTrabalhoController(servico);
    for (const headers of [{}, { 'idempotency-key': 'curta' }]) {
      expect(await capturar(() => c.abrir({ bancada: 3 }, comSessao(headers)))).toBe(400);
      expect(await capturar(() => c.fechar({ lote: 5 }, comSessao(headers)))).toBe(400);
      expect(await capturar(() => c.imprimir({ lote: 5 }, comSessao(headers)))).toBe(400);
    }
    expect(chamadas).toEqual([]);
  });

  it('o corpo válido chega ao serviço com o usuário da sessão; a lista traz os lotes do dia e a fila', async () => {
    const { servico, chamadas, chaves } = servicoFalso();
    const c = new LoteTrabalhoController(servico);
    await c.abrir({ bancada: 3, analista: 9 }, comSessao());
    await c.fechar({ lote: 5 }, comSessao());
    await c.imprimir({ lote: 5 }, comSessao());
    expect(chamadas).toEqual([
      { metodo: 'abrir', usuario: 7, entrada: { bancada: 3, analista: 9 } },
      { metodo: 'fechar', usuario: 7, entrada: { lote: 5 } },
      { metodo: 'imprimir', usuario: 7, entrada: { lote: 5 } },
    ]);
    // A chave do pedido chega ao serviço: o reenvio pela mesma chave devolve o mesmo lote sem gravar de novo.
    expect(chaves).toEqual([CHAVE, CHAVE, CHAVE]);
    chamadas.length = 0;
    const req = comSessao();
    expect(await c.listar({ data: '2026-03-15' }, req)).toEqual({
      lotes: [{ id: 1 }],
      fila: [{ bancada: 3, foraDeLote: 2 }],
    });
    expect(chamadas.map((x) => [x.metodo, x.entrada])).toEqual([
      ['listar', '2026-03-15'],
      ['fila', undefined],
    ]);
    expect(req.sghAlvo).toMatchObject({ tabelaAlvo: 'grupo_trabalho_bancada' });
    // A data fora do formato não chega ao serviço: vale o dia corrente.
    chamadas.length = 0;
    await c.listar({ data: "2026-03-15' OR 1=1" }, comSessao());
    expect(chamadas[0]!.entrada).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
