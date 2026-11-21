// Integração da porta própria do alerta de vencimento dos contratos sobre o MariaDB real (cliente f22_o5; lote F2.2
// 05-15): a chave ligada; o contrato vigente com o gestor e o fiscal vigentes (o mesmo usuário: um destinatário) e o que só tem o gestor principal, com antecedência, assunto e mensagem próprios; o
// aviso gravado na central (versão 1, chave de agrupamento, trilha); o segundo aviso não grava nem abre trilha; o
// contrato de outro estabelecimento não aparece. Massa sintética com as chaves estrangeiras desligadas só na montagem;
// apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { CHAVE_LIBERACAO_CONTRATOS, recursoDesligado } from '@sgh/contratos';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaContratosPropria } from './contratos-vencimento-propria.js';
import { cicloContratos } from './contratos-vencimento.service.js';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  garantirUsuario,
  inserirSintetico,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import type { AlvoEstabelecimento } from './servico-worker.js';

const AGORA = new Date('2026-10-28T15:00:00.000Z');

describe.skipIf(SEM_BANCO)('alerta de vencimento dos contratos sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est: AlvoEstabelecimento;
  let outro = 0;
  let usuario = 0;
  let contrato = 0;
  let principal = 0;
  let proprio = 0;

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      for (const id of [est?.id, outro].filter(Boolean)) {
        await e.executar("DELETE FROM notificacao_usuario WHERE estabelecimento_id = ? AND entidade = 'contrato_fornecedor'", [id]);
        await e.executar(
          'DELETE g FROM gestor_contrato g JOIN contrato_fornecedor c ON c.id = g.contrato_fornecedor_id WHERE c.estabelecimento_id = ?',
          [id],
        );
        await e.executar('DELETE FROM contrato_fornecedor WHERE estabelecimento_id = ?', [id]);
        await e.executar('DELETE FROM liberacao_chave WHERE estabelecimento_id = ? AND chave = ?', [id, CHAVE_LIBERACAO_CONTRATOS]);
        await e.executar('DELETE FROM recurso_prerequisito WHERE estabelecimento_id = ? AND recurso = ?', [id, CHAVE_LIBERACAO_CONTRATOS]);
      }
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    const a = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f515k'));
    outro = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f515m'));
    est = { cliente: CLIENTE, id: a, codigo: 'f515k', fuso: 'America/Sao_Paulo' };
    usuario = await escrever(nucleo, (e) => garantirUsuario(e, 'f515.gestor'));
    principal = await escrever(nucleo, (e) => garantirUsuario(e, 'f515.principal'));
    await limpar();
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      const cadastrar = (estabelecimento: number, numero: string, extra: Record<string, unknown> = {}) =>
        inserirSintetico(e, 'contrato_fornecedor', {
          estabelecimento_id: estabelecimento,
          numero,
          objeto: 'Objeto sintético',
          empresa_fornecedora_id: 1,
          tipo: 'servico',
          data_emissao: '2026-01-01',
          vigencia_inicio: '2026-01-01',
          vigencia_fim: '2026-11-10',
          situacao: 'vigente',
          criado_em: agora,
          ...extra,
        });
      contrato = await cadastrar(a, 'CT-F515-1');
      await cadastrar(outro, 'CT-F515-2');
      // Só o gestor principal (sem vínculo em gestor_contrato), com antecedência, assunto e mensagem próprios.
      proprio = await cadastrar(a, 'CT-F515-3', {
        vigencia_fim: '2026-11-15',
        gestor_usuario_id: principal,
        dias_alerta_vencimento: 20,
        assunto_alerta: 'Renovar contrato sintético',
        mensagem_alerta: 'Mensagem sintética do contrato.',
      });
      for (const papel of ['gestor', 'fiscal'])
        await inserirSintetico(e, 'gestor_contrato', {
          contrato_fornecedor_id: contrato,
          usuario_id: usuario,
          papel,
          vigencia_inicio: '2026-01-01',
          criado_em: agora,
        });
      await inserirSintetico(e, 'liberacao_chave', {
        estabelecimento_id: a,
        tipo: 'recurso',
        chave: CHAVE_LIBERACAO_CONTRATOS,
        escopo: 'hospital',
        valor: '*',
        ligada: 1,
        criado_em: agora,
      });
      for (const tipo of new Set((recursoDesligado(CHAVE_LIBERACAO_CONTRATOS)?.prerequisitos ?? []).map((p) => p.tipo)))
        await inserirSintetico(e, 'recurso_prerequisito', {
          estabelecimento_id: a,
          recurso: CHAVE_LIBERACAO_CONTRATOS,
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

  it('lê o contrato vigente do estabelecimento com o gestor e o fiscal vigentes (um destinatário)', async () => {
    const porta = new PortaContratosPropria(nucleo, CLIENTE);
    expect(await porta.ligada(est, AGORA)).toBe(true);
    expect(await porta.contratos(est, '2026-10-28')).toEqual([
      {
        id: contrato,
        numero: 'CT-F515-1',
        situacao: 'vigente',
        inicio: '2026-01-01',
        fim: '2026-11-10',
        destinatarios: [usuario],
        diasAlerta: null,
        assunto: null,
        mensagem: null,
      },
      {
        id: proprio,
        numero: 'CT-F515-3',
        situacao: 'vigente',
        inicio: '2026-01-01',
        fim: '2026-11-15',
        destinatarios: [principal],
        diasAlerta: 20,
        assunto: 'Renovar contrato sintético',
        mensagem: 'Mensagem sintética do contrato.',
      },
    ]);
  });

  it('avisa uma vez na central (versão 1 e trilha); o ciclo seguinte não grava nem abre trilha', async () => {
    const porta = new PortaContratosPropria(nucleo, CLIENTE);
    expect(await cicloContratos(porta, est, AGORA)).toEqual({ ligada: true, emAlerta: 3, avisos: 3, semDestinatario: 0 });
    const n = await escrever(nucleo, (e) =>
      e.uma(
        "SELECT versao, usuario_id, chave_agrupamento, gravidade FROM notificacao_usuario WHERE estabelecimento_id = ? AND entidade = 'contrato_fornecedor' AND entidade_id = ?",
        [est.id, contrato],
      ),
    );
    expect(n).toMatchObject({ versao: 1, chave_agrupamento: `contrato-vencimento:${contrato}:2026-11-10:vence-30`, gravidade: 'atencao' });
    expect(Number(n!['usuario_id'])).toBe(usuario);
    const trilha = async () =>
      Number(
        (await escrever(nucleo, (e) =>
          e.uma("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'contrato_fornecedor' AND entidade_id = ?", [contrato]),
        ))!['n'],
      );
    expect(await trilha()).toBe(1);
    expect(await cicloContratos(porta, est, AGORA)).toEqual({ ligada: true, emAlerta: 3, avisos: 0, semDestinatario: 0 });
    const doPrincipal = await escrever(nucleo, (e) =>
      e.consultar(
        "SELECT usuario_id, titulo, texto, chave_agrupamento FROM notificacao_usuario WHERE entidade = 'contrato_fornecedor' AND entidade_id = ? ORDER BY chave_agrupamento",
        [proprio],
      ),
    );
    expect(doPrincipal.map((x) => [Number(x['usuario_id']), x['chave_agrupamento']])).toEqual([
      [principal, `contrato-vencimento:${proprio}:2026-11-15:antecedencia-20`],
      [principal, `contrato-vencimento:${proprio}:2026-11-15:vence-30`],
    ]);
    expect(doPrincipal.every((x) => x['titulo'] === 'Renovar contrato sintético (vence em 15/11/2026)')).toBe(true);
    expect(doPrincipal.every((x) => x['texto'] === 'Mensagem sintética do contrato.')).toBe(true);
    expect(await trilha()).toBe(1);
  });
});
