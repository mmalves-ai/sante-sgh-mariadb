// Integração da porta da contabilidade do worker sobre o MariaDB real (cliente f22_o5; lote F2.2 05-12): os
// estabelecimentos do cliente, a liberação do recurso `contabil` lida do estabelecimento (chave e pré-requisitos), as
// contagens dos fatos por situação (só do estabelecimento e sem os excluídos) e a recusa `modelo-pendente` da leitura e
// da gravação da contabilização automática (regras publicadas sem tabela; gravação comum pedida). O ciclo do cliente
// sobre a porta real registra a recusa com o código. Massa sintética (estabelecimentos fo512c e fo512d, fatos
// sintéticos), com as chaves estrangeiras desligadas só na montagem; apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { CHAVE_CONTABIL, recursoDesligado } from '@sgh/contratos';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  inserirSintetico,
  SEM_BANCO,
  sha,
} from '../importadores/integracao.spec-util.js';
import { cicloDoCliente } from './leitura-fatos.service.js';
import { contabilLigadaPor, PortaContabilWorkerPropria } from './porta-propria.js';

const ORIGEM = 'teste_05_12';

describe.skipIf(SEM_BANCO)('porta da contabilidade do worker sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaContabilWorkerPropria;
  let estA = 0;
  let estB = 0;

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      await e.executar('DELETE FROM fato_contabil WHERE entidade_origem = ?', [ORIGEM]);
      await e.executar('DELETE FROM liberacao_chave WHERE estabelecimento_id IN (?, ?) AND chave = ?', [estA, estB, CHAVE_CONTABIL]);
      await e.executar('DELETE FROM recurso_prerequisito WHERE estabelecimento_id IN (?, ?) AND recurso = ?', [
        estA,
        estB,
        CHAVE_CONTABIL,
      ]);
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    porta = new PortaContabilWorkerPropria(nucleo, CLIENTE);
    estA = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'fo512c'));
    estB = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'fo512d'));
    await limpar();
    await escrever(nucleo, async (e) => {
      const agora = new Date();
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      await inserirSintetico(e, 'liberacao_chave', {
        estabelecimento_id: estA,
        tipo: 'recurso',
        chave: CHAVE_CONTABIL,
        escopo: 'hospital',
        valor: '*',
        ligada: 1,
        criado_em: agora,
      });
      // estB: a chave do estabelecimento desligada e uma chave de pessoa ligada (não vale para o worker).
      await inserirSintetico(e, 'liberacao_chave', {
        estabelecimento_id: estB,
        tipo: 'recurso',
        chave: CHAVE_CONTABIL,
        escopo: 'hospital',
        valor: '*',
        ligada: 0,
        criado_em: agora,
      });
      await inserirSintetico(e, 'liberacao_chave', {
        estabelecimento_id: estB,
        tipo: 'recurso',
        chave: CHAVE_CONTABIL,
        escopo: 'pessoa',
        valor: 'servico.contabil',
        ligada: 1,
        criado_em: agora,
      });
      for (const p of recursoDesligado(CHAVE_CONTABIL)?.prerequisitos ?? [])
        await inserirSintetico(e, 'recurso_prerequisito', {
          estabelecimento_id: estA,
          recurso: CHAVE_CONTABIL,
          tipo: p.tipo,
          situacao: 'cumprido',
          criado_em: agora,
        });
      const fato = (est: number, id: number, situacao: string, excluido: Date | null) =>
        inserirSintetico(e, 'fato_contabil', {
          estabelecimento_id: est,
          evento_contabil_id: 9_905_120,
          entidade_origem: ORIGEM,
          entidade_origem_id: id,
          data_fato: '2026-10-15',
          competencia: '2026-10-01',
          valor: 10,
          impressao: sha(`05-12:${id}`),
          situacao,
          criado_em: agora,
          excluido_em: excluido,
        });
      await fato(estA, 1, 'pendente', null);
      await fato(estA, 2, 'pendente', null);
      await fato(estA, 3, 'sem_regra', null);
      await fato(estA, 4, 'pendente', agora);
      await fato(estB, 5, 'pendente', null);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.encerrar();
  });

  it('estabelecimentos: os dois sintéticos estão na lista do cliente', async () => {
    const codigos = (await porta.estabelecimentos()).map((x) => x.codigo);
    expect(codigos).toEqual(expect.arrayContaining(['fo512c', 'fo512d']));
  });

  it('liberação: a chave e os pré-requisitos do estabelecimento ligam o recurso; chave de pessoa não liga o outro', async () => {
    const agora = new Date();
    const a = await porta.liberacao(estA);
    expect(a.chaves).toEqual([{ escopo: 'hospital', valor: '*', ligada: true }]);
    expect(a.prerequisitos).toHaveLength(recursoDesligado(CHAVE_CONTABIL)?.prerequisitos.length ?? 0);
    expect(contabilLigadaPor(a, agora)).toBe(true);
    const b = await porta.liberacao(estB);
    // Só a chave do estabelecimento é lida: a de pessoa ('servico.contabil') fica de fora e não liga o recurso.
    expect(b.chaves).toEqual([{ escopo: 'hospital', valor: '*', ligada: false }]);
    expect(contabilLigadaPor(b, agora)).toBe(false);
  });

  it('contagem: por situação do estabelecimento, sem os excluídos e sem os de outro estabelecimento', async () => {
    expect(await porta.fatosPorSituacao(estA)).toMatchObject({ pendente: 2, semRegra: 1, contabilizado: 0 });
    expect((await porta.fatosPorSituacao(estB)).pendente).toBe(1);
  });

  it('contabilização: leitura e gravação recusadas com modelo-pendente, sem gravar nada', async () => {
    const ler = porta.ler();
    await expect(ler).rejects.toBeInstanceOf(ErroOperacao);
    await expect(ler).rejects.toMatchObject({ problema: { codigo: 'modelo-pendente' } });
    await expect(porta.gravar()).rejects.toMatchObject({ problema: { codigo: 'modelo-pendente' } });
    expect(await porta.fatosPorSituacao(estA)).toMatchObject({ pendente: 2, contabilizado: 0 });
  });

  it('ciclo do cliente: só o estabelecimento liberado entra, com a recusa registrada pelo código', async () => {
    const r = (await cicloDoCliente(porta, CLIENTE, new Date(), {})).filter((x) =>
      ['fo512c', 'fo512d'].includes(x.estabelecimento),
    );
    expect(r).toEqual([{ cliente: CLIENTE, estabelecimento: 'fo512c', pendentes: 2, lancamentos: 0, falha: 'modelo-pendente' }]);
  });
});
