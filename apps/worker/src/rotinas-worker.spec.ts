// Rotinas do worker (01-SIS L95): o pedido manual muda o trabalho da volta (o censo recupera 31 dias em vez de 7), a
// rotina suspensa não roda e a vigia da plataforma (não suspensível) segue registrando. Dublês no lugar do banco; a
// prova no MariaDB é a rotinas-registro-proprio.int.spec.ts. Dados sintéticos.
import type { MovimentoInternacao } from '@sgh/contratos';
import { dataDoDia, diaDoCenso, relogioDeParede } from '@sgh/dominio-internacao';
import { describe, expect, it } from 'vitest';
import type { DiaCensoParaGravar, PortaCenso } from './censo-fechamento-propria.js';
import {
  CensoFechamentoService,
  JANELA_FECHAMENTO_DIAS,
  JANELA_RECUPERACAO_DIAS,
  janelaDoFechamento,
} from './censo-fechamento.service.js';
import type { EstadoRotina, PortaRotinas, VoltaRotina } from './rotinas-registro-proprio.js';
import { RegistradorRotinas, ROTINAS_WORKER } from './rotinas-worker.js';
import type { AlvoEstabelecimento } from './servico-worker.js';

const EST: AlvoEstabelecimento = { cliente: 'cli_teste', id: 7, codigo: 'est_a', fuso: 'America/Sao_Paulo' };
const MOV: MovimentoInternacao = {
  internacoes: [],
  trechos: [],
  transferencias: [],
  unidades: [{ bloco: '1', acomodacao: 'ENF', nome: 'Enf', tipo: 1, leitos: 2, leitosAtivos: 2 }],
  tipos: new Map([[1, 'Enfermaria']]),
  dadosAte: new Date('2026-10-20T00:00:00Z'),
};
// 2026-10-20 13:00 UTC = 10:00 em São Paulo: o último dia fechado é 2026-10-19.
const AGORA = Date.UTC(2026, 9, 20, 13, 0);
const ULTIMO = diaDoCenso(relogioDeParede(AGORA, EST.fuso), 24) - 1;
const FALTANTE = dataDoDia(ULTIMO - 14);

function portaRotinas(estado: EstadoRotina | null) {
  const voltas: VoltaRotina[] = [];
  const p: PortaRotinas = {
    estado: async () => estado,
    registrar: async (v) => {
      voltas.push(v);
      return { rotina: 1, execucao: v.historico ? 1 : null, disparo: null, situacaoRotina: 'ociosa' };
    },
  };
  return { p, voltas };
}

function portaCenso() {
  const gravados: DiaCensoParaGravar[] = [];
  // Todos os dias do último mês têm retrato, menos um de 14 dias atrás (worker parado mais que a semana).
  const fechados: string[] = [];
  for (let d = ULTIMO - JANELA_RECUPERACAO_DIAS + 1; d <= ULTIMO; d++)
    if (dataDoDia(d) !== FALTANTE) fechados.push(dataDoDia(d));
  const p: PortaCenso = {
    estabelecimentos: async () => [EST],
    configuracao: async () => ({ ligada: true, horaFechamento: null, categoriasIntensivas: [] }),
    diasFechados: async () => fechados,
    movimento: async () => MOV,
    gravarDia: async (_e, d) => {
      gravados.push(d);
      return { unidades: 1, linhas: d.linhas.length, internados: 0 };
    },
  };
  return { p, gravados };
}

async function cicloCenso(estado: EstadoRotina | null) {
  const s = new CensoFechamentoService();
  const censo = portaCenso();
  const rot = portaRotinas(estado);
  const plataforma = { lerPlataforma: async () => [] as never, encerrar: async () => undefined };
  s.usar(plataforma, () => censo.p, new RegistradorRotinas(() => rot.p));
  const antes = process.env['WORKER_CLIENTES'];
  process.env['WORKER_CLIENTES'] = 'cli_teste';
  try {
    const r = await s.ciclo(AGORA);
    return { r, gravados: censo.gravados, voltas: rot.voltas };
  } finally {
    if (antes === undefined) delete process.env['WORKER_CLIENTES'];
    else process.env['WORKER_CLIENTES'] = antes;
    await s.onApplicationShutdown();
  }
}

describe('rotinas do worker: o pedido manual muda o trabalho feito', () => {
  it('a janela do censo pelo disparo: agendada 7 dias, manual 31', () => {
    expect(janelaDoFechamento('agendado')).toBe(JANELA_FECHAMENTO_DIAS);
    expect(janelaDoFechamento('manual')).toBe(JANELA_RECUPERACAO_DIAS);
    expect(JANELA_RECUPERACAO_DIAS).toBeGreaterThan(JANELA_FECHAMENTO_DIAS);
  });

  it('volta agendada não alcança o dia sem retrato de 14 dias atrás; a pedida à mão o recupera', async () => {
    const agendada = await cicloCenso({ ativo: true, situacao: 'ociosa', manualPendente: false });
    expect(agendada.r).toEqual([{ situacao: 'ja-fechado', cliente: 'cli_teste', estabelecimento: 'est_a' }]);
    expect(agendada.gravados).toEqual([]);

    const manual = await cicloCenso({ ativo: true, situacao: 'ociosa', manualPendente: true });
    expect(manual.gravados.map((g) => g.data)).toEqual([FALTANTE]);
    expect(manual.r[0]).toMatchObject({ situacao: 'fechado', dias: [FALTANTE] });
    // O pedido vira histórico com a etapa do estabelecimento e o dia gravado.
    expect(manual.voltas).toHaveLength(1);
    expect(manual.voltas[0]).toMatchObject({ historico: true, gravados: 1, situacao: 'concluida' });
    expect(manual.voltas[0]?.etapas.map((e) => e.nome)).toEqual(['est_a']);
  });

  it('a rotina suspensa não roda; a vigia da plataforma (não suspensível) segue registrando', async () => {
    const suspensa = await cicloCenso({ ativo: true, situacao: 'suspensa', manualPendente: false });
    expect(suspensa.r).toEqual([]);
    expect(suspensa.gravados).toEqual([]);
    expect(suspensa.voltas).toEqual([]);

    const rot = portaRotinas({ ativo: true, situacao: 'suspensa', manualPendente: false });
    const reg = new RegistradorRotinas(() => rot.p);
    let disparos: string[] = [];
    const fn = async (d: string) => {
      disparos = [...disparos, d];
      return { resultado: 'ok', avisos: 1 };
    };
    expect(await reg.rodar('cli_teste', ROTINAS_WORKER.censo, 't', fn)).toBeNull();
    expect(ROTINAS_WORKER.vigiaBanco.permiteSuspensao).toBe(false);
    expect(await reg.rodar('cli_teste', ROTINAS_WORKER.vigiaBanco, 't', fn)).toBe('ok');
    expect(disparos).toEqual(['agendado']);
    expect(rot.voltas.map((v) => v.situacao)).toEqual(['concluida_com_avisos']);
  });

  it('só o censo aceita acionamento manual (as demais não teriam o que antecipar)', () => {
    expect(ROTINAS_WORKER.censo.permiteAcionamentoManual).toBe(true);
    expect(ROTINAS_WORKER.relay.permiteAcionamentoManual).toBe(false);
    expect(ROTINAS_WORKER.envioRelatorios.permiteAcionamentoManual).toBe(false);
    expect(ROTINAS_WORKER.vigiaBanco.permiteAcionamentoManual).toBe(false);
  });
});
