// Regra 1 do M48 (não punitiva): o que o NSP, o gestor da área e o notificador veem. Dados sintéticos.
import type { NotificacaoDetalhe } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  acompanhamentoDe,
  ATOR_ANONIMO,
  atorDaNotificacao,
  payloadDaTrilha,
  projetarNotificacao,
} from './visibilidade.js';

const n: NotificacaoDetalhe = {
  id: 10,
  protocolo: 'NSP-2026-000010',
  notificadaEm: '2026-10-18T04:00:00',
  ocorridoEm: '2026-10-18T03:40:00',
  tipo: 'queda',
  classificacao: 'eventoAdverso',
  dano: 'leve',
  situacao: 'distribuida',
  notivisa: 'pendente',
  unidade: 'Unidade sintética',
  comPaciente: true,
  anonima: false,
  proximoPrazo: null,
  versao: 4,
  descricao: 'Queda sintética ao lado do leito.',
  local: null,
  chegouAoPaciente: true,
  danoPercebido: 'leve',
  tipoOutro: null,
  neverEvent: false,
  notificador: 'SGH.SINT.TECNICO',
  paciente: { id: 7, nome: 'PACIENTE SINTETICO', prontuario: 123, leito: '208-B' },
  gestor: 'SGH.SINT.GESTOR',
  prazoAnalise: '2026-11-10',
  prazos: [],
  eventos: [
    { tipo: 'recebida', em: '2026-10-18T04:00:00', por: 'SGH.SINT.TECNICO', texto: null },
    { tipo: 'triada', em: '2026-10-18T08:00:00', por: 'SGH.SINT.NSP', texto: null },
    { tipo: 'devolutiva', em: '2026-10-19T08:00:00', por: 'SGH.SINT.NSP', texto: 'Grade revisada no setor.' },
    { tipo: 'devolutiva', em: '2026-10-19T09:00:00', por: 'SGH.SINT.NSP', texto: null },
  ],
};

describe('projeção por leitor', () => {
  it('NSP vê quem notificou só quando não é anônima', () => {
    expect(projetarNotificacao(n, { papel: 'nsp' })?.notificador).toBe('SGH.SINT.TECNICO');
    expect(projetarNotificacao({ ...n, anonima: true }, { papel: 'nsp' })?.notificador).toBeNull();
  });

  it('o gestor da distribuição vê sem o notificador e sem autor na linha do tempo; outro gestor não vê', () => {
    const g = projetarNotificacao(n, { papel: 'gestor', login: ' sgh.sint.gestor ' });
    expect(g?.notificador).toBeNull();
    expect(g?.eventos.every((e) => e.por === null)).toBe(true);
    expect(g?.descricao).toBe(n.descricao);
    expect(projetarNotificacao(n, { papel: 'gestor', login: 'SGH.SINT.OUTRO' })).toBeNull();
    expect(
      projetarNotificacao({ ...n, gestor: null }, { papel: 'gestor', login: 'SGH.SINT.GESTOR' }),
    ).toBeNull();
  });

  it('qualquer outro não vê', () => {
    expect(projetarNotificacao(n, { papel: 'outro' })).toBeNull();
  });
});

describe('acompanhamento do notificador', () => {
  it('só a situação e as devolutivas com texto, sem classificação, gestor nem notificador', () => {
    const a = acompanhamentoDe(n);
    expect(a).toEqual({
      protocolo: 'NSP-2026-000010',
      notificadaEm: '2026-10-18T04:00:00',
      situacao: 'distribuida',
      devolutivas: [{ em: '2026-10-19T08:00:00', texto: 'Grade revisada no setor.' }],
    });
    expect(JSON.stringify(a)).not.toContain('SGH.SINT');
  });
});

describe('trilha da regra 11', () => {
  it('anônima vai com o marcador e sem origem; identificada com o login', () => {
    expect(atorDaNotificacao(true, 'SGH.SINT.TECNICO')).toEqual({ ator: ATOR_ANONIMO, semOrigem: true });
    expect(atorDaNotificacao(false, 'SGH.SINT.TECNICO')).toEqual({
      ator: 'SGH.SINT.TECNICO',
      semOrigem: false,
    });
  });

  it('o payload leva só o ID e o protocolo', () => {
    expect(payloadDaTrilha(n)).toEqual({ notificacao: 10, protocolo: 'NSP-2026-000010' });
  });
});
