// Envio agendado sobre o banco próprio (lote F2.2 05-17), unidade: conversões da agenda do banco para a regra do
// domínio, relógio de parede, máscara dos e-mails no motivo, parâmetros, e o ciclo dos vencidos sobre porta dublê.
import { RELATORIOS_CATALOGO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { MensagemEmail } from '../smtp.js';
import { dependenciasDoEnvio, enviarVencidos, redeDaFila } from './envio-agendado.service.js';
import {
  agendaDaLinha,
  agoraParede,
  chaveDaReserva,
  diaMesDoDominio,
  diaSemanaDoDominio,
  formaDe,
  horaDoDominio,
  mascararEmails,
  mascararEndereco,
  pedidoDoCadastro,
  parametrosDe,
  type PortaEnvioRelatorio,
  proximoDepoisDoEnvio,
} from './envio-agendado-proprio.js';

describe('envio agendado: conversões do banco para o domínio', () => {
  it('dia da semana (domingo = 1 no banco, 7 no domínio), hora, dia do mês e agenda', () => {
    expect(diaSemanaDoDominio(1)).toBe(7);
    expect(diaSemanaDoDominio(2)).toBe(1);
    expect(diaSemanaDoDominio(7)).toBe(6);
    expect(diaSemanaDoDominio(null)).toBeNull();
    expect(() => diaSemanaDoDominio(9)).toThrow();
    expect(horaDoDominio('07:30:00')).toBe('07:30');
    expect(() => horaDoDominio('x')).toThrow();
    expect(diaMesDoDominio(31)).toBe(28);
    expect(diaMesDoDominio(5)).toBe(5);
    expect(
      agendaDaLinha({ periodicidade: 'semanal', hora_envio: '18:05:00', dia_semana: 2, dia_mes: null }),
    ).toEqual({
      periodicidade: 'semanal',
      hora: '18:05',
      diaSemana: 1,
      diaMes: null,
    });
  });

  it('relógio de parede do fuso, próximo envio, máscara e parâmetros', () => {
    expect(agoraParede(new Date('2026-11-21T15:00:00Z')).toISOString()).toBe('2026-11-21T12:00:00.000Z');
    const agora = new Date('2026-11-21T12:00:00Z');
    const agenda = { periodicidade: 'diaria' as const, hora: '07:00', diaSemana: null, diaMes: null };
    expect(proximoDepoisDoEnvio(agenda, null, agora).toISOString()).toBe('2026-11-22T07:00:00.000Z');
    const futuro = new Date('2026-12-01T07:00:00Z');
    expect(proximoDepoisDoEnvio(agenda, futuro, agora)).toBe(futuro);
    expect(mascararEmails('envio recusado (550 <pessoa@exemplo.invalid> inexistente)')).toBe(
      'envio recusado (550 <***@***> inexistente)',
    );
    expect(parametrosDe('{"mesFim":"mesAnterior","n":3,"x":{"y":1}}')).toEqual({
      mesFim: 'mesAnterior',
      n: 3,
    });
    expect(parametrosDe('não é json')).toEqual({});
    expect(redeDaFila('f22_o5')).toBe('f22-o5');
  });

  it('chave da reserva determinística, endereço mascarado, forma única e o pedido do cadastro', () => {
    const previsto = new Date('2026-11-20T07:30:00Z');
    const k = chaveDaReserva(12, { tipo: 'vencido', previsto });
    expect(k).toBe(chaveDaReserva(12, { tipo: 'vencido', previsto: new Date(previsto.getTime()) }));
    expect(k).not.toBe(chaveDaReserva(12, { tipo: 'vencido', previsto: new Date('2026-11-27T07:30:00Z') }));
    expect(k).not.toBe(chaveDaReserva(13, { tipo: 'vencido', previsto }));
    expect(chaveDaReserva(12, { tipo: 'fila', job: 'j1' })).toBe(
      chaveDaReserva(12, { tipo: 'fila', job: 'j1' }),
    );
    expect(k).toMatch(/^[A-Za-z0-9._:-]{8,80}$/);
    expect(mascararEndereco('pessoa@exemplo.invalid')).toBe('p***@exemplo.invalid');
    expect(mascararEndereco('sem-arroba')).toBe('***');
    expect(['para', 'cc', 'cco', 'copia', 'copia_oculta', null].map(formaDe)).toEqual([
      'para',
      'copia',
      'copia_oculta',
      'copia',
      'copia_oculta',
      'para',
    ]);
    expect(
      pedidoDoCadastro({
        entrega: 'anexo',
        formato: 'xlsx',
        validade_link_horas: null,
        enviar_sem_linhas: 0,
        condicao_envio: ' ',
      }),
    ).toEqual({
      entregaPedida: 'anexo',
      entregaFeita: 'link',
      formatoPedido: 'xlsx',
      validadeLinkHoras: null,
      enviarSemLinhas: false,
      temCondicao: false,
      linhasAvaliadas: false,
    });
  });
});

describe('envio agendado: ciclo dos vencidos sobre porta dublê', () => {
  it('envia o do catálogo, registra com a quantidade e ignora o relatório fora do catálogo', async () => {
    const registros: unknown[] = [];
    const enviados: MensagemEmail[] = [];
    const previsto = new Date('2026-11-20T07:30:00Z');
    const porta: PortaEnvioRelatorio = {
      estabelecimentos: async () => ['aa'],
      nomeEstabelecimento: async () => 'Estabelecimento Teste',
      vencidos: async () => [
        {
          id: 1,
          estabelecimento: 'aa',
          relatorio: 'naoExisteNoCatalogo',
          titulo: 'X',
          parametros: {},
          dono: 9,
          proximoEnvioEm: previsto,
        },
      ],
      destinatarios: async () => ({ destinatarios: ['a@exemplo.invalid'], dono: null }),
      falhasSeguidas: async () => 0,
      reservar: async () => ({ envio: 1, proximoEnvio: new Date() }),
      concluir: async (_h, envio, r) => {
        registros.push({ envio, ...r });
      },
    };
    const d = {
      ...dependenciasDoEnvio(porta, { AMBIENTE: 'dev', SMTP_URL: 'smtp://127.0.0.1:1325' }),
      enviar: async (m: MensagemEmail) => {
        enviados.push(m);
      },
    };
    expect(await enviarVencidos(porta, 'f22_o5', d)).toEqual({
      agendamentos: 1,
      processados: 0,
      ignorados: 1,
      repetidos: 0,
    });
    expect(enviados).toEqual([]);
    expect(registros).toEqual([]);
  });

  it('do catálogo: reserva pelo vencimento lido, envia e conclui; o reservado por outro não envia', async () => {
    const previsto = new Date('2026-11-20T07:30:00Z');
    const origens: unknown[] = [];
    const concluidos: unknown[] = [];
    const enviados: MensagemEmail[] = [];
    let ganha = true;
    const porta: PortaEnvioRelatorio = {
      estabelecimentos: async () => ['aa'],
      nomeEstabelecimento: async () => 'Estabelecimento Teste',
      vencidos: async () => [
        {
          id: 5,
          estabelecimento: 'aa',
          relatorio: relatorioDoCatalogoQualquer(),
          titulo: 'Mensal',
          parametros: {},
          dono: 9,
          proximoEnvioEm: previsto,
        },
      ],
      destinatarios: async () => ({
        destinatarios: ['a@exemplo.invalid', 'b@exemplo.invalid'],
        dono: null,
        avisarFalha: true,
        formas: { para: 1, copia: 0, copia_oculta: 1 },
      }),
      falhasSeguidas: async () => 0,
      reservar: async (_h, ag, origem) => {
        origens.push({ ag, origem });
        return ganha ? { envio: 77, proximoEnvio: new Date() } : null;
      },
      concluir: async (_h, envio, r) => {
        concluidos.push({ envio, situacao: r.situacao, destinatarios: r.destinatarios, formas: r.formas });
      },
    };
    const d = {
      ...dependenciasDoEnvio(porta, { AMBIENTE: 'dev', SMTP_URL: 'smtp://127.0.0.1:1325' }),
      enviar: async (m: MensagemEmail) => {
        enviados.push(m);
      },
    };
    expect(await enviarVencidos(porta, 'f22_o5', d)).toEqual({
      agendamentos: 1,
      processados: 1,
      ignorados: 0,
      repetidos: 0,
    });
    expect(origens).toEqual([{ ag: 5, origem: { tipo: 'vencido', previsto } }]);
    expect(enviados).toHaveLength(2);
    expect(concluidos).toEqual([
      { envio: 77, situacao: 'enviado', destinatarios: 2, formas: { para: 1, copia: 0, copia_oculta: 1 } },
    ]);
    ganha = false;
    expect(await enviarVencidos(porta, 'f22_o5', d)).toEqual({
      agendamentos: 1,
      processados: 0,
      ignorados: 0,
      repetidos: 1,
    });
    expect(enviados).toHaveLength(2);
    expect(concluidos).toHaveLength(1);
  });

  it('sem porta (só a fila), não lê nem grava no banco', async () => {
    const d = dependenciasDoEnvio(null, {});
    expect(await d.emails('aa', '1')).toEqual({ destinatarios: [], dono: null });
    expect(d.registrar).toBeUndefined();
    expect(d.reservar).toBeUndefined();
    expect(await d.nomeEstabelecimento('aa')).toBe('aa');
  });
});

function relatorioDoCatalogoQualquer(): string {
  const r = RELATORIOS_CATALOGO[0];
  if (!r) throw new Error('catálogo vazio');
  return r.codigo;
}
