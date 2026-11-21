// Unidade: a porta da agenda de exames em memória (dev/ci) com os tipos de negócio próprios, o relógio civil do
// estabelecimento e a conversão de data e hora civil em instante. Dados SINTÉTICOS.
import type { ContextoNucleo, ContextoOperacao } from '@sgh/nucleo';
import { ErroOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { PortaExameMemoria } from './porta-memoria.js';
import { civil, hhmmDeMinutos, instanteCivil, minutosDeHhmm, relogioNoFuso } from './relogio.js';

const ctx: ContextoNucleo = { cliente: 'sintetico', estabelecimento: 1, usuario: 7, correlacao: 'unidade-01-05' };
let k = 0;
const op = (): ContextoOperacao => ({ ...ctx, chaveIdempotencia: `unidade-${++k}-0105` });
const codigo = (e: unknown) => (e instanceof ErroOperacao ? e.problema['codigo'] : null);

describe('relógio civil do estabelecimento', () => {
  it('data e hora no fuso; instante de volta; minutos e HHMM', () => {
    const r = relogioNoFuso('America/Sao_Paulo', new Date('2026-11-20T12:05:00Z'));
    expect(r).toEqual({ hoje: '2026-11-20', hhmm: '0905' });
    expect(instanteCivil('2026-11-20', '0905', 'America/Sao_Paulo').toISOString()).toBe('2026-11-20T12:05:00.000Z');
    expect(civil(new Date('2026-11-21T02:30:00Z'), 'America/Sao_Paulo')).toEqual({ data: '2026-11-20', hhmm: '2330' });
    expect(minutosDeHhmm('0120')).toBe(80);
    expect(hhmmDeMinutos(20)).toBe('0020');
    expect(relogioNoFuso('Fuso/Inexistente', new Date('2026-11-20T12:05:00Z')).hhmm).toBe('0905');
  });
});

describe('porta da agenda de exames em memória', () => {
  const relogio = () => ({ hoje: '2026-11-20', hhmm: '0600' });
  const pacientes = async () => [
    { id: 501, nome: 'PACIENTE SINTETICO', prontuario: 9001, telefone: null, celular: null, ativo: true },
  ];

  it('agendas com booleano de ativa e grade por id da agenda; estado nomeado do horário', async () => {
    const p = new PortaExameMemoria(null, pacientes, relogio);
    const ags = await p.agendas(ctx);
    expect(ags.find((a) => a.id === 954)?.ativa).toBe(false);
    expect((await p.escala(ctx, 951)).length).toBeGreaterThan(0);
    expect((await p.geracoes(ctx, 951))[0]).toMatchObject({ situacao: 'gerada', dias: [2, 3, 4, 5, 6] });
    const h = await p.horarios(ctx, 951, '2026-11-23', '2026-11-23');
    expect(h.itens[0]).toMatchObject({ estado: 'vago', paciente: null, marcacao: null });
  });

  it('marca, lista com estado e cancela; recusa o horário ocupado e a entrada inválida', async () => {
    const p = new PortaExameMemoria(null, pacientes, relogio);
    const [h] = (await p.horarios(ctx, 951, '2026-11-23', '2026-11-23')).itens;
    const entrada = {
      agenda: 951,
      data: h?.data,
      hora: h?.hora,
      paciente: 501,
      convenio: 10,
      exame: 7001,
      solicitante: null,
      retorno: false,
      canal: 'telefone',
    };
    const r = await p.executar(ctx, 'agenda.agendarExame', entrada, op());
    const id = Number(r.resultado['marcacao']);
    const dia = await p.marcacoesDoDia(ctx, h?.data ?? '', 951);
    expect(dia.itens).toContainEqual(expect.objectContaining({ id, estado: 'marcado', atendido: false }));
    expect(codigo(await p.executar(ctx, 'agenda.agendarExame', entrada, op()).catch((e) => e))).toBe('horario-ocupado');
    expect(codigo(await p.executar(ctx, 'agenda.agendarExame', { agenda: 951 }, op()).catch((e) => e))).toBe(
      'entrada-invalida',
    );
    await p.executar(ctx, 'agenda.cancelarExame', { marcacao: id, motivo: 'PAC-DESISTIU', solicitante: 'paciente' }, op());
    const canc = await p.cancelamentos(ctx, { de: '2026-11-20', ate: '2026-11-20', agendas: [951], pagina: 1, porPagina: 10 });
    expect(canc.total).toBe(1);
    expect((await p.podeGravar(ctx, 'agenda.agendarExameSemProntuario')).pode).toBe(false);
  });
});
