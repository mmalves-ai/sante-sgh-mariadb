// 01-ADM L77: por onde e com que texto sai o e-mail do sistema (servidor cadastrado, captura fora de produção, modelo).
import { describe, expect, it } from 'vitest';
import { validarServidorEmail } from './email-configuracao.js';
import {
  autenticacaoSemCifra,
  chaveCofreEmail,
  chaveCofreEmailValida,
  senhaServidorEmailValida,
  conexaoDaSaida,
  codigoDaFinalidade,
  FINALIDADE_DO_ALERTA,
  valoresDoEnvio,
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

describe('autenticação só com cifra (a senha nunca trafega aberta)', () => {
  const cadastro = {
    codigo: 'PRINCIPAL',
    nome: 'Principal',
    host: 'smtp.sintetico.invalid',
    porta: 25,
    seguranca: 'nenhuma',
    exigeAutenticacao: true,
    usuarioAutenticacao: 'envio',
    referenciaCofre: 'email/saida/principal',
    remetenteEmail: 'r@sintetico.invalid',
  };
  it('o cadastro recusa autenticação sem SSL/TLS nem STARTTLS', () => {
    expect(validarServidorEmail(cadastro)).toBe('autenticacao-sem-tls');
    expect(validarServidorEmail({ ...cadastro, seguranca: 'starttls' })).toBeNull();
    expect(
      validarServidorEmail({ ...cadastro, exigeAutenticacao: false, usuarioAutenticacao: null }),
    ).toBeNull();
  });
  it('a saída em produção falha fechada com o servidor antigo que autentica sem cifra', () => {
    expect(conexaoDaSaida(srv(1, { seguranca: 'nenhuma' }), amb)).toEqual({ recusa: 'autenticacao-sem-tls' });
    expect(
      conexaoDaSaida(srv(1, { seguranca: 'nenhuma', exigeAutenticacao: false }), amb),
    ).not.toHaveProperty('recusa');
  });
  it('autenticacaoSemCifra', () => {
    expect(autenticacaoSemCifra('nenhuma', 'envio')).toBe(true);
    expect(autenticacaoSemCifra('ssl_tls', 'envio')).toBe(false);
    expect(autenticacaoSemCifra('nenhuma', null)).toBe(false);
  });
});

describe('chave da senha no cofre presa ao cliente', () => {
  it('compõe pelo cliente; a mesma referência em dois clientes dá chaves diferentes', () => {
    expect(chaveCofreEmail('f22_o5', 'email/saida/principal')).toBe(
      'email/cliente/f22_o5/email/saida/principal',
    );
    expect(chaveCofreEmail('f22_o4', 'email/saida/principal')).not.toBe(
      chaveCofreEmail('f22_o5', 'email/saida/principal'),
    );
  });
  it('a referência cadastrada não escapa do prefixo do cliente', () => {
    const c = chaveCofreEmail('f22_o5', 'email/cliente/f22_o4/email/saida/principal');
    expect(c?.startsWith('email/cliente/f22_o5/')).toBe(true);
    expect(chaveCofreEmail('f22_o5', '../outro')).toBeNull();
    expect(chaveCofreEmail('F22/O5', 'email/saida/principal')).toBeNull();
    expect(chaveCofreEmail('f22_o5', null)).toBeNull();
  });
  it('o cofre só aceita chave de e-mail composta', () => {
    expect(chaveCofreEmailValida('email/cliente/f22_o5/email/saida/principal')).toBe(true);
    expect(chaveCofreEmailValida('email/saida/principal')).toBe(false);
    expect(chaveCofreEmailValida('email/cliente/f22_o5/')).toBe(false);
  });
});

describe('senha do servidor digitada pelo administrador', () => {
  it('aceita texto de 1 a 500 sem caractere de controle', () => {
    expect(senhaServidorEmailValida('Sintetica#1 com espaço')).toBe(true);
    expect(senhaServidorEmailValida('')).toBe(false);
    expect(senhaServidorEmailValida('a'.repeat(501))).toBe(false);
    expect(senhaServidorEmailValida('linha\r\nRCPT')).toBe(false);
    expect(senhaServidorEmailValida(123)).toBe(false);
  });
});

describe('finalidade e valores das outras saídas (relatório agendado, aviso do sistema)', () => {
  it('o tipo de alerta vai pelo mapa; o código da finalidade vale por si; o resto fica sem finalidade', () => {
    expect(codigoDaFinalidade('alerta-chamado')).toBe('ALERTA_CHAMADO');
    expect(codigoDaFinalidade('RELATORIO_AGENDADO')).toBe('RELATORIO_AGENDADO');
    expect(codigoDaFinalidade('AVISO_SISTEMA')).toBe('AVISO_SISTEMA');
    expect(codigoDaFinalidade('relatorio')).toBeNull();
    expect(codigoDaFinalidade("X' OR 1")).toBeNull();
  });
  it('os campos simples vão ao grupo da saída, com o texto padrão', () => {
    const v = valoresDoEnvio(
      'relatorio',
      { titulo: 'Censo diário', nomeEstabelecimento: 'Hospital', lista: ['x'], vazio: null },
      { assunto: 'A', texto: 'T' },
    );
    expect(v).toEqual({
      'relatorio.assunto': 'A',
      'relatorio.texto': 'T',
      'relatorio.titulo': 'Censo diário',
      'relatorio.nome_estabelecimento': 'Hospital',
    });
  });
});
