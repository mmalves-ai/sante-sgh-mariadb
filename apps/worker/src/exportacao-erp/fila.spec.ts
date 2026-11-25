import type { ItemAtualErp, ResultadoRetornoErp, SituacaoLoteErp } from '@sgh/dominio-integracao';
import { describe, expect, it } from 'vitest';
import {
  adaptadorErpSimuladoWorker,
  type FonteFilaErp,
  importarRetornoErp,
  type LoteParaEnvioErp,
  type LoteSemRetornoErp,
  processarFilaErp,
} from './fila.js';

/** Falhas injetadas por chamada da fonte (uma vez cada). */
type Falha = 'reservar' | 'registrar' | 'retorno';

function memoria(falhas: Set<Falha> = new Set()) {
  const lotes = new Map<
    number,
    { situacao: SituacaoLoteErp; versao: number; protocolo: string | null; itens: ItemAtualErp[] }
  >();
  lotes.set(1, {
    situacao: 'gerado',
    versao: 1,
    protocolo: null,
    itens: [
      { sequencia: 1, situacao: 'pendente', chaveExterna: null, valor: 10 },
      { sequencia: 2, situacao: 'pendente', chaveExterna: null, valor: 5 },
    ],
  });
  lotes.set(2, {
    situacao: 'gerado',
    versao: 1,
    protocolo: null,
    itens: [{ sequencia: 1, situacao: 'pendente', chaveExterna: null, valor: 7 }],
  });
  const gravacoes: ResultadoRetornoErp[] = [];
  const envios: number[] = [];
  const falhar = (f: Falha) => {
    if (falhas.delete(f)) throw new Error(`falha em ${f}`);
  };
  const lote = (id: number, l: { versao: number; itens: ItemAtualErp[] }): LoteParaEnvioErp => ({
    id,
    numero: `ERP-${id}`,
    tipo: 'pagar',
    versao: l.versao,
    itens: l.itens.map((i) => ({
      sequencia: i.sequencia,
      cpfCnpj: i.sequencia === 1 ? '12345678000199' : null,
      valor: i.valor,
      conteudo: {},
    })),
  });
  const transitar = (id: number, versao: number, de: SituacaoLoteErp, para: SituacaoLoteErp) => {
    const l = lotes.get(id)!;
    if (l.versao !== versao || l.situacao !== de) throw new Error('LoteErpMudou');
    Object.assign(l, { situacao: para, versao: versao + 1 });
    return l;
  };
  const fonte: FonteFilaErp = {
    lotesParaEnviar: async () =>
      [...lotes.entries()].filter(([, l]) => l.situacao === 'gerado').map(([id, l]) => lote(id, l)),
    lotesSemRetorno: async () =>
      [...lotes.entries()]
        .filter(([, l]) => l.situacao === 'enviado' && l.protocolo)
        .map(([id, l]): LoteSemRetornoErp => ({ ...lote(id, l), protocolo: l.protocolo! })),
    reservarEnvio: async (_h, id, versao) => {
      falhar('reservar');
      return transitar(id, versao, 'gerado', 'enviando').versao;
    },
    liberarEnvio: async (_h, id, versao) => {
      transitar(id, versao, 'enviando', 'gerado');
    },
    registrarEnvio: async (_h, id, versao, protocolo) => {
      falhar('registrar');
      const l = transitar(id, versao, 'enviando', 'enviado');
      l.protocolo = protocolo;
      return l.versao;
    },
    itensAtuais: async (_h, id) => ({ situacao: lotes.get(id)!.situacao, itens: lotes.get(id)!.itens }),
    gravarRetorno: async (_h, id, v, r) => {
      falhar('retorno');
      const l = lotes.get(id)!;
      if (l.versao !== v) throw new Error('LoteErpMudou');
      gravacoes.push(r);
      for (const m of r.mudancas) {
        const i = l.itens.findIndex((x) => x.sequencia === m.sequencia);
        l.itens[i] = { ...l.itens[i]!, situacao: m.situacao, chaveExterna: m.chaveExterna };
      }
      l.situacao = r.situacaoLote;
      l.versao++;
    },
  };
  const adaptador = {
    ...adaptadorErpSimuladoWorker,
    enviar: (l: LoteParaEnvioErp) => {
      // O adaptador só é chamado com o lote já reservado: nunca em gerado.
      expect(lotes.get(l.id)!.situacao).toBe('enviando');
      envios.push(l.id);
      return adaptadorErpSimuladoWorker.enviar(l);
    },
  };
  return { lotes, gravacoes, fonte, envios, adaptador };
}

describe('job da fila com o ERP', () => {
  it('reserva, envia pelo simulador e importa o retorno; o segundo ciclo não reenvia', async () => {
    const m = memoria();
    expect(await processarFilaErp(m.fonte, m.adaptador, 'h')).toEqual({
      enviados: 2,
      retomados: 0,
      falhas: 0,
      itensAlterados: 3,
      rejeitados: 1,
    });
    const l = m.lotes.get(1)!;
    expect(l).toMatchObject({ situacao: 'processado_com_erro', protocolo: 'SIM-ERP-1' });
    expect(l.itens.map((i) => [i.situacao, i.chaveExterna])).toEqual([
      ['exportado', 'SIM-ERP-1-1'],
      ['rejeitado', null],
    ]);
    expect(m.lotes.get(2)!.situacao).toBe('processado');
    expect(await processarFilaErp(m.fonte, m.adaptador, 'h')).toMatchObject({ enviados: 0, falhas: 0 });
    expect(m.envios).toEqual([1, 2]);
  });

  it('falha do adaptador devolve o lote reservado a gerado e conta a falha; o outro lote segue', async () => {
    const m = memoria();
    let chamadas = 0;
    const r = await processarFilaErp(
      m.fonte,
      {
        ...m.adaptador,
        enviar: (l) => (++chamadas === 1 ? Promise.reject(new Error('fora do ar')) : m.adaptador.enviar(l)),
      },
      'h',
    );
    expect(r).toMatchObject({ enviados: 1, falhas: 1 });
    expect(m.lotes.get(1)!).toMatchObject({ situacao: 'gerado', protocolo: null });
    expect(m.lotes.get(2)!.situacao).toBe('processado');
  });

  it('lote que mudou na reserva não vai ao ERP, conta falha e não interrompe o ciclo', async () => {
    const m = memoria(new Set(['reservar']));
    const r = await processarFilaErp(m.fonte, m.adaptador, 'h');
    expect(r).toMatchObject({ enviados: 1, falhas: 1 });
    expect(m.envios).toEqual([2]);
    expect(m.lotes.get(1)!.situacao).toBe('gerado');
  });

  it('falha ao registrar o envio conta falha, não reenvia e o lote fica reservado', async () => {
    const m = memoria(new Set(['registrar']));
    const r = await processarFilaErp(m.fonte, m.adaptador, 'h');
    expect(r).toMatchObject({ enviados: 1, falhas: 1 });
    expect(m.lotes.get(1)!.situacao).toBe('enviando');
    expect(await processarFilaErp(m.fonte, m.adaptador, 'h')).toMatchObject({ enviados: 0, falhas: 0 });
    expect(m.envios).toEqual([1, 2]);
  });

  it('falha ao gravar o retorno: o lote fica enviado e o ciclo seguinte retoma pelo protocolo', async () => {
    const m = memoria(new Set(['retorno']));
    expect(await processarFilaErp(m.fonte, m.adaptador, 'h')).toMatchObject({
      enviados: 2,
      retomados: 0,
      falhas: 1,
    });
    expect(m.lotes.get(1)!).toMatchObject({ situacao: 'enviado', protocolo: 'SIM-ERP-1' });
    expect(await processarFilaErp(m.fonte, m.adaptador, 'h')).toMatchObject({
      enviados: 0,
      retomados: 1,
      falhas: 0,
    });
    expect(m.lotes.get(1)!.situacao).toBe('processado_com_erro');
    expect(m.envios).toEqual([1, 2]);
  });

  it('retorno avulso repetido não grava de novo (idempotente)', async () => {
    const m = memoria();
    await processarFilaErp(m.fonte, m.adaptador, 'h');
    const antes = m.gravacoes.length;
    const ret = [{ sequencia: 2, aceito: true, chaveExterna: 'ERP-9', mensagem: null }];
    expect((await importarRetornoErp(m.fonte, 'h', 1, m.lotes.get(1)!.versao, ret)).situacaoLote).toBe(
      'processado',
    );
    expect((await importarRetornoErp(m.fonte, 'h', 1, m.lotes.get(1)!.versao, ret)).repetidos).toBe(1);
    expect(m.gravacoes.length).toBe(antes + 1);
  });
});

describe('serviço da fila do ERP no worker', () => {
  it('liga só com FILA_ERP_ENVIO=ligado em dev/ci e usa o simulador fora de produção', async () => {
    const { adaptadorErpDoAmbiente, filaErpLigada } = await import('./fila.service.js');
    expect(filaErpLigada({ AMBIENTE: 'dev' })).toBe(false);
    expect(filaErpLigada({ AMBIENTE: 'dev', FILA_ERP_ENVIO: 'ligado' })).toBe(true);
    expect(filaErpLigada({ AMBIENTE: 'producao', FILA_ERP_ENVIO: 'desligado' })).toBe(false);
    expect(adaptadorErpDoAmbiente({ AMBIENTE: 'dev' })).toBe(adaptadorErpSimuladoWorker);
    expect(adaptadorErpDoAmbiente({ AMBIENTE: 'homolog', NODE_ENV: 'production' })).toBe(
      adaptadorErpSimuladoWorker,
    );
    // Produção é a chave AMBIENTE=producao (regra 6), não o NODE_ENV: sem adaptador configurado, não envia.
    expect(adaptadorErpDoAmbiente({ AMBIENTE: 'producao', NODE_ENV: 'development' })).toBeNull();
    expect(adaptadorErpDoAmbiente({ AMBIENTE: 'producao', NODE_ENV: 'production' })).toBeNull();
  });
});
