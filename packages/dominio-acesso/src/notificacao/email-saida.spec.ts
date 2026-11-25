// 01-ADM L77: por onde e com que texto sai o e-mail do sistema (servidor cadastrado, captura fora de produção, modelo).
import { describe, expect, it } from 'vitest';
import {
  conexaoDaSaida,
  FINALIDADE_DO_ALERTA,
  servidorDaSaida,
  type ServidorDeSaida,
  textoDoHtml,
  textoPeloModelo,
  valoresDoAlerta,
} from './email-saida.js';

const srv = (id: number, extra: Partial<ServidorDeSaida> = {}): ServidorDeSaida => ({
  id,
  estabelecimento: null,
  finalidade: null,
  host: `smtp${id}.sintetico.invalid`,
  porta: 587,
  seguranca: 'starttls',
  exigeAutenticacao: true,
  usuarioAutenticacao: 'envio',
  referenciaCofre: 'email/saida/principal',
  remetenteEmail: `remetente${id}@sintetico.invalid`,
  remetenteNome: 'HOSPITAL SINTETICO',
  responderPara: null,
  tempoLimiteSegundos: 30,
  padrao: false,
  ativo: true,
  ...extra,
});
const amb = {
  producao: true,
  local: { host: '127.0.0.1', porta: 1025 },
  remetentePadrao: 'padrao@x.invalid',
};

describe('servidorDaSaida', () => {
  it('padrão antes dos outros; inativo nunca', () => {
    expect(servidorDaSaida([srv(1), srv(2, { padrao: true })], 5, null)?.id).toBe(2);
    expect(servidorDaSaida([srv(1, { ativo: false })], 5, null)).toBeNull();
  });
  it('o da finalidade antes do geral e o do estabelecimento antes do de todos', () => {
    const lista = [srv(1, { padrao: true }), srv(2, { finalidade: 5 }), srv(3, { estabelecimento: 9 })];
    expect(servidorDaSaida(lista, 5, 9)?.id).toBe(2);
    expect(servidorDaSaida(lista, 6, 9)?.id).toBe(3);
    expect(servidorDaSaida(lista, 6, 8)?.id).toBe(1);
  });
});

describe('conexaoDaSaida', () => {
  it('fora de produção sai sempre pela captura local, sem senha, com o remetente cadastrado', () => {
    const c = conexaoDaSaida(srv(4), { ...amb, producao: false });
    expect(c).toMatchObject({
      host: '127.0.0.1',
      porta: 1025,
      seguranca: 'nenhuma',
      usuario: null,
      referenciaCofre: null,
      remetente: 'remetente4@sintetico.invalid',
      servidor: 4,
    });
  });
  it('em produção usa o servidor cadastrado com a referência da senha', () => {
    expect(conexaoDaSaida(srv(4), amb)).toMatchObject({
      host: 'smtp4.sintetico.invalid',
      seguranca: 'starttls',
      usuario: 'envio',
      referenciaCofre: 'email/saida/principal',
      servidor: 4,
    });
    expect(conexaoDaSaida(srv(4, { exigeAutenticacao: false }), amb)).toMatchObject({ usuario: null });
  });
  it('sem servidor cadastrado cai no do ambiente; sem nenhum, recusa', () => {
    expect(conexaoDaSaida(null, amb)).toMatchObject({
      host: '127.0.0.1',
      servidor: null,
      remetente: 'padrao@x.invalid',
    });
    expect(conexaoDaSaida(null, { ...amb, local: null })).toEqual({ recusa: 'sem-servidor' });
  });
});

describe('modelo', () => {
  const modelo = {
    id: 1,
    assunto: 'Emergência {{alerta.id_emergencia}}\n({{alerta.hospital}})',
    corpoHtml: '<p>Registro {{alerta.id_emergencia}} &amp; revisão</p><p>{{alerta.texto}}</p>',
    corpoTexto: null,
    remetenteEmail: null,
    remetenteNome: null,
    responderPara: 'auditoria@sintetico.invalid',
  };
  it('troca os marcadores pelos campos do alerta e usa o texto do HTML', () => {
    const v = valoresDoAlerta(
      { idEmergencia: '77', hospital: 'H1', lixo: { a: 1 } },
      { assunto: 'A', texto: 'T' },
    );
    expect(v).toMatchObject({ 'alerta.id_emergencia': '77', 'alerta.hospital': 'H1', 'alerta.texto': 'T' });
    expect(v['alerta.lixo']).toBeUndefined();
    expect(textoPeloModelo(modelo, v)).toEqual({
      assunto: 'Emergência 77 (H1)',
      texto: 'Registro 77 & revisão\nT',
      remetente: null,
      remetenteNome: null,
      responderPara: 'auditoria@sintetico.invalid',
    });
  });
  it('marcador sem valor devolve o que falta', () => {
    expect(textoPeloModelo(modelo, { 'alerta.texto': 'T' })).toEqual({
      faltando: ['alerta.id_emergencia', 'alerta.hospital'],
    });
  });
  it('texto do HTML e finalidades dos alertas', () => {
    expect(textoDoHtml('a<br>b<p>c</p>d')).toBe('a\nbc\nd');
    expect(Object.values(FINALIDADE_DO_ALERTA)).toHaveLength(4);
  });
});
