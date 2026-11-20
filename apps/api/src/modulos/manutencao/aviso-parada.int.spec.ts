// A abertura da OS de equipamento crítico parado pela porta da manutenção sobre UMA transação da cópia
// (portaManutencaoNaTransacao, o mesmo gravador e a mesma trilha da porta do legado), SEMPRE desfeita
// (desfazendoNaCopia): o equipamento sintético crítico num setor real do pc que tem usuários, a OS corretiva com a
// parada, o aviso do controller a cada login do setor (SGH_ADM_AVISO, unicidade por login/evento/objeto) e a linha da
// SGH_TRILHA, tudo na mesma transação. Depois do ROLLBACK, nem o aviso, nem a OS, nem o equipamento existem (o retrato
// por contagens, com SGH_ADM_AVISO e a trilha, fica no manutencao.int.spec.ts do @sgh/legado, que é quem fala SQL).
// Saída: só contagens agregadas (abaixo de 5 vira <5); os logins ficam em memória, nunca impressos.
import {
  avisosDoUsuario,
  escritasDaTransacao,
  type LinhaTrilha,
  lerEquipamentoPorCodigo,
  lerOrdemServico,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';
import { ManutencaoController } from './manutencao.controller.js';
import { portaManutencaoNaTransacao } from './porta-legado.js';
import type { GravadorManutencao } from './porta.js';

const mascara = (x: number) => (x > 0 && x < 5 ? '<5' : String(x));
const USUARIO = 'SGH.TESTE.M551';
type AvisarParada = (
  g: GravadorManutencao,
  eq: NonNullable<Awaited<ReturnType<GravadorManutencao['equipamento']>>>,
  os: { id: number; numero: string },
) => Promise<{ alerta: unknown; avisados: number }>;
// O aviso é o do controller (o mesmo método que a rota POST /manutencao/os chama), sem reescrever a regra no teste.
const avisarParada = (ManutencaoController as unknown as { avisarParada: AvisarParada }).avisarParada.bind(
  ManutencaoController,
);

describe.skipIf(!PODE_ESCREVER)('aviso do crítico parado e trilha na cópia (M55.1)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('OS + evento + aviso + trilha na mesma transação; tudo desfeito', async () => {
    const ctx = { ...a.c, traceId: 'int-m55-1-aviso' };
    const r = await a.nucleo.desfazendoNaCopia(ctx, async (e) => {
      const porta = portaManutencaoNaTransacao(e);
      const trilha = (x: { os: number }): LinhaTrilha => ({
        rede: a.c.rede,
        hospital: a.c.hospital,
        usuario: USUARIO,
        evento: 'manutencao.os.aberta',
        recurso: 'manutencao',
        operacao: 'manutencao.os.aberta',
        tabelaAlvo: 'SGH_MAN_OS',
        idAlvo: String(x.os),
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: null,
        correlacao: 'int-m55-1-aviso',
      });
      const feito = await porta.gravarSgh(a.c, trilha, async (g) => {
        // Um setor real do pc que tem usuários (GEUSERS_TBCENCUS): procura entre os ativos, sem imprimir nada.
        let setor: number | null = null;
        let logins: string[] = [];
        for (const s of (await g.setores()).filter((x) => x.ativo).slice(0, 200)) {
          logins = await g.loginsDoSetor(s.codigo);
          if (logins.length > 0) {
            setor = s.codigo;
            break;
          }
        }
        if (setor === null) throw new Error('nenhum setor do estabelecimento com usuários');
        const { agora } = await g.relogio();
        const novo = await g.incluirEquipamento({
          codigo: 'TESTE-M551-AVISO',
          nome: 'MONITOR SINTETICO M551 AVISO',
          tipo: 'medico',
          criticidade: 'critica',
          classeRisco: 'III',
          fabricante: null,
          modelo: null,
          numeroSerie: 'SN-M551-AVISO',
          registroAnvisa: null,
          unidade: null,
          centroCusto: setor,
          localizacao: null,
          recurso: null,
          bemPatrimonial: null,
          instalacao: '2025-01-10',
          garantiaAte: null,
          situacao: 'ativo',
          motivo: null,
          usuario: USUARIO,
        });
        const os = await g.abrirOs({
          natureza: 'corretiva',
          equipamento: novo.id,
          centroCusto: setor,
          local: null,
          descricao: 'Parou durante o uso (teste sintético)',
          contato: null,
          prioridadeSugerida: 'emergencia',
          prioridade: 'emergencia',
          solicitante: USUARIO,
          registro: agora,
          parado: true,
          plano: null,
          nota: null,
        });
        const eq = await g.equipamento(novo.id);
        if (!eq) throw new Error('equipamento sintético não relido');
        const aviso = await avisarParada(g, eq, os);
        // De novo para o mesmo objeto: a unicidade (login, evento, objeto) não avisa duas vezes.
        const repetido = await avisarParada(g, eq, os);
        const destinatarios = [...new Set(logins.map((l) => l.trim().toUpperCase()))];
        return { os: os.id, avisados: aviso.avisados, repetidos: repetido.avisados, destinatarios };
      });
      const escritas = await escritasDaTransacao(e);
      const avisosDentro = (await avisosDoUsuario(e, a.cod, feito.destinatarios[0]!)).filter(
        (x) => x.link === `/manutencao/os?os=${feito.os}`,
      ).length;
      return { ...feito, avisosDentro, escritas: escritas.map((x) => x.tabela).sort() };
    });
    const depois = await a.nucleo.lerSomente(ctx, async (l) => ({
      avisos: (await avisosDoUsuario(l, a.cod, r.destinatarios[0]!)).filter(
        (x) => x.link === `/manutencao/os?os=${r.os}`,
      ).length,
      os: await lerOrdemServico(l, a.cod, r.os),
      equipamento: await lerEquipamentoPorCodigo(l, a.cod, 'TESTE-M551-AVISO'),
    }));
    console.log(
      `[m55.1 aviso] avisados ${mascara(r.avisados)}; repetidos ${r.repetidos}; escritas ${r.escritas.join(', ')}`,
    );
    expect(r.avisados).toBeGreaterThan(0);
    expect(r.avisados).toBeGreaterThanOrEqual(r.destinatarios.length);
    expect(r.repetidos).toBe(0);
    expect(r.avisosDentro).toBe(1);
    expect(r.escritas).toEqual(
      expect.arrayContaining([
        'SGH_ADM_AVISO',
        'SGH_MAN_EQUIPAMENTO',
        'SGH_MAN_OS',
        'SGH_MAN_OS_EVENTO',
        'SGH_TRILHA',
      ]),
    );
    expect(
      r.escritas.every((t) => t.startsWith('SGH_') || t.startsWith('RDB$') || t.startsWith('MON$')),
    ).toBe(true);
    expect(depois).toEqual({ avisos: 0, os: null, equipamento: null });
  }, 900_000);
});
