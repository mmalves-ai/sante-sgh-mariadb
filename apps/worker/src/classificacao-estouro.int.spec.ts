// Integração da porta própria do aviso de estouro sobre o MariaDB real (cliente f22_o5; lote F2.2 05-15): a chave
// ligada; o atendimento aberto com as etapas; a classificação concluída com a cor do nível de prioridade; o estouro
// pendente no relógio injetado, com a leitura dentro da meta; dois consumidores gravando o MESMO aviso ao mesmo tempo:
// um grava (versão 1, trilha), o outro desiste sem erro; o ciclo seguinte não acha pendente; a classificação de outro
// estabelecimento é recusada. Massa sintética com as chaves estrangeiras desligadas só na montagem; apagada no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { CHAVE_LIBERACAO_CLASSIFICACAO, recursoDesligado } from '@sgh/contratos';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaEstouroPropria } from './classificacao-estouro-propria.js';
import { estourosPendentes } from './classificacao-estouro.service.js';
import { CLIENTE, escrever, garantirCliente, garantirEstabelecimento, inserirSintetico, SEM_BANCO } from './importadores/integracao.spec-util.js';
import type { AlvoEstabelecimento } from './servico-worker.js';

describe.skipIf(SEM_BANCO)('aviso de estouro sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est: AlvoEstabelecimento;
  let outro: AlvoEstabelecimento;
  const ids = { atendimento: 0, classificacao: 0, alheia: 0, nivel: 0 };
  const classificadoEm = new Date('2026-10-24T08:00:00.000Z');

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      for (const x of [est, outro].filter(Boolean)) {
        await e.executar(
          'DELETE a FROM aviso_estouro_classificacao a JOIN classificacao_risco c ON c.id = a.classificacao_risco_id WHERE c.estabelecimento_id = ?',
          [x.id],
        );
        await e.executar('DELETE FROM classificacao_risco WHERE estabelecimento_id = ?', [x.id]);
        await e.executar(
          'DELETE t FROM atendimento_etapa_pa t JOIN atendimento a ON a.id = t.atendimento_id WHERE a.estabelecimento_id = ?',
          [x.id],
        );
        await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [x.id]);
        await e.executar('DELETE FROM liberacao_chave WHERE estabelecimento_id = ? AND chave = ?', [x.id, CHAVE_LIBERACAO_CLASSIFICACAO]);
        await e.executar('DELETE FROM recurso_prerequisito WHERE estabelecimento_id = ? AND recurso = ?', [x.id, CHAVE_LIBERACAO_CLASSIFICACAO]);
      }
      await e.executar("DELETE FROM nivel_prioridade WHERE codigo = 'F515AMARELO'");
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    const a = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f515e'));
    const b = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f515m'));
    est = { cliente: CLIENTE, id: a, codigo: 'f515e', fuso: 'America/Sao_Paulo' };
    outro = { cliente: CLIENTE, id: b, codigo: 'f515m', fuso: 'America/Sao_Paulo' };
    await limpar();
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      ids.nivel = await inserirSintetico(e, 'nivel_prioridade', {
        codigo: 'F515AMARELO',
        descricao: 'Amarelo sintético',
        nome_cor: 'amarelo',
        cor_hexadecimal: '#FFFF00',
        contexto: 'geral',
        ordem: 9515,
      });
      const atendimento = (estabelecimento: number, numero: string) =>
        inserirSintetico(e, 'atendimento', {
          estabelecimento_id: estabelecimento,
          numero,
          paciente_id: 9_905_150,
          categoria_atendimento_id: 1,
          carater_atendimento_tiss_id: 1,
          fonte_pagadora_id: 1,
          profissional_id: 9_905_150,
          situacao: 'aberto',
          entrada_em: new Date('2026-10-24T07:50:00.000Z'),
          criado_em: agora,
        });
      const classificacao = (estabelecimento: number, atendimentoId: number) =>
        inserirSintetico(e, 'classificacao_risco', {
          estabelecimento_id: estabelecimento,
          atendimento_id: atendimentoId,
          paciente_id: 9_905_150,
          protocolo_classificacao_risco_versao_id: 1,
          proposto_nivel_prioridade_id: ids.nivel,
          nivel_prioridade_id: ids.nivel,
          tempo_alvo_minutos: 60,
          prazo_atendimento_em: new Date(classificadoEm.getTime() + 3_600_000),
          queixa_principal: 'Queixa sintética',
          classificador_profissional_id: 9_905_150,
          inicio_em: classificadoEm,
          classificado_em: classificadoEm,
          situacao: 'concluida',
          criado_em: agora,
        });
      ids.atendimento = await atendimento(a, 'F515-AT-1');
      await inserirSintetico(e, 'atendimento_etapa_pa', {
        atendimento_id: ids.atendimento,
        etapa: 'classificacao',
        ocorrida_em: classificadoEm,
        criado_em: agora,
      });
      ids.classificacao = await classificacao(a, ids.atendimento);
      ids.alheia = await classificacao(b, await atendimento(b, 'F515-AT-2'));
      await inserirSintetico(e, 'liberacao_chave', {
        estabelecimento_id: a,
        tipo: 'recurso',
        chave: CHAVE_LIBERACAO_CLASSIFICACAO,
        escopo: 'hospital',
        valor: '*',
        ligada: 1,
        criado_em: agora,
      });
      for (const tipo of new Set((recursoDesligado(CHAVE_LIBERACAO_CLASSIFICACAO)?.prerequisitos ?? []).map((p) => p.tipo)))
        await inserirSintetico(e, 'recurso_prerequisito', {
          estabelecimento_id: a,
          recurso: CHAVE_LIBERACAO_CLASSIFICACAO,
          tipo,
          situacao: 'cumprido',
          criado_em: agora,
        });
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.encerrar();
  });

  it('a leitura do ciclo com o relógio injetado acha o estouro, dentro da meta', async () => {
    const porta = new PortaEstouroPropria(nucleo, CLIENTE);
    const t0 = performance.now();
    const r = await estourosPendentes(porta, est, new Date('2026-10-24T10:00:00.000Z'));
    expect(Math.round(performance.now() - t0)).toBeLessThan(5_000);
    expect(r.ligada).toBe(true);
    expect(r.pendentes).toEqual([
      {
        chave: `pa.classificacao.estouro:f515e:${ids.classificacao}`,
        classificacao: ids.classificacao,
        atendimento: ids.atendimento,
        prazoEm: '2026-10-24T09:00:00.000Z',
        cor: 'amarelo',
      },
    ]);
    expect((await porta.ligada(outro, new Date())) ).toBe(false);
  });

  it('dois consumidores, o mesmo aviso: um grava (versão 1 e trilha), o outro desiste; o ciclo seguinte não repete', async () => {
    const porta = new PortaEstouroPropria(nucleo, CLIENTE);
    const [p] = (await estourosPendentes(porta, est, new Date('2026-10-24T10:00:00.000Z'))).pendentes;
    const rs = await Promise.all([
      new PortaEstouroPropria(nucleo, CLIENTE).registrarAviso(est, p!),
      new PortaEstouroPropria(nucleo, CLIENTE).registrarAviso(est, p!),
    ]);
    expect(rs.filter(Boolean)).toHaveLength(1);
    const linha = await escrever(nucleo, (e) =>
      e.uma('SELECT versao, classificacao_risco_id FROM aviso_estouro_classificacao WHERE chave = ?', [p!.chave]),
    );
    expect(Number(linha!['versao'])).toBe(1);
    const t = await escrever(nucleo, (e) =>
      e.uma("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'classificacao_risco' AND entidade_id = ?", [ids.classificacao]),
    );
    expect(Number(t!['n'])).toBe(1);
    expect((await estourosPendentes(porta, est, new Date('2026-10-24T10:00:00.000Z'))).pendentes).toEqual([]);
  });

  it('a classificação de outro estabelecimento é recusada', async () => {
    const porta = new PortaEstouroPropria(nucleo, CLIENTE);
    await expect(
      porta.registrarAviso(est, {
        chave: `pa.classificacao.estouro:f515e:${ids.alheia}`,
        classificacao: ids.alheia,
        atendimento: 1,
        prazoEm: '2026-10-24T09:00:00.000Z',
        cor: 'amarelo',
      }),
    ).rejects.toThrow(/neste estabelecimento/);
  });
});
